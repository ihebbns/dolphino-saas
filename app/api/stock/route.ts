// ═══════════════════════════════════════════════════
// /api/stock
//
// GET  ?key=XXX              → returns all stock items for restaurant
// POST ?key=XXX  body={items:[{item_id,item_name,item_emoji,quantity,barcode?,cost?,category?,sell_price?}]}
//                            → set/update stock quantities (full catalog sync from POS)
// PATCH ?key=XXX body={sold:[{item_id, qty, uid?, ts?}], actor?, terminalId?, sessionId?, saleNum?}
//                            → record a sale's stock consumption (called by EXE)
//
// ── LEDGER ─────────────────────────────────────────────────────────────
// Every quantity change is appended to stock_movements (see
// migration-stock-movements.sql) and stock.quantity is refreshed from it.
// Nothing is overwritten in place, so:
//   • two terminals selling at once cannot clobber each other
//   • flushing an offline queue cannot lose or double-apply a sale
//     (each line may carry a `uid` idempotency key and a client `ts`)
//   • every add/decrease is permanently attributable to a person
//
// Backward compatible on purpose: already-deployed EXEs that send neither `uid`
// nor `ts`, and that POST absolute quantities, keep working exactly as before.
// If the migration has not been run yet the endpoint silently falls back to the
// old in-place arithmetic, so deploying this early cannot break anything.
// ═══════════════════════════════════════════════════

import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { getApiKey } from '@/lib/auth'
import { recordMovement, ledgerReady } from '@/lib/stock'

export const runtime = 'edge'

const cors = (r: NextResponse) => {
  r.headers.set('Access-Control-Allow-Origin', '*')
  r.headers.set('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS')
  r.headers.set('Access-Control-Allow-Headers', 'Content-Type,X-Api-Key')
  return r
}

export async function OPTIONS() {
  return cors(new NextResponse(null, { status: 200 }))
}

// ── GET — fetch all stock for this restaurant ──────────
export async function GET(req: Request) {
  const key = getApiKey(req)
  if (!key) return cors(NextResponse.json({ ok: false, error: 'API key required' }, { status: 401 }))

  const rows = await sql`SELECT id FROM restaurants WHERE api_key=${key} AND plan!='suspended' LIMIT 1`
  if (!rows.length) return cors(NextResponse.json({ ok: false, error: 'Invalid key' }, { status: 403 }))
  const rid = rows[0].id

  const stock = await sql`
    SELECT item_id, item_name, item_emoji, quantity, barcode, cost, category, sell_price, updated_at
    FROM stock
    WHERE restaurant_id = ${rid}
    ORDER BY category ASC, item_name ASC
  `
  return cors(NextResponse.json({ ok: true, stock }))
}

