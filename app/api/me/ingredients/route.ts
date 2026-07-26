// ═══════════════════════════════════════════════════
// /api/me/ingredients — INGREDIENTS & RECIPES (web-owned)
//
// GET  ?key=API
//   → { ingredients, recipes, products, totals }
//     products = the caisse-owned menu, so a recipe can be attached to a real
//     item and its computed cost compared against the real selling price.
//
// POST { key, action, ... }
//   action 'saveIngredient'  { ing_key?, name, category, stock_unit,
//                              recipe_unit, conversion_factor,
//                              cost_per_stock_unit, quantity, low_threshold,
//                              tracked }
//   action 'deleteIngredient'{ ing_key }        → archives, and refuses if used
//   action 'saveRecipe'      { item_id, item_name, cost_mode, cost_override,
//                              enabled, yield_qty, lines:[{ing_key, qty}] }
//   action 'deleteRecipe'    { item_id }
//
// Recipes are OPTIONAL: a product with no recipe keeps its manual cost and
// deducts nothing. See migration-ingredients.sql.
// ═══════════════════════════════════════════════════

import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { getApiKey } from '@/lib/auth'
import { recipeCosts, cacheComputedCosts, ingredientCosts, ingredientLedgerReady } from '@/lib/ingredients'

export const runtime = 'edge'

const cors = (r: NextResponse) => {
  r.headers.set('Access-Control-Allow-Origin', '*')
  r.headers.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  r.headers.set('Access-Control-Allow-Headers', 'Content-Type,X-Api-Key')
  return r
}
export async function OPTIONS() { return cors(new NextResponse(null, { status: 200 })) }

const clip = (v: any, n: number) => String(v ?? '').slice(0, n)
const n3 = (v: any) => { const f = parseFloat(String(v)); return Number.isFinite(f) ? Math.round(f * 1000) / 1000 : 0 }
const n4 = (v: any) => { const f = parseFloat(String(v)); return Number.isFinite(f) ? Math.round(f * 10000) / 10000 : 0 }

