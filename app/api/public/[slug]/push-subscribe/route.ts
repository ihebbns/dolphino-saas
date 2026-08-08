// ═══════════════════════════════════════════════════
// POST /api/public/[slug]/push-subscribe — stores a browser's push
// subscription for ONE order, called from /moi/[slug] right after the
// customer grants notification permission (which only happens after they've
// already submitted that order — there's no persistent /moi identity to
// subscribe ahead of time).
//
// Body: { order_id, subscription: { endpoint, keys: { p256dh, auth } } }
// ═══════════════════════════════════════════════════

import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { serverError } from '@/lib/apiError'

export const runtime = 'edge'

export async function POST(req: Request, { params }: { params: { slug: string } }) {
  const slug = String(params.slug || '').slice(0, 60)
  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ ok: false, error: 'Bad JSON' }, { status: 400 }) }

  const orderId = parseInt(String(body?.order_id))
  const sub = body?.subscription
  if (!slug) return NextResponse.json({ ok: false, error: 'Lien invalide' }, { status: 400 })
  if (!Number.isFinite(orderId)) return NextResponse.json({ ok: false, error: 'Commande invalide' }, { status: 400 })
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
    return NextResponse.json({ ok: false, error: 'Abonnement invalide' }, { status: 400 })
  }

  try {
    const rest = await sql`
      SELECT id FROM restaurants WHERE public_slug = ${slug} AND plan NOT IN ('suspended', 'suspended_exe') LIMIT 1`
    if (!rest.length) return NextResponse.json({ ok: false, error: 'Commerce introuvable' }, { status: 404 })

    // Order must genuinely belong to this restaurant — a subscription
    // attached to someone else's order would leak a "your order's ready"
    // push to the wrong browser.
    const order = await sql`SELECT id FROM online_orders WHERE id = ${orderId} AND restaurant_id = ${rest[0].id} LIMIT 1`
    if (!order.length) return NextResponse.json({ ok: false, error: 'Commande introuvable' }, { status: 404 })

    await sql`
      INSERT INTO push_subscriptions (restaurant_id, order_id, endpoint, p256dh, auth)
      VALUES (${rest[0].id}, ${orderId}, ${String(sub.endpoint).slice(0, 500)}, ${String(sub.keys.p256dh)}, ${String(sub.keys.auth)})
      ON CONFLICT (order_id, endpoint) DO NOTHING`

    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json(serverError('push-subscribe', e), { status: 500 })
  }
}
