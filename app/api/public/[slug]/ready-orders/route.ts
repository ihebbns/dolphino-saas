// ═══════════════════════════════════════════════════
// GET /api/public/[slug]/ready-orders — the list a pickup board (/ready/[slug])
// polls: every order number that's fully done right now.
//
// A restaurant is free to run its kitchen on paper tickets only, the KDS
// screen only, or both (see kitchenOutputMode in /admin) — this board has
// to light up correctly no matter which one they actually use. Two
// independent "done" signals both count, unioned together:
//
//   1. kds_tickets — every zone ticket for that order's num bumped (the
//      till's own KDS overlay or the standalone /kitchen/[slug] screen).
//      Works for restaurants using the digital queue.
//   2. online_orders.ready — staff explicitly tapped "Marquer prêt" (see
//      /api/me/online-orders). Works for restaurants running paper tickets
//      only, where no kds_tickets row for this order may ever exist at all
//      — without this signal, THOSE restaurants could never light up this
//      board no matter what staff did.
//
// One order can have several kitchen tickets (one per zone/station) — via
// signal 1 it's only "ready" once ALL of them are bumped, hence GROUP BY
// num with bool_and(bumped). tbl_num IS NULL excludes dine-in table
// orders — food gets carried to the table, nobody's calling a table's
// number from a board. Scoped to TODAY (UTC) so the board, daily_num, and
// the ticket prefix below all agree on what "today" resets against.
//
// The ticket's own `num` (or the reconstructed KIO/WEB+daily_num for
// signal 2) carries its channel as a prefix — see
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
      const rid = rest[0].id
      let rows: any[]
      try {
        rows = await sql`
          WITH kitchen_ready AS (
            SELECT num, MAX(cli_name) AS cli_name, MIN(sent_at) AS sent_at, MAX(bumped_at) AS ready_at
            FROM kds_tickets
            WHERE restaurant_id = ${rid}
              AND tbl_num IS NULL
              AND num != ''
              AND (sent_at AT TIME ZONE 'UTC')::date = (NOW() AT TIME ZONE 'UTC')::date
            GROUP BY num
            HAVING bool_and(bumped)
          ),
          staff_ready AS (
            SELECT (CASE WHEN source = 'kiosk' THEN 'KIO' ELSE 'WEB' END) || LPAD(daily_num::text, 3, '0') AS num,
                   client_name AS cli_name, created_at AS sent_at, ready_at
            FROM online_orders
            WHERE restaurant_id = ${rid}
              AND status = 'accepted' AND ready = TRUE AND table_num IS NULL
              AND daily_num IS NOT NULL
              AND (ready_at AT TIME ZONE 'UTC')::date = (NOW() AT TIME ZONE 'UTC')::date
          )
          SELECT num, MAX(cli_name) AS cli_name, MIN(sent_at) AS sent_at, MAX(ready_at) AS ready_at
          FROM (SELECT * FROM kitchen_ready UNION ALL SELECT * FROM staff_ready) merged
          GROUP BY num
          ORDER BY MAX(ready_at) DESC
          LIMIT 40`
      } catch (e: any) {
        // online_orders.daily_num/ready columns missing (pre-migration
        // restaurant) — fall back to kds_tickets alone rather than 500ing
        // the whole board.
        const isMissingCol = String(e?.code) === '42703' || /does not exist|undefined_column/i.test(String(e?.message || ''))
        if (!isMissingCol) throw e
        rows = await sql`
          SELECT num, MAX(cli_name) AS cli_name, MIN(sent_at) AS sent_at, MAX(bumped_at) AS ready_at
          FROM kds_tickets
          WHERE restaurant_id = ${rid}
            AND tbl_num IS NULL
            AND num != ''
            AND (sent_at AT TIME ZONE 'UTC')::date = (NOW() AT TIME ZONE 'UTC')::date
          GROUP BY num
          HAVING bool_and(bumped)
          ORDER BY MAX(bumped_at) DESC
          LIMIT 40`
      }
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
