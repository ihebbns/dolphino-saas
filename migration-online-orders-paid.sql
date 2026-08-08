-- ═══════════════════════════════════════════════════
-- MIGRATION: payment tracking for online_orders
--
-- Online orders (phone or kiosk) never touch money at submission — payment
-- happens at the counter, same as a walk-in. This adds a `paid` flag so the
-- till can track which ACCEPTED orders still owe money, separate from the
-- pending/accepted/rejected status — an order can be accepted (kitchen has
-- it) and still be unpaid until the customer settles at the counter.
-- ═══════════════════════════════════════════════════

ALTER TABLE online_orders ADD COLUMN IF NOT EXISTS paid BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE online_orders ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;
