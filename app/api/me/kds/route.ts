// ═══════════════════════════════════════════════════
// /api/me/kds — cloud-synced kitchen display screen tickets
//
// GET  ?key=API
//   → last 24h of tickets (bumped and not) for this restaurant, so any
//     device reconciles to the same state a till's own KDS overlay would
//     show. Callers filter to "not bumped" for the live work queue —
//     bumped ones are returned too so a device that reconnects after
//     being offline can catch up on what already got cleared elsewhere.
//
// POST { key, action:'add', ticket:{key,num,tblNum?,tblSec?,cliName?,
//                                    zone,zoneLabel,items,sentAt} }
//   → a till sending an order to the kitchen pushes one ticket per zone.
//     Idempotent on (restaurant_id, ticket_key) — a retried push after a
//     flaky connection can't create a duplicate.
//
// POST { key, action:'bump', ticket_key, actor? }
//   → kitchen/bar staff marking a ticket done, from ANY device watching
//     this restaurant's tickets (the till's own overlay, or a browser tab
//     on a separate kitchen tablet — see /kitchen/[slug]).
//
// Requires migration-kds.sql. Degrades gracefully without it — same
// notReadyPayload pattern as /api/me/tables.
// ═══════════════════════════════════════════════════

import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { getApiKey } from '@/lib/auth'
import {
  isMissingSchema, serverError, notReadyPayload, missingRelations,
} from '@/lib/apiError'
import { notifyOrderReady } from '@/lib/orderReady'

// Node runtime, not edge — notifyOrderReady pulls in the web-push package
// (see lib/webpush.ts), which needs real Node crypto internals to sign
// VAPID requests. This route isn't a latency-sensitive hot path (a human
// tapping "bump" or the till polling every ~20s), so the switch costs
// nothing that matters.

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

const NEEDS = ['kds_tickets']
async function missingTables(): Promise<string[]> { return missingRelations(sql, NEEDS) }

export async function GET(req: Request) {
  const key = getKey(req)
  if (!key) return cors(NextResponse.json({ ok: false, error: 'Clé manquante' }, { status: 400 }))
  try {
    const rest = await resolveRestaurant(key)
    if (!rest) return cors(NextResponse.json({ ok: false, error: 'Compte introuvable ou suspendu' }, { status: 403 }))

    const gaps = await missingTables()
    if (gaps.length) return cors(NextResponse.json(notReadyPayload('migration-kds.sql', { tickets: [] }, gaps)))

    const rows = await sql`
      SELECT ticket_key, num, tbl_num, tbl_sec, cli_name, zone, zone_label, items,
             sent_at, bumped, bumped_at, bumped_by
      FROM kds_tickets
      WHERE restaurant_id = ${rest.id} AND sent_at > NOW() - INTERVAL '24 hours'
      ORDER BY sent_at ASC`
    const tickets = rows.map((r: any) => ({
      id: r.ticket_key, num: r.num, tblNum: r.tbl_num, tblSec: r.tbl_sec, cliName: r.cli_name || '',
      zone: r.zone, zoneLabel: r.zone_label || '', items: r.items || [],
      sentAt: new Date(r.sent_at).getTime(),
      bumped: !!r.bumped, bumpedAt: r.bumped_at ? new Date(r.bumped_at).getTime() : null, bumpedBy: r.bumped_by || '',
    }))
    return cors(NextResponse.json({ ok: true, ready: true, tickets }))
  } catch (err: any) {
    if (isMissingSchema(err)) {
      const gaps = await missingTables()
      return cors(NextResponse.json(notReadyPayload('migration-kds.sql', { tickets: [] }, gaps)))
    }
    return cors(NextResponse.json(serverError('kds GET', err), { status: 500 }))
  }
}

