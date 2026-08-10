// ═══════════════════════════════════════════════════
// GET /api/public/[slug]/ready-orders — the list a pickup board (/ready/[slug])
// polls: every order number that's fully done in the kitchen right now.
//
// Reuses kds_tickets (the same rows the till's own KDS overlay and the
// kitchen screen — servio.tn/kitchen/<slug> — already bump) rather than a
// separate "mark ready" action, on purpose: kitchen staff already bump a
// ticket the instant it's done, for EVERY order however it was placed
// (typed at the till, kiosk, or online) — that single existing action is
// now also what puts a number on this board, no new step for anyone.
//
// One order can have several tickets (one per kitchen zone/station) — it's
// only "ready" once ALL of them are bumped, hence GROUP BY num with
// bool_and(bumped). tbl_num IS NULL excludes dine-in table orders — food
// gets carried to the table, nobody's calling a table's number from a
// board. Scoped to TODAY so the board (and daily_num, and the ticket
// prefix below) all agree on what "today" resets against.
//
// The ticket's own `num` already carries its channel as a prefix — see
// printOnlineOrderKitchenTicket() in the POS: 'KIO001' (kiosk), 'WEB001'
// (moi/online link), or a plain digit sequence (typed at the till/caisse).
// Parsed back out here into a clean {source, display} pair so the board
// never has to know about the prefix convention itself.
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
      const rows = await sql`
        SELECT num, MAX(cli_name) AS cli_name, MIN(sent_at) AS sent_at, MAX(bumped_at) AS ready_at
        FROM kds_tickets
        WHERE restaurant_id = ${rest[0].id}
          AND tbl_num IS NULL
          AND num != ''
          AND (sent_at AT TIME ZONE 'UTC')::date = (NOW() AT TIME ZONE 'UTC')::date
        GROUP BY num
        HAVING bool_and(bumped)
        ORDER BY MAX(bumped_at) DESC
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
