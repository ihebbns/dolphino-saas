-- ═══════════════════════════════════════════════════
-- MIGRATION: Append-only STOCK MOVEMENTS ledger (anti-theft audit trail)
-- Run in Neon SQL Editor. 100% ADDITIVE and safe to re-run.
-- Existing rows, existing clients and already-deployed EXEs are unaffected.
--
-- ── WHY A LEDGER INSTEAD OF A QUANTITY COLUMN ──────────────────────────
-- Today stock.quantity is overwritten in place:
--   POST  /api/stock  → sets an ABSOLUTE quantity
--   PATCH /api/stock  → quantity = GREATEST(0, quantity - qty)
-- Both lose data the moment there are two terminals, or one terminal flushes
-- an offline queue: whoever writes last wins and the other sale vanishes. It
-- also leaves no trace of WHO changed a quantity, so a cashier can cover a
-- theft by editing 10 down to 7 and nothing remembers.
--
-- This ledger fixes both. Every change is an immutable row saying what moved,
-- how much, why, who did it and when. Nothing is ever overwritten.
--
-- ── HOW A QUANTITY IS DERIVED ─────────────────────────────────────────
--   quantity = <value of the most recent 'count'> + SUM(deltas recorded after it)
-- If a product has no count yet, the sum starts from zero. This is the same
-- checkpoint model professional inventory systems use, and it is what makes
-- out-of-order arrivals (offline sales!) safe: each movement carries a
-- CLIENT-generated timestamp so the server can sequence them correctly no
-- matter what order they land in.
--
-- stock.quantity is KEPT as a materialised cache so every existing endpoint
-- and every deployed EXE keeps working unchanged. The API refreshes it after
-- each movement.
-- ═══════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS stock_movements (
  id             BIGSERIAL     PRIMARY KEY,
  restaurant_id  INTEGER       NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  item_id        VARCHAR(64)   NOT NULL,

  -- What kind of movement this is:
  --   'sale'    → sold to a customer (negative delta, written by the POS)
  --   'receive' → delivery / restock  (positive delta)
  --   'waste'   → breakage, spoilage, offered  (negative delta)
  --   'adjust'  → manual correction  (signed delta, reason required)
  --   'return'  → customer return / cancelled sale (positive delta)
  --   'count'   → physical count. Resets the running total (uses count_value).
  kind           VARCHAR(16)   NOT NULL,

  -- Signed change, for every kind EXCEPT 'count'. NULL on a count row so it is
  -- naturally excluded from SUM(delta).
  delta          NUMERIC(12,3),

  -- Absolute counted value, ONLY for kind='count'.
  count_value    NUMERIC(12,3),

  -- What the system believed the quantity was at the moment of a count, frozen
  -- here so the écart stays historically accurate forever (same principle as
  -- the cash clôture storing theorique alongside montant_compte).
  expected_value NUMERIC(12,3),

  reason         VARCHAR(200)  DEFAULT '',
  actor          VARCHAR(80)   DEFAULT '',      -- who: cashier/manager name, or 'web'
  source         VARCHAR(16)   DEFAULT 'pos',   -- 'pos' | 'web'
  terminal_id    VARCHAR(64)   DEFAULT '',      -- which caisse, for multi-terminal
  session_id     VARCHAR(64)   DEFAULT '',      -- links to the caisse session
  sale_num       INTEGER,                       -- ticket number, for 'sale' rows

  -- Client-generated instant. REQUIRED: this is what makes offline replay and
  -- multi-terminal sequencing correct. Never use created_at for ordering.
  client_ts      TIMESTAMPTZ   NOT NULL,

  -- Idempotency key so replaying a queued offline movement cannot double-apply.
  client_uid     VARCHAR(64)   DEFAULT '',

  created_at     TIMESTAMPTZ   DEFAULT NOW()
);

-- Reporting / quantity derivation path.
CREATE INDEX IF NOT EXISTS idx_stockmov_item
  ON stock_movements(restaurant_id, item_id, client_ts DESC);

-- Audit-trail listing (newest first for the whole restaurant).
CREATE INDEX IF NOT EXISTS idx_stockmov_recent
  ON stock_movements(restaurant_id, client_ts DESC);

