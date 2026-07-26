// ═══════════════════════════════════════════════════
// INGREDIENT LEDGER — the single place that writes ingredient movements.
//
// Runs entirely on the web. The POS is unchanged and never learns that
// ingredients exist: it already reports what it sold to PATCH /api/stock, and a
// recipe is a web-side fact, so the explosion belongs here. That also means it
// works for every terminal already in the field without a rebuild.
//
// Rules enforced here:
//   • Nothing overwrites a quantity. Every change is an immutable row, so a
//     surprising deduction can be traced to the ticket that caused it.
//   • Quantity is DERIVED: last 'count' + deltas after it.
//   • A consumption carries the idempotency key '<sale uid>:<ing_key>', so a
//     replayed offline sale cannot eat the same cheese twice.
//   • Cost is weighted average across priced receipts, falling back to the
//     manual cost_per_stock_unit. Last-purchase-price is what leaves recipe
//     costs silently months out of date.
//
// Requires migration-ingredient-movements.sql. Every function degrades quietly
// when the table is absent, so deploying before the migration cannot break the
// dashboard or drop a sale.
// ═══════════════════════════════════════════════════

import { sql } from '@/lib/db'

export type IngKind = 'consume' | 'receive' | 'waste' | 'adjust' | 'count'

export type IngMovement = {
  ingKey: string
  kind: IngKind
  /** Signed change in STOCK units. Required except for 'count'. */
  delta?: number | null
  /** Absolute counted value in STOCK units. Required for 'count'. */
  countValue?: number | null
  /** Price of one stock unit. Only meaningful on 'receive'; feeds the average. */
  unitCost?: number | null
  reason?: string
  actor?: string
  source?: 'web' | 'pos' | 'system'
  itemId?: string
  saleUid?: string
  saleNum?: number | null
  clientTs?: string | null
  clientUid?: string
}

const n4 = (v: any): number => {
  const f = parseFloat(String(v))
  return Number.isFinite(f) ? Math.round(f * 10000) / 10000 : 0
}
const clip = (v: any, len: number): string => String(v ?? '').slice(0, len)

function safeTs(v: any): string {
  const t = v ? Date.parse(String(v)) : NaN
  if (!Number.isFinite(t)) return new Date().toISOString()
  const now = Date.now()
  const year = 365 * 24 * 3600 * 1000
  // A till with a wrong clock would corrupt sequencing, so reject absurd dates.
  if (t < now - 5 * year || t > now + 2 * 24 * 3600 * 1000) return new Date().toISOString()
  return new Date(t).toISOString()
}

/** True when the ledger table exists, so callers can pick a path. */
export async function ingredientLedgerReady(): Promise<boolean> {
  try {
    await sql`SELECT 1 FROM ingredient_movements LIMIT 1`
    return true
  } catch {
    return false
  }
}

/** Quantity in stock units, derived: last count + deltas recorded after it. */
export async function derivedIngredientQty(rid: number, ingKey: string): Promise<number> {
  const rows = await sql`
    WITH lc AS (
      SELECT count_value, client_ts
      FROM ingredient_movements
      WHERE restaurant_id = ${rid} AND ing_key = ${ingKey} AND kind = 'count'
      ORDER BY client_ts DESC, id DESC
      LIMIT 1
    )
    SELECT COALESCE((SELECT count_value FROM lc), 0)
         + COALESCE((
             SELECT SUM(delta) FROM ingredient_movements m
             WHERE m.restaurant_id = ${rid} AND m.ing_key = ${ingKey}
               AND m.delta IS NOT NULL
               AND ((SELECT client_ts FROM lc) IS NULL OR m.client_ts > (SELECT client_ts FROM lc))
           ), 0) AS quantity`
  return n4(rows[0]?.quantity)
}

/** Push the derived quantity back into the ingredients.quantity cache. */
export async function refreshIngredientCache(rid: number, ingKey: string): Promise<number> {
  const qty = await derivedIngredientQty(rid, ingKey)
  await sql`
    UPDATE ingredients SET quantity = ${qty}, updated_at = NOW()
    WHERE restaurant_id = ${rid} AND ing_key = ${ingKey}`
  return qty
}

