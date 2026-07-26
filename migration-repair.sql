-- ═══════════════════════════════════════════════════
-- REPAIR MIGRATION — run this if credits or stock movements still show errors
-- after the full migration-all.sql has been run.
--
-- Neon aborts a script on the first error, so if migration-credits.sql or
-- migration-stock-movements.sql hit any error partway through, the tables were
-- created but columns added LATER in the same file were silently skipped.
-- This file adds each column individually with IF NOT EXISTS guards, so it is
-- completely safe to run even if everything is already correct.
-- ═══════════════════════════════════════════════════

-- ── credit_movements ────────────────────────────────────────────────────
-- Early installations called this field client_name.  The current API and
-- reconciliation view use name, so keep old customer records while bringing
-- the schema forward instead of treating the whole credits feature as absent.
ALTER TABLE credits ADD COLUMN IF NOT EXISTS name VARCHAR(120);
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'credits' AND column_name = 'client_name'
  ) THEN
    UPDATE credits
    SET name = client_name
    WHERE (name IS NULL OR name = '') AND client_name IS NOT NULL;
    ALTER TABLE credits ALTER COLUMN client_name DROP NOT NULL;
  END IF;
END $$;

ALTER TABLE credit_movements ADD COLUMN IF NOT EXISTS pay_method    VARCHAR(20)   DEFAULT '';
ALTER TABLE credit_movements ADD COLUMN IF NOT EXISTS items_summary VARCHAR(400)  DEFAULT '';
ALTER TABLE credit_movements ADD COLUMN IF NOT EXISTS sale_num      INTEGER;
ALTER TABLE credit_movements ADD COLUMN IF NOT EXISTS reason        VARCHAR(200)  DEFAULT '';
ALTER TABLE credit_movements ADD COLUMN IF NOT EXISTS actor         VARCHAR(80)   DEFAULT '';
ALTER TABLE credit_movements ADD COLUMN IF NOT EXISTS session_id    VARCHAR(64)   DEFAULT '';
ALTER TABLE credit_movements ADD COLUMN IF NOT EXISTS terminal_id   VARCHAR(64)   DEFAULT '';
ALTER TABLE credit_movements ADD COLUMN IF NOT EXISTS client_ts     TIMESTAMPTZ   NOT NULL DEFAULT NOW();
ALTER TABLE credit_movements ADD COLUMN IF NOT EXISTS client_uid    VARCHAR(64)   NOT NULL DEFAULT '';
ALTER TABLE credit_movements ADD COLUMN IF NOT EXISTS created_at    TIMESTAMPTZ   DEFAULT NOW();

-- Idempotency index (may already exist, IF NOT EXISTS handles it)
CREATE UNIQUE INDEX IF NOT EXISTS idx_creditmov_uid
  ON credit_movements(restaurant_id, client_uid)
  WHERE client_uid <> '';

CREATE INDEX IF NOT EXISTS idx_creditmov_client
  ON credit_movements(restaurant_id, client_key, client_ts DESC);

CREATE INDEX IF NOT EXISTS idx_creditmov_recent
  ON credit_movements(restaurant_id, client_ts DESC);

-- Re-create the view (OR REPLACE is safe)
CREATE OR REPLACE VIEW credit_reconciliation AS
SELECT
  c.restaurant_id, c.client_key, c.name, c.phone,
  c.balance                                             AS balance_pos,
  COALESCE(m.derived, 0)                                AS balance_derived,
  c.balance - COALESCE(m.derived, 0)                    AS drift,
  COALESCE(m.nb_credits, 0)                             AS nb_credits,
  COALESCE(m.nb_payments, 0)                            AS nb_payments,
  COALESCE(m.total_credit, 0)                           AS total_pris,
  COALESCE(m.total_paid, 0)                             AS total_regle,
  m.last_movement_at, c.archived
FROM credits c
LEFT JOIN (
  SELECT restaurant_id, client_key,
         SUM(delta)                                              AS derived,
         COUNT(*) FILTER (WHERE kind = 'credit')::int             AS nb_credits,
         COUNT(*) FILTER (WHERE kind = 'payment')::int            AS nb_payments,
         COALESCE(SUM(delta) FILTER (WHERE delta > 0), 0)         AS total_credit,
         COALESCE(SUM(-delta) FILTER (WHERE delta < 0), 0)        AS total_paid,
         MAX(client_ts)                                           AS last_movement_at
  FROM credit_movements
  GROUP BY restaurant_id, client_key
) m ON m.restaurant_id = c.restaurant_id AND m.client_key = c.client_key;


-- ── stock_movements ──────────────────────────────────────────────────────
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS delta          NUMERIC(12,3);
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS count_value    NUMERIC(12,3);
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS expected_value NUMERIC(12,3);
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS unit_cost      NUMERIC(12,4);
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS reason         VARCHAR(200)  DEFAULT '';
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS actor          VARCHAR(80)   NOT NULL DEFAULT '';
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS source         VARCHAR(8)    DEFAULT 'pos';
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS terminal_id    VARCHAR(64)   DEFAULT '';
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS session_id     VARCHAR(64)   DEFAULT '';
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS sale_num       INTEGER;
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS client_ts      TIMESTAMPTZ   NOT NULL DEFAULT NOW();
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS client_uid     VARCHAR(64)   NOT NULL DEFAULT '';
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS created_at     TIMESTAMPTZ   DEFAULT NOW();
-- Supplier columns (from migration-suppliers.sql)
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS supplier_id    INTEGER REFERENCES suppliers(id) ON DELETE SET NULL;
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS payment_method VARCHAR(20)   DEFAULT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_stockmov_uid
  ON stock_movements(restaurant_id, client_uid)
  WHERE client_uid <> '';