-- Finding the latest checkpoint per product quickly.
CREATE INDEX IF NOT EXISTS idx_stockmov_counts
  ON stock_movements(restaurant_id, item_id, client_ts DESC)
  WHERE kind = 'count';

-- Idempotency: the same client_uid can never be inserted twice. Partial index
-- so blank uids (legacy / server-generated rows) are not constrained.
CREATE UNIQUE INDEX IF NOT EXISTS idx_stockmov_uid
  ON stock_movements(restaurant_id, client_uid)
  WHERE client_uid <> '';


-- ═══════════════════════════════════════════════════
-- SEED: turn every existing stock.quantity into an opening 'count' checkpoint
-- so the switch to the ledger loses nothing. Guarded — a product that already
-- has any movement is skipped, which makes this whole migration re-runnable.
-- ═══════════════════════════════════════════════════
INSERT INTO stock_movements
  (restaurant_id, item_id, kind, count_value, expected_value, reason, actor, source, client_ts, client_uid)
SELECT
  s.restaurant_id,
  s.item_id,
  'count',
  COALESCE(s.quantity, 0),
  COALESCE(s.quantity, 0),          -- no history to compare against yet → écart 0
  'Solde initial (migration)',
  'system',
  'web',
  COALESCE(s.updated_at, NOW()),
  'seed_' || s.restaurant_id || '_' || s.item_id
FROM stock s
WHERE NOT EXISTS (
  SELECT 1 FROM stock_movements m
  WHERE m.restaurant_id = s.restaurant_id AND m.item_id = s.item_id
)
ON CONFLICT DO NOTHING;


-- ═══════════════════════════════════════════════════
-- VIEW: quantity derived from the ledger.
-- Used to verify the materialised stock.quantity cache and to build the
-- théorique-vs-réel report. Recreated on every run so it always matches
-- the code that reads it.
-- ═══════════════════════════════════════════════════
CREATE OR REPLACE VIEW stock_derived AS
WITH last_count AS (
  SELECT DISTINCT ON (restaurant_id, item_id)
         restaurant_id, item_id, count_value, client_ts
  FROM stock_movements
  WHERE kind = 'count'
  ORDER BY restaurant_id, item_id, client_ts DESC, id DESC
)
SELECT
  m.restaurant_id,
  m.item_id,
  COALESCE(lc.count_value, 0)
    + COALESCE(SUM(m.delta) FILTER (
        WHERE lc.client_ts IS NULL OR m.client_ts > lc.client_ts
      ), 0)                                   AS quantity,
  lc.client_ts                                AS last_count_at,
  COALESCE(lc.count_value, 0)                 AS last_count_value,
  -- Movement totals SINCE the last count, which is what a variance report needs.
  COALESCE(SUM(-m.delta) FILTER (WHERE m.kind = 'sale'    AND (lc.client_ts IS NULL OR m.client_ts > lc.client_ts)), 0) AS sold_since,
  COALESCE(SUM( m.delta) FILTER (WHERE m.kind = 'receive' AND (lc.client_ts IS NULL OR m.client_ts > lc.client_ts)), 0) AS received_since,
  COALESCE(SUM(-m.delta) FILTER (WHERE m.kind = 'waste'   AND (lc.client_ts IS NULL OR m.client_ts > lc.client_ts)), 0) AS wasted_since,
  COALESCE(SUM( m.delta) FILTER (WHERE m.kind = 'adjust'  AND (lc.client_ts IS NULL OR m.client_ts > lc.client_ts)), 0) AS adjusted_since
FROM stock_movements m
LEFT JOIN last_count lc
       ON lc.restaurant_id = m.restaurant_id
      AND lc.item_id       = m.item_id
GROUP BY m.restaurant_id, m.item_id, lc.count_value, lc.client_ts;


-- ═══════════════════════════════════════════════════
-- Sanity check after running (should return no rows once the API is deployed):
--   SELECT s.item_id, s.quantity AS cached, d.quantity AS derived
--   FROM stock s JOIN stock_derived d
--     ON d.restaurant_id = s.restaurant_id AND d.item_id = s.item_id
--   WHERE s.quantity <> d.quantity;
-- ═══════════════════════════════════════════════════