/**
 * Append one movement, then refresh the cache.
 * Returns the new quantity, or null when the row was a duplicate (same
 * client_uid) or the ledger is not migrated yet.
 */
export async function recordIngMovement(rid: number, m: IngMovement): Promise<number | null> {
  const ingKey = clip(m.ingKey, 64)
  if (!ingKey) return null

  const isCount = m.kind === 'count'
  const delta = isCount ? null : n4(m.delta)
  const countValue = isCount ? Math.max(0, n4(m.countValue)) : null

  // A zero delta carries no information; do not litter the trail with it.
  if (!isCount && delta === 0) return null

  let expected: number | null = null
  if (isCount) {
    try { expected = await derivedIngredientQty(rid, ingKey) } catch { expected = null }
  }

  const unitCost = m.kind === 'receive' && m.unitCost != null && n4(m.unitCost) > 0
    ? n4(m.unitCost) : null
  const clientUid = clip(m.clientUid, 160)

  try {
    if (clientUid) {
      const ins = await sql`
        INSERT INTO ingredient_movements
          (restaurant_id, ing_key, kind, delta, count_value, expected_value, unit_cost,
           reason, actor, source, item_id, sale_uid, sale_num, client_ts, client_uid)
        VALUES
          (${rid}, ${ingKey}, ${m.kind}, ${delta}, ${countValue}, ${expected}, ${unitCost},
           ${clip(m.reason, 200)}, ${clip(m.actor, 80)}, ${m.source ?? 'web'},
           ${clip(m.itemId, 64)}, ${clip(m.saleUid, 64)},
           ${Number.isFinite(m.saleNum as any) ? m.saleNum : null},
           ${safeTs(m.clientTs)}, ${clientUid})
        ON CONFLICT (restaurant_id, client_uid) WHERE client_uid <> '' DO NOTHING
        RETURNING id`
      if (!ins.length) return null            // already recorded — do not re-apply
    } else {
      await sql`
        INSERT INTO ingredient_movements
          (restaurant_id, ing_key, kind, delta, count_value, expected_value, unit_cost,
           reason, actor, source, item_id, sale_uid, sale_num, client_ts, client_uid)
        VALUES
          (${rid}, ${ingKey}, ${m.kind}, ${delta}, ${countValue}, ${expected}, ${unitCost},
           ${clip(m.reason, 200)}, ${clip(m.actor, 80)}, ${m.source ?? 'web'},
           ${clip(m.itemId, 64)}, ${clip(m.saleUid, 64)},
           ${Number.isFinite(m.saleNum as any) ? m.saleNum : null},
           ${safeTs(m.clientTs)}, '')`
    }
  } catch {
    // Not migrated, or a write failure. Never break the caller: a sale must be
    // recorded even if its ingredient explosion cannot be.
    return null
  }

  try { return await refreshIngredientCache(rid, ingKey) } catch { return null }
}

// ── Recipe explosion ──────────────────────────────────────────────────

export type SoldLine = {
  item_id: string
  qty: number
  uid?: string
  ts?: string | null
  sale_num?: number | null
}

type RecipeLine = {
  item_id: string
  ing_key: string
  qty: number                 // in the ingredient's RECIPE unit
  conversion_factor: number   // recipe units per stock unit
  yield_qty: number           // portions the recipe produces
  enabled: boolean
  tracked: boolean
}

/**
 * Turn sold products into ingredient consumption.
 *
 * qty_sold portions × (line qty ÷ yield) recipe units, converted to stock units
 * by the ingredient's conversion factor. A 200 g line on a kg ingredient
 * (factor 1000) consumes 0.2 stock units per portion.
 *
 * Only enabled recipes and tracked ingredients are touched, so a recipe kept on
 * file for reference costs nothing and an untracked ingredient (salt, pepper) is
 * never chased.
 *
 * Returns how many movements were actually applied.
 */
