-- ═══════════════════════════════════════════════════
-- MIGRATION: WALLET PIN PROTECTION
-- Additive and safe to re-run.
--
-- ── WHY ────────────────────────────────────────────────────────────────
-- GET /api/public/[slug]/wallet identifies a customer by phone number
-- alone (see that file's own header comment) — anyone who knows or
-- guesses a real customer's phone number could see their balance,
-- purchase history, and loyalty reward tier. No spend/order path is
-- reachable from that leak (read-only), but it's still a real privacy
-- gap. This adds an OPTIONAL (per-restaurant, config.modules.
-- walletPinProtected) self-service PIN: the first successful lookup for
-- a phone sets a 4-digit PIN, every lookup after that requires it, with
-- a fail-counter + timed lockout against brute force. No SMS/OTP gateway
-- involved — this is a self-service PIN customers set themselves, not a
-- verified identity, so it doesn't need one.
-- ═══════════════════════════════════════════════════

ALTER TABLE wallets ADD COLUMN IF NOT EXISTS pin_hash        VARCHAR(100);
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS pin_set_at      TIMESTAMPTZ;
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS pin_fail_count  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS pin_locked_until TIMESTAMPTZ;
