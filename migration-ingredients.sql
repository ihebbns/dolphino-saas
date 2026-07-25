-- ═══════════════════════════════════════════════════
-- MIGRATION: INGREDIENTS & RECIPES (fiches techniques)
-- Run in the Neon SQL Editor. Additive and safe to re-run.
--
-- ── THE MODEL ─────────────────────────────────────────────────────────
-- Two lists, not one:
--   what you SELL  → menu products (owned by the caisse, in restaurants.menu_json)
--   what you BUY   → ingredients (owned by the web, this table)
-- A recipe joins them: 1 Café Express consumes 20 g of coffee + 1 cup.
--
-- ── THREE UNITS PER INGREDIENT ────────────────────────────────────────
-- This is what makes "1 kg makes 50 coffees" work:
--   stock_unit         how you buy it            sac de 1 kg
--   recipe_unit        how you use it            gramme
--   conversion_factor  recipe units per stock    1000
-- Coffee at 20 g per cup therefore yields exactly 50 cups per kilo, and the
-- same mechanism handles a pizza where each size uses a different amount.
--
-- ── COST: AUTO OR MANUAL, PER PRODUCT ─────────────────────────────────
-- cost per recipe unit = cost_per_stock_unit / conversion_factor
-- plate cost           = SUM(line.qty * that)
--
-- `recipes.cost_mode` is 'auto' or 'manual'. An override lives on the RECIPE and
-- never touches the ingredients' own costs — the same separation professional
-- costing tools use, so correcting one dish cannot corrupt your purchase prices.
--
-- ── ENTIRELY OPTIONAL ─────────────────────────────────────────────────
-- A product with no row in `recipes` behaves exactly as before: its cost is the
-- manual figure in stock.cost and nothing is deducted from ingredients. You can
-- write recipes for your five biggest sellers and ignore everything else.
-- ═══════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS ingredients (
  id                  BIGSERIAL     PRIMARY KEY,
  restaurant_id       INTEGER       NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,

  -- Stable slug so a rename never breaks the recipes pointing at it.
  ing_key             VARCHAR(64)   NOT NULL,
  name                VARCHAR(120)  NOT NULL,
  category            VARCHAR(60)   DEFAULT '',

  stock_unit          VARCHAR(24)   NOT NULL DEFAULT 'kg',
  recipe_unit         VARCHAR(24)   NOT NULL DEFAULT 'g',
  -- How many recipe units are in ONE stock unit. Must be > 0 or every derived
  -- cost would divide by zero.
  conversion_factor   NUMERIC(14,4) NOT NULL DEFAULT 1000
                        CHECK (conversion_factor > 0),

  -- Purchase price for one STOCK unit (one sack, one bag, one litre).
  cost_per_stock_unit NUMERIC(12,3) NOT NULL DEFAULT 0,

  -- On hand, expressed in stock units. Counted in the back office.
  quantity            NUMERIC(14,3) NOT NULL DEFAULT 0,
  low_threshold       NUMERIC(14,3) NOT NULL DEFAULT 0,
  tracked             BOOLEAN       NOT NULL DEFAULT TRUE,

  archived            BOOLEAN       NOT NULL DEFAULT FALSE,
  updated_at          TIMESTAMPTZ   DEFAULT NOW(),
  created_at          TIMESTAMPTZ   DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ing_key ON ingredients(restaurant_id, ing_key);
CREATE INDEX IF NOT EXISTS idx_ing_low
  ON ingredients(restaurant_id) WHERE tracked AND NOT archived;


-- One row per menu product that HAS a recipe. Absent = no recipe = optional.
CREATE TABLE IF NOT EXISTS recipes (
  id             BIGSERIAL     PRIMARY KEY,
  restaurant_id  INTEGER       NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  item_id        VARCHAR(64)   NOT NULL,   -- menu item id, from menu_json
  item_name      VARCHAR(120)  DEFAULT '',

  -- 'auto'   → cost computed from the lines below
  -- 'manual' → cost_override wins; the lines still deplete stock
  cost_mode      VARCHAR(10)   NOT NULL DEFAULT 'auto'
                   CHECK (cost_mode IN ('auto','manual')),
  cost_override  NUMERIC(12,3),

  -- Lets you keep a recipe on file without it affecting cost or stock yet.
  enabled        BOOLEAN       NOT NULL DEFAULT TRUE,

  yield_qty      NUMERIC(12,3) NOT NULL DEFAULT 1
                   CHECK (yield_qty > 0),   -- portions produced by the recipe
  notes          VARCHAR(300)  DEFAULT '',
  updated_at     TIMESTAMPTZ   DEFAULT NOW(),
  created_at     TIMESTAMPTZ   DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_recipe_item ON recipes(restaurant_id, item_id);


CREATE TABLE IF NOT EXISTS recipe_lines (
  id             BIGSERIAL     PRIMARY KEY,
  restaurant_id  INTEGER       NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  item_id        VARCHAR(64)   NOT NULL,
  ing_key        VARCHAR(64)   NOT NULL,
  -- Quantity expressed in the ingredient's RECIPE unit (200 g, 1 piece, 30 ml).
  qty            NUMERIC(14,4) NOT NULL DEFAULT 0 CHECK (qty >= 0),
  created_at     TIMESTAMPTZ   DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_rl_unique ON recipe_lines(restaurant_id, item_id, ing_key);
CREATE INDEX IF NOT EXISTS idx_rl_item ON recipe_lines(restaurant_id, item_id);
CREATE INDEX IF NOT EXISTS idx_rl_ing  ON recipe_lines(restaurant_id, ing_key);


-- ═══════════════════════════════════════════════════
-- VIEW: computed plate cost per product.
--   unit cost of an ingredient = cost_per_stock_unit / conversion_factor
--   plate cost                 = SUM(line.qty * unit cost) / yield
-- `cost_effective` applies the manual override when cost_mode = 'manual'.
-- `lines_missing_cost` counts ingredients priced at 0, which would otherwise
-- silently understate the plate cost and overstate margin.
-- ═══════════════════════════════════════════════════
CREATE OR REPLACE VIEW recipe_cost AS
SELECT
  r.restaurant_id,
  r.item_id,
  r.item_name,
  r.cost_mode,
  r.cost_override,
  r.enabled,
  r.yield_qty,
  COALESCE(SUM(rl.qty * (i.cost_per_stock_unit / NULLIF(i.conversion_factor, 0))), 0)
    / NULLIF(r.yield_qty, 0)                                   AS cost_computed,
  CASE
    WHEN r.cost_mode = 'manual' THEN COALESCE(r.cost_override, 0)
    ELSE COALESCE(SUM(rl.qty * (i.cost_per_stock_unit / NULLIF(i.conversion_factor, 0))), 0)
         / NULLIF(r.yield_qty, 0)
  END                                                          AS cost_effective,
  COUNT(rl.id)::int                                            AS nb_lines,
  COUNT(rl.id) FILTER (WHERE COALESCE(i.cost_per_stock_unit,0) = 0)::int AS lines_missing_cost
FROM recipes r
LEFT JOIN recipe_lines rl
       ON rl.restaurant_id = r.restaurant_id AND rl.item_id = r.item_id
LEFT JOIN ingredients i
       ON i.restaurant_id = rl.restaurant_id AND i.ing_key = rl.ing_key
GROUP BY r.restaurant_id, r.item_id, r.item_name, r.cost_mode,
         r.cost_override, r.enabled, r.yield_qty;


-- ═══════════════════════════════════════════════════
-- VIEW: ingredient stock with its value and a low-stock flag.
-- ═══════════════════════════════════════════════════
CREATE OR REPLACE VIEW ingredient_stock AS
SELECT
  i.restaurant_id,
  i.ing_key,
  i.name,
  i.category,
  i.stock_unit,
  i.recipe_unit,
  i.conversion_factor,
  i.cost_per_stock_unit,
  (i.cost_per_stock_unit / NULLIF(i.conversion_factor,0)) AS cost_per_recipe_unit,
  i.quantity,
  i.low_threshold,
  i.tracked,
  i.archived,
  (i.quantity * i.cost_per_stock_unit)                    AS stock_value,
  (i.tracked AND NOT i.archived AND i.quantity <= i.low_threshold) AS is_low,
  -- How many recipes would break if this ingredient ran out.
  (SELECT COUNT(*) FROM recipe_lines rl
    WHERE rl.restaurant_id = i.restaurant_id AND rl.ing_key = i.ing_key)::int AS used_in_recipes
FROM ingredients i;


-- ═══════════════════════════════════════════════════
-- Useful queries:
--
--   -- Plate cost and margin, joined to the caisse-owned selling price
--   SELECT rc.item_name, s.sell_price, rc.cost_effective,
--          s.sell_price - rc.cost_effective AS marge
--   FROM recipe_cost rc
--   JOIN stock s ON s.restaurant_id = rc.restaurant_id AND s.item_id = rc.item_id
--   WHERE rc.restaurant_id = ? ORDER BY marge ASC;
--
--   -- Ingredients to reorder
--   SELECT name, quantity, low_threshold, stock_unit FROM ingredient_stock
--   WHERE restaurant_id = ? AND is_low ORDER BY quantity;
--
--   -- Recipes whose cost is understated because an ingredient has no price
--   SELECT item_name, lines_missing_cost FROM recipe_cost
--   WHERE restaurant_id = ? AND lines_missing_cost > 0;
-- ═══════════════════════════════════════════════════
