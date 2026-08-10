// ═══════════════════════════════════════════════════
// GET /api/public/[slug]/my-orders?phone=X&pin=Y — a logged-in customer's
// own order history, live-pollable from the "Mon compte" tab of
// /moi/[slug] once they're authenticated (see requiresAccountLogin there).
//
// Same PIN-gate as /api/public/[slug]/wallet, reusing verifyWalletPin —
// a bare phone number is guessable/shareable, and an order list reveals
// name, items, and habits, so it gets the same protection as the balance
// itself rather than a weaker one. This only ever exists for restaurants
// with wallet + PIN protection on, i.e. exactly the ones that require an
// account to place an online order in the first place.
// ═══════════════════════════════════════════════════

import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { serverError } from '@/lib/apiError'
import { verifyWalletPin } from '@/lib/walletPin'

export const runtime = 'nodejs'

export async function GET(req: Request, { params }: { params: { slug: string } }) {
  const slug = String(params.slug || '').slice(0, 60)
  const url = new URL(req.url)
  const phone = String(url.searchParams.get('phone') || '').slice(0, 40).replace(/\s+/g, '')
  const pin = String(url.searchParams.get('pin') || '').slice(0, 4)
  if (!slug) return NextResponse.json({ ok: false, error: 'Lien invalide' }, { status: 400 })
  if (!phone) return NextResponse.json({ ok: false, error: 'Numéro requis' }, { status: 400 })

  try {
    const rest = await sql`
      SELECT id, config FROM restaurants WHERE public_slug = ${slug} AND plan NOT IN ('suspended', 'suspended_exe') LIMIT 1`
    if (!rest.length) return NextResponse.json({ ok: false, error: 'Commerce introuvable' }, { status: 404 })
    const rid = rest[0].id
    const modules = (rest[0].config?.modules && typeof rest[0].config.modules === 'object') ? rest[0].config.modules : {}
    if (modules.wallet !== true || modules.walletPinProtected !== true) {
      return NextResponse.json({ ok: false, error: 'Non disponible pour ce commerce' }, { status: 403 })
    }

    const result = await verifyWalletPin(sql, rid, phone, pin)
    if (result.ok === false) {
      if (result.reason === 'not_found') return NextResponse.json({ ok: false, error: 'Aucune carte fidélité trouvée pour ce numéro' }, { status: 404 })
      if (result.reason === 'no_pin') return NextResponse.json({ ok: false, error: 'Configurez d\'abord votre code PIN dans "Mon compte"', needsPinSetup: true }, { status: 400 })
      if (result.reason === 'locked') return NextResponse.json({ ok: false, error: 'Compte temporairement bloqué', locked: true, lockedUntil: result.lockedUntil }, { status: 423 })
      if (result.reason === 'wrong') return NextResponse.json({ ok: false, error: 'Code PIN incorrect', attemptsLeft: result.attemptsLeft }, { status: 401 })
      return NextResponse.json({ ok: false, error: 'Code PIN invalide' }, { status: 400 })
    }

    const rows = await sql`
      SELECT id, order_type, items_json, total::float AS total, status, ready, paid, table_num, table_sec, created_at
      FROM online_orders
      WHERE restaurant_id = ${rid} AND client_phone = ${phone}
      ORDER BY created_at DESC LIMIT 20`

    return NextResponse.json({
      ok: true,
      orders: rows.map((o: any) => ({
        id: o.id, order_type: o.order_type, items: o.items_json, total: o.total,
        status: o.status, ready: o.ready, paid: o.paid,
        table_num: o.table_num, table_sec: o.table_sec, created_at: o.created_at,
      })),
    })
  } catch (e: any) {
    return NextResponse.json(serverError('public my-orders', e), { status: 500 })
  }
}
