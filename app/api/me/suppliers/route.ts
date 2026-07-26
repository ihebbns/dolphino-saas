// ═══════════════════════════════════════════════════
// /api/me/suppliers — SUPPLIER MANAGEMENT + CREDIT TRACKING
//
// GET  ?key=API
//   → { suppliers, totals }  — all suppliers with their running balance
//
// POST { key, action, ... }
//   action 'saveSupplier'    { id?, name, phone, category, notes }
//   action 'archiveSupplier' { id }
//   action 'recordPayment'   { supplier_id, amount, method, reference, notes }
//   action 'getDeliveries'   { supplier_id, limit? }
//     → { deliveries }  — all stock + ingredient deliveries from this supplier
//
// The balance is what you OWE: deliveries on credit increase it, payments
// decrease it. A delivery paid comptant does not touch the balance.
// Same append-only ledger design as client credits.
// ═══════════════════════════════════════════════════

import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { getApiKey } from '@/lib/auth'
import { refreshSupplierBalance } from '@/lib/suppliers'
import { serverError, isMissingSchema, notReadyPayload, missingRelations, dbIdentity } from '@/lib/apiError'

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

function getKey(req: Request, body?: any): string {
  return (body && body.key) || getApiKey(req) || new URL(req.url).searchParams.get('key') || ''
}

const NEEDS = ['suppliers', 'supplier_payments']

async function resolveRestaurant(key: string) {
  const rows = await sql`
    SELECT id, name FROM restaurants
    WHERE api_key = ${key} AND plan NOT IN ('suspended', 'suspended_dash')
    LIMIT 1`
  return rows.length ? rows[0] : null
}

// ─────────────────────────────────────────────────────────────────────
export async function GET(req: Request) {
  const key = getKey(req)
  if (!key) return cors(NextResponse.json({ ok: false, error: 'Clé manquante' }, { status: 400 }))

  try {
    const rest = await resolveRestaurant(key)
    if (!rest) return cors(NextResponse.json({ ok: false, error: 'Compte introuvable ou suspendu' }, { status: 403 }))
    const rid = rest.id

    const gaps = await missingRelations(sql, NEEDS)
    if (gaps.length) {
      const id = await dbIdentity(sql)
      return cors(NextResponse.json(
        notReadyPayload('migration-suppliers.sql', { suppliers: [], totals: null }, gaps)
      ))
    }

    const suppliers = await sql`
      SELECT id, name, phone, category, notes, balance::float, archived, created_at, updated_at
      FROM suppliers
      WHERE restaurant_id = ${rid}
      ORDER BY archived ASC, balance DESC, name ASC`

    const [totals] = await sql`
      SELECT
        COUNT(*) FILTER (WHERE NOT archived)::int                          AS nb_suppliers,
        COALESCE(SUM(balance) FILTER (WHERE NOT archived AND balance > 0), 0)::float AS total_dette,
        COUNT(*) FILTER (WHERE NOT archived AND balance > 0)::int         AS nb_with_debt,
        COALESCE(SUM(balance) FILTER (WHERE archived AND balance > 0), 0)::float AS dette_archived
      FROM suppliers
      WHERE restaurant_id = ${rid}`

    return cors(NextResponse.json({ ok: true, ready: true, name: rest.name, suppliers, totals }))
  } catch (e: any) {
    if (isMissingSchema(e)) {
      return cors(NextResponse.json(
        notReadyPayload('migration-suppliers.sql', { suppliers: [], totals: null })
      ))
    }
    return cors(NextResponse.json(serverError('me/suppliers', e), { status: 500 }))
  }
}