export async function POST(req: Request) {
  let body: any
  try { body = await req.json() } catch { return cors(NextResponse.json({ ok: false, error: 'Bad JSON' }, { status: 400 })) }
  const key = getKey(req, body)
  if (!key) return cors(NextResponse.json({ ok: false, error: 'Clé manquante' }, { status: 400 }))

  try {
    const rest = await resolveRestaurant(key)
    if (!rest) return cors(NextResponse.json({ ok: false, error: 'Compte introuvable ou suspendu' }, { status: 403 }))
    const rid = rest.id

    const gaps = await missingTables()
    if (gaps.length) return cors(NextResponse.json(notReadyPayload('migration-kds.sql', {}, gaps)))

    if (body.action === 'add') {
      const t = body.ticket || {}
      const ticketKey = clip(t.key, 64)
      const zone = clip(t.zone, 20)
      if (!ticketKey || !zone) return cors(NextResponse.json({ ok: false, error: 'Ticket invalide' }, { status: 400 }))
      const sentAt = Number(t.sentAt) || Date.now()
      const tblNum = Number.isFinite(parseInt(String(t.tblNum))) && t.tblNum ? parseInt(String(t.tblNum)) : null
      await sql`
        INSERT INTO kds_tickets (restaurant_id, ticket_key, num, tbl_num, tbl_sec, cli_name, zone, zone_label, items, sent_at)
        VALUES (${rid}, ${ticketKey}, ${clip(t.num, 20)}, ${tblNum}, ${tblNum ? clip(t.tblSec, 80) : null}, ${clip(t.cliName, 120)},
                ${zone}, ${clip(t.zoneLabel, 80)}, ${JSON.stringify(Array.isArray(t.items) ? t.items.slice(0, 50) : [])},
                ${new Date(sentAt).toISOString()})
        ON CONFLICT (restaurant_id, ticket_key) DO NOTHING`
      return cors(NextResponse.json({ ok: true }))
    }

    if (body.action === 'bump') {
      const ticketKey = clip(body.ticket_key, 64)
      if (!ticketKey) return cors(NextResponse.json({ ok: false, error: 'ticket_key requis' }, { status: 400 }))
      const actor = clip(body.actor, 80)
      const bumped = await sql`
        UPDATE kds_tickets SET bumped = TRUE, bumped_at = NOW(), bumped_by = ${actor}
        WHERE restaurant_id = ${rid} AND ticket_key = ${ticketKey} AND bumped = FALSE
        RETURNING num`
      // A kds_tickets row only ever exists for an order whose restaurant is
      // actually using the KDS screen (kitchenOutputMode 'screen' or
      // 'both', see the POS's autoPrintKitchen) — a ticket-only kitchen
      // never creates one, so this branch can never fire for them; they
      // stay on the cashier's explicit "Marquer prêt" button (see
      // /api/me/online-orders) as their only path, same as always. For a
      // screen-using kitchen, finishing the LAST ticket for an order IS
      // the real-world "done" signal (same as Toast/Square auto-releasing
      // from KDS completion) — release it here too, so staff don't have to
      // separately press a second button for something the kitchen screen
      // already just told everyone. The cashier's button stays available
      // regardless, as a manual override (kitchen forgot to bump, staff
      // know it's actually ready, whatever). `bumped.length` guards this
      // to a REAL false->true transition only, so two devices racing to
      // bump the same ticket — or the cashier's button firing around the
      // same moment — can't double-release or double-notify (the
      // online_orders UPDATE below has its own `ready = FALSE` guard too).
      if (bumped.length) {
        const num = String(bumped[0].num || '')
        const prefix = num.slice(0, 3)
        if (prefix === 'KIO' || prefix === 'WEB') {
          try {
            const doneRows = await sql`
              SELECT bool_and(bumped) AS all_done FROM kds_tickets
              WHERE restaurant_id = ${rid} AND num = ${num}
                AND (sent_at AT TIME ZONE 'UTC')::date = (NOW() AT TIME ZONE 'UTC')::date`
            if (doneRows[0]?.all_done) {
              const dailyNum = parseInt(num.slice(3), 10)
              if (Number.isFinite(dailyNum)) {
                const ready = await sql`
                  UPDATE online_orders SET ready = TRUE, ready_at = NOW(), ready_by = ${actor || 'Cuisine'}
                  WHERE restaurant_id = ${rid} AND daily_num = ${dailyNum} AND status = 'accepted' AND ready = FALSE
                  RETURNING id, client_name, client_phone`
                if (ready.length) {
                  await notifyOrderReady({ id: ready[0].id, client_name: ready[0].client_name, client_phone: ready[0].client_phone })
                }
              }
            }
          } catch { /* best-effort — the ticket bump itself already succeeded above */ }
        }
      }
      return cors(NextResponse.json({ ok: true }))
    }

    return cors(NextResponse.json({ ok: false, error: 'Action invalide' }, { status: 400 }))
  } catch (err: any) {
    if (isMissingSchema(err)) {
      return cors(NextResponse.json(notReadyPayload('migration-kds.sql', {})))
    }
    return cors(NextResponse.json(serverError('kds POST', err), { status: 500 }))
  }
}
