// ═══════════════════════════════════════════════════
// /api/credits
// GET  ?key=XXX        → returns all credit clients for this restaurant
// POST ?key=XXX        → sync full credit data from POS
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

export async function OPTIONS() {
  return cors(new NextResponse(null, { status: 200 }))
}

export async function GET(req: Request) {
  const key = getApiKey(req)
  if (!key) return cors(NextResponse.json({ ok: false, error: 'API key required' }, { status: 401 }))

  const rows = await sql`SELECT id FROM restaurants WHERE api_key=${key} AND plan!='suspended' LIMIT 1`
  if (!rows.length) return cors(NextResponse.json({ ok: false, error: 'Invalid key' }, { status: 403 }))
  const rid = rows[0].id

  const credits = await sql`
    SELECT client_name, phone, balance, history, updated_at
    FROM credits
    WHERE restaurant_id = ${rid}
    ORDER BY balance DESC, client_name ASC
  `
  return cors(NextResponse.json({ ok: true, credits }))
}

export async function POST(req: Request) {
  const key = getApiKey(req)
  if (!key) return cors(NextResponse.json({ ok: false, error: 'API key required' }, { status: 401 }))

  const rows = await sql`SELECT id FROM restaurants WHERE api_key=${key} AND plan!='suspended' LIMIT 1`
  if (!rows.length) return cors(NextResponse.json({ ok: false, error: 'Invalid key' }, { status: 403 }))
  const rid = rows[0].id

  let body: any
  try { body = await req.json() } catch { return cors(NextResponse.json({ ok: false, error: 'Bad JSON' }, { status: 400 })) }

  const clients: { name: string; phone?: string; balance: number; history: any[] }[] = body.clients || []
  if (!clients.length) return cors(NextResponse.json({ ok: true, updated: 0 }))

  for (const c of clients.slice(0, 500)) {
    const name = String(c.name).slice(0, 100)
    const phone = String(c.phone || '').slice(0, 30)
    const balance = parseFloat(String(c.balance)) || 0
    const history = JSON.stringify(c.history || [])

    await sql`
      INSERT INTO credits (restaurant_id, client_name, phone, balance, history, updated_at)
      VALUES (${rid}, ${name}, ${phone}, ${balance}, ${history}::jsonb, NOW())
      ON CONFLICT (restaurant_id, client_name)
      DO UPDATE SET
        phone = ${phone},
        balance = ${balance},
        history = ${history}::jsonb,
        updated_at = NOW()
    `
  }

  return cors(NextResponse.json({ ok: true, updated: clients.length }))
}
