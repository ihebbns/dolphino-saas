// ═══════════════════════════════════════════════════
// /api/stock
//
// GET  ?key=XXX              → returns all stock items for restaurant
// POST ?key=XXX  body={items:[{item_id,item_name,item_emoji,quantity,barcode?,cost?,category?,sell_price?}]}
//                            → set/update stock quantities (full catalog sync from POS)
// POST ?key=XXX  body={mode:'count',    actor, reason, items:[…{quantity}]}
//                            → attributed physical count; resets the checkpoint
// POST ?key=XXX  body={mode:'movement', actor, movements:[{item_id,kind,qty,reason?}]}
//                            → delivery / loss / correction booked at the till.
//                              DELTAS: the checkpoint is left alone.
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
import { recordMovement, ledgerReady, POS_KINDS } from '@/lib/stock'
import { consumeForSale } from '@/lib/ingredients'

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

  const rows = await sql`SELECT id, config FROM restaurants WHERE api_key=${key} AND plan!='suspended' LIMIT 1`
  if (!rows.length) return cors(NextResponse.json({ ok: false, error: 'Invalid key' }, { status: 403 }))
  const rid = rows[0].id

  const stock = await sql`
    SELECT item_id, item_name, item_emoji, quantity, barcode, cost, category, sell_price, updated_at
    FROM stock
    WHERE restaurant_id = ${rid}
    ORDER BY category ASC, item_name ASC
  `
  // The POS already polls this route for costs, so the lock rides along on a
  // call it makes anyway — no extra request, and it caches the answer so the
  // till still knows the rule while offline.
  return cors(NextResponse.json({
    ok: true,
    stock,
    posStockLocked: isStockLocked(rows[0].config),
    stockTracking: isStockTracking(rows[0].config),
  }))
}

/** Owner has locked stock editing at the till. Absent/false ⇒ POS is free. */
function isStockLocked(config: any): boolean {
  return !!(config && typeof config === 'object' && config.posStockLocked)
}

/**
 * Whether this establishment uses stock at all.
 *
 * Many cafés do not want it: they sell coffee and reorder when the shelf looks
 * empty, and a half-maintained count is worse than none — it produces alarming
 * figures nobody trusts. Off means off everywhere in the POS.
 *
 * Defaults to ON so no existing client changes behaviour, and so a POS-only
 * client that never opens this dashboard keeps what it was built with.
 */
function isStockTracking(config: any): boolean {
  const m = config && typeof config === 'object' ? config.modules : null
  if (m && typeof m === 'object' && 'stockTracking' in m) return !!m.stockTracking
  return true
}

/** Shared 403 for a till that tried to change stock while locked. */
function stockLockedResponse() {
  return cors(NextResponse.json({
    ok: false,
    locked: true,
    error: 'Le stock est géré depuis le back-office. Modification refusée sur la caisse.',
  }, { status: 403 }))
}

// ── Movements booked at the till: deliveries, losses, corrections ──────────
// POST /api/stock?key=…
// { mode:'movement', actor, sessionId?, terminalId?,
//   movements:[{ item_id, kind:'receive'|'waste'|'adjust'|'return',
//                qty, reason?, item_name?, item_emoji?, uid?, ts? }] }
//
// `qty` is the magnitude the operator typed; the SIGN is derived here from the
// kind, never taken from the client. A till that could post its own signed
// numbers could turn a loss into a delivery.
async function handleMovements(rid: number, body: any, locked: boolean) {
  // Enforced HERE, not just by hiding buttons in the POS. A lock that only
  // greys out a control is decoration: the till holds the api_key and could post
  // the request anyway. Sales are never blocked — see the PATCH path.
  if (locked) return stockLockedResponse()

  const list: any[] = Array.isArray(body.movements) ? body.movements : []
  if (!list.length) {
    return cors(NextResponse.json({ ok: false, error: 'No movements provided' }, { status: 400 }))
  }

  const actor = String(body.actor ?? '').slice(0, 80)
  // Same rule as a count: an unattributed stock change is exactly how a shortage
  // gets buried, so refuse it instead of recording something untraceable.
  if (!actor) {
    return cors(NextResponse.json(
      { ok: false, error: "Un mouvement de stock doit être attribué : 'actor' est obligatoire." },
      { status: 400 },
    ))
  }

  if (!(await ledgerReady())) {
    // Migration not run yet. Say so plainly rather than silently dropping a
    // delivery the client believes was recorded.
    return cors(NextResponse.json(
      { ok: false, error: 'Journal de stock non initialisé (migration requise).', ledger: false },
      { status: 503 },
    ))
  }

  const SIGN: Record<string, number> = { receive: +1, return: +1, waste: -1, adjust: +1 }
  let applied = 0
  const rejected: string[] = []

  for (const mv of list.slice(0, 500)) {
    const id = String(mv.item_id ?? '').slice(0, 64)
    const kind = String(mv.kind ?? '').toLowerCase()
    const qty = Math.abs(parseFloat(String(mv.qty)) || 0)

    if (!id || !POS_KINDS.includes(kind as any) || kind === 'sale' || kind === 'count' || !qty) {
      rejected.push(id || '?')
      continue
    }

    // A movement can be the first thing the server ever hears about a product
    // (POS-only client, brand-new article). Make sure the cached row exists, or
    // refreshStockCache has nothing to update.
    await sql`
      INSERT INTO stock (restaurant_id, item_id, item_name, item_emoji, quantity, updated_at)
      VALUES (${rid}, ${id}, ${String(mv.item_name ?? id).slice(0, 100)},
              ${String(mv.item_emoji ?? '📦').slice(0, 10)}, 0, NOW())
      ON CONFLICT (restaurant_id, item_id) DO NOTHING`

    const q = await recordMovement(rid, {
      itemId: id,
      kind: kind as any,
      delta: SIGN[kind] * qty,
      reason: String(mv.reason ?? '').slice(0, 200),
      actor,
      source: 'pos',
      terminalId: String(body.terminalId ?? '').slice(0, 64),
      sessionId: String(body.sessionId ?? '').slice(0, 64),
      clientTs: mv.ts ?? null,
      clientUid: String(mv.uid ?? '').slice(0, 64),
    })
    // null = duplicate uid (already recorded) or a write failure. Either way the
    // POS must treat the batch as accepted so it stops retrying a movement that
    // is already in the ledger.
    if (q !== null) applied++
  }

  return cors(NextResponse.json({ ok: true, applied, rejected, ledger: true }))
}

