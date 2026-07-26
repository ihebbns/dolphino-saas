// ═══════════════════════════════════════════════════
// STOCK LEDGER helpers — the single place that writes stock movements.
//
// Rules enforced here:
//   • Nothing ever overwrites a quantity. Every change is an immutable row in
//     stock_movements, so a theft can be traced instead of silently edited away.
//   • Quantity is DERIVED: latest 'count' checkpoint + the deltas recorded after
//     it. stock.quantity is only a cache, refreshed from the ledger.
//   • Every movement carries a CLIENT-generated timestamp so offline replays and
//     multiple terminals sequence correctly, plus an optional client_uid so a
//     replayed movement cannot be applied twice.
//
// Requires migration-stock-movements.sql. Every function degrades gracefully if
// the table is not there yet, so deploying this before running the migration
// cannot take the dashboard down.
// ═══════════════════════════════════════════════════

import { sql } from '@/lib/db'

export type MovementKind = 'sale' | 'receive' | 'waste' | 'adjust' | 'return' | 'count'

export const MOVEMENT_KINDS: MovementKind[] = ['sale', 'receive', 'waste', 'adjust', 'return', 'count']

// Movements the POS is allowed to originate — which is all of them.
//
// 'receive' used to be excluded here on the grounds that recording a delivery is
// office work. That was wrong for this product: many clients buy the POS on its
// own and never open the back-office, so a till that cannot book a delivery
// leaves them with no way to enter stock at all. It is also wrong operationally
// — the supplier arrives at the counter, not at the owner's laptop.
//
// Allowing it costs nothing, because permission is not what makes a movement
// trustworthy: every row carries actor, reason, source and an immutable
// timestamp, and only a 'count' may reset the checkpoint.
export const POS_KINDS: MovementKind[] = ['sale', 'receive', 'waste', 'adjust', 'return', 'count']

// ── Tracking mode ─────────────────────────────────────────────────────
//
// Every product is tracked exactly ONE way. Before this, a product could carry
// both a counted quantity and a recipe, and a single sale deducted both — so
// /stock and /ingredients gave two different answers for the same item and there
// was no way to tell which one to trust.
//
//   'stock'   counted by the unit (a Coca is a bottle in, a bottle out)
//   'recipe'  built from ingredients (a citronnade takes 200 ml of a 1 L bottle)
//   'none'    not tracked
//
// The mode decides what a SALE CONSUMES. It does not affect costing: a recipe
// still prices a product whatever the mode.
export type TrackMode = 'stock' | 'recipe' | 'none'

export const TRACK_MODES: TrackMode[] = ['stock', 'recipe', 'none']

export function isTrackMode(v: any): v is TrackMode {
  return TRACK_MODES.includes(v as TrackMode)
}

/**
 * Resolve the mode for each of `itemIds`.
 *
 * Two fallbacks matter here:
 *   • A recipe-built product often has NO `stock` row at all — nobody ever
 *     counted a citronnade — so an absent row must not silently mean "count it
 *     by the unit". If a recipe exists, the answer is 'recipe'.
 *   • Before migration-product-tracking.sql the column does not exist. Rather
 *     than fail the sale, fall back to the same recipe-or-stock inference, which
 *     reproduces the intended behaviour without the column.
 */
export async function resolveTrackModes(
  rid: number,
  itemIds: string[],
): Promise<Map<string, TrackMode>> {
  const out = new Map<string, TrackMode>()
  const ids = [...new Set(itemIds.filter(Boolean))]
  if (!ids.length) return out

  // Which of these products has a recipe? Used both as the fallback and to
  // decide the mode for products with no stock row.
  const withRecipe = new Set<string>()
  try {
    const rows = await sql`
      SELECT item_id FROM recipes
      WHERE restaurant_id = ${rid} AND item_id = ANY(${ids}) AND enabled`
    for (const r of rows) withRecipe.add(String(r.item_id))
  } catch { /* recipes not migrated — leave the set empty */ }

  let haveColumn = true
  try {
    const rows = await sql`
      SELECT item_id, track_mode FROM stock
      WHERE restaurant_id = ${rid} AND item_id = ANY(${ids})`
    for (const r of rows) {
      const m = String(r.track_mode || '')
      if (isTrackMode(m)) out.set(String(r.item_id), m)
    }
  } catch {
    haveColumn = false
  }

  for (const id of ids) {
    if (out.has(id)) continue
    // No stock row, or no column yet: a recipe is the deliberate statement of
    // intent, so it wins. Otherwise count units.
    out.set(id, withRecipe.has(id) ? 'recipe' : 'stock')
  }

  // Column missing entirely: ignore whatever we managed to read and infer for
  // everything, so behaviour is consistent rather than half-and-half.
  if (!haveColumn) {
    for (const id of ids) out.set(id, withRecipe.has(id) ? 'recipe' : 'stock')
  }

  return out
}

