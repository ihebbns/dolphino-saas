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
//     Editable here: cost, category, tracked, low_threshold, barcode,
//     item_name, item_emoji. Numbers are clamped/validated.
//
//   NOT editable here: `quantity`. A quantity may only change through a traced
//   movement — a sale delta or an attributed physical count — so that no stock
//   figure can ever move without a record of who did it and why. Use
//   POST /api/me/stock-log { kind:'count' | 'adjust', reason, actor }.
//   Accepting it on this route was a silent second door into the same field.
//
// ── FIELD OWNERSHIP (single owner per field, no split brain) ──────────
//   • PRICE (prix de vente) → owned by the POS/EXE. Managers edit it in
//     "Gérer le menu"; the POS publishes it to restaurants.menu_json.
//     This endpoint MIRRORS it into stock.sell_price so stock valuation
//     stays correct, and IGNORES any sell_price sent in the body for a
//     product that exists in the menu. Only stock-only products (no menu
//     entry) accept a web-set price.
//   • COST (prix d'achat) → owned by the web. The POS pulls it read-only
//     and freezes it onto each sale line at checkout.
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
import { serverError } from '@/lib/apiError'
import { isTrackMode, type TrackMode } from '@/lib/stock'

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

// Menu items with size variants keep their prices in `v[]`, not `p`. Reading
// only `p` reported price 0 for every variant product (pizzas Moy/Max, etc.),
// which made their margin meaningless. Use the lowest variant price as the
// reference price for the catalog view.
function itemPrice(it: any): number {
  if (Array.isArray(it?.v) && it.v.length) {
    const ps = it.v
      .map((v: any) => Math.max(0, parseFloat(v?.p) || 0))
      .filter((n: number) => n > 0)
    if (ps.length) return Math.min(...ps)
  }
  return Math.max(0, parseFloat(it?.p ?? it?.price) || 0)
}

// Same id resolution the GET merge uses, so a product always maps to the same
// stock row whether it arrived with an explicit id or not.
function resolveId(catName: string, it: any): string {
  const rawId = it.id ?? it._id ?? it.item_id
  return (rawId !== undefined && rawId !== null && String(rawId).trim() !== '')
    ? String(rawId).trim().slice(0, 64)
    : slugId(catName, String(it.name ?? it.n ?? ''))
}

// item_id → selling price, taken from menu_json. The POS (EXE) is the sole
// owner of price, so this index is what POST mirrors into stock.sell_price.
function buildPriceIndex(menu: any): Map<string, number> {
  const idx = new Map<string, number>()
  for (const [catName, catVal] of Object.entries<any>(menu || {})) {
    const items = Array.isArray(catVal) ? catVal
                : (catVal && Array.isArray(catVal.items) ? catVal.items : [])
    for (const it of items) {
      if (!it || typeof it !== 'object') continue
      idx.set(resolveId(catName, it), itemPrice(it))
    }
  }
  return idx
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
  // Set only from menu_json's own tracked:false — never overwritten by the
  // stock-row merge below, so it survives as the fallback signal even once a
  // stock row exists but never got an explicit track_mode of its own.
  menu_untracked?: boolean
}

