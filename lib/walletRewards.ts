// ═══════════════════════════════════════════════════
// Monthly spend-tier rewards (Fidélité Phase 2).
//
// A client who loads enough REAL money onto their card in a calendar month
// earns a % credited straight back onto the same wallet. "Real money" means
// SUM(paid_amount) from 'topup' movements — the amount the client actually
// handed over, never the bonus-inclusive `delta`. This is deliberate: every
// real loyalty program (airline miles, points programs) excludes promotional
// credit from reward-tier qualification specifically because counting bonus
// money as "spend" would let bonus money earn more bonus money in a
// compounding loop. A topup with no paid_amount recorded (pre-migration rows)
// is excluded rather than treated as 0 — unknown is not the same as zero.
//
// TIERS is intentionally ONE hardcoded array, the same "change this one
// number" pattern as WALLET_TOPUP_BONUS on the till — these are starting
// defaults the client needs to sign off on before they go live with real
// money, not something to make configurable prematurely.
// ═══════════════════════════════════════════════════

import { sql } from '@/lib/db'

export type Tier = { min: number; pct: number }

// Highest threshold first — the first (and only) match wins, tiers are NOT
// cumulative. 200 DT/month -> 3%, 500 DT/month -> 6%, 1000 DT/month -> 10%.
export const REWARD_TIERS: Tier[] = [
  { min: 1000, pct: 0.10 },
  { min: 500, pct: 0.06 },
  { min: 200, pct: 0.03 },
]

export function tierFor(qualifyingSpend: number): Tier | null {
  for (const t of REWARD_TIERS) if (qualifyingSpend >= t.min) return t
  return null
}

/** Previous calendar month as 'YYYY-MM', in the server's UTC clock. */
export function previousPeriod(): string {
  const now = new Date()
  const y = now.getUTCFullYear()
  const m = now.getUTCMonth() // 0-based; subtracting 1 more gives the PREVIOUS month
  const d = new Date(Date.UTC(y, m - 1, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

function periodBounds(period: string): { start: string; end: string } {
  const [y, m] = period.split('-').map(Number)
  const start = new Date(Date.UTC(y, m - 1, 1)).toISOString()
  const end = new Date(Date.UTC(y, m, 1)).toISOString() // first instant of the NEXT month, exclusive
  return { start, end }
}

export type RewardResult = {
  client_key: string
  name: string
  qualifying_spend: number
  tier_pct: number | null
  amount: number
  applied: boolean
  reason?: string
}

/**
 * Compute and apply monthly rewards for every client of ONE restaurant, for
 * ONE period. Idempotent via wallet_reward_runs' unique (restaurant, client,
 * period) — calling this twice for the same period returns the SAME results
 * without crediting twice (second call sees `applied: false` per client via
 * ON CONFLICT DO NOTHING on the insert, or reuses the existing run's amount).
 */
export async function computeAndApplyRewards(rid: number, period: string): Promise<RewardResult[]> {
  const { start, end } = periodBounds(period)

  const rows = await sql`
    SELECT w.client_key, w.name,
           COALESCE(SUM(m.paid_amount), 0)::float AS qualifying_spend
    FROM wallets w
    JOIN wallet_movements m
      ON m.restaurant_id = w.restaurant_id AND m.client_key = w.client_key
     AND m.kind = 'topup' AND m.paid_amount IS NOT NULL
     AND m.client_ts >= ${start} AND m.client_ts < ${end}
    WHERE w.restaurant_id = ${rid} AND w.archived = FALSE
    GROUP BY w.client_key, w.name
    HAVING COALESCE(SUM(m.paid_amount), 0) > 0
    ORDER BY qualifying_spend DESC`

  const results: RewardResult[] = []

  for (const r of rows) {
    const spend = Number(r.qualifying_spend)
    const tier = tierFor(spend)
    if (!tier) {
      results.push({ client_key: r.client_key, name: r.name, qualifying_spend: spend, tier_pct: null, amount: 0, applied: false, reason: 'sous le premier palier' })
      continue
    }
    const amount = Math.round(spend * tier.pct * 1000) / 1000

    // Idempotency: one row per (restaurant, client, period). A second run
    // for the same period hits the unique index and inserts nothing.
    const inserted = await sql`
      INSERT INTO wallet_reward_runs (restaurant_id, client_key, period, qualifying_spend, tier_pct, amount)
      VALUES (${rid}, ${r.client_key}, ${period}, ${spend}, ${tier.pct}, ${amount})
      ON CONFLICT (restaurant_id, client_key, period) DO NOTHING
      RETURNING id`

    if (!inserted.length) {
      results.push({ client_key: r.client_key, name: r.name, qualifying_spend: spend, tier_pct: tier.pct, amount, applied: false, reason: 'déjà versée pour cette période' })
      continue
    }

    // Reuse the exact same movement + recompute-balance path as the manual
    // 'bonus' action — one code path for how a bonus ever lands on a wallet,
    // whether triggered by hand or by this job.
    const uid = `reward:${r.client_key}:${period}`
    const reason = `Récompense mensuelle ${period} — ${(tier.pct * 100).toFixed(0)}% sur ${spend.toFixed(3)} DT rechargés`
    await sql`
      INSERT INTO wallet_movements (restaurant_id, client_key, kind, delta, reason, actor, client_ts, client_uid)
      VALUES (${rid}, ${r.client_key}, 'bonus', ${amount}, ${reason}, 'web', NOW(), ${uid})
      ON CONFLICT (restaurant_id, client_uid) DO NOTHING`
    await sql`
      UPDATE wallets SET
        balance = (SELECT COALESCE(SUM(delta), 0) FROM wallet_movements WHERE restaurant_id = ${rid} AND client_key = ${r.client_key}),
        updated_at = NOW()
      WHERE restaurant_id = ${rid} AND client_key = ${r.client_key}`

    results.push({ client_key: r.client_key, name: r.name, qualifying_spend: spend, tier_pct: tier.pct, amount, applied: true })
  }

  return results
}