// ── POST — full catalog sync (retail POS sends entire product list with current quantities) ──
export async function POST(req: Request) {
  const key = getApiKey(req)
  if (!key) return cors(NextResponse.json({ ok: false, error: 'API key required' }, { status: 401 }))

  const rows = await sql`SELECT id, config FROM restaurants WHERE api_key=${key} AND plan!='suspended' LIMIT 1`
  if (!rows.length) return cors(NextResponse.json({ ok: false, error: 'Invalid key' }, { status: 403 }))
  const rid = rows[0].id
  const locked = isStockLocked(rows[0].config)

  let body: any
  try { body = await req.json() } catch { return cors(NextResponse.json({ ok: false, error: 'Bad JSON' }, { status: 400 })) }

  // ── mode='movement' — a delivery or a loss booked at the till ───────────
  // Handled before the catalog path because it carries `movements`, not `items`.
  //
  // These are DELTAS on purpose. Sending a delivery as a 'count' (which is what
  // the POS used to do for every stock action) silently resets the checkpoint,
  // so the system then believes the shelf was physically verified when in fact
  // nobody counted anything — and the écart report, the whole reason the ledger
  // exists, becomes meaningless. Only 'count' may move the checkpoint.
  if (String(body.mode ?? '').toLowerCase() === 'movement') {
    return handleMovements(rid, body, locked)
  }

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

  // A count writes a quantity, so it is a stock modification like any other and
  // the lock applies. The legacy catalog sync ('sync') is left alone: it carries
  // no quantity, and blocking it would stop product names reaching the web.
  if (mode === 'count' && locked) return stockLockedResponse()

  // A count is a claim about physical reality, so it must say who counted and
  // why. Refuse an anonymous one rather than record an untraceable change.
  if (mode === 'count' && !actor) {
    return cors(NextResponse.json(
      { ok: false, error: "Un inventaire doit être attribué : 'actor' est obligatoire." },
      { status: 400 },
    ))
  }

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
    //   • item_name / item_emoji / barcode flow POS → web.
    //
    // QUANTITY IS DELIBERATELY NOT UPDATED HERE unless this request is an
    // attributed physical count (mode='count'). A quantity that changes with no
    // movement behind it is untraceable, which is exactly how a shortage gets
    // hidden. Sales arrive as signed deltas on PATCH; a count arrives here with
    // a reason and an actor. For a brand-new row 0 is the right starting point —
    // the first count establishes the real figure.
    await sql`
      INSERT INTO stock (restaurant_id, item_id, item_name, item_emoji, quantity, barcode, cost, category, sell_price, updated_at)
      VALUES (${rid}, ${id}, ${name}, ${emoji}, ${mode === 'count' ? qty : 0}, ${barcode}, ${cost}, ${category}, ${sellPrice}, NOW())
      ON CONFLICT (restaurant_id, item_id)
      DO UPDATE SET
        quantity   = CASE WHEN ${mode === 'count'} THEN ${qty} ELSE stock.quantity END,
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

  // ── Recipe explosion ────────────────────────────────────────────────
  // Selling a pizza used to deduct the pizza and leave the cheese untouched:
  // recipes computed a cost and nothing else, so there was no actual consumption
  // to compare a theoretical figure against.
  //
  // Done HERE, on the web, rather than in the POS. The till already reports what
  // it sold; a recipe is a web-side fact it has no reason to know. That also
  // means every terminal already installed starts deducting ingredients without
  // a rebuild.
  //
  // Deliberately after the product movements and wrapped: an ingredient problem
  // must never cost us the sale itself.
  let ingredients = 0
  try {
    ingredients = await consumeForSale(
      rid,
      sold.map(it => ({
        item_id: String(it.item_id ?? '').slice(0, 64),
        qty: Math.max(1, parseInt(String(it.qty)) || 1),
        uid: it.uid,
        ts: it.ts ?? null,
        sale_num: saleNum,
      })),
      { actor, source: 'pos', saleNum },
    )
  } catch { /* never block a sale on its ingredient explosion */ }

  return cors(NextResponse.json({
    ok: true,
    updated,
    // Surfaced so the POS can stop retrying a movement that already landed.
    duplicates,
    ledger: useLedger,
    // How many ingredient movements the recipes produced. 0 simply means no
    // sold product had an enabled recipe with tracked ingredients.
    ingredients,
  }))
}