// ── POST — full catalog sync (retail POS sends entire product list with current quantities) ──
export async function POST(req: Request) {
  const key = getApiKey(req)
  if (!key) return cors(NextResponse.json({ ok: false, error: 'API key required' }, { status: 401 }))

  const rows = await sql`SELECT id FROM restaurants WHERE api_key=${key} AND plan!='suspended' LIMIT 1`
  if (!rows.length) return cors(NextResponse.json({ ok: false, error: 'Invalid key' }, { status: 403 }))
  const rid = rows[0].id

  let body: any
  try { body = await req.json() } catch { return cors(NextResponse.json({ ok: false, error: 'Bad JSON' }, { status: 400 })) }

  const items: {
    item_id: string
    item_name: string
    item_emoji?: string
    quantity: number
    barcode?: string
    cost?: number
    category?: string
    sell_price?: number
    ts?: string
    uid?: string
  }[] = body.items || []

  if (!items.length) return cors(NextResponse.json({ ok: false, error: 'No items provided' }, { status: 400 }))

  // Limit to 2000 products per sync to prevent abuse
  const batch = items.slice(0, 2000)

  // ── mode ──────────────────────────────────────────────────────────────
  // 'count' → the operator physically counted these products. Each one becomes
  //           a 'count' checkpoint in the ledger (with its écart frozen).
  // anything else (default) → legacy catalog sync. Quantity is written straight
  //           to the cache and NO movement is recorded. This is deliberate:
  //           deployed EXEs call this endpoint after every single sale, and
  //           turning each of those into a 'count' would reset the checkpoint
  //           constantly and destroy the audit trail it exists to provide.
  const mode = String(body.mode ?? '').toLowerCase() === 'count' ? 'count' : 'sync'
  const actor = String(body.actor ?? '').slice(0, 80)
  const useLedger = mode === 'count' ? await ledgerReady() : false

  for (const it of batch) {
    const id         = String(it.item_id).slice(0, 64)
    const name       = String(it.item_name).slice(0, 100)
    const emoji      = String(it.item_emoji || '📦').slice(0, 10)
    const qty        = Math.max(0, parseInt(String(it.quantity)) || 0)
    const barcode    = String(it.barcode || '').slice(0, 64)
    const cost       = Math.max(0, parseFloat(String(it.cost)) || 0)
    const category   = String(it.category || '').slice(0, 100)
    const sellPrice  = Math.max(0, parseFloat(String(it.sell_price)) || 0)

    // Strict field ownership:
    //   • cost / sell_price / category are WEB-OWNED — never overwritten by a POS sync.
    //   • quantity / item_name / item_emoji / barcode flow POS → web.
    // For brand-new rows we insert whatever the POS provided (cost defaults to 0);
    // for existing rows we update ONLY the POS-owned fields so a web-entered cost
    // can never be clobbered.
    await sql`
      INSERT INTO stock (restaurant_id, item_id, item_name, item_emoji, quantity, barcode, cost, category, sell_price, updated_at)
      VALUES (${rid}, ${id}, ${name}, ${emoji}, ${qty}, ${barcode}, ${cost}, ${category}, ${sellPrice}, NOW())
      ON CONFLICT (restaurant_id, item_id)
      DO UPDATE SET
        quantity   = ${qty},
        item_name  = ${name},
        item_emoji = ${emoji},
        barcode    = ${barcode},
        updated_at = NOW()
    `

    // Physical count → record a checkpoint so the écart is captured and the
    // running total restarts from the counted value. Runs AFTER the upsert so
    // the stock row is guaranteed to exist for brand-new products.
    if (useLedger) {
      await recordMovement(rid, {
        itemId: id,
        kind: 'count',
        countValue: qty,
        reason: String(body.reason ?? 'Inventaire').slice(0, 200),
        actor,
        source: 'pos',
        terminalId: String(body.terminalId ?? '').slice(0, 64),
        sessionId: String(body.sessionId ?? '').slice(0, 64),
        clientTs: it.ts ?? null,
        clientUid: it.uid ?? '',
      })
    }
  }

  return cors(NextResponse.json({ ok: true, updated: batch.length, mode, ledger: useLedger }))
}

// ── PATCH — decrease stock after a sale (called by EXE sync) ──
export async function PATCH(req: Request) {
  const key = getApiKey(req)
  if (!key) return cors(NextResponse.json({ ok: false, error: 'API key required' }, { status: 401 }))

  const rows = await sql`SELECT id FROM restaurants WHERE api_key=${key} AND plan!='suspended' LIMIT 1`
  if (!rows.length) return cors(NextResponse.json({ ok: false, error: 'Invalid key' }, { status: 403 }))
  const rid = rows[0].id

  let body: any
  try { body = await req.json() } catch { return cors(NextResponse.json({ ok: false, error: 'Bad JSON' }, { status: 400 })) }

  const sold: { item_id: string; qty: number; uid?: string; ts?: string }[] = body.sold || []
  if (!sold.length) return cors(NextResponse.json({ ok: true, updated: 0 }))

  const actor      = String(body.actor ?? '').slice(0, 80)
  const terminalId = String(body.terminalId ?? '').slice(0, 64)
  const sessionId  = String(body.sessionId ?? '').slice(0, 64)
  const saleNum    = Number.isFinite(parseInt(String(body.saleNum))) ? parseInt(String(body.saleNum)) : null

  const useLedger = await ledgerReady()

  let updated = 0
  let duplicates = 0

  for (const it of sold) {
    const id  = String(it.item_id).slice(0, 64)
    if (!id) continue
    const qty = Math.max(1, parseInt(String(it.qty)) || 1)

    if (useLedger) {
      // Append a negative 'sale' movement. `uid` makes an offline replay safe;
      // `ts` keeps ordering correct when movements arrive late or out of order.
      const applied = await recordMovement(rid, {
        itemId: id,
        kind: 'sale',
        delta: -qty,
        reason: '',
        actor,
        source: 'pos',
        terminalId,
        sessionId,
        saleNum,
        clientTs: it.ts ?? null,
        clientUid: it.uid ?? '',
      })
      if (applied === null) duplicates++
      else updated++
    } else {
      // Legacy path — migration not run yet. Same behaviour as before.
      await sql`
        UPDATE stock
        SET quantity   = GREATEST(0, quantity - ${qty}),
            updated_at = NOW()
        WHERE restaurant_id = ${rid} AND item_id = ${id}
      `
      updated++
    }
  }

  return cors(NextResponse.json({
    ok: true,
    updated,
    // Surfaced so the POS can stop retrying a movement that already landed.
    duplicates,
    ledger: useLedger,
  }))
}
