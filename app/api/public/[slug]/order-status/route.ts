// ═══════════════════════════════════════════════════
// GET /api/public/[slug]/order-status?order_id=X — read-only status check
// for a customer's own order, polled from /moi/[slug] after submission.
//
// Identification is the order_id alone (returned to the customer at
// submission time, in their browser) — same privacy posture already
// documented for the wallet-by-phone lookup: this is read-only, no payment
// step, and order ids are sequential per restaurant so this is closer to
// a paper ticket number than a secret. Nothing here can be written to.
// ═══════════════════════════════════════════════════

import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { serverError } from '@/lib/apiError'

export const runtime = 'edge'

export async function GET(req: Request, { params }: { params: { slug: string } }) {
  const slug = String(params.slug || '').slice(0, 60)
  const orderId = parseInt(new URL(req.url).searchParams.get('order_id') || '')
  if (!slug) return NextResponse.json({ ok: false, error: 'Lien invalide' }, { status: 400 })
  if (!Number.isFinite(orderId)) return NextResponse.json({ ok: false, error: 'Commande invalide' }, { status: 400 })

  try {
    const rest = await sql`
      SELECT id FROM restaurants WHERE public_slug = ${slug} AND plan NOT IN ('suspended', 'suspended_exe') LIMIT 1`
    if (!rest.length) return NextResponse.json({ ok: false, error: 'Commerce introuvable' }, { status: 404 })

    const rows = await sql`
      SELECT id, client_name, order_type, items_json, total::float AS total, status, ready, created_at
      FROM online_orders WHERE id = ${orderId} AND restaurant_id = ${rest[0].id} LIMIT 1`
    if (!rows.length) return NextResponse.json({ ok: false, error: 'Commande introuvable' }, { status: 404 })

    const o = rows[0]
    return NextResponse.json({
      ok: true,
      status: o.status, ready: o.ready,
      client_name: o.client_name, order_type: o.order_type,
      items: o.items_json, total: o.total, created_at: o.created_at,
    })
  } catch (e: any) {
    return NextResponse.json(serverError('public order-status', e), { status: 500 })
  }
}
