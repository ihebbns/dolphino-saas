-- ═══════════════════════════════════════════════════
-- MIGRATION: due_at — échéance de paiement fournisseur
-- Run in Neon SQL Editor. 100% ADDITIVE, safe to re-run.
--
-- Adds a nullable DATE column to both delivery ledgers.
-- Only filled when kind='receive' AND payment_method='credit'.
-- If omitted at creation, the API defaults to CURRENT_DATE + 30 days.
-- ═══════════════════════════════════════════════════

ALTER TABLE stock_movements
  ADD COLUMN IF NOT EXISTS due_at DATE DEFAULT NULL;

ALTER TABLE ingredient_movements
  ADD COLUMN IF NOT EXISTS due_at DATE DEFAULT NULL;

-- Index for urgency queries (late / soon) — filters by supplier and date
CREATE INDEX IF NOT EXISTS idx_stockmov_due
  ON stock_movements(supplier_id, due_at)
  WHERE kind = 'receive' AND payment_method = 'credit' AND due_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ingmov_due
  ON ingredient_movements(supplier_id, due_at)
  WHERE kind = 'receive' AND payment_method = 'credit' AND due_at IS NOT NULL;