// ─────────────────────────────────────────────────────────────────────
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

    const gaps = await missingRelations(sql, NEEDS)
    if (gaps.length) {
      return cors(NextResponse.json({ ok: false, error: 'Tables fournisseurs non initialisées — exécutez migration-suppliers.sql' }, { status: 409 }))
    }

    // ── Save supplier ─────────────────────────────────────────────
    if (action === 'saveSupplier') {
      const name = clip(body.name, 120).trim()
      if (!name) return cors(NextResponse.json({ ok: false, error: 'Nom requis' }, { status: 400 }))

      const id = body.id ? parseInt(String(body.id)) : null

      if (id) {
        // Update
        await sql`
          UPDATE suppliers SET
            name = ${name},
            phone = ${clip(body.phone, 40)},
            category = ${clip(body.category, 60)},
            notes = ${clip(body.notes, 2000)},
            updated_at = NOW()
          WHERE id = ${id} AND restaurant_id = ${rid}`
        return cors(NextResponse.json({ ok: true, id }))
      } else {
        // Insert
        const [row] = await sql`
          INSERT INTO suppliers (restaurant_id, name, phone, category, notes)
          VALUES (${rid}, ${name}, ${clip(body.phone, 40)}, ${clip(body.category, 60)}, ${clip(body.notes, 2000)})
          ON CONFLICT (restaurant_id, name) WHERE NOT archived
            DO UPDATE SET phone = EXCLUDED.phone, category = EXCLUDED.category,
                          notes = EXCLUDED.notes, updated_at = NOW()
          RETURNING id`
        return cors(NextResponse.json({ ok: true, id: row.id }))
      }
    }

    // ── Archive supplier ──────────────────────────────────────────
    if (action === 'archiveSupplier') {
      const id = parseInt(String(body.id))
      if (!id) return cors(NextResponse.json({ ok: false, error: 'id requis' }, { status: 400 }))
      await sql`UPDATE suppliers SET archived = TRUE, updated_at = NOW() WHERE id = ${id} AND restaurant_id = ${rid}`
      return cors(NextResponse.json({ ok: true }))
    }

    // ── Record payment ────────────────────────────────────────────
    if (action === 'recordPayment') {
      const supplierId = parseInt(String(body.supplier_id))
      const amount = n3(body.amount)
      if (!supplierId) return cors(NextResponse.json({ ok: false, error: 'supplier_id requis' }, { status: 400 }))
      if (!(amount > 0)) return cors(NextResponse.json({ ok: false, error: 'Montant doit être > 0' }, { status: 400 }))

      // Verify supplier belongs to this restaurant
      const [s] = await sql`SELECT id FROM suppliers WHERE id = ${supplierId} AND restaurant_id = ${rid} LIMIT 1`
      if (!s) return cors(NextResponse.json({ ok: false, error: 'Fournisseur introuvable' }, { status: 404 }))

      await sql`
        INSERT INTO supplier_payments (restaurant_id, supplier_id, amount, method, reference, notes, actor, client_ts)
        VALUES (${rid}, ${supplierId}, ${amount}, ${clip(body.method, 20) || 'espèces'},
                ${clip(body.reference, 120)}, ${clip(body.notes, 2000)},
                ${clip(body.actor, 80) || 'back-office'}, NOW())`

      const balance = await refreshSupplierBalance(rid, supplierId)
      return cors(NextResponse.json({ ok: true, balance }))
    }

    // ── Get deliveries for one supplier ───────────────────────────
    if (action === 'getDeliveries') {
      const supplierId = parseInt(String(body.supplier_id))
      if (!supplierId) return cors(NextResponse.json({ ok: false, error: 'supplier_id requis' }, { status: 400 }))
      const limit = Math.min(500, Math.max(1, parseInt(String(body.limit)) || 200))

      // Stock deliveries
      let stockDel: any[] = []
      try {
        stockDel = await sql`
          SELECT m.id, 'stock' AS source, m.item_id, s.item_name, s.item_emoji,
                 m.delta::float, m.unit_cost::float, m.payment_method,
                 m.reason, m.actor, m.client_ts,
                 (ABS(m.delta) * COALESCE(m.unit_cost, 0))::float AS line_total
          FROM stock_movements m
          LEFT JOIN stock s ON s.restaurant_id = m.restaurant_id AND s.item_id = m.item_id
          WHERE m.restaurant_id = ${rid} AND m.supplier_id = ${supplierId} AND m.kind = 'receive'
          ORDER BY m.client_ts DESC
          LIMIT ${limit}`
      } catch { /* table may not have supplier_id column yet */ }

      // Ingredient deliveries
      let ingDel: any[] = []
      try {
        ingDel = await sql`
          SELECT m.id, 'ingredient' AS source, m.ing_key AS item_id, i.name AS item_name, NULL AS item_emoji,
                 m.delta::float, m.unit_cost::float, m.payment_method,
                 m.reason, m.actor, m.client_ts,
                 (ABS(m.delta) * COALESCE(m.unit_cost, 0))::float AS line_total
          FROM ingredient_movements m
          LEFT JOIN ingredients i ON i.restaurant_id = m.restaurant_id AND i.ing_key = m.ing_key
          WHERE m.restaurant_id = ${rid} AND m.supplier_id = ${supplierId} AND m.kind = 'receive'
          ORDER BY m.client_ts DESC
          LIMIT ${limit}`
      } catch { /* table may not have supplier_id column yet */ }

      // Payments
      const payments = await sql`
        SELECT id, amount::float, method, reference, notes, actor, client_ts
        FROM supplier_payments
        WHERE restaurant_id = ${rid} AND supplier_id = ${supplierId}
        ORDER BY client_ts DESC
        LIMIT ${limit}`

      // Merge and sort
      const deliveries = [...stockDel, ...ingDel].sort((a, b) =>
        new Date(b.client_ts).getTime() - new Date(a.client_ts).getTime()
      )

      return cors(NextResponse.json({ ok: true, deliveries, payments }))
    }

    return cors(NextResponse.json({ ok: false, error: 'Action inconnue' }, { status: 400 }))
  } catch (e: any) {
    if (isMissingSchema(e)) {
      return cors(NextResponse.json(
        notReadyPayload('migration-suppliers.sql', { suppliers: [], totals: null })
      ))
    }
    return cors(NextResponse.json(serverError('me/suppliers', e), { status: 500 }))
  }
}
