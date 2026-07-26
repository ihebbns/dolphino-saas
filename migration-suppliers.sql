-- ═══════════════════════════════════════════════════
-- MIGRATION: Suppliers (Fournisseurs) + delivery credit tracking
-- Run this ONCE in Neon → SQL Editor. Safe to re-run.
--
-- ── THE DESIGN ────────────────────────────────────────────────────────
-- Mirror of the client credit system but in the other direction:
--   • Client credit: THEY owe YOU → you track what to collect.
--   • Supplier credit: YOU owe THEM → you track what to pay.
--
-- Every delivery of stock or ingredients can carry a supplier. When the payment
-- method is 'credit', the delivery amount increases the supplier's balance (what
-- you owe). A payment decreases it. 'comptant' means paid immediately: balance
-- untouched. Same append-only ledger approach: nothing is overwritten, everything
-- carries date + actor.
--
-- A delivery without a supplier is allowed ("passager" / one-time supplier). It
-- still records the price (for the weighted average cost) but creates no debt
-- entry. The supplier_id is nullable for exactly this reason.
--
-- ── WEIGHTED AVERAGE COST ─────────────────────────────────────────────
-- The unit_cost on each 'receive' movement already feeds the WAC. This migration
-- does NOT change that calculation — it only adds WHO you bought from and WHETHER
-- you paid them. The cost logic stays in lib/stock.ts and lib/ingredients.ts.
-- ═══════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════
-- TABLE: suppliers
-- ═══════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS suppliers (
  id             SERIAL        PRIMARY KEY,
  restaurant_id  INTEGER       NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  name           VARCHAR(120)  NOT NULL,
  phone          VARCHAR(40)   DEFAULT '',
  category       VARCHAR(60)   DEFAULT '',   -- viande, légumes, boissons, emballage...
  notes          TEXT          DEFAULT '',
  -- Cache of what you owe. Derived: SUM(deliveries on credit) - SUM(payments).
  -- Kept for fast list rendering; recalculated on each write.
  balance        NUMERIC(12,3) NOT NULL DEFAULT 0,
  archived       BOOLEAN       NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ   DEFAULT NOW(),
  updated_at     TIMESTAMPTZ   DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_suppliers_name
  ON suppliers(restaurant_id, name) WHERE NOT archived;

CREATE INDEX IF NOT EXISTS idx_suppliers_balance
  ON suppliers(restaurant_id, balance DESC) WHERE NOT archived;


-- ═══════════════════════════════════════════════════
-- TABLE: supplier_payments
-- When you pay a supplier (partially or fully), a row goes here.
-- Same shape as credit_movements for clients, but simpler: only payments,
-- no "credit" entries (those come from the delivery itself).
-- ═══════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS supplier_payments (
  id             SERIAL        PRIMARY KEY,
  restaurant_id  INTEGER       NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  supplier_id    INTEGER       NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  amount         NUMERIC(12,3) NOT NULL CHECK (amount > 0),
  method         VARCHAR(20)   DEFAULT 'espèces',  -- espèces, virement, chèque
  reference      VARCHAR(120)  DEFAULT '',          -- cheque number, transfer ref
  notes          TEXT          DEFAULT '',
  actor          VARCHAR(80)   NOT NULL DEFAULT '',
  client_ts      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  created_at     TIMESTAMPTZ   DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_supplier_payments_supplier
  ON supplier_payments(restaurant_id, supplier_id, client_ts DESC);


-- ═══════════════════════════════════════════════════
-- ALTER: add supplier_id + payment_method to stock_movements
-- A delivery row can now say WHO delivered and WHETHER it was paid.
-- ═══════════════════════════════════════════════════
ALTER TABLE stock_movements
  ADD COLUMN IF NOT EXISTS supplier_id     INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS payment_method  VARCHAR(20) DEFAULT NULL;

-- Same for ingredient_movements
ALTER TABLE ingredient_movements
  ADD COLUMN IF NOT EXISTS supplier_id     INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS payment_method  VARCHAR(20) DEFAULT NULL;


-- ═══════════════════════════════════════════════════
-- VIEW: supplier balances derived from movements + payments
-- ═══════════════════════════════════════════════════
CREATE OR REPLACE VIEW supplier_ledger AS
SELECT
  s.id AS supplier_id,
  s.restaurant_id,
  s.name,
  s.phone,
  s.category,
  s.archived,
  -- Total bought on credit (from both stock and ingredient deliveries)
  COALESCE(d.total_credit, 0)        AS total_credit,
  COALESCE(d.nb_deliveries, 0)       AS nb_deliveries,
  COALESCE(d.last_delivery_at, NULL) AS last_delivery_at,
  -- Total paid back
  COALESCE(p.total_paid, 0)          AS total_paid,
  COALESCE(p.nb_payments, 0)         AS nb_payments,
  COALESCE(p.last_payment_at, NULL)  AS last_payment_at,
  -- What you still owe
  COALESCE(d.total_credit, 0) - COALESCE(p.total_paid, 0) AS dette
FROM suppliers s
LEFT JOIN (
  -- Stock deliveries on credit
  SELECT supplier_id,
         SUM(ABS(delta) * COALESCE(unit_cost, 0))::numeric(12,3) AS total_credit,
         COUNT(*)::int AS nb_deliveries,
         MAX(client_ts) AS last_delivery_at
  FROM (
    SELECT supplier_id, delta, unit_cost, client_ts
    FROM stock_movements
    WHERE kind = 'receive' AND supplier_id IS NOT NULL AND payment_method = 'credit'
    UNION ALL
    SELECT supplier_id, delta, unit_cost, client_ts
    FROM ingredient_movements
    WHERE kind = 'receive' AND supplier_id IS NOT NULL AND payment_method = 'credit'
  ) all_deliveries
  GROUP BY supplier_id
) d ON d.supplier_id = s.id
LEFT JOIN (
  SELECT supplier_id,
         SUM(amount)::numeric(12,3) AS total_paid,
         COUNT(*)::int AS nb_payments,
         MAX(client_ts) AS last_payment_at
  FROM supplier_payments
  GROUP BY supplier_id
) p ON p.supplier_id = s.id;


-- ═══════════════════════════════════════════════════
-- Useful queries:
--
--   -- Who do I owe?
--   SELECT name, dette FROM supplier_ledger
--   WHERE restaurant_id = X AND NOT archived AND dette > 0
--   ORDER BY dette DESC;
--
--   -- All deliveries from a supplier:
--   SELECT * FROM stock_movements WHERE supplier_id = Y AND kind = 'receive'
--   UNION ALL
--   SELECT * FROM ingredient_movements WHERE supplier_id = Y AND kind = 'receive'
--   ORDER BY client_ts DESC;
-- ═══════════════════════════════════════════════════