export type MovementInput = {
  itemId: string
  kind: MovementKind
  /** Signed change. Required for every kind except 'count'. */
  delta?: number | null
  /** Absolute counted value. Required for 'count'. */
  countValue?: number | null
  reason?: string
  actor?: string
  source?: 'pos' | 'web'
  terminalId?: string
  sessionId?: string
  saleNum?: number | null
  /** Client-generated ISO instant. Falls back to now when absent. */
  clientTs?: string | null
  /** Idempotency key. Blank means "not deduplicated". */
  clientUid?: string
  /** The unit price paid, used for weighted average cost. Only on 'receive'. */
  unitCost?: number | null
  /** Supplier who delivered. Nullable (passager = one-time supplier). */
  supplierId?: number | null
  /** How the delivery was paid: 'comptant' | 'credit'. Drives supplier balance. */
  paymentMethod?: 'comptant' | 'credit' | null
}

const n3 = (v: any): number => {
  const f = parseFloat(String(v))
  return Number.isFinite(f) ? Math.round(f * 1000) / 1000 : 0
}

const clip = (v: any, len: number): string => String(v ?? '').slice(0, len)

/** Accept only a real, parseable instant — never trust a client string blindly. */
function safeTs(v: any): string {
  const t = v ? Date.parse(String(v)) : NaN
  if (!Number.isFinite(t)) return new Date().toISOString()
  // Reject absurd clocks (a POS with a wrong date would corrupt sequencing).
  const now = Date.now()
  const yearMs = 365 * 24 * 3600 * 1000
  if (t < now - 5 * yearMs || t > now + 2 * 24 * 3600 * 1000) return new Date().toISOString()
  return new Date(t).toISOString()
}

export function isMovementKind(v: any): v is MovementKind {
  return MOVEMENT_KINDS.includes(v as MovementKind)
}

/**
 * Quantity derived from the ledger for one product.
 * latest 'count' value + sum of deltas recorded after that count.
 */
export async function derivedQuantity(rid: number, itemId: string): Promise<number> {
  const rows = await sql`
    WITH lc AS (
      SELECT count_value, client_ts
      FROM stock_movements
      WHERE restaurant_id = ${rid} AND item_id = ${itemId} AND kind = 'count'
      ORDER BY client_ts DESC, id DESC
      LIMIT 1
    )
    SELECT COALESCE((SELECT count_value FROM lc), 0)
         + COALESCE((
             SELECT SUM(delta) FROM stock_movements m
             WHERE m.restaurant_id = ${rid} AND m.item_id = ${itemId}
               AND m.delta IS NOT NULL
               AND (
                 (SELECT client_ts FROM lc) IS NULL
                 OR m.client_ts > (SELECT client_ts FROM lc)
               )
           ), 0) AS quantity`
  return n3(rows[0]?.quantity)
}

/** Push the derived quantity back into the stock.quantity cache. */
export async function refreshStockCache(rid: number, itemId: string): Promise<number> {
  const qty = await derivedQuantity(rid, itemId)
  // Never let the cache go negative — the ledger keeps the true (possibly
  // negative) figure, but the cache feeds UI that assumes >= 0.
  const cached = Math.max(0, qty)
  await sql`
    UPDATE stock SET quantity = ${Math.round(cached)}, updated_at = NOW()
    WHERE restaurant_id = ${rid} AND item_id = ${itemId}`
  return qty
}

/**
 * Append one movement and refresh the cache.
 * Returns the new derived quantity, or null when the movement was a duplicate
 * (same client_uid already recorded) or the ledger table does not exist yet.
 */
