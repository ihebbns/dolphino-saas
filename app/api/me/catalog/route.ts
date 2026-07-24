// ═══════════════════════════════════════════════════
// Client self-service PRODUCT CATALOG + COST management
// (authenticated by the client's own api_key — same secret as the POS/dashboard).
//
// GET  /api/me/catalog?key=API
//   → full product catalog = every product in restaurants.menu_json
//     (categories → items: id, name, price `p`, emoji `e`) MERGED with the
//     `stock` rows by item_id, so the owner sees EVERY product even before a
//     stock row exists. Returns an array of:
//     { item_id, name, emoji, price, category, cost, sell_price, quantity,
//       tracked, low_threshold, barcode }
//
// POST /api/me/catalog { key, item_id, ... }
//   → upsert ONE product into `stock` by (restaurant_id, item_id).
//     Editable: cost, sell_price, quantity, category, tracked, low_threshold,
//     barcode, item_name, item_emoji. Numbers are clamped/validated.
//
// This endpoint can NEVER change plan / trial / api_key. It also respects the
// dashboard suspension check (plan NOT IN suspended / suspended_dash).
//
// IMPORTANT: editing a product's cost here only affects FUTURE sales. Past days
// stay locked because their cost is frozen inside sales.items[].c at sale time.
// ═══════════════════════════════════════════════════

import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { getApiKey } from '@/lib/auth'

export const runtime = 'edge'

const cors = (r: NextResponse) => {
  r.headers.set('Access-Control-Allow-Origin', '*')
  r.headers.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  r.headers.set('Access-Control-Allow-Headers', 'Content-Type,X-Api-Key')
  return r
}
export async function OPTIONS() { return cors(new NextResponse(null, { status: 200 })) }

function getKey(req: Request, body?: any): string {
  return (body && body.key) || getApiKey(req) || ''
}

