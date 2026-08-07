// ═══════════════════════════════════════════════════
// GET /api/cron/wallet-rewards — runs the monthly spend-tier reward job for
// EVERY active restaurant with the Fidélité module on, for the previous
// calendar month. Meant to be called by Vercel Cron (see vercel.json,
// scheduled for the 2nd of each month — one day after the month closes, so
// the last day's topups have definitely landed).
//
// Auth: Vercel signs cron requests with `Authorization: Bearer $CRON_SECRET`
// automatically when CRON_SECRET is set as an env var — see
// https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs.
// Without CRON_SECRET set, this route refuses to run rather than being an
// open "credit money to everyone" endpoint reachable by anyone who finds it.
//
// Idempotent per restaurant via wallet_reward_runs — a duplicate cron
// invocation (Vercel retry, or running it manually the same day) computes
// and credits nothing a second time.
// ═══════════════════════════════════════════════════

import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { computeAndApplyRewards, previousPeriod } from '@/lib/walletRewards'

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json({ ok: false, error: 'CRON_SECRET not configured — refusing to run' }, { status: 503 })
  }
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  const period = previousPeriod()

  try {
    // Only restaurants with the wallet module explicitly on — mirrors
    // DEFAULT_MODULES.wallet = false in /api/check: a client who never
    // turned Fidélité on should never be silently enrolled into a reward job.
    const restaurants = await sql`
      SELECT id, name FROM restaurants
      WHERE plan NOT IN ('suspended', 'suspended_dash', 'suspended_exe')
        AND config -> 'modules' ->> 'wallet' = 'true'`

    const summary: any[] = []
    for (const r of restaurants) {
      try {
        const results = await computeAndApplyRewards(r.id, period)
        const applied = results.filter(x => x.applied)
        summary.push({
          restaurant_id: r.id, name: r.name,
          clients_rewarded: applied.length,
          total_credited: Math.round(applied.reduce((a, x) => a + x.amount, 0) * 1000) / 1000,
        })
      } catch (e: any) {
        // One restaurant's failure (e.g. migration not run for it yet) must
        // never stop the rest from being paid.
        summary.push({ restaurant_id: r.id, name: r.name, error: String(e?.message || e).slice(0, 200) })
      }
    }

    return NextResponse.json({ ok: true, period, restaurants: summary.length, summary })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 })
  }
}
