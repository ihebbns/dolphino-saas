-- ═══════════════════════════════════════════════════
-- MIGRATION: Bidirectional rupture (out-of-stock) flag on the stock table
-- Run in Neon SQL Editor. 100% ADDITIVE and safe to re-run.
-- Existing rows, existing clients and already-deployed EXEs are unaffected.
--
-- ── WHY A TIMESTAMPED FLAG, NOT A BOOLEAN ──────────────────────────────
-- The POS and the web can both toggle availability. A plain boolean has no
-- way to resolve a near-simultaneous conflict ("who wrote last?").  A
-- nullable timestamp works as both a flag (NULL = available) and as a
-- vector clock: last-write-wins is determined by comparing rupture_at vs
-- the ts supplied by the writer.
--
-- Conflict resolution (conservative / "safety first"):
--   if POS says "rupture" and web says "available" within RUPTURE_GRACE_SECS
--   of each other, keep "rupture" until an explicit "restore" with a later ts.
--
-- ── FIELDS ─────────────────────────────────────────────────────────────
--   is_available   BOOLEAN  — materialised cache (NULL treated as TRUE)
--   rupture_at     TIMESTAMPTZ — when it was marked out of stock (NULL = in stock)
--   rupture_by     TEXT     — actor who last changed it ('pos' | 'web' | name)
--   rupture_ts     TIMESTAMPTZ — client-supplied timestamp for LWW resolution
-- ═══════════════════════════════════════════════════

ALTER TABLE stock
  ADD COLUMN IF NOT EXISTS is_available  BOOLEAN       DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS rupture_at    TIMESTAMPTZ   DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS rupture_by    VARCHAR(80)   DEFAULT '',
  ADD COLUMN IF NOT EXISTS rupture_ts    TIMESTAMPTZ   DEFAULT NULL;

-- Index so the GET endpoint can cheaply filter rupture items for the POS poll.
CREATE INDEX IF NOT EXISTS idx_stock_rupture
  ON stock(restaurant_id, is_available)
  WHERE is_available = FALSE;

-- Backfill: all existing rows are available (the flag never existed before).
UPDATE stock
SET is_available = TRUE
WHERE is_available IS NULL;