// A stable, deterministic id for menu items that have no explicit id, so the
// same product always maps to the same stock row across reloads/saves.
function slugId(cat: string, name: string): string {
  const base = `${cat}_${name}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return ('m_' + base).slice(0, 64)
}

type CatalogItem = {
  item_id: string
  name: string
  emoji: string
  price: number
  category: string
  cost: number
  sell_price: number
  quantity: number
  tracked: boolean
  low_threshold: number
  barcode: string
}

// Read all stock rows, tolerating a DB where tracked/low_threshold haven't been
// migrated yet (same defensive fallback pattern used elsewhere).
async function loadStock(rid: number): Promise<any[]> {
  try {
    return await sql`
      SELECT item_id, item_name, item_emoji, quantity, barcode, cost, category, sell_price, tracked, low_threshold
      FROM stock WHERE restaurant_id = ${rid}`
  } catch {
    return await sql`
      SELECT item_id, item_name, item_emoji, quantity, barcode, cost, category, sell_price
      FROM stock WHERE restaurant_id = ${rid}`
  }
}

export async function GET(req: Request) {
  const key = getKey(req)
  if (!key) return cors(NextResponse.json({ ok: false, error: 'Clé manquante' }, { status: 400 }))
  try {
    const rows = await sql`
      SELECT id, name, plan, menu_json
      FROM restaurants
      WHERE api_key = ${key} AND plan NOT IN ('suspended', 'suspended_dash')
      LIMIT 1`
    if (!rows.length) return cors(NextResponse.json({ ok: false, error: 'Compte introuvable ou suspendu' }, { status: 403 }))
    const rid = rows[0].id
    const menu = (rows[0].menu_json && typeof rows[0].menu_json === 'object') ? rows[0].menu_json : {}

    const catalog = new Map<string, CatalogItem>()

    // 1) Every product declared in the menu (categories → items)
    for (const [catName, catVal] of Object.entries<any>(menu)) {
      const icon  = (catVal && typeof catVal === 'object' && catVal.icon) ? String(catVal.icon) : ''
      const items = Array.isArray(catVal) ? catVal
                  : (catVal && Array.isArray(catVal.items) ? catVal.items : [])
      for (const it of items) {
        if (!it || typeof it !== 'object') continue
        const rawId = it.id ?? it._id ?? it.item_id
        const id = (rawId !== undefined && rawId !== null && String(rawId).trim() !== '')
          ? String(rawId).trim().slice(0, 64)
          : slugId(catName, String(it.name ?? it.n ?? ''))
        catalog.set(id, {
          item_id: id,
          name: String(it.name ?? it.n ?? '').slice(0, 100),
          emoji: String(it.e ?? it.emoji ?? icon ?? '🍽️').slice(0, 10) || '🍽️',
          price: Math.max(0, parseFloat(it.p ?? it.price) || 0),
          category: String(catName).slice(0, 80),
          cost: 0, sell_price: 0, quantity: 0,
          tracked: true, low_threshold: 5, barcode: '',
        })
      }
    }

    // 2) Merge stock rows (adds cost/sell_price/qty; also surfaces stock-only products)
    for (const row of await loadStock(rid)) {
      const id = String(row.item_id)
      const cost       = Math.max(0, parseFloat(row.cost) || 0)
      const sellPrice  = Math.max(0, parseFloat(row.sell_price) || 0)
      const quantity   = parseInt(String(row.quantity)) || 0
      const tracked    = (row.tracked === undefined || row.tracked === null) ? true : !!row.tracked
      const lowThresh  = (row.low_threshold === undefined || row.low_threshold === null) ? 5 : (parseInt(String(row.low_threshold)) || 0)
      const barcode    = String(row.barcode ?? '')
      const existing = catalog.get(id)
      if (existing) {
        existing.cost = cost
        existing.sell_price = sellPrice
        existing.quantity = quantity
        existing.tracked = tracked
        existing.low_threshold = lowThresh
        existing.barcode = barcode
        if (!existing.name)     existing.name = String(row.item_name ?? '').slice(0, 100)
        if (!existing.category) existing.category = String(row.category ?? '').slice(0, 80)
      } else {
        catalog.set(id, {
          item_id: id,
          name: String(row.item_name ?? '').slice(0, 100),
          emoji: String(row.item_emoji ?? '📦').slice(0, 10) || '📦',
          price: sellPrice,
          category: String(row.category ?? '').slice(0, 80),
          cost, sell_price: sellPrice, quantity,
          tracked, low_threshold: lowThresh, barcode,
        })
      }
    }

    const products = Array.from(catalog.values())
      .sort((a, b) => (a.category || '').localeCompare(b.category || '') || (a.name || '').localeCompare(b.name || ''))

    return cors(NextResponse.json({ ok: true, name: rows[0].name, count: products.length, products }))
  } catch (e: any) {
    return cors(NextResponse.json({ ok: false, error: e.message }, { status: 500 }))
  }
}

export async function POST(req: Request) {
  let body: any
  try { body = await req.json() } catch { return cors(NextResponse.json({ ok: false, error: 'Bad JSON' }, { status: 400 })) }
  const key = getKey(req, body)
  if (!key) return cors(NextResponse.json({ ok: false, error: 'Clé manquante' }, { status: 400 }))

  const itemId = String(body.item_id ?? '').trim().slice(0, 64)
  if (!itemId) return cors(NextResponse.json({ ok: false, error: 'item_id requis' }, { status: 400 }))

  try {
    const rows = await sql`
      SELECT id FROM restaurants
      WHERE api_key = ${key} AND plan NOT IN ('suspended', 'suspended_dash')
      LIMIT 1`
    if (!rows.length) return cors(NextResponse.json({ ok: false, error: 'Compte introuvable ou suspendu' }, { status: 403 }))
    const rid = rows[0].id

    // Validate / clamp — item_name is NOT NULL in the schema, so never store empty.
    const name       = (String(body.item_name ?? '').slice(0, 100)) || itemId
    const emoji      = (String(body.item_emoji ?? '📦').slice(0, 10)) || '📦'
    const cost       = Math.max(0, parseFloat(body.cost) || 0)
    const sellPrice  = Math.max(0, parseFloat(body.sell_price) || 0)
    const quantity   = Math.max(0, parseInt(String(body.quantity)) || 0)
    const category   = String(body.category ?? '').slice(0, 80)
    const barcode    = String(body.barcode ?? '').slice(0, 64)
    const tracked    = (body.tracked === undefined || body.tracked === null) ? true : !!body.tracked
    const lowThresh  = Math.max(0, parseInt(String(body.low_threshold)) || 0)

    try {
      // Fully-migrated DB (has tracked + low_threshold)
      await sql`
        INSERT INTO stock (restaurant_id, item_id, item_name, item_emoji, quantity, barcode, cost, category, sell_price, tracked, low_threshold, updated_at)
        VALUES (${rid}, ${itemId}, ${name}, ${emoji}, ${quantity}, ${barcode}, ${cost}, ${category}, ${sellPrice}, ${tracked}, ${lowThresh}, NOW())
        ON CONFLICT (restaurant_id, item_id) DO UPDATE SET
          item_name     = EXCLUDED.item_name,
          item_emoji    = EXCLUDED.item_emoji,
          quantity      = EXCLUDED.quantity,
          barcode       = EXCLUDED.barcode,
          cost          = EXCLUDED.cost,
          category      = EXCLUDED.category,
          sell_price    = EXCLUDED.sell_price,
          tracked       = EXCLUDED.tracked,
          low_threshold = EXCLUDED.low_threshold,
          updated_at    = NOW()`
    } catch (colErr: any) {
      // Fallback: tracked / low_threshold not migrated yet
      await sql`
        INSERT INTO stock (restaurant_id, item_id, item_name, item_emoji, quantity, barcode, cost, category, sell_price, updated_at)
        VALUES (${rid}, ${itemId}, ${name}, ${emoji}, ${quantity}, ${barcode}, ${cost}, ${category}, ${sellPrice}, NOW())
        ON CONFLICT (restaurant_id, item_id) DO UPDATE SET
          item_name  = EXCLUDED.item_name,
          item_emoji = EXCLUDED.item_emoji,
          quantity   = EXCLUDED.quantity,
          barcode    = EXCLUDED.barcode,
          cost       = EXCLUDED.cost,
          category   = EXCLUDED.category,
          sell_price = EXCLUDED.sell_price,
          updated_at = NOW()`
    }

    return cors(NextResponse.json({
      ok: true,
      item: { item_id: itemId, item_name: name, item_emoji: emoji, cost, sell_price: sellPrice, quantity, category, barcode, tracked, low_threshold: lowThresh },
    }))
  } catch (e: any) {
    return cors(NextResponse.json({ ok: false, error: e.message }, { status: 500 }))
  }
}
