// ═══════════════════════════════════════════════════
// /api/me/drawer-log — CASH DRAWER audit trail   (WEB-ONLY visibility)
//
// POST  { key, events:[ {uid, reason, amount, note, opened, actor, isManager,
//                        sessionId, terminalId, ts} ] }
//   → append drawer events sent by a till. Idempotent on (restaurant, uid),
//     because the POS retains entries locally until the server confirms and
//     therefore WILL re-send after a failed round trip.
//
// GET   ?key=API[&reason=no_sale][&actor=NAME][&days=7][&limit=200]
//   → the audit trail plus aggregates the owner actually acts on.
//
// ── WHY ────────────────────────────────────────────────────────────────
// An unexplained drawer opening is a primary theft signal; Toast reports
// "no-sale" events in its exception reports for exactly this reason. The POS
// records every drawer DECISION through one choke point, including the times it
// deliberately did NOT open, and ships them here.
//
// This data is never exposed back to the POS: owners hand the till's manager PIN
// to cashiers, so whoever opens the drawer must not be able to see whether it
// was noticed.
//
// Requires migration-drawer-log.sql. Degrades gracefully without it so shipping
// this ahead of the migration cannot break a till's sync loop.
// ═══════════════════════════════════════════════════

import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { getApiKey } from '@/lib/auth'

export const runtime = 'edge'

const REASONS = ['cash_sale', 'pay_in', 'pay_out', 'credit_payment', 'no_sale']

const cors = (r: NextResponse) => {
  r.headers.set('Access-Control-Allow-Origin', '*')
  r.headers.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  r.headers.set('Access-Control-Allow-Headers', 'Content-Type,X-Api-Key')
  return r
}
export async function OPTIONS() { return cors(new NextResponse(null, { status: 200 })) }

const clip = (v: any, n: number) => String(v ?? '').slice(0, n)

/** Only accept a parseable, plausible instant — a till with a wrong clock must
 *  not be able to poison the ordering of the audit trail. */
function safeTs(v: any): string {
  const t = v ? Date.parse(String(v)) : NaN
  if (!Number.isFinite(t)) return new Date().toISOString()
  const now = Date.now()
  if (t < now - 5 * 365 * 24 * 3600 * 1000 || t > now + 2 * 24 * 3600 * 1000) return new Date().toISOString()
  return new Date(t).toISOString()
}

async function tableReady(): Promise<boolean> {
  try { await sql`SELECT 1 FROM drawer_events LIMIT 1`; return true } catch { return false }
}

async function resolveRestaurant(key: string) {
  const rows = await sql`
    SELECT id, name FROM restaurants
    WHERE api_key = ${key} AND plan NOT IN ('suspended', 'suspended_dash')
    LIMIT 1`
  return rows.length ? rows[0] : null
}

function getKey(req: Request, body?: any): string {
  return (body && body.key) || getApiKey(req) || new URL(req.url).searchParams.get('key') || ''
}

// ─────────────────────────────────────────────────────────────────────────
// POST — a till ships its pending events
// ─────────────────────────────────────────────────────────────────────────
export async function POST(req: Request) {
  let body: any
  try { body = await req.json() } catch { return cors(NextResponse.json({ ok: false, error: 'Bad JSON' }, { status: 400 })) }

  const key = getKey(req, body)
  if (!key) return cors(NextResponse.json({ ok: false, error: 'Clé manquante' }, { status: 400 }))

  const events: any[] = Array.isArray(body.events) ? body.events : []
  if (!events.length) return cors(NextResponse.json({ ok: true, inserted: 0 }))

  try {
    const rest = await resolveRestaurant(key)
    if (!rest) return cors(NextResponse.json({ ok: false, error: 'Compte introuvable ou suspendu' }, { status: 403 }))
    const rid = rest.id

    // No table yet → acknowledge so the till stops retrying forever, but say so.
    if (!(await tableReady())) {
      return cors(NextResponse.json({
        ok: true, inserted: 0, ready: false,
        note: 'Journal tiroir non initialisé — exécutez migration-drawer-log.sql',
      }))
    }

    let inserted = 0, skipped = 0
    for (const e of events.slice(0, 500)) {
      const uid = clip(e?.uid, 64)
      const reason = clip(e?.reason, 24)
      // A row without a uid could be duplicated endlessly; an unknown reason is
      // not something this schema promises to report on.
      if (!uid || !REASONS.includes(reason)) { skipped++; continue }

      const amountRaw = parseFloat(String(e?.amount))
      const amount = Number.isFinite(amountRaw) ? Math.round(amountRaw * 1000) / 1000 : null

      const res = await sql`
        INSERT INTO drawer_events
          (restaurant_id, reason, amount, note, opened, actor, is_manager,
           session_id, terminal_id, client_ts, client_uid)
        VALUES
          (${rid}, ${reason}, ${amount}, ${clip(e?.note, 200)},
           ${e?.opened === false ? false : true}, ${clip(e?.actor, 80)},
           ${!!e?.isManager}, ${clip(e?.sessionId, 64)}, ${clip(e?.terminalId, 64)},
           ${safeTs(e?.ts)}, ${uid})
        ON CONFLICT (restaurant_id, client_uid) DO NOTHING
        RETURNING id`
      if (res.length) inserted++; else skipped++
    }

    return cors(NextResponse.json({ ok: true, ready: true, inserted, skipped }))
  } catch (err: any) {
    return cors(NextResponse.json({ ok: false, error: err.message }, { status: 500 }))
  }
}

