// TEMPORARY diagnostic endpoint — DELETE after the credits issue is resolved.
// GET /api/debug-credits?key=YOUR_API_KEY
// Returns exactly what the credits route sees: which tables exist, which columns
// are present, and what the actual error is if the query fails.

import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'

export const runtime = 'edge'

export async function GET(req: Request) {
  const key = new URL(req.url).searchParams.get('key') || ''
  if (!key) return NextResponse.json({ error: 'key required' }, { status: 400 })

  const result: Record<string, any> = {}

  // 1. Which database are we actually talking to?
  try {
    const [r] = await sql`SELECT current_database()::text AS db, current_schema()::text AS schema, version() AS pg`
    result.database = r
  } catch (e: any) { result.database = { error: e.message } }

  // 2. Does the restaurant row exist?
  try {
    const rows = await sql`SELECT id, name, plan FROM restaurants WHERE api_key = ${key} LIMIT 1`
    result.restaurant = rows.length ? rows[0] : 'NOT FOUND'
  } catch (e: any) { result.restaurant = { error: e.message } }

  // 3. Which of the required tables exist?
  const NEEDED = ['credits', 'credit_movements']
  try {
    const rows = await sql`
      SELECT relname AS name FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = ANY(current_schemas(false))
        AND c.relkind IN ('r','v','m','p','f')
        AND c.relname = ANY(${NEEDED})`
    result.tables = { found: rows.map((r: any) => r.name), missing: NEEDED.filter(n => !rows.map((r: any) => r.name).includes(n)) }
  } catch (e: any) { result.tables = { error: e.message } }

  // 4. Which columns does credit_movements have?
  try {
    const rows = await sql`
      SELECT column_name, data_type FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'credit_movements'
      ORDER BY ordinal_position`
    result.credit_movements_columns = rows.map((r: any) => `${r.column_name} (${r.data_type})`)
  } catch (e: any) { result.credit_movements_columns = { error: e.message } }

  // 5. Try the exact inline query the credits GET runs
  if (result.restaurant && result.restaurant.id) {
    const rid = result.restaurant.id
    try {
      const clients = await sql`
        SELECT c.client_key, c.name, c.balance::float
        FROM credits c
        WHERE c.restaurant_id = ${rid}
        LIMIT 3`
      result.query_credits = { ok: true, rows: clients.length }
    } catch (e: any) { result.query_credits = { ok: false, error: e.message, code: (e as any).code } }

    try {
      await sql`SELECT 1 FROM credit_movements WHERE restaurant_id = ${rid} LIMIT 1`
      result.query_credit_movements = { ok: true }
    } catch (e: any) { result.query_credit_movements = { ok: false, error: e.message, code: (e as any).code } }

    // 6. Try the full inline reconciliation query that the credits GET actually runs
    try {
      const clients = await sql`
        SELECT c.client_key, c.name, c.phone,
               c.balance::float                                AS balance,
               COALESCE(m.derived, 0)::float                   AS balance_derived,
               (c.balance - COALESCE(m.derived, 0))::float     AS drift,
               COALESCE(m.nb_credits, 0)                       AS nb_credits,
               COALESCE(m.nb_payments, 0)                      AS nb_payments,
               COALESCE(m.total_credit, 0)::float              AS total_pris,
               COALESCE(m.total_paid, 0)::float                AS total_regle,
               m.last_movement_at,
               c.archived
        FROM credits c
        LEFT JOIN (
          SELECT restaurant_id, client_key,
                 SUM(delta)                                        AS derived,
                 COUNT(*) FILTER (WHERE kind = 'credit')::int       AS nb_credits,
                 COUNT(*) FILTER (WHERE kind = 'payment')::int      AS nb_payments,
                 COALESCE(SUM(delta) FILTER (WHERE delta > 0), 0)   AS total_credit,
                 COALESCE(SUM(-delta) FILTER (WHERE delta < 0), 0)  AS total_paid,
                 MAX(client_ts)                                     AS last_movement_at
          FROM credit_movements
          WHERE restaurant_id = ${rid}
          GROUP BY restaurant_id, client_key
        ) m ON m.restaurant_id = c.restaurant_id AND m.client_key = c.client_key
        WHERE c.restaurant_id = ${rid}
        ORDER BY c.archived ASC, c.balance DESC, c.name ASC
        LIMIT 3`
      result.full_reconciliation_query = { ok: true, rows: clients.length }
    } catch (e: any) {
      result.full_reconciliation_query = { ok: false, error: e.message, code: (e as any).code }
    }
  }

  return NextResponse.json(result, { status: 200 })
}
