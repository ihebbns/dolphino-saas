// ═══════════════════════════════════════════════════
// GET /api/public/[slug]/wallet?phone=XXXXXXXX — a customer looking up their
// OWN card balance/history/reward progress on the public ordering page.
//
// ── PRIVACY NOTE (v1 limitation, documented on purpose) ──────────────────
// Identification is the phone number alone — there is no OTP/SMS
// verification in this pass (that needs a paid SMS gateway, a separate
// decision). This means anyone who knows (or guesses) a real customer's
// phone number can see that customer's balance and purchase history. This
// is an accepted, common tradeoff for small-business loyalty portals (the
// same trust level as a physical loyalty card), but it should be upgraded
// to phone+OTP before this is pitched as handling anything more sensitive
// than a small prepaid balance. Nothing here allows a WRITE (no spend, no
// balance change) — read-only, and ordering itself carries no payment
// step (see /api/public/[slug]/order), so the blast radius of a guessed
// phone number is "sees a stranger's spending", not "loses money".
// ═══════════════════════════════════════════════════

import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { serverError } from '@/lib/apiError'
import { tierFor, REWARD_TIERS, previousPeriod } from '@/lib/walletRewards'

export const runtime = 'edge'

const clip = (v: any, n: number) => String(v ?? '').slice(0, n)

export async function GET(req: Request, { params }: { params: { slug: string } }) {
  const slug = String(params.slug || '').slice(0, 60)
  const phone = clip(new URL(req.url).searchParams.get('phone'), 40).replace(/\s+/g, '')
  if (!slug) return NextResponse.json({ ok: false, error: 'Lien invalide' }, { status: 400 })
  if (!phone) return NextResponse.json({ ok: false, error: 'Numéro requis' }, { status: 400 })

  try {
    const rest = await sql`
      SELECT id, config FROM restaurants
      WHERE public_slug = ${slug} AND plan NOT IN ('suspended', 'suspended_exe') LIMIT 1`
    if (!rest.length) return NextResponse.json({ ok: false, error: 'Commerce introuvable' }, { status: 404 })
    const rid = rest[0].id
    const modules = (rest[0].config?.modules && typeof rest[0].config.modules === 'object') ? rest[0].config.modules : {}
    if (modules.wallet !== true) {
      return NextResponse.json({ ok: true, found: false, walletDisabled: true })
    }

    const clients = await sql`
      SELECT client_key, name, balance::float AS balance
      FROM wallets
      WHERE restaurant_id = ${rid} AND phone = ${phone} AND archived = FALSE
      LIMIT 1`
    if (!clients.length) return NextResponse.json({ ok: true, found: false })
    const client = clients[0]

    const movements = await sql`
      SELECT kind, delta::float, reason, client_ts
      FROM wallet_movements
      WHERE restaurant_id = ${rid} AND client_key = ${client.client_key}
      ORDER BY client_ts DESC, id DESC
      LIMIT 20`

    // This month's qualifying spend so far, and how far to the next tier —
    // read-only preview, never writes anything (the actual reward only ever
    // lands via the monthly job in lib/walletRewards.ts).
    const now = new Date()
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
    const [thisMonth] = await sql`
      SELECT COALESCE(SUM(paid_amount), 0)::float AS spend
      FROM wallet_movements
      WHERE restaurant_id = ${rid} AND client_key = ${client.client_key}
        AND kind = 'topup' AND paid_amount IS NOT NULL AND client_ts >= ${monthStart}`
    const currentSpend = Number(thisMonth?.spend || 0)
    const currentTier = tierFor(currentSpend)
    const nextTier = [...REWARD_TIERS].reverse().find(t => t.min > currentSpend) || null

    return NextResponse.json({
      ok: true, found: true,
      name: client.name,
      balance: client.balance,
      movements,
      reward: {
        current_month_spend: currentSpend,
        current_tier_pct: currentTier?.pct ?? null,
        next_tier_min: nextTier?.min ?? null,
        next_tier_pct: nextTier?.pct ?? null,
        missing_for_next: nextTier ? Math.max(0, Math.round((nextTier.min - currentSpend) * 1000) / 1000) : null,
      },
    })
  } catch (e: any) {
    return NextResponse.json(serverError('public wallet', e), { status: 500 })
  }
}