export async function consumeForSale(
  rid: number,
  sold: SoldLine[],
  meta: { actor?: string; source?: 'pos' | 'web'; saleNum?: number | null } = {},
): Promise<number> {
  const lines = (sold || []).filter(l => l && l.item_id && n4(l.qty) > 0)
  if (!lines.length) return 0

  const itemIds = [...new Set(lines.map(l => clip(l.item_id, 64)))]

  let rows: any[] = []
  try {
    rows = await sql`
      SELECT rl.item_id, rl.ing_key, rl.qty::float AS qty,
             i.conversion_factor::float AS conversion_factor,
             r.yield_qty::float AS yield_qty, r.enabled, i.tracked
      FROM recipe_lines rl
      JOIN recipes     r ON r.restaurant_id = rl.restaurant_id AND r.item_id = rl.item_id
      JOIN ingredients i ON i.restaurant_id = rl.restaurant_id AND i.ing_key = rl.ing_key
      WHERE rl.restaurant_id = ${rid}
        AND rl.item_id = ANY(${itemIds})
        AND r.enabled
        AND i.tracked
        AND NOT i.archived
        AND rl.qty > 0`
  } catch {
    return 0   // recipes not migrated — nothing to explode
  }
  if (!rows.length) return 0

  const byItem = new Map<string, RecipeLine[]>()
  for (const r of rows as RecipeLine[]) {
    const arr = byItem.get(r.item_id) || []
    arr.push(r)
    byItem.set(r.item_id, arr)
  }

  let applied = 0
  for (const line of lines) {
    const recipe = byItem.get(clip(line.item_id, 64))
    if (!recipe) continue                       // product has no recipe: fine

    for (const rl of recipe) {
      const factor = rl.conversion_factor > 0 ? rl.conversion_factor : 1
      const yieldQty = rl.yield_qty > 0 ? rl.yield_qty : 1
      // recipe units for this sale → stock units
      const stockUnits = (n4(line.qty) * rl.qty) / yieldQty / factor
      if (!(stockUnits > 0)) continue

      // Deterministic key: the same sale replayed produces the same key, and the
      // unique index turns the second attempt into a no-op.
      const uid = line.uid ? clip(line.uid + ':' + rl.ing_key, 160) : ''

      const q = await recordIngMovement(rid, {
        ingKey: rl.ing_key,
        kind: 'consume',
        delta: -stockUnits,
        reason: 'Vente',
        actor: meta.actor,
        source: meta.source ?? 'pos',
        itemId: line.item_id,
        saleUid: line.uid || '',
        saleNum: line.sale_num ?? meta.saleNum ?? null,
        clientTs: line.ts ?? null,
        clientUid: uid,
      })
      if (q !== null) applied++
    }
  }
  return applied
}

// ── Cost ──────────────────────────────────────────────────────────────

export type IngCost = { ingKey: string; wac: number | null; manual: number; used: number }

/**
 * Effective cost per STOCK unit for each ingredient.
 * Weighted average across priced receipts when there is one, otherwise the
 * manually entered purchase price. Both are returned so the UI can show the gap
 * instead of hiding it.
 */
export async function ingredientCosts(rid: number): Promise<Map<string, IngCost>> {
  const out = new Map<string, IngCost>()
  let rows: any[] = []
  try {
    rows = await sql`
      SELECT i.ing_key,
             i.cost_per_stock_unit::float AS manual,
             d.wac_cost::float            AS wac
      FROM ingredients i
      LEFT JOIN ingredient_derived d
        ON d.restaurant_id = i.restaurant_id AND d.ing_key = i.ing_key
      WHERE i.restaurant_id = ${rid} AND NOT i.archived`
  } catch {
    // Ledger absent: fall back to the manual figure alone.
    try {
      rows = await sql`
        SELECT ing_key, cost_per_stock_unit::float AS manual, NULL::float AS wac
        FROM ingredients WHERE restaurant_id = ${rid} AND NOT archived`
    } catch { return out }
  }
  for (const r of rows) {
    const manual = n4(r.manual)
    const wac = r.wac == null ? null : n4(r.wac)
    out.set(r.ing_key, { ingKey: r.ing_key, wac, manual, used: wac != null && wac > 0 ? wac : manual })
  }
  return out
}

export type RecipeCost = {
  itemId: string
  computed: number          // what the lines add up to
  mode: 'auto' | 'manual'
  override: number | null
  used: number              // what the rest of the system should charge
  missingCost: string[]     // ingredients with no price at all
}

