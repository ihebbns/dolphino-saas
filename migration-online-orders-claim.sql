-- ═══════════════════════════════════════════════════
-- MIGRATION: claim lock for unpaid online orders
--
-- With multiple tills, two cashiers could both pull the same unpaid order
-- into their cart and both complete a real sale for it — duplicate stock
-- deduction, duplicate receipt, silently. `claimed_by`/`claimed_at` give
-- the till an atomic "I've got this one" before it loads the order into
-- the cart, so a second till is refused instead of racing.
-- ═══════════════════════════════════════════════════

ALTER TABLE online_orders ADD COLUMN IF NOT EXISTS claimed_by VARCHAR(80);
ALTER TABLE online_orders ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;
