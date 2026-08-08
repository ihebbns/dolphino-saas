-- ═══════════════════════════════════════════════════
-- MIGRATION: "ready for pickup" status for online orders
--
-- Orthogonal to `paid` — kitchen finishing an order and the customer
-- settling the bill are two independent events that can happen in either
-- order. Lets staff signal "food's done" separately from "money's in",
-- and lets the customer's own tracking view (see /moi/[slug]) show it.
-- ═══════════════════════════════════════════════════

ALTER TABLE online_orders ADD COLUMN IF NOT EXISTS ready BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE online_orders ADD COLUMN IF NOT EXISTS ready_at TIMESTAMPTZ;
ALTER TABLE online_orders ADD COLUMN IF NOT EXISTS ready_by VARCHAR(80);