function slug(name: string, prefix = 'i_'): string {
  const b = String(name || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return (prefix + (b || 'sans-nom')).slice(0, 64)
}

/** Variant items keep prices in v[]; reading only `p` reported 0. Mirrors /api/me/catalog. */
function itemPrice(it: any): number {
  if (Array.isArray(it?.v) && it.v.length) {
    const ps = it.v.map((v: any) => Math.max(0, parseFloat(v?.p) || 0)).filter((n: number) => n > 0)
    if (ps.length) return Math.min(...ps)
  }
  return Math.max(0, parseFloat(it?.p ?? it?.price) || 0)
}
function resolveId(cat: string, it: any): string {
  const raw = it.id ?? it._id ?? it.item_id
  return raw !== undefined && raw !== null && String(raw).trim() !== ''
    ? String(raw).trim().slice(0, 64)
    : ('m_' + `${cat}_${it.name ?? ''}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')).slice(0, 64)
}

async function ready(): Promise<boolean> {
  try { await sql`SELECT 1 FROM ingredients LIMIT 1`; return true } catch { return false }
}
async function resolveRestaurant(key: string) {
  const rows = await sql`
    SELECT id, name, menu_json FROM restaurants
    WHERE api_key = ${key} AND plan NOT IN ('suspended','suspended_dash') LIMIT 1`
  return rows.length ? rows[0] : null
}
const getKey = (req: Request, body?: any) =>
  (body && body.key) || getApiKey(req) || new URL(req.url).searchParams.get('key') || ''

// ─────────────────────────────────────────────────────────────
export async function GET(req: Request) {
  const key = getKey(req)
  if (!key) return cors(NextResponse.json({ ok: false, error: 'Clé manquante' }, { status: 400 }))

  try {
    const rest = await resolveRestaurant(key)
    if (!rest) return cors(NextResponse.json({ ok: false, error: 'Compte introuvable ou suspendu' }, { status: 403 }))
    const rid = rest.id

    // The menu is caisse-owned; expose it so recipes attach to real products.
    const menu = (rest.menu_json && typeof rest.menu_json === 'object') ? rest.menu_json : {}
    const products: any[] = []
    for (const [catName, catVal] of Object.entries<any>(menu)) {
      const items = Array.isArray(catVal) ? catVal : (catVal && Array.isArray(catVal.items) ? catVal.items : [])
      for (const it of items) {
        if (!it || typeof it !== 'object') continue
        products.push({
          item_id: resolveId(catName, it),
          name: clip(it.name ?? it.n, 120),
          category: catName,
          emoji: clip(it.e ?? it.emoji, 10) || '🍽️',
          price: itemPrice(it),
        })
      }
    }

    if (!(await ready())) {
      return cors(NextResponse.json({ ok: true, ready: false, ingredients: [], recipes: [], products, totals: null }))
    }

    const ingredients = await sql`
      SELECT ing_key, name, category, stock_unit, recipe_unit,
             conversion_factor::float, cost_per_stock_unit::float,
             cost_per_recipe_unit::float, quantity::float, low_threshold::float,
             tracked, archived, stock_value::float, is_low, used_in_recipes
      FROM ingredient_stock
      WHERE restaurant_id = ${rid}
      ORDER BY archived, category NULLS LAST, name`

    const recipes = await sql`
      SELECT rc.item_id, rc.item_name, rc.cost_mode, rc.cost_override::float,
             rc.enabled, rc.yield_qty::float,
             rc.cost_computed::float, rc.cost_effective::float,
             rc.nb_lines, rc.lines_missing_cost
      FROM recipe_cost rc
      WHERE rc.restaurant_id = ${rid}
      ORDER BY rc.item_name`

    const lines = await sql`
      SELECT item_id, ing_key, qty::float FROM recipe_lines WHERE restaurant_id = ${rid}`

    const byItem: Record<string, any[]> = {}
    for (const l of lines) (byItem[l.item_id] ||= []).push({ ing_key: l.ing_key, qty: l.qty })

    // Roll the lines up, and return BOTH the calculated figure and the one
    // actually charged. An override that hides the calculation turns a decision
    // into a guess — the gap between them is what exposes a stale recipe or a
    // bad assumption, so it has to stay on screen.
    const rollup = await recipeCosts(rid)
    cacheComputedCosts(rid, rollup).catch(() => {})   // best effort, never blocks the read

    const recipesFull = recipes.map((r: any) => {
      const c = rollup.get(r.item_id)
      const computed = c ? c.computed : 0
      const used = c ? c.used : (r.cost_override ?? 0)
      return {
        ...r,
        lines: byItem[r.item_id] || [],
        cost_computed: computed,
        cost_used: used,
        // Signed gap, so the UI can show "+19 %" without recomputing it.
        cost_gap: Math.round((used - computed) * 1000) / 1000,
        cost_gap_pct: computed > 0 ? Math.round(((used - computed) / computed) * 1000) / 10 : null,
        // Ingredients with no price at all: the usual reason a plate cost looks
        // impossibly low.
        missing_cost: c ? c.missingCost : [],
      }
    })

    const [totals] = await sql`
      SELECT COUNT(*) FILTER (WHERE NOT archived)::int                    AS nb_ingredients,
             COUNT(*) FILTER (WHERE is_low)::int                          AS nb_low,
             COALESCE(SUM(stock_value) FILTER (WHERE NOT archived),0)::float AS stock_value,
             COUNT(*) FILTER (WHERE NOT archived AND cost_per_stock_unit = 0)::int AS nb_sans_cout
      FROM ingredient_stock WHERE restaurant_id = ${rid}`

    return cors(NextResponse.json({
      ok: true, ready: true, name: rest.name,
      ingredients, recipes: recipesFull, products, totals,
    }))
  } catch (e: any) {
    return cors(NextResponse.json({ ok: false, error: e.message }, { status: 500 }))
  }
}

// ─────────────────────────────────────────────────────────────
export async function POST(req: Request) {
  let body: any
  try { body = await req.json() } catch { return cors(NextResponse.json({ ok: false, error: 'Bad JSON' }, { status: 400 })) }

  const key = getKey(req, body)
  if (!key) return cors(NextResponse.json({ ok: false, error: 'Clé manquante' }, { status: 400 }))
  const action = clip(body.action, 32)

  try {
    const rest = await resolveRestaurant(key)
    if (!rest) return cors(NextResponse.json({ ok: false, error: 'Compte introuvable ou suspendu' }, { status: 403 }))
    const rid = rest.id

    if (!(await ready())) {
      return cors(NextResponse.json({
        ok: false, error: 'Tables ingrédients non initialisées — exécutez migration-ingredients.sql',
      }, { status: 409 }))
    }

    // ── Ingredient ────────────────────────────────────────────
    if (action === 'saveIngredient') {
      const name = clip(body.name, 120).trim()
      if (!name) return cors(NextResponse.json({ ok: false, error: 'Nom requis' }, { status: 400 }))
      const ingKey = clip(body.ing_key, 64) || slug(name)

      // Guard the divisor: a zero factor would make every derived cost invalid.
      const conv = n4(body.conversion_factor)
      if (!(conv > 0)) {
        return cors(NextResponse.json({ ok: false, error: 'Le facteur de conversion doit être supérieur à 0' }, { status: 400 }))
      }

      await sql`
        INSERT INTO ingredients
          (restaurant_id, ing_key, name, category, stock_unit, recipe_unit,
           conversion_factor, cost_per_stock_unit, quantity, low_threshold, tracked, updated_at)
        VALUES
          (${rid}, ${ingKey}, ${name}, ${clip(body.category, 60)},
           ${clip(body.stock_unit, 24) || 'kg'}, ${clip(body.recipe_unit, 24) || 'g'},
           ${conv}, ${n3(body.cost_per_stock_unit)}, ${n3(body.quantity)},
           ${n3(body.low_threshold)}, ${body.tracked !== false}, NOW())
        ON CONFLICT (restaurant_id, ing_key) DO UPDATE SET
          name = EXCLUDED.name, category = EXCLUDED.category,
          stock_unit = EXCLUDED.stock_unit, recipe_unit = EXCLUDED.recipe_unit,
          conversion_factor = EXCLUDED.conversion_factor,
          cost_per_stock_unit = EXCLUDED.cost_per_stock_unit,
          quantity = EXCLUDED.quantity, low_threshold = EXCLUDED.low_threshold,
          tracked = EXCLUDED.tracked, archived = FALSE, updated_at = NOW()`
      return cors(NextResponse.json({ ok: true, ing_key: ingKey }))
    }

    if (action === 'deleteIngredient') {
      const ingKey = clip(body.ing_key, 64)
      if (!ingKey) return cors(NextResponse.json({ ok: false, error: 'ing_key requis' }, { status: 400 }))
      // Refuse while recipes still reference it, otherwise their cost silently
      // drops and the operator has no idea why.
      const used = await sql`
        SELECT COUNT(*)::int AS n FROM recipe_lines
        WHERE restaurant_id = ${rid} AND ing_key = ${ingKey}`
      if ((used[0]?.n || 0) > 0) {
        return cors(NextResponse.json({
          ok: false, error: `Utilisé dans ${used[0].n} recette(s) — retirez-le d'abord.`,
        }, { status: 409 }))
      }
      await sql`UPDATE ingredients SET archived = TRUE, updated_at = NOW()
                WHERE restaurant_id = ${rid} AND ing_key = ${ingKey}`
      return cors(NextResponse.json({ ok: true }))
    }

    // ── Recipe ────────────────────────────────────────────────
    if (action === 'saveRecipe') {
      const itemId = clip(body.item_id, 64)
      if (!itemId) return cors(NextResponse.json({ ok: false, error: 'item_id requis' }, { status: 400 }))
      const mode = body.cost_mode === 'manual' ? 'manual' : 'auto'
      const yieldQty = n3(body.yield_qty) || 1
      if (!(yieldQty > 0)) return cors(NextResponse.json({ ok: false, error: 'Rendement invalide' }, { status: 400 }))

      await sql`
        INSERT INTO recipes
          (restaurant_id, item_id, item_name, cost_mode, cost_override, enabled, yield_qty, notes, updated_at)
        VALUES
          (${rid}, ${itemId}, ${clip(body.item_name, 120)}, ${mode},
           ${mode === 'manual' ? n3(body.cost_override) : null},
           ${body.enabled !== false}, ${yieldQty}, ${clip(body.notes, 300)}, NOW())
        ON CONFLICT (restaurant_id, item_id) DO UPDATE SET
          item_name = EXCLUDED.item_name, cost_mode = EXCLUDED.cost_mode,
          cost_override = EXCLUDED.cost_override, enabled = EXCLUDED.enabled,
          yield_qty = EXCLUDED.yield_qty, notes = EXCLUDED.notes, updated_at = NOW()`

      // Replace the line set wholesale — simpler and atomic enough here than
      // diffing, and the editor always submits the complete list.
      if (Array.isArray(body.lines)) {
        await sql`DELETE FROM recipe_lines WHERE restaurant_id = ${rid} AND item_id = ${itemId}`
        for (const l of body.lines.slice(0, 200)) {
          const ik = clip(l?.ing_key, 64)
          const q = n4(l?.qty)
          if (!ik || !(q > 0)) continue
          await sql`
            INSERT INTO recipe_lines (restaurant_id, item_id, ing_key, qty)
            VALUES (${rid}, ${itemId}, ${ik}, ${q})
            ON CONFLICT (restaurant_id, item_id, ing_key) DO UPDATE SET qty = EXCLUDED.qty`
        }
      }
      // After saving the lines, recompute the cost and push it through:
      // - Always cache the computed figure on the recipe row.
      // - When mode='auto', write it into stock.cost so the POS picks it up
      //   next sync without anyone retyping it. That's the "cost from ingredients
      //   becomes the product's cost, automatically" the owner asked for.
      const rollup = await recipeCosts(rid)
      await cacheComputedCosts(rid, rollup)

      return cors(NextResponse.json({ ok: true, item_id: itemId }))
    }

    if (action === 'deleteRecipe') {
      const itemId = clip(body.item_id, 64)
      if (!itemId) return cors(NextResponse.json({ ok: false, error: 'item_id requis' }, { status: 400 }))
      await sql`DELETE FROM recipe_lines WHERE restaurant_id = ${rid} AND item_id = ${itemId}`
      await sql`DELETE FROM recipes      WHERE restaurant_id = ${rid} AND item_id = ${itemId}`
      return cors(NextResponse.json({ ok: true }))
    }

    return cors(NextResponse.json({ ok: false, error: 'Action inconnue' }, { status: 400 }))
  } catch (e: any) {
    return cors(NextResponse.json({ ok: false, error: e.message }, { status: 500 }))
  }
}
