import { sql } from '@/lib/db'

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
