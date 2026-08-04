-- ═══════════════════════════════════════════════════
-- Per-VARIANT recipes (e.g. Pizza "Moyenne" vs "Maxi" each with their own
-- ingredient quantities, instead of one blended recipe for the whole product).
--
-- variant_key = '' means "the whole item, no size split" — every recipe
-- created before this migration keeps working unchanged, since it was
-- implicitly ''. A size-specific recipe uses the POS's own variant label
-- (od.items[].variant, e.g. "Moyenne"/"Maxi") as variant_key.
--
-- Safe to run multiple times and safe to run before or after app code that
-- references variant_key — every route degrades to '' (whole-item) behaviour
-- if this hasn't run yet, same defensive pattern as the rest of this file.
-- ═══════════════════════════════════════════════════

ALTER TABLE recipes      ADD COLUMN IF NOT EXISTS variant_key VARCHAR(40) NOT NULL DEFAULT '';
ALTER TABLE recipe_lines ADD COLUMN IF NOT EXISTS variant_key VARCHAR(40) NOT NULL DEFAULT '';

DROP INDEX IF EXISTS idx_recipe_item;
CREATE UNIQUE INDEX IF NOT EXISTS idx_recipe_item_variant
  ON recipes(restaurant_id, item_id, variant_key);

DROP INDEX IF EXISTS idx_rl_unique;
CREATE UNIQUE INDEX IF NOT EXISTS idx_rl_unique_variant
  ON recipe_lines(restaurant_id, item_id, variant_key, ing_key);

-- idx_rl_item / idx_rl_ing (plain item_id / ing_key indexes) are left as-is —
-- still useful for the "used_in_recipes" and whole-item lookups.

-- CREATE OR REPLACE only allows appending columns at the end; variant_key
-- sits in the middle of the old column order, so the view must be dropped
-- and recreated instead of replaced in place.
DROP VIEW IF EXISTS recipe_cost;
CREATE VIEW recipe_cost AS
SELECT
  r.restaurant_id,
  r.item_id,
  r.variant_key,
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
       ON rl.restaurant_id = r.restaurant_id AND rl.item_id = r.item_id AND rl.variant_key = r.variant_key
LEFT JOIN ingredients i
       ON i.restaurant_id = rl.restaurant_id AND i.ing_key = rl.ing_key
GROUP BY r.restaurant_id, r.item_id, r.variant_key, r.item_name, r.cost_mode,
         r.cost_override, r.enabled, r.yield_qty;
