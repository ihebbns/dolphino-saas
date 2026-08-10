-- ═══════════════════════════════════════════════════
-- MIGRATION: per-restaurant, per-day order numbers for kiosk/moi orders
--
-- online_orders.id is a global BIGSERIAL shared across every restaurant on
-- the platform — fine as a database key, unusable as a number to call out at
-- a counter ("order #48291" instead of "order #12"). daily_num resets to 1
-- every day, per restaurant, matching how a physical ticket printer works.
--
-- Assigned atomically inside the INSERT itself (see /api/public/[slug]/order),
-- with a unique index as the real correctness guarantee — a same-instant
-- collision under concurrent orders throws a unique-violation the insert
-- retries, rather than ever handing two customers the same number.
-- ═══════════════════════════════════════════════════

ALTER TABLE online_orders ADD COLUMN IF NOT EXISTS daily_num INTEGER;

-- created_at::date alone depends on the session timezone (STABLE, not
-- IMMUTABLE), which Postgres refuses in an index expression — pinning to UTC
-- explicitly makes it a constant function of its input, which is immutable.
CREATE UNIQUE INDEX IF NOT EXISTS idx_online_orders_daily_num
  ON online_orders(restaurant_id, ((created_at AT TIME ZONE 'UTC')::date), daily_num);