/**
 * Roll a recipe up into a plate cost.
 *
 * Both figures are returned on purpose. An override that hides the computed
 * value turns a decision into a guess: showing "calculé 4,200 · utilisé 5,000"
 * is what makes a stale recipe or a bad assumption visible.
 */
export async function recipeCosts(rid: number): Promise<Map<string, RecipeCost>> {
  const out = new Map<string, RecipeCost>()
  const costs = await ingredientCosts(rid)

  let rows: any[] = []
  try {
    rows = await sql`
      SELECT r.item_id, r.cost_mode, r.cost_override::float AS cost_override,
             r.yield_qty::float AS yield_qty,
             rl.ing_key, rl.qty::float AS qty,
             i.conversion_factor::float AS conversion_factor
      FROM recipes r
      LEFT JOIN recipe_lines rl ON rl.restaurant_id = r.restaurant_id AND rl.item_id = r.item_id
      LEFT JOIN ingredients  i  ON i.restaurant_id  = r.restaurant_id AND i.ing_key  = rl.ing_key
      WHERE r.restaurant_id = ${rid} AND r.enabled`
  } catch {
    return out
  }

  for (const r of rows) {
    const id = r.item_id as string
    let e = out.get(id)
    if (!e) {
      e = {
        itemId: id, computed: 0,
        mode: r.cost_mode === 'manual' ? 'manual' : 'auto',
        override: r.cost_override == null ? null : n4(r.cost_override),
        used: 0, missingCost: [],
      }
      out.set(id, e)
    }
    if (!r.ing_key) continue

    const factor = n4(r.conversion_factor) > 0 ? n4(r.conversion_factor) : 1
    const yieldQty = n4(r.yield_qty) > 0 ? n4(r.yield_qty) : 1
    const c = costs.get(r.ing_key)
    const perStockUnit = c ? c.used : 0
    if (!perStockUnit) e.missingCost.push(r.ing_key)
    // cost per recipe unit = cost per stock unit ÷ recipe units per stock unit
    e.computed += (n4(r.qty) / yieldQty) * (perStockUnit / factor)
  }

  for (const e of out.values()) {
    e.computed = Math.round(e.computed * 1000) / 1000
    e.used = e.mode === 'manual' && e.override != null ? e.override : e.computed
  }
  return out
}

/**
 * Cache the computed cost on the recipe so the override always has the current
 * calculation sitting next to it, including when the mode is manual.
 *
 * AND — the key bit the user asked for — when cost_mode='auto', push the
 * computed figure into stock.cost so the POS picks it up on its next sync and
 * freezes the correct number onto every sale. This is what makes "a product
 * with a recipe gets its cost from its ingredients, automatically" real instead
 * of just displayed.
 */
export async function cacheComputedCosts(rid: number, costs: Map<string, RecipeCost>): Promise<void> {
  for (const c of costs.values()) {
    try {
      await sql`
        UPDATE recipes SET cost_computed = ${c.computed}, cost_computed_at = NOW()
        WHERE restaurant_id = ${rid} AND item_id = ${c.itemId}`

      // Auto mode: the recipe IS the cost. Write it through to stock.cost so the
      // POS (which only reads stock.cost) always has the current figure without
      // anyone having to type it twice. Manual mode: leave stock.cost alone, the
      // owner typed their own value on purpose.
      if (c.mode === 'auto' && c.computed > 0) {
        await sql`
          UPDATE stock SET cost = ${c.computed}, updated_at = NOW()
          WHERE restaurant_id = ${rid} AND item_id = ${c.itemId}`
      } else if (c.mode === 'manual' && c.override != null && c.override > 0) {
        // Manual override: the owner typed a specific cost, which is their
        // decision — but it STILL needs to reach stock.cost so the POS
        // freezes the right number onto the next sale. The calculated figure
        // stays on the recipe row for comparison ("calculé 4,200 · utilisé 5,000").
        await sql`
          UPDATE stock SET cost = ${c.override}, updated_at = NOW()
          WHERE restaurant_id = ${rid} AND item_id = ${c.itemId}`
      }
    } catch { return }   // column missing → migration not run; stop trying
  }
}
