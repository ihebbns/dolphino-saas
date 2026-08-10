// ═══════════════════════════════════════════════════
// GET /api/public/[slug]/ready-orders — the list a pickup board (/ready/[slug])
// polls: every order marked "ready" (see POST /api/me/online-orders
// {action:'markReady'}) today, that hasn't gone stale.
//
// Unauthenticated by design, same posture as menu/order-status — a pickup
// board runs on a screen mounted in the dining room, nothing here is a
// secret (a ticket number + a first name), and it's read-only.
//
// Scoped to TODAY (created_at::date = current business day) rather than a
// rolling time window — this is what makes the board clear itself out
// automatically at the next day's first order instead of needing an explicit
// "picked up" action staff would have to remember to tap. daily_num already
// resets the same way (see migration-online-orders-daily-num.sql), so the
// two line up: today's board shows today's numbers, nothing else.
// ═══════════════════════════════════════════════════

import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { serverError, isMissingSchema } from '@/lib/apiError'

export const runtime = 'edge'

export async function GET(req: Request, { params }: { params: { slug: string } }) {
  const slug = String(params.slug || '').slice(0, 60)
  if (!slug) return NextResponse.json({ ok: false, error: 'Lien invalide' }, { status: 400 })

  try {
    const rest = await sql`
      SELECT id, name FROM restaurants WHERE public_slug = ${slug} AND plan NOT IN ('suspended', 'suspended_exe') LIMIT 1`
    if (!rest.length) return NextResponse.json({ ok: false, error: 'Commerce introuvable' }, { status: 404 })

    try {
      const rows = await sql`
        SELECT daily_num, client_name, ready_at
        FROM online_orders
        WHERE restaurant_id = ${rest[0].id}
          AND ready = TRUE
          AND (created_at AT TIME ZONE 'UTC')::date = (NOW() AT TIME ZONE 'UTC')::date
          AND daily_num IS NOT NULL
        ORDER BY ready_at DESC
        LIMIT 40`
      return NextResponse.json({
        ok: true, ready: true,
        restaurant_name: rest[0].name,
        orders: rows.map((r: any) => ({ daily_num: r.daily_num, first_name: String(r.client_name || '').split(' ')[0], ready_at: r.ready_at })),
      })
    } catch (e: any) {
      // daily_num column not migrated yet — the board has nothing numeric to
      // show, so say so plainly rather than erroring the page.
      if (isMissingSchema(e)) return NextResponse.json({ ok: true, ready: false, note: 'Écran non initialisé — contactez le développeur' })
      throw e
    }
  } catch (e: any) {
    return NextResponse.json(serverError('public ready-orders', e), { status: 500 })
  }
}
