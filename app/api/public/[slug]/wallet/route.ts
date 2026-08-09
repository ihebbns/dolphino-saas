// ═══════════════════════════════════════════════════
// GET /api/public/[slug]/wallet?phone=XXXXXXXX&pin=NNNN — a customer looking
// up their OWN card balance/history/reward progress on the public ordering
// page.
//
// ── PRIVACY (v2 — self-service PIN, admin-togglable per restaurant) ──────
// v1 identified a customer by phone number ALONE — anyone who knew or
// guessed a real customer's phone number could see that customer's balance,
// purchase history, and reward tier. No spend/order path was ever reachable
// from it (read-only), but it was still a real privacy gap, reported by a
// client.
//
// Fix: when `restaurants.config.modules.walletPinProtected === true` (an
// admin-only per-client toggle, off by default so nothing changes for a
// client who hasn't opted in), a phone lookup now also needs a 4-digit PIN:
//   - First-ever lookup for a phone with no PIN set yet: pass `pin` to set
//     one right there (self-service, not identity-verified — this is not an
//     OTP/SMS system, doesn't claim to be one; it's the same trust level as
//     a physical loyalty card's own PIN pad).
//   - Every lookup after that requires the correct PIN.
//   - 5 wrong PINs locks the phone out for 15 minutes (a 4-digit PIN is only
//     10,000 combinations — the lockout is what makes guessing impractical).
//   - A locked-out customer can be unlocked by the developer from /admin
//     (POST /api/admin/wallet-pin-reset) — a support action, not something
//     the public page can do to itself.
// When the toggle is OFF, behavior is byte-for-byte what v1 did — this is
// an opt-in hardening, not a forced breaking change for every client.
//
// Still true from v1: this route never writes a balance or a movement (PIN
// columns aside) — read-only, and ordering itself carries no payment step
// (see /api/public/[slug]/order), so even a fully-open wallet lookup could
// never spend anything.
// ═══════════════════════════════════════════════════

import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { sql } from '@/lib/db'
import { serverError, isMissingSchema } from '@/lib/apiError'
import { tierFor, REWARD_TIERS, previousPeriod } from '@/lib/walletRewards'
import { verifyWalletPin, PIN_RE } from '@/lib/walletPin'

export const runtime = 'nodejs'

const clip = (v: any, n: number) => String(v ?? '').slice(0, n)

export async function GET(req: Request, { params }: { params: { slug: string } }) {
  const slug = String(params.slug || '').slice(0, 60)
  const url = new URL(req.url)
  const phone = clip(url.searchParams.get('phone'), 40).replace(/\s+/g, '')
  const pinInput = clip(url.searchParams.get('pin'), 4)
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
    const pinProtected = modules.walletPinProtected === true

    const clients = await sql`
      SELECT client_key, name, balance::float AS balance, pin_hash, pin_locked_until
      FROM wallets
      WHERE restaurant_id = ${rid} AND phone = ${phone} AND archived = FALSE
      LIMIT 1`
    if (!clients.length) return NextResponse.json({ ok: true, found: false })
    const client = clients[0]

    // ── PIN gate (only when this restaurant opted in) ────────────────────
    if (pinProtected) {
      if (client.pin_locked_until && new Date(client.pin_locked_until) > new Date()) {
        return NextResponse.json({ ok: true, found: true, locked: true, lockedUntil: client.pin_locked_until })
      }

      if (!client.pin_hash) {
        // No PIN set yet — this lookup establishes one instead of revealing
        // anything. Only a plain phone (no pin) just asks "does this need
        // setup", still with zero balance/history in the response. Setting
        // one is unique to THIS route (see lib/walletPin.ts's header note
        // for why /order never does this itself).
        if (!pinInput) return NextResponse.json({ ok: true, found: true, needsPinSetup: true })
        if (!PIN_RE.test(pinInput)) return NextResponse.json({ ok: false, error: 'Le code doit contenir 4 chiffres' }, { status: 400 })
        const hash = await bcrypt.hash(pinInput, 10)
        await sql`UPDATE wallets SET pin_hash = ${hash}, pin_set_at = NOW(), pin_fail_count = 0, pin_locked_until = NULL
                  WHERE restaurant_id = ${rid} AND client_key = ${client.client_key}`
        // fall through — setup succeeded, show the balance same as a normal
        // successful lookup below.
      } else {
        if (!pinInput) return NextResponse.json({ ok: true, found: true, pinRequired: true })
        const result = await verifyWalletPin(sql, rid, phone, pinInput)
        if (result.ok === false) {
          if (result.reason === 'locked') return NextResponse.json({ ok: true, found: true, locked: true, lockedUntil: result.lockedUntil })
          if (result.reason === 'wrong') return NextResponse.json({ ok: true, found: true, pinRequired: true, error: 'Code PIN incorrect', attemptsLeft: result.attemptsLeft })
          return NextResponse.json({ ok: true, found: true, pinRequired: true })
        }
      }
    }

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
    // walletPinProtected turned on before migration-wallet-pin.sql ran: fail
    // CLOSED (no data) rather than silently falling back to the unprotected
    // v1 response — the whole point of this endpoint is not to leak.
    if (isMissingSchema(e)) {
      return NextResponse.json({ ok: true, found: true, pinRequired: true, error: 'Protection PIN non initialisée — contactez le développeur' })
    }
    return NextResponse.json(serverError('public wallet', e), { status: 500 })
  }
}
