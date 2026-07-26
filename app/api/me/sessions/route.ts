// ═══════════════════════════════════════════════════
// /api/me/sessions — CASH SESSION CLOSURES (clôtures de caisse)
//
// GET ?key=API[&days=7]
//   → { sessions, totals }
//
// This is the daily control question: the till says it should hold X, the cashier
// counted Y, and the gap between them is the only figure that matters. It used to
// be a tab buried on the dashboard and scoped to a SINGLE day, which is the wrong
// window — one cashier 2 DT short every evening is invisible day by day and
// obvious over a fortnight. So this reads a range.
//
// Read-only by design. A closure is a fact the till recorded at the counter; the
// back office reviews it and never edits it. Same ownership rule as credit and
// stock (ARCHITECTURE.md §2).
// ═══════════════════════════════════════════════════

import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { getApiKey } from '@/lib/auth'
import { serverError, isMissingSchema, notReadyPayload } from '@/lib/apiError'

export const runtime = 'edge'

const cors = (r: NextResponse) => {
  r.headers.set('Access-Control-Allow-Origin', '*')
  r.headers.set('Access-Control-Allow-Methods', 'GET,OPTIONS')
  r.headers.set('Access-Control-Allow-Headers', 'Content-Type,X-Api-Key')
  return r
}
export async function OPTIONS() { return cors(new NextResponse(null, { status: 200 })) }

export async function GET(req: Request) {
  const url = new URL(req.url)
  const key = getApiKey(req) || url.searchParams.get('key') || ''
  if (!key) return cors(NextResponse.json({ ok: false, error: 'Clé manquante' }, { status: 400 }))

  try {
    const rows = await sql`
      SELECT id, name FROM restaurants
      WHERE api_key = ${key} AND plan NOT IN ('suspended', 'suspended_dash')
      LIMIT 1`
    if (!rows.length) {
      return cors(NextResponse.json({ ok: false, error: 'Compte introuvable ou suspendu' }, { status: 403 }))
    }
    const rid = rows[0].id

    // Clamped: an unbounded range would let a URL parameter pull every closure
    // the account has ever recorded in one response.
    const raw = parseInt(String(url.searchParams.get('days') ?? '7'))
    const days = Math.min(365, Math.max(1, Number.isFinite(raw) ? raw : 7))

    const sessions = await sql`
      SELECT
        id,
        session_id,
        business_date::text AS day,
        cashier,
        opened_at,
        closed_at,
        fond_initial::float    AS fond_initial,
        total_sales::float     AS total_sales,
        orders_count,
        cash_sales::float      AS cash_sales,
        card_sales::float      AS card_sales,
        mobile_sales::float    AS mobile_sales,
        montant_compte::float  AS montant_compte,
        theorique::float       AS theorique,
        ecart::float           AS ecart,
        cash_movements
      FROM sessions
      WHERE restaurant_id = ${rid}
        AND business_date >= (CURRENT_DATE - (${days}::int - 1))
      ORDER BY business_date DESC, closed_at DESC NULLS FIRST`

    // Totals worth acting on. `ecart_net` is the sum of signed gaps — it can look
    // healthy while hiding a cashier who is short every night and another who is
    // over, so `ecart_abs` is reported next to it as the real error volume.
    const [totals] = await sql`
      SELECT
        COUNT(*)::int                                          AS nb_sessions,
        COALESCE(SUM(total_sales), 0)::float                    AS total_sales,
        COALESCE(SUM(ecart), 0)::float                          AS ecart_net,
        COALESCE(SUM(ABS(ecart)), 0)::float                     AS ecart_abs,
        COUNT(*) FILTER (WHERE ABS(ecart) >= 1)::int            AS nb_ecarts,
        COUNT(*) FILTER (WHERE closed_at IS NULL)::int          AS nb_ouvertes
      FROM sessions
      WHERE restaurant_id = ${rid}
        AND business_date >= (CURRENT_DATE - (${days}::int - 1))`

    // Per cashier over the whole window. This is the view that makes a pattern
    // visible; a single day never does.
    const byCashier = await sql`
      SELECT
        COALESCE(NULLIF(cashier, ''), 'Inconnu')      AS cashier,
        COUNT(*)::int                                  AS nb_sessions,
        COALESCE(SUM(total_sales), 0)::float           AS total_sales,
        COALESCE(SUM(ecart), 0)::float                 AS ecart_net,
        COALESCE(SUM(ABS(ecart)), 0)::float            AS ecart_abs,
        COUNT(*) FILTER (WHERE ecart <= -1)::int       AS nb_manquants
      FROM sessions
      WHERE restaurant_id = ${rid}
        AND business_date >= (CURRENT_DATE - (${days}::int - 1))
      GROUP BY 1
      ORDER BY ecart_abs DESC`

    return cors(NextResponse.json({
      ok: true, ready: true, name: rows[0].name, days,
      sessions, totals, byCashier,
    }))
  } catch (e: any) {
    if (isMissingSchema(e)) {
      return cors(NextResponse.json(
        notReadyPayload('migration-sessions.sql', { sessions: [], totals: null, byCashier: [] })
      ))
    }
    return cors(NextResponse.json(serverError('me/sessions', e), { status: 500 }))
  }
}
