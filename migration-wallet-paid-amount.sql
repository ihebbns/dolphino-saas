-- ═══════════════════════════════════════════════════
-- MIGRATION: track REAL money paid on a topup, separately from the
-- bonus-inclusive credited amount already stored in `delta`.
--
-- WHY: the monthly spend-tier reward (Phase 2) must be computed on money the
-- client actually paid in — never on the 30% bonus itself. Every real loyalty
-- program (airline miles, points programs, etc.) excludes promotional/bonus
-- credit from reward-tier qualification specifically to avoid bonus money
-- generating more bonus money in a compounding loop. `delta` on a 'topup'
-- movement is the CREDITED amount (e.g. 130 for a 100 DT payment); this new
-- column holds the 100.
--
-- Nullable and only meaningful for kind='topup'. NULL for older rows (from
-- before this migration) — the reward job treats NULL as "unknown, skip",
-- never as 0, so a pre-migration recharge is simply excluded from reward
-- calculation rather than silently zeroed out.
-- ═══════════════════════════════════════════════════

ALTER TABLE wallet_movements ADD COLUMN IF NOT EXISTS paid_amount NUMERIC(12,3);
