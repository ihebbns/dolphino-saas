// ═══════════════════════════════════════════════════
// POST /api/admin/wallet-rewards — manually run the monthly spend-tier
// reward job for ONE client, from the admin panel.
//
// Body: { admin_key, api_key, period? }
//   period: 'YYYY-MM', defaults to the previous calendar month.
//
// Same computeAndApplyRewards() the cron job uses (see
// /api/cron/wallet-rewards) — this route exists so the reward can be
// triggered on demand (testing, or running it manually before a cron
// schedule is set up) rather than only ever automatically.
// ═══════════════════════════════════════════════════

import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { computeAndApplyRewards, previousPeriod } from '@/lib/walletRewards'

// No fallback: a hardcoded default here would let anyone who's ever seen
// this source (public GitHub repo) call every admin action on every tenant
// the moment ADMIN_SECRET_KEY is unset in the deployment env — fail closed
// instead, same as cron/wallet-rewards's existing correct pattern.
const ADMIN_KEY = process.env.ADMIN_SECRET_KEY || ''

export async function POST(req: Request) {
  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ ok: false, error: 'Bad JSON' }, { status: 400 }) }
  if (!ADMIN_KEY || body?.admin_key !== ADMIN_KEY) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const apiKey = body?.api_key
  if (!apiKey) return NextResponse.json({ ok: false, error: 'Missing api_key' }, { status: 400 })

  const period = /^\d{4}-\d{2}$/.test(body?.period) ? body.period : previousPeriod()

  try {
    const rows = await sql`SELECT id FROM restaurants WHERE api_key = ${apiKey} LIMIT 1`
    if (!rows.length) return NextResponse.json({ ok: false, error: 'Client introuvable' }, { status: 404 })

    const results = await computeAndApplyRewards(rows[0].id, period)
    return NextResponse.json({ ok: true, period, results })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 })
  }
}