// ─────────────────────────────────────────────────────────────────────────
// GET — the owner's audit view
// ─────────────────────────────────────────────────────────────────────────
export async function GET(req: Request) {
  const key = getKey(req)
  if (!key) return cors(NextResponse.json({ ok: false, error: 'Clé manquante' }, { status: 400 }))

  try {
    const rest = await resolveRestaurant(key)
    if (!rest) return cors(NextResponse.json({ ok: false, error: 'Compte introuvable ou suspendu' }, { status: 403 }))
    const rid = rest.id

    if (!(await tableReady())) {
      return cors(NextResponse.json({
        ok: true, ready: false, events: [], byActor: [], totals: null,
        note: 'Journal tiroir non initialisé — exécutez migration-drawer-log.sql',
      }))
    }

    const url = new URL(req.url)
    const reason = clip(url.searchParams.get('reason'), 24)
    const actor = clip(url.searchParams.get('actor'), 80)
    const daysRaw = parseInt(String(url.searchParams.get('days') ?? '7'))
    const days = Math.min(365, Math.max(1, Number.isFinite(daysRaw) ? daysRaw : 7))
    const limitRaw = parseInt(String(url.searchParams.get('limit') ?? '200'))
    const limit = Math.min(1000, Math.max(1, Number.isFinite(limitRaw) ? limitRaw : 200))

    const useReason = reason && REASONS.includes(reason) ? reason : null

    const events = await sql`
      SELECT id, reason, amount::float, note, opened, actor, is_manager,
             session_id, terminal_id, client_ts
      FROM drawer_events
      WHERE restaurant_id = ${rid}
        AND client_ts >= NOW() - (${days} || ' days')::interval
        AND (${useReason}::text IS NULL OR reason = ${useReason})
        AND (${actor || null}::text IS NULL OR actor = ${actor})
      ORDER BY client_ts DESC
      LIMIT ${limit}`

    // Who handles cash outside of normal sales — the ranking the owner reads.
    const byActor = await sql`
      SELECT actor,
             COUNT(*)::int                                                      AS total,
             COUNT(*) FILTER (WHERE reason = 'no_sale')::int                    AS manual_opens,
             COUNT(*) FILTER (WHERE reason = 'pay_out')::int                    AS retraits,
             COALESCE(SUM(amount) FILTER (WHERE reason = 'pay_out'), 0)::float  AS total_retire,
             COALESCE(SUM(amount) FILTER (WHERE reason = 'pay_in'), 0)::float   AS total_ajoute,
             COUNT(*) FILTER (WHERE opened = FALSE)::int                        AS refus_ouverture
      FROM drawer_events
      WHERE restaurant_id = ${rid}
        AND client_ts >= NOW() - (${days} || ' days')::interval
      GROUP BY actor
      ORDER BY manual_opens DESC, retraits DESC`

    const [totals] = await sql`
      SELECT COUNT(*)::int                                                     AS total_events,
             COUNT(*) FILTER (WHERE reason = 'no_sale')::int                   AS manual_opens,
             COALESCE(SUM(amount) FILTER (WHERE reason = 'pay_out'), 0)::float AS total_retire,
             COALESCE(SUM(amount) FILTER (WHERE reason = 'pay_in'), 0)::float  AS total_ajoute,
             COUNT(*) FILTER (WHERE opened = FALSE)::int                       AS refus_ouverture,
             COUNT(DISTINCT actor)::int                                        AS nb_intervenants
      FROM drawer_events
      WHERE restaurant_id = ${rid}
        AND client_ts >= NOW() - (${days} || ' days')::interval`

    return cors(NextResponse.json({
      ok: true, ready: true, name: rest.name, days,
      events, byActor, totals,
    }))
  } catch (err: any) {
    return cors(NextResponse.json({ ok: false, error: err.message }, { status: 500 }))
  }
}
