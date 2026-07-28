import { sql } from '@/lib/db'

/**
 * Compute how urgent a due date is, relative to now.
 *
 * Returns:
 *   'late'  — due date is in the past (overdue)
 *   'soon'  — due in 0–3 days (this week warning)
 *   'ok'    — due in more than 3 days
 *   null    — no due date, or balance already zero
 *
 * Never stored in the DB — always computed at read time so it stays
 * accurate without any background job.
 */
export function computeUrgency(dueAt: string | null, balance: number): 'ok' | 'soon' | 'late' | null {
  if (!dueAt || balance <= 0) return null
  const days = Math.ceil((new Date(dueAt).getTime() - Date.now()) / 86400000)
  if (days < 0)  return 'late'
  if (days <= 3) return 'soon'
  return 'ok'
}

/**
 * Rebuild the cached amount owed to one supplier from immutable deliveries and
 * payments. Both product and ingredient deliveries feed the same balance.
 */
export async function refreshSupplierBalance(rid: number, supplierId: number): Promise<number> {
  let deliveries = 0
  try {
    const [[stock], [ingredients]] = await Promise.all([
      sql`SELECT COALESCE(SUM(ABS(delta) * COALESCE(unit_cost, 0)), 0)::float AS total
          FROM stock_movements
          WHERE restaurant_id = ${rid} AND supplier_id = ${supplierId}
            AND kind = 'receive' AND payment_method = 'credit'`,
      sql`SELECT COALESCE(SUM(ABS(delta) * COALESCE(unit_cost, 0)), 0)::float AS total
          FROM ingredient_movements
          WHERE restaurant_id = ${rid} AND supplier_id = ${supplierId}
            AND kind = 'receive' AND payment_method = 'credit'`,
    ])
    deliveries = Number(stock?.total || 0) + Number(ingredients?.total || 0)
  } catch {
    // Supplier tracking is additive: older databases may not yet have the
    // supplier columns on both ledgers.
  }

  const [payments] = await sql`
    SELECT COALESCE(SUM(amount), 0)::float AS total
    FROM supplier_payments
    WHERE restaurant_id = ${rid} AND supplier_id = ${supplierId}`

  const balance = Math.round((deliveries - Number(payments?.total || 0)) * 1000) / 1000
  await sql`UPDATE suppliers SET balance = ${balance}, updated_at = NOW()
            WHERE id = ${supplierId} AND restaurant_id = ${rid}`
  return balance
}
