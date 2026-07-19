-- ═══════════════════════════════════════════════════
-- MIGRATION: Per-caissier sessions + session_id linkage
-- Run this ONCE in Neon → SQL Editor
-- ═══════════════════════════════════════════════════

-- 1) Link each sale to its exact caisse session (stable client key)
ALTER TABLE sales    ADD COLUMN IF NOT EXISTS session_id VARCHAR(64) DEFAULT '';
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS session_id VARCHAR(64) DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_sales_session    ON sales(session_id);
CREATE INDEX IF NOT EXISTS idx_sessions_session ON sessions(session_id);

-- 2) Allow MULTIPLE sessions per day (multiple caissiers / shifts).
--    Without this, a second clôture the same day overwrites the first one.
ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_restaurant_id_business_date_key;

-- 3) (Safety) make sure sales can hold same ticket number from different cashiers
ALTER TABLE sales DROP CONSTRAINT IF EXISTS sales_restaurant_id_num_business_date_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_unique_per_cashier
  ON sales(restaurant_id, num, business_date, cashier);