// Read all stock rows, tolerating a DB where tracked/low_threshold haven't been
// migrated yet (same defensive fallback pattern used elsewhere).
async function loadStock(rid: number): Promise<any[]> {
  // Widest select first, narrowing on each failure. track_mode is the newest
  // column, so it is dropped before tracked/low_threshold.
  try {
    return await sql`
      SELECT item_id, item_name, item_emoji, quantity, barcode, cost, category, sell_price,
             tracked, low_threshold, track_mode
      FROM stock WHERE restaurant_id = ${rid}`
  } catch { /* fall through */ }
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
        const id = resolveId(catName, it)
        catalog.set(id, {
          item_id: id,
          name: String(it.name ?? it.n ?? '').slice(0, 100),
          emoji: String(it.e ?? it.emoji ?? icon ?? '🍽️').slice(0, 10) || '🍽️',
          price: itemPrice(it),
          category: String(catName).slice(0, 80),
          cost: 0, sell_price: 0, quantity: 0,
          // The POS's own tracked:false is a deliberate statement (made-to-order,
          // nothing to count) — it must survive into the catalog view, not get
          // silently overwritten by the "tracked by default" assumption.
          tracked: it.tracked !== false, low_threshold: 5, barcode: '',
          menu_untracked: it.tracked === false,
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
      // Absent on a DB without migration-product-tracking.sql, in which case the
      // mode is inferred further down rather than defaulted here.
      const rowMode = isTrackMode(row.track_mode) ? row.track_mode : undefined
      const existing = catalog.get(id)
      if (existing) {
        existing.cost = cost
        existing.sell_price = sellPrice
        existing.quantity = quantity
        existing.tracked = tracked
        existing.low_threshold = lowThresh
        existing.barcode = barcode
        if (rowMode) (existing as any).track_mode = rowMode
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
          ...(rowMode ? { track_mode: rowMode } : {}),
        } as CatalogItem)
      }
    }

    // 3) Which products have a recipe.
    //
    // Needed for two reasons: to infer the mode for a product with no stock row
    // (a citronnade nobody ever counted), and so the UI can warn when 'recipe' is
    // selected with no recipe behind it — that combination deducts nothing at
    // all, and silence there looks exactly like working stock.
    const withRecipe = new Set<string>()
    try {
      for (const r of await sql`
        SELECT item_id FROM recipes WHERE restaurant_id = ${rid} AND enabled`) {
        withRecipe.add(String(r.item_id))
      }
    } catch { /* recipes not migrated — no product has one */ }

    const products = Array.from(catalog.values())
      .map(p => {
        const { menu_untracked, ...rest } = p
        return {
          ...rest,
          has_recipe: withRecipe.has(p.item_id),
          // Explicit column wins; otherwise infer exactly as the server does when
          // deciding what a sale consumes (see resolveTrackModes in lib/stock.ts),
          // so the UI cannot show one thing while the sale path does another.
          track_mode: (p as any).track_mode
            ?? (withRecipe.has(p.item_id) ? 'recipe' : menu_untracked ? 'none' : 'stock'),
        }
      })
      .sort((a, b) => (a.category || '').localeCompare(b.category || '') || (a.name || '').localeCompare(b.name || ''))

    return cors(NextResponse.json({ ok: true, name: rows[0].name, count: products.length, products }))
  } catch (e: any) {
    return cors(NextResponse.json(serverError('me/catalog', e), { status: 500 }))
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
      SELECT id, menu_json FROM restaurants
      WHERE api_key = ${key} AND plan NOT IN ('suspended', 'suspended_dash')
      LIMIT 1`
    if (!rows.length) return cors(NextResponse.json({ ok: false, error: 'Compte introuvable ou suspendu' }, { status: 403 }))
    const rid = rows[0].id

    // PRICE OWNERSHIP: the POS (EXE) owns the selling price. If this product
    // exists in the menu, its price is mirrored from menu_json and the body's
    // sell_price is ignored — the web can never fight the caisse. Only a
    // stock-only product (no menu entry, e.g. a retail item created here)
    // accepts a web-set price.
    const menuJson = (rows[0].menu_json && typeof rows[0].menu_json === 'object') ? rows[0].menu_json : {}
    const menuPrice = buildPriceIndex(menuJson).get(itemId)

    // Validate / clamp — item_name is NOT NULL in the schema, so never store empty.
    const name       = (String(body.item_name ?? '').slice(0, 100)) || itemId
    const emoji      = (String(body.item_emoji ?? '📦').slice(0, 10)) || '📦'
    const cost       = Math.max(0, parseFloat(body.cost) || 0)
    const sellPrice  = (menuPrice !== undefined)
      ? menuPrice
      : Math.max(0, parseFloat(body.sell_price) || 0)
    // Set only when the caller asks; left alone otherwise so an unrelated edit
    // cannot silently reset how a product is inventoried.
    let trackMode: TrackMode | null = null

    // Quantity is NOT accepted from this route — see the header note. A stock
    // figure may only move via a traced movement, so an upsert here must never
    // silently overwrite it. We read the current value and write it back
    // unchanged, which keeps the INSERT ... ON CONFLICT statement below intact
    // for brand-new rows (where 0 is the correct starting point) without giving
    // the web an untraced way to edit an existing count.
    const existingQty = await sql`
      SELECT quantity FROM stock WHERE restaurant_id = ${rid} AND item_id = ${itemId} LIMIT 1`
    const quantity = existingQty.length
      ? (parseInt(String(existingQty[0].quantity)) || 0)
      : 0
    const category   = String(body.category ?? '').slice(0, 80)
    const barcode    = String(body.barcode ?? '').slice(0, 64)
    const tracked    = (body.tracked === undefined || body.tracked === null) ? true : !!body.tracked
    const lowThresh  = Math.max(0, parseInt(String(body.low_threshold)) || 0)

    // ── Tracking mode ────────────────────────────────────────────────
    // How this product is inventoried, and it is one OR the other:
    //   'stock'  counted by the unit  (a Coca)
    //   'recipe' consumes ingredients (a citronnade: 200 ml of a 1 L bottle)
    //   'none'   not tracked
    // Written separately from the upsert above so a DB without the column still
    // accepts every other edit on this form.
    if (body.track_mode !== undefined && body.track_mode !== null) {
      const wanted = String(body.track_mode)
      if (!isTrackMode(wanted)) {
        return cors(NextResponse.json({ ok: false, error: 'Mode de suivi invalide' }, { status: 400 }))
      }
      trackMode = wanted
    }

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

    // Applied after the upsert so the row is guaranteed to exist, and reported
    // back honestly: if the migration has not run, say the mode was not saved
    // rather than letting the UI show a choice that never took effect.
    let trackModeSaved = false
    if (trackMode) {
      try {
        await sql`
          UPDATE stock SET track_mode = ${trackMode}, updated_at = NOW()
          WHERE restaurant_id = ${rid} AND item_id = ${itemId}`
        trackModeSaved = true
      } catch { trackModeSaved = false }
    }

    return cors(NextResponse.json({
      ok: true,
      item: { item_id: itemId, item_name: name, item_emoji: emoji, cost, sell_price: sellPrice, quantity, category, barcode, tracked, low_threshold: lowThresh, track_mode: trackMode },
      trackModeSaved,
      ...(trackMode && !trackModeSaved
        ? { warning: 'Mode de suivi non enregistré — exécutez migration-product-tracking.sql' }
        : {}),
    }))
  } catch (e: any) {
    return cors(NextResponse.json(serverError('me/catalog', e), { status: 500 }))
  }
}
