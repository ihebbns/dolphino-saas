// ═══════════════════════════════════════════════════
// /api/me/online-orders — the till's incoming-order queue.
//
// GET  ?key=API              → pending orders (+ a short recent history)
// POST { key, action:'accept'|'reject', order_id, actor? }
//   → staff-driven only, never auto-transitions. 'accept' does NOT deduct
//     stock or touch sales here — the POS pulls the pending order's items
//     into a normal cart via this same GET response and completes the sale
//     through its own encaisser() flow, so accepted online orders go
//     through EXACTLY the same stock/kitchen-ticket/receipt path as an
//     order typed in by hand. This endpoint only tracks queue status.
// ═══════════════════════════════════════════════════

import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { getApiKey } from '@/lib/auth'
import { serverError } from '@/lib/apiError'

export const runtime = 'edge'

const cors = (r: NextResponse) => {
  r.headers.set('Access-Control-Allow-Origin', '*')
  r.headers.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  r.headers.set('Access-Control-Allow-Headers', 'Content-Type,X-Api-Key')
  return r
}
export async function OPTIONS() { return cors(new NextResponse(null, { status: 200 })) }

const clip = (v: any, n: number) => String(v ?? '').slice(0, n)

function getKey(req: Request, body?: any): string {
  return (body && body.key) || getApiKey(req) || new URL(req.url).searchParams.get('key') || ''
}

async function resolveRestaurant(key: string) {
  const rows = await sql`
    SELECT id FROM restaurants WHERE api_key = ${key} AND plan NOT IN ('suspended', 'suspended_exe') LIMIT 1`
  return rows.length ? rows[0] : null
}

export async function GET(req: Request) {
  const key = getKey(req)
  if (!key) return cors(NextResponse.json({ ok: false, error: 'Clé manquante' }, { status: 400 }))
  try {
    const rest = await resolveRestaurant(key)
    if (!rest) return cors(NextResponse.json({ ok: false, error: 'Compte introuvable ou suspendu' }, { status: 403 }))

    const pending = await sql`
      SELECT id, client_name, client_phone, order_type, items_json, total::float AS total, note, created_at
      FROM online_orders
      WHERE restaurant_id = ${rest.id} AND status = 'pending'
      ORDER BY created_at ASC`

    const recent = await sql`
      SELECT id, client_name, order_type, total::float AS total, status, created_at, responded_at
      FROM online_orders
      WHERE restaurant_id = ${rest.id} AND status != 'pending'
      ORDER BY responded_at DESC LIMIT 30`

    return cors(NextResponse.json({ ok: true, pending, recent }))
  } catch (e: any) {
    return cors(NextResponse.json(serverError('online-orders GET', e), { status: 500 }))
  }
}

export async function POST(req: Request) {
  let body: any
  try { body = await req.json() } catch { return cors(NextResponse.json({ ok: false, error: 'Bad JSON' }, { status: 400 })) }
  const key = getKey(req, body)
  if (!key) return cors(NextResponse.json({ ok: false, error: 'Clé manquante' }, { status: 400 }))

  const action = clip(body?.action, 16)
  const orderId = parseInt(String(body?.order_id))
  if (!['accept', 'reject'].includes(action) || !Number.isFinite(orderId)) {
    return cors(NextResponse.json({ ok: false, error: 'Paramètres invalides' }, { status: 400 }))
  }

  try {
    const rest = await resolveRestaurant(key)
    if (!rest) return cors(NextResponse.json({ ok: false, error: 'Compte introuvable ou suspendu' }, { status: 403 }))

    const status = action === 'accept' ? 'accepted' : 'rejected'
    const res = await sql`
      UPDATE online_orders SET status = ${status}, responded_by = ${clip(body?.actor, 80)}, responded_at = NOW()
      WHERE id = ${orderId} AND restaurant_id = ${rest.id} AND status = 'pending'
      RETURNING id`
    if (!res.length) return cors(NextResponse.json({ ok: false, error: 'Commande introuvable ou déjà traitée' }, { status: 404 }))

    return cors(NextResponse.json({ ok: true }))
  } catch (e: any) {
    return cors(NextResponse.json(serverError('online-orders POST', e), { status: 500 }))
  }
}
