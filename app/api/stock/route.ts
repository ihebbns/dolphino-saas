// ═══════════════════════════════════════════════════
// /api/stock
//
// GET  ?key=XXX              → returns all stock items for restaurant
// POST ?key=XXX  body={items:[{item_id,item_name,item_emoji,quantity,barcode?,cost?,category?,sell_price?}]}
//                            → set/update stock quantities (full catalog sync from POS)
// PATCH ?key=XXX body={sold:[{item_id, qty}]}
//                            → decrease stock after a sale (called by EXE)
// ═══════════════════════════════════════════════════

import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { getApiKey } from '@/lib/auth'

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
  }[] = body.items || []

  if (!items.length) return cors(NextResponse.json({ ok: false, error: 'No items provided' }, { status: 400 }))

  // Limit to 2000 products per sync to prevent abuse
  const batch = items.slice(0, 2000)

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
  }

  return cors(NextResponse.json({ ok: true, updated: batch.length }))
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

  const sold: { item_id: string; qty: number }[] = body.sold || []
  if (!sold.length) return cors(NextResponse.json({ ok: true, updated: 0 }))

  for (const it of sold) {
    const id  = String(it.item_id).slice(0, 64)
    const qty = Math.max(1, parseInt(String(it.qty)) || 1)

    await sql`
      UPDATE stock
      SET quantity   = GREATEST(0, quantity - ${qty}),
          updated_at = NOW()
      WHERE restaurant_id = ${rid} AND item_id = ${id}
    `
  }

  return cors(NextResponse.json({ ok: true, updated: sold.length }))
}
