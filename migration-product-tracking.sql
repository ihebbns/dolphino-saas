-- ═══════════════════════════════════════════════════
-- MIGRATION: one tracking mode per product
-- Run this ONCE in Neon → SQL Editor. Safe to re-run.
--
-- ── THE PROBLEM ──────────────────────────────────────────────────────
-- A product could be tracked TWO ways at once: a counted quantity in `stock`
-- AND a recipe consuming ingredients. Both were deducted on the same sale, so
-- the two inventories answered the same question differently and neither was
-- wrong — /stock said "20 en stock" while /ingredients said "encore possible 5"
-- for the same item. Nothing on screen explained which to believe.
--
-- ── THE RULE ─────────────────────────────────────────────────────────
-- Every product picks exactly ONE mode:
--
--   'stock'   Counted by the unit. A Coca is a bottle in, a bottle out.
--             A sale deducts the product quantity. Ingredients untouched.
--
--   'recipe'  Built from ingredients. A citronnade takes 200 ml out of a 1 L
--             bottle; a sandwich takes bread, tuna and oil. The product itself
--             has no meaningful unit count, so a sale deducts INGREDIENTS ONLY
--             and "how many left" becomes "how many can I still make".
--
--   'none'    Not tracked at all. Coffee, a service, anything you do not count.
--             A sale deducts nothing.
--
-- Cost is unaffected: a recipe still prices the product in every mode. The mode
-- decides what a SALE CONSUMES, not how the product is costed.
-- ═══════════════════════════════════════════════════

ALTER TABLE stock
  ADD COLUMN IF NOT EXISTS track_mode VARCHAR(10) NOT NULL DEFAULT 'stock';

-- Rejected at the database rather than trusted from the caller: an unknown mode
-- would silently fall through to "deduct nothing", which loses stock quietly.
ALTER TABLE stock DROP CONSTRAINT IF EXISTS stock_track_mode_chk;
ALTER TABLE stock ADD CONSTRAINT stock_track_mode_chk
  CHECK (track_mode IN ('stock', 'recipe', 'none'));

CREATE INDEX IF NOT EXISTS idx_stock_track_mode
  ON stock(restaurant_id, track_mode);


-- ═══════════════════════════════════════════════════
-- BACKFILL
-- A product that already has a recipe was, until now, being double-deducted.
-- Its recipe is the deliberate statement of intent, so recipe wins. Everything
-- else keeps counting units, which is what the DEFAULT already gives.
--
-- Guarded on the `recipes` table existing so this file can be run before or
-- after migration-ingredients.sql without erroring — an error here would abort
-- the rest of a combined script.
-- ═══════════════════════════════════════════════════
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = current_schema() AND table_name = 'recipes'
  ) THEN
    UPDATE stock s
    SET track_mode = 'recipe'
    WHERE s.track_mode = 'stock'
      AND EXISTS (
        SELECT 1 FROM recipes r
        WHERE r.restaurant_id = s.restaurant_id
          AND r.item_id = s.item_id
      );
  END IF;
END $$;


-- ═══════════════════════════════════════════════════
-- Useful checks after running:
--
--   SELECT track_mode, COUNT(*) FROM stock GROUP BY track_mode;
--
--   -- Products still counted by unit that also carry a recipe (should be none
--   -- straight after the backfill; any row here was set by hand afterwards, and
--   -- its recipe is used for COST only):
--   SELECT s.item_name FROM stock s
--   JOIN recipes r ON r.restaurant_id = s.restaurant_id AND r.item_id = s.item_id
--   WHERE s.track_mode = 'stock';
-- ═══════════════════════════════════════════════════
