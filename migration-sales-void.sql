-- ═══════════════════════════════════════════════════
-- MIGRATION: voided sales visible + traced on the web
--
-- A void at the till updated only the local SQLite row — the cloud `sales`
-- table never learned a sale was cancelled, so a voided sale's revenue stayed
-- baked into every dashboard total forever, and stock/ingredients consumed by
-- it were never restorable server-side (see migration history: the till's
-- own restock call for voided sales was silently rejected for recipe-mode
-- items, since it went through the movement endpoint that only accepts
-- unit-tracked products).
--
-- `voided` is written via the SAME upsert path a sale first syncs through
-- (POST /api/sync, keyed on the existing UNIQUE (restaurant_id, num,
-- business_date, cashier)) — the till just re-posts the sale once it's been
-- voided locally. `sales.voided OR EXCLUDED.voided` in that upsert makes this
-- monotonic: once true, no stale/offline-queued replay of the original
-- (pre-void) snapshot can ever flip it back to false.
-- ═══════════════════════════════════════════════════

ALTER TABLE sales ADD COLUMN IF NOT EXISTS voided      BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS void_reason VARCHAR(200) DEFAULT '';
ALTER TABLE sales ADD COLUMN IF NOT EXISTS void_by     VARCHAR(80)  DEFAULT '';
ALTER TABLE sales ADD COLUMN IF NOT EXISTS voided_at   TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_sales_voided ON sales(restaurant_id, business_date, voided);