CREATE INDEX IF NOT EXISTS idx_stockmov_item
  ON stock_movements(restaurant_id, item_id, client_ts DESC);

CREATE INDEX IF NOT EXISTS idx_stockmov_recent
  ON stock_movements(restaurant_id, client_ts DESC);

-- Re-create the derived view
CREATE OR REPLACE VIEW stock_derived AS
SELECT
  s.restaurant_id, s.item_id, s.item_name, s.item_emoji, s.category,
  s.cost, s.sell_price, s.barcode, s.tracked, s.low_threshold,
  COALESCE(
    (SELECT lc.count_value + COALESCE((
       SELECT SUM(m2.delta) FROM stock_movements m2
       WHERE m2.restaurant_id = s.restaurant_id AND m2.item_id = s.item_id
         AND m2.delta IS NOT NULL AND m2.client_ts > lc.client_ts
     ), 0)
     FROM stock_movements lc
     WHERE lc.restaurant_id = s.restaurant_id AND lc.item_id = s.item_id AND lc.kind = 'count'
     ORDER BY lc.client_ts DESC, lc.id DESC LIMIT 1
    ),
    s.quantity
  ) AS theorique
FROM stock s;


-- ── ingredient_movements ────────────────────────────────────────────────
ALTER TABLE ingredient_movements ADD COLUMN IF NOT EXISTS supplier_id    INTEGER REFERENCES suppliers(id) ON DELETE SET NULL;
ALTER TABLE ingredient_movements ADD COLUMN IF NOT EXISTS payment_method VARCHAR(20) DEFAULT NULL;

-- ── ingredients table — add missing columns that may have been skipped ────
ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS cost_per_stock_unit NUMERIC(12,4) NOT NULL DEFAULT 0;
ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS quantity            NUMERIC(14,3) NOT NULL DEFAULT 0;
ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS low_threshold       NUMERIC(14,3) NOT NULL DEFAULT 0;
ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS tracked             BOOLEAN       NOT NULL DEFAULT TRUE;
ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS archived            BOOLEAN       NOT NULL DEFAULT FALSE;
ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS updated_at          TIMESTAMPTZ   DEFAULT NOW();

-- Re-create ingredient_stock view so it picks up any new columns
CREATE OR REPLACE VIEW ingredient_stock AS
SELECT
  i.restaurant_id, i.ing_key, i.name, i.category,
  i.stock_unit, i.recipe_unit, i.conversion_factor,
  i.cost_per_stock_unit,
  (i.cost_per_stock_unit / NULLIF(i.conversion_factor,0)) AS cost_per_recipe_unit,
  i.quantity, i.low_threshold, i.tracked, i.archived,
  (i.quantity * i.cost_per_stock_unit) AS stock_value,
  (i.tracked AND NOT i.archived AND i.quantity <= i.low_threshold) AS is_low,
  (SELECT COUNT(*) FROM recipe_lines rl
   WHERE rl.restaurant_id = i.restaurant_id AND rl.ing_key = i.ing_key)::int AS used_in_recipes
FROM ingredients i;

-- Re-create recipe_cost view
CREATE OR REPLACE VIEW recipe_cost AS
SELECT
  r.restaurant_id, r.item_id, r.item_name,
  r.cost_mode, r.cost_override, r.enabled, r.yield_qty,
  COALESCE(r.cost_override, 0)::float  AS cost_effective,
  0::float                              AS cost_computed,
  (SELECT COUNT(*) FROM recipe_lines rl WHERE rl.restaurant_id = r.restaurant_id AND rl.item_id = r.item_id)::int AS nb_lines,
  0::int AS lines_missing_cost
FROM recipes r;

-- Re-create ingredient_derived view  
CREATE OR REPLACE VIEW ingredient_derived AS
SELECT
  restaurant_id, ing_key,
  COALESCE(
    (SELECT lc.count_value + COALESCE((
       SELECT SUM(m2.delta) FROM ingredient_movements m2
       WHERE m2.restaurant_id = lc.restaurant_id AND m2.ing_key = lc.ing_key
         AND m2.delta IS NOT NULL AND m2.client_ts > lc.client_ts
     ), 0)
     FROM ingredient_movements lc
     WHERE lc.restaurant_id = ingredient_movements.restaurant_id
       AND lc.ing_key = ingredient_movements.ing_key AND lc.kind = 'count'
     ORDER BY lc.client_ts DESC, lc.id DESC LIMIT 1
    ),
    (SELECT quantity FROM ingredients i WHERE i.restaurant_id = ingredient_movements.restaurant_id AND i.ing_key = ingredient_movements.ing_key)
  ) AS quantity
FROM ingredient_movements
GROUP BY restaurant_id, ing_key;


-- ═══════════════════════════════════════════════════
-- Verify: run these queries to confirm all columns exist
--
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'credit_movements' ORDER BY ordinal_position;
--
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'stock_movements' ORDER BY ordinal_position;
-- ═══════════════════════════════════════════════════
