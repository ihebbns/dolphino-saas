// ═══════════════════════════════════════════════════
// Shared self-service wallet PIN verification — used by both
// /api/public/[slug]/wallet (viewing a balance) and
// /api/public/[slug]/order (paying for an order with wallet balance).
//
// Security-critical logic (lockout, fail-counting, PIN compare) living in
// ONE place rather than copy-pasted into two routes — a fix or a bug here
// only ever needs to happen once, and the two callers can't silently drift
// out of sync on how many attempts are allowed or how long a lockout lasts.
//
// This only verifies an EXISTING pin — first-time PIN setup is a separate,
// deliberately narrower flow that only /api/public/[slug]/wallet exposes
// (setting a PIN as a side effect of trying to pay for an order would be a
// confusing, risky UX — a typo there locks in the wrong PIN on the first
// try, with money already on the line).
// ═══════════════════════════════════════════════════

import bcrypt from 'bcryptjs'

export const PIN_RE = /^\d{4}$/
export const MAX_FAILS = 5
export const LOCK_MINUTES = 15

export type WalletPinResult =
  | { ok: true; client: { client_key: string; name: string; balance: number } }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'locked'; lockedUntil: string }
  | { ok: false; reason: 'no_pin' }
  | { ok: false; reason: 'bad_format' }
  | { ok: false; reason: 'wrong'; attemptsLeft: number }

export async function verifyWalletPin(sql: any, rid: number, phone: string, pin: string): Promise<WalletPinResult> {
  const rows = await sql`
    SELECT client_key, name, balance::float AS balance, pin_hash, pin_fail_count, pin_locked_until
    FROM wallets WHERE restaurant_id = ${rid} AND phone = ${phone} AND archived = FALSE LIMIT 1`
  if (!rows.length) return { ok: false, reason: 'not_found' }
  const w = rows[0]

  if (w.pin_locked_until && new Date(w.pin_locked_until) > new Date()) {
    return { ok: false, reason: 'locked', lockedUntil: w.pin_locked_until }
  }
  if (!w.pin_hash) return { ok: false, reason: 'no_pin' }
  if (!PIN_RE.test(pin)) return { ok: false, reason: 'bad_format' }

  const match = await bcrypt.compare(pin, w.pin_hash)
  if (!match) {
    const fails = (w.pin_fail_count || 0) + 1
    if (fails >= MAX_FAILS) {
      const until = new Date(Date.now() + LOCK_MINUTES * 60000).toISOString()
      await sql`UPDATE wallets SET pin_fail_count = 0, pin_locked_until = ${until}
                WHERE restaurant_id = ${rid} AND client_key = ${w.client_key}`
      return { ok: false, reason: 'locked', lockedUntil: until }
    }
    await sql`UPDATE wallets SET pin_fail_count = ${fails} WHERE restaurant_id = ${rid} AND client_key = ${w.client_key}`
    return { ok: false, reason: 'wrong', attemptsLeft: MAX_FAILS - fails }
  }

  if (w.pin_fail_count) {
    await sql`UPDATE wallets SET pin_fail_count = 0 WHERE restaurant_id = ${rid} AND client_key = ${w.client_key}`
  }
  return { ok: true, client: { client_key: w.client_key, name: w.name, balance: w.balance } }
}