export async function recordMovement(rid: number, m: MovementInput): Promise<number | null> {
  const itemId = clip(m.itemId, 64)
  if (!itemId || !isMovementKind(m.kind)) return null

  const isCount = m.kind === 'count'
  const delta = isCount ? null : n3(m.delta)
  const countValue = isCount ? Math.max(0, n3(m.countValue)) : null

  // A zero-delta movement carries no information; drop it rather than litter
  // the audit trail. (A zero COUNT is meaningful — that is "we have none".)
  if (!isCount && delta === 0) return null

  const clientTs = safeTs(m.clientTs)
  const clientUid = clip(m.clientUid, 64)

  // For a count, freeze what the system believed so the écart stays accurate
  // forever, exactly like the cash clôture stores theorique next to compté.
  let expected: number | null = null
  if (isCount) {
    try { expected = await derivedQuantity(rid, itemId) } catch { expected = null }
  }

  // Fields that only matter on a delivery (kind='receive') but live on the same
  // row because the movement IS the delivery — there is no separate table.
  const unitCost = m.kind === 'receive' && m.unitCost != null && n3(m.unitCost) > 0 ? n3(m.unitCost) : null
  const supplierId = m.kind === 'receive' && m.supplierId ? m.supplierId : null
  const paymentMethod = m.kind === 'receive' && m.paymentMethod ? clip(m.paymentMethod, 20) : null

  try {
    if (clientUid) {
      const ins = await sql`
        INSERT INTO stock_movements
          (restaurant_id, item_id, kind, delta, count_value, expected_value,
           unit_cost, supplier_id, payment_method,
           reason, actor, source, terminal_id, session_id, sale_num, client_ts, client_uid)
        VALUES
          (${rid}, ${itemId}, ${m.kind}, ${delta}, ${countValue}, ${expected},
           ${unitCost}, ${supplierId}, ${paymentMethod},
           ${clip(m.reason, 200)}, ${clip(m.actor, 80)}, ${m.source === 'web' ? 'web' : 'pos'},
           ${clip(m.terminalId, 64)}, ${clip(m.sessionId, 64)},
           ${Number.isFinite(m.saleNum as any) ? m.saleNum : null},
           ${clientTs}, ${clientUid})
        ON CONFLICT (restaurant_id, client_uid) WHERE client_uid <> '' DO NOTHING
        RETURNING id`
      // Already recorded → do not touch the cache, do not double-apply.
      if (!ins.length) return null
    } else {
      await sql`
        INSERT INTO stock_movements
          (restaurant_id, item_id, kind, delta, count_value, expected_value,
           unit_cost, supplier_id, payment_method,
           reason, actor, source, terminal_id, session_id, sale_num, client_ts, client_uid)
        VALUES
          (${rid}, ${itemId}, ${m.kind}, ${delta}, ${countValue}, ${expected},
           ${unitCost}, ${supplierId}, ${paymentMethod},
           ${clip(m.reason, 200)}, ${clip(m.actor, 80)}, ${m.source === 'web' ? 'web' : 'pos'},
           ${clip(m.terminalId, 64)}, ${clip(m.sessionId, 64)},
           ${Number.isFinite(m.saleNum as any) ? m.saleNum : null},
           ${clientTs}, '')`
    }
  } catch (e: any) {
    // If the failure is specifically about the supplier columns not existing yet
    // (migration-suppliers.sql not run), retry WITHOUT those columns so stock
    // movements still work — the supplier feature is additive, not blocking.
    const code = String(e?.code || '')
    const msg = String(e?.message || '')
    const isSupplierCol = (code === '42703' || /does not exist|undefined_column/i.test(msg))
      && /supplier_id|payment_method/i.test(msg)

    if (isSupplierCol) {
      try {
        if (clientUid) {
          const ins = await sql`
            INSERT INTO stock_movements
              (restaurant_id, item_id, kind, delta, count_value, expected_value,
               unit_cost, reason, actor, source, terminal_id, session_id, sale_num, client_ts, client_uid)
            VALUES
              (${rid}, ${itemId}, ${m.kind}, ${delta}, ${countValue}, ${expected},
               ${unitCost},
               ${clip(m.reason, 200)}, ${clip(m.actor, 80)}, ${m.source === 'web' ? 'web' : 'pos'},
               ${clip(m.terminalId, 64)}, ${clip(m.sessionId, 64)},
               ${Number.isFinite(m.saleNum as any) ? m.saleNum : null},
               ${clientTs}, ${clientUid})
            ON CONFLICT (restaurant_id, client_uid) WHERE client_uid <> '' DO NOTHING
            RETURNING id`
          if (!ins.length) return null
        } else {
          await sql`
            INSERT INTO stock_movements
              (restaurant_id, item_id, kind, delta, count_value, expected_value,
               unit_cost, reason, actor, source, terminal_id, session_id, sale_num, client_ts, client_uid)
            VALUES
              (${rid}, ${itemId}, ${m.kind}, ${delta}, ${countValue}, ${expected},
               ${unitCost},
               ${clip(m.reason, 200)}, ${clip(m.actor, 80)}, ${m.source === 'web' ? 'web' : 'pos'},
               ${clip(m.terminalId, 64)}, ${clip(m.sessionId, 64)},
               ${Number.isFinite(m.saleNum as any) ? m.saleNum : null},
               ${clientTs}, '')`
        }
      } catch {
        return null
      }
    } else {
      // Table missing or other write failure — do not break the caller.
      return null
    }
  }

  try { return await refreshStockCache(rid, itemId) } catch { return null }
}

/** Append several movements. Returns how many were actually recorded. */
export async function recordMovements(rid: number, list: MovementInput[]): Promise<number> {
  let applied = 0
  for (const m of list.slice(0, 500)) {
    const q = await recordMovement(rid, m)
    if (q !== null) applied++
  }
  return applied
}

/** True when the ledger table exists — lets callers pick a code path. */
export async function ledgerReady(): Promise<boolean> {
  try {
    await sql`SELECT 1 FROM stock_movements LIMIT 1`
    return true
  } catch {
    return false
  }
}
