-- ═══════════════════════════════════════════════════
-- MIGRATION: monthly spend-tier rewards (Fidélité Phase 2)
--
-- One row per (restaurant, client, calendar period) reward actually paid out.
-- The UNIQUE constraint is what makes the monthly job idempotent — running it
-- twice for the same month, or a cron retry after a timeout, computes the
-- same reward and inserts nothing the second time, rather than double-paying.
--
-- period is 'YYYY-MM' (the calendar month the reward covers), not a
-- timestamp — a reward is a monthly-granularity fact, not an instant.
-- ═══════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS wallet_reward_runs (
  id             BIGSERIAL     PRIMARY KEY,
  restaurant_id  INTEGER       NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  client_key     VARCHAR(64)   NOT NULL,
  period         VARCHAR(7)    NOT NULL,   -- 'YYYY-MM'

  qualifying_spend NUMERIC(12,3) NOT NULL, -- SUM(paid_amount) that earned this
  tier_pct         NUMERIC(5,4)  NOT NULL, -- e.g. 0.06 for 6%
  amount           NUMERIC(12,3) NOT NULL, -- reward credited (qualifying_spend * tier_pct)

  created_at     TIMESTAMPTZ   DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_reward_period
  ON wallet_reward_runs(restaurant_id, client_key, period);
