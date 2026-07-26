-- ═══════════════════════════════════════════════════
-- MIGRATION: ingredient consumption ledger + weighted-average cost
-- Run in Neon SQL Editor. 100% ADDITIVE and safe to re-run.
-- Requires migration-ingredients.sql. No POS change is needed.
--
-- ── WHAT WAS BROKEN ───────────────────────────────────────────────────
-- Selling a pizza deducted the pizza and left the cheese untouched. The whole
-- recipe system computed a COST and nothing else: there was no code path
-- anywhere from a sale back to `ingredients.quantity`. The only UPDATE on that
-- table in the entire codebase was the archive statement.
--
-- The consequence is bigger than a wrong number. Without consumption there is no
-- ACTUAL usage, only THEORETICAL usage, so the one figure that tells an owner
-- whether cheese is being wasted or walking out of the door — the variance
-- between the two — could not be computed at all.
--
-- ── WHY A LEDGER, NOT A COLUMN ────────────────────────────────────────
-- `UPDATE ingredients SET quantity = quantity - x` is last-write-wins. One
-- replayed offline sale silently eats the cheese twice, two terminals clobber
-- each other, and nothing records who or why. Same reasoning, and the same
-- shape, as stock_movements: append only, quantity DERIVED, every row carrying a
-- client timestamp and an idempotency key.
--
--   quantity = <last 'count' value> + SUM(deltas recorded after it)
--
-- ── WHY unit_cost LIVES ON THE MOVEMENT ───────────────────────────────
-- `ingredients.cost_per_stock_unit` is a single overwritten field, which is
-- effectively last-purchase-price. The documented failure of that approach is
-- silently stale costs — recipe costs six months out of date while the dish
-- quietly loses money. Recording the price paid ON EACH RECEIPT gives weighted
-- average cost, which is what NetSuite defaults to and what the costing tools in
-- this space use, because it smooths supplier fluctuation instead of lurching
-- with the newest invoice.
--
-- cost_per_stock_unit is KEPT as the fallback and as the manual figure, so
-- nothing that reads it today breaks.
-- ═══════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS ingredient_movements (
  id             BIGSERIAL     PRIMARY KEY,
  restaurant_id  INTEGER       NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  ing_key        VARCHAR(64)   NOT NULL,

  --   'consume' → used by a sale, exploded from a recipe (negative delta)
  --   'receive' → delivery. Carries unit_cost, which is what feeds the WAC.
  --   'waste'   → spoiled, burnt, dropped (negative)
  --   'adjust'  → manual correction, signed, reason expected
  --   'count'   → physical count. Resets the running total via count_value.
  kind           VARCHAR(16)   NOT NULL
                   CHECK (kind IN ('consume','receive','waste','adjust','count')),

  -- Signed change in STOCK units, for every kind except 'count'.
  delta          NUMERIC(16,4),

  -- Absolute counted value in STOCK units, ONLY for kind='count'.
  count_value    NUMERIC(16,4),

  -- What the system believed at the moment of a count, frozen so the écart stays
  -- historically true even after later movements.
  expected_value NUMERIC(16,4),

  -- Price paid for ONE stock unit on a receipt. NULL for every other kind.
  unit_cost      NUMERIC(12,3),

  reason         VARCHAR(200)  DEFAULT '',
  actor          VARCHAR(80)   DEFAULT '',
  source         VARCHAR(16)   DEFAULT 'web',   -- 'web' | 'pos' | 'system'

  -- Provenance for a 'consume' row, so a surprising deduction can be traced back
  -- to the exact ticket that caused it.
  item_id        VARCHAR(64)   DEFAULT '',
  sale_uid       VARCHAR(64)   DEFAULT '',
  sale_num       INTEGER,

  client_ts      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  -- Idempotency. For a consumption this is '<sale uid>:<ing_key>', so replaying
  -- a queued sale cannot deduct the same ingredient twice.
  client_uid     VARCHAR(160)  DEFAULT '',

  created_at     TIMESTAMPTZ   DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ingmov_ing
  ON ingredient_movements(restaurant_id, ing_key, client_ts DESC);
CREATE INDEX IF NOT EXISTS idx_ingmov_recent
  ON ingredient_movements(restaurant_id, client_ts DESC);
CREATE INDEX IF NOT EXISTS idx_ingmov_counts
  ON ingredient_movements(restaurant_id, ing_key, client_ts DESC) WHERE kind = 'count';
CREATE INDEX IF NOT EXISTS idx_ingmov_sale
  ON ingredient_movements(restaurant_id, sale_uid) WHERE sale_uid <> '';

-- The guard that makes replay safe. Partial so blank uids are unconstrained.
CREATE UNIQUE INDEX IF NOT EXISTS idx_ingmov_uid
  ON ingredient_movements(restaurant_id, client_uid) WHERE client_uid <> '';


-- ═══════════════════════════════════════════════════
-- SEED: today's quantity becomes an opening count, so switching to the ledger
-- loses nothing. Guarded per ingredient, which makes this re-runnable.
-- ═══════════════════════════════════════════════════
INSERT INTO ingredient_movements
  (restaurant_id, ing_key, kind, count_value, expected_value, unit_cost,
   reason, actor, source, client_ts, client_uid)
SELECT
  i.restaurant_id, i.ing_key, 'count',
  COALESCE(i.quantity, 0),
  COALESCE(i.quantity, 0),          -- no history to compare against yet → écart 0
  NULLIF(i.cost_per_stock_unit, 0), -- seeds the weighted average
  'Solde initial (migration)', 'system', 'system',
  COALESCE(i.updated_at, NOW()),
  'seed_ing_' || i.restaurant_id || '_' || i.ing_key
FROM ingredients i
WHERE NOT EXISTS (
  SELECT 1 FROM ingredient_movements m
  WHERE m.restaurant_id = i.restaurant_id AND m.ing_key = i.ing_key
)
ON CONFLICT DO NOTHING;


-- ═══════════════════════════════════════════════════
-- VIEW: quantity and weighted-average cost, both derived from the ledger.
--
-- WAC counts only receipts that carry a price, so an unpriced delivery cannot
-- drag the average to zero. When nothing has ever been received with a price the
-- result is NULL and callers fall back to ingredients.cost_per_stock_unit.
-- ═══════════════════════════════════════════════════
CREATE OR REPLACE VIEW ingredient_derived AS
WITH last_count AS (
  SELECT DISTINCT ON (restaurant_id, ing_key)
         restaurant_id, ing_key, count_value, client_ts
  FROM ingredient_movements
  WHERE kind = 'count'
  ORDER BY restaurant_id, ing_key, client_ts DESC, id DESC
),
wac AS (
  SELECT restaurant_id, ing_key,
         SUM(delta * unit_cost) / NULLIF(SUM(delta), 0) AS avg_cost,
         MAX(client_ts) FILTER (WHERE unit_cost IS NOT NULL) AS last_priced_at
  FROM ingredient_movements
  WHERE kind = 'receive' AND unit_cost IS NOT NULL AND delta > 0
  GROUP BY restaurant_id, ing_key
)
SELECT
  m.restaurant_id,
  m.ing_key,
  COALESCE(lc.count_value, 0)
    + COALESCE(SUM(m.delta) FILTER (
        WHERE lc.client_ts IS NULL OR m.client_ts > lc.client_ts
      ), 0)                                                   AS quantity,
  lc.client_ts                                                AS last_count_at,
  COALESCE(lc.count_value, 0)                                 AS last_count_value,
  w.avg_cost                                                  AS wac_cost,
  w.last_priced_at,
  -- Movement totals SINCE the last count: this is ACTUAL usage, which is what
  -- makes theoretical-vs-actual variance possible for the first time.
  COALESCE(SUM(-m.delta) FILTER (WHERE m.kind = 'consume' AND (lc.client_ts IS NULL OR m.client_ts > lc.client_ts)), 0) AS consumed_since,
  COALESCE(SUM( m.delta) FILTER (WHERE m.kind = 'receive' AND (lc.client_ts IS NULL OR m.client_ts > lc.client_ts)), 0) AS received_since,
  COALESCE(SUM(-m.delta) FILTER (WHERE m.kind = 'waste'   AND (lc.client_ts IS NULL OR m.client_ts > lc.client_ts)), 0) AS wasted_since,
  COALESCE(SUM( m.delta) FILTER (WHERE m.kind = 'adjust'  AND (lc.client_ts IS NULL OR m.client_ts > lc.client_ts)), 0) AS adjusted_since
FROM ingredient_movements m
LEFT JOIN last_count lc ON lc.restaurant_id = m.restaurant_id AND lc.ing_key = m.ing_key
LEFT JOIN wac w         ON w.restaurant_id  = m.restaurant_id AND w.ing_key  = m.ing_key
GROUP BY m.restaurant_id, m.ing_key, lc.count_value, lc.client_ts, w.avg_cost, w.last_priced_at;


-- ═══════════════════════════════════════════════════
-- Keep the computed recipe cost even when the owner overrides it.
--
-- cost_mode='manual' used to make the calculated figure invisible, which hid the
-- one thing worth seeing: the gap between what the recipe says a dish costs and
-- what the owner decided to use. Storing both turns an override from a guess
-- into a decision with evidence next to it.
-- ═══════════════════════════════════════════════════
ALTER TABLE recipes ADD COLUMN IF NOT EXISTS cost_computed    NUMERIC(12,3);
ALTER TABLE recipes ADD COLUMN IF NOT EXISTS cost_computed_at TIMESTAMPTZ;


-- ═══════════════════════════════════════════════════
-- Sanity checks after running:
--
--   -- cached quantity vs derived
--   SELECT i.ing_key, i.quantity AS cached, d.quantity AS derived
--   FROM ingredients i JOIN ingredient_derived d
--     ON d.restaurant_id = i.restaurant_id AND d.ing_key = i.ing_key
--   WHERE i.quantity <> d.quantity;
--
--   -- what a sale consumed
--   SELECT sale_num, ing_key, -delta AS used, item_id
--   FROM ingredient_movements
--   WHERE kind = 'consume' ORDER BY client_ts DESC LIMIT 20;
-- ═══════════════════════════════════════════════════
