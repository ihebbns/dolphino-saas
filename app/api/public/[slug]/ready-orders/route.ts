// ═══════════════════════════════════════════════════
// GET /api/public/[slug]/ready-orders — the list a pickup board (/ready/[slug])
// polls: every order the CASHIER has explicitly released as ready right now.
//
// Deliberately reads ONLY online_orders.ready (set by staff tapping
// "Marquer prêt" — see /api/me/online-orders), never kds_tickets directly.
// A kitchen ticket bump means "done cooking," an internal signal — it does
// NOT by itself notify the customer or light up this board. The cashier's
// explicit action is what actually releases an order, on purpose: staff
// get the final judgment call (packaging, a last check, whatever a small
// kitchen needs) rather than a raw kitchen bump auto-triggering the
// customer-facing board. This works identically whether the restaurant
// uses paper tickets, the KDS screen, or both (see kitchenOutputMode in
// /admin) — the board never has to know or care which one they use.
//
// table_num IS NULL excludes dine-in table orders — food gets carried to
// the table, nobody's calling a table's number from a board. Scoped to
// TODAY (UTC) so the board, daily_num, and the ticket prefix below all
// agree on what "today" resets against.
//
// The reconstructed KIO/WEB+daily_num carries the order's channel as a
// prefix — see printOnlineOrderKitchenTicket() in the POS. Parsed back out
// here into a clean {source, display} pair so the board never has to know
// about the prefix convention itself.
//
// Unauthenticated by design, same posture as menu/order-status — a pickup
// board runs on a screen mounted in the dining room, nothing here is a
// secret (a ticket number + a first name), and it's read-only.
// ═══════════════════════════════════════════════════

import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { serverError, isMissingSchema } from '@/lib/apiError'

export const runtime = 'edge'

function parseTicketNum(raw: string): { source: 'kiosk' | 'moi' | 'caisse'; display: string } {
  const s = String(raw || '')
  if (s.startsWith('KIO')) {
    const n = parseInt(s.slice(3), 10)
    return { source: 'kiosk', display: Number.isFinite(n) ? String(n) : s.slice(3) }
  }
  if (s.startsWith('WEB')) {
    const n = parseInt(s.slice(3), 10)
    return { source: 'moi', display: Number.isFinite(n) ? String(n) : s.slice(3) }
  }
  const n = parseInt(s, 10)
  return { source: 'caisse', display: Number.isFinite(n) ? String(n) : s }
}

export async function GET(req: Request, { params }: { params: { slug: string } }) {
  const slug = String(params.slug || '').slice(0, 60)
  if (!slug) return NextResponse.json({ ok: false, error: 'Lien invalide' }, { status: 400 })

  try {
    const rest = await sql`
      SELECT id, name FROM restaurants WHERE public_slug = ${slug} AND plan NOT IN ('suspended', 'suspended_exe') LIMIT 1`
    if (!rest.length) return NextResponse.json({ ok: false, error: 'Commerce introuvable' }, { status: 404 })

    try {
      const rid = rest[0].id
      const rows = await sql`
        SELECT (CASE WHEN source = 'kiosk' THEN 'KIO' ELSE 'WEB' END) || LPAD(daily_num::text, 3, '0') AS num,
               client_name AS cli_name, ready_at
        FROM online_orders
        WHERE restaurant_id = ${rid}
          AND status = 'accepted' AND ready = TRUE AND table_num IS NULL
          AND daily_num IS NOT NULL
          AND (ready_at AT TIME ZONE 'UTC')::date = (NOW() AT TIME ZONE 'UTC')::date
        ORDER BY ready_at DESC
        LIMIT 40`
      return NextResponse.json({
        ok: true, ready: true,
        restaurant_name: rest[0].name,
        orders: rows.map((r: any) => {
          const { source, display } = parseTicketNum(r.num)
          return { display_num: display, source, first_name: String(r.cli_name || '').split(' ')[0], ready_at: r.ready_at }
        }),
      })
    } catch (e: any) {
      if (isMissingSchema(e)) return NextResponse.json({ ok: true, ready: false, note: 'Écran non initialisé — contactez le développeur' })
      throw e
    }
  } catch (e: any) {
    return NextResponse.json(serverError('public ready-orders', e), { status: 500 })
  }
}
