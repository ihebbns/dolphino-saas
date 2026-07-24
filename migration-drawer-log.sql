-- ═══════════════════════════════════════════════════
-- MIGRATION: CASH DRAWER audit log  (anti-theft, web-only visibility)
-- Run in the Neon SQL Editor. Additive and safe to re-run.
--
-- ── WHY THIS EXISTS ───────────────────────────────────────────────────
-- An unexplained cash-drawer opening is a primary theft signal, which is why
-- professional systems record it as its own auditable event: Toast surfaces
-- "no-sale" events in its Cash and Loss Management reports (it calls them
-- exception reports) and gates the Drawer History report behind a dedicated
-- permission.
--
-- The POS already writes one row per drawer decision through a single choke
-- point (openDrawer()). It records the REFUSALS too — when the device setting
-- said "do not open" — because "the drawer did not open when cash moved" is
-- just as interesting as the opposite.
--
-- ── WHY IT MUST LIVE HERE AND NOT IN THE EXE ──────────────────────────
-- Owners routinely hand the EXE manager PIN to their cashiers, so anything
-- shown inside the till cannot be trusted to stay private. Whoever opens the
-- drawer must not be able to check whether it was noticed. This table is read
-- only through the owner's own web login.
-- ═══════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS drawer_events (
  id             BIGSERIAL     PRIMARY KEY,
  restaurant_id  INTEGER       NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,

  -- Why the drawer was asked to open:
  --   'cash_sale'      → a sale settled in cash
  --   'pay_in'         → cash added with no sale (ajout de fond)
  --   'pay_out'        → cash removed with no sale (retrait)
  --   'credit_payment' → a client settled an ardoise IN CASH
  --   'no_sale'        → manual open, manager-only, reason required
  reason         VARCHAR(24)   NOT NULL,

  -- Amount of cash involved. NULL for 'no_sale' (nothing is being tendered).
  amount         NUMERIC(12,3),

  -- Free-text reason. Mandatory for no_sale / pay_out in the POS UI.
  note           VARCHAR(200)  DEFAULT '',

  -- FALSE means the event was recorded but the drawer deliberately stayed shut
  -- because the device setting for that trigger was switched off. Keeping these
  -- is the point: it reveals a till configured to hide cash handling.
  opened         BOOLEAN       NOT NULL DEFAULT TRUE,

  actor          VARCHAR(80)   DEFAULT '',   -- who was logged in
  is_manager     BOOLEAN       DEFAULT FALSE,
  session_id     VARCHAR(64)   DEFAULT '',   -- links to the caisse session
  terminal_id    VARCHAR(64)   DEFAULT '',

  -- Client-generated instant. Authoritative for ordering, because a till can be
  -- offline for hours and flush later. Never sort by created_at.
  client_ts      TIMESTAMPTZ   NOT NULL,

  -- Idempotency: the POS keeps entries locally until the server confirms, so
  -- the same event WILL be re-sent after a failed round trip.
  client_uid     VARCHAR(64)   NOT NULL,

  created_at     TIMESTAMPTZ   DEFAULT NOW()
);

-- One row per event, no matter how many times the till retries.
CREATE UNIQUE INDEX IF NOT EXISTS idx_drawer_uid
  ON drawer_events(restaurant_id, client_uid);

-- Main report path: newest first for a restaurant.
CREATE INDEX IF NOT EXISTS idx_drawer_recent
  ON drawer_events(restaurant_id, client_ts DESC);

-- "Show me every manual opening" — the exception report.
CREATE INDEX IF NOT EXISTS idx_drawer_nosale
  ON drawer_events(restaurant_id, client_ts DESC)
  WHERE reason = 'no_sale';

-- Per-employee review.
CREATE INDEX IF NOT EXISTS idx_drawer_actor
  ON drawer_events(restaurant_id, actor, client_ts DESC);


-- ═══════════════════════════════════════════════════
-- Useful queries once data arrives:
--
--   -- Manual openings, most recent first
--   SELECT client_ts, actor, note FROM drawer_events
--   WHERE restaurant_id = ? AND reason = 'no_sale'
--   ORDER BY client_ts DESC;
--
--   -- Who opens the drawer outside of sales, ranked
--   SELECT actor,
--          COUNT(*) FILTER (WHERE reason = 'no_sale')  AS manual_opens,
--          COUNT(*) FILTER (WHERE reason = 'pay_out')  AS retraits,
--          COALESCE(SUM(amount) FILTER (WHERE reason = 'pay_out'), 0) AS total_retire
--   FROM drawer_events
--   WHERE restaurant_id = ?
--   GROUP BY actor ORDER BY manual_opens DESC;
--
--   -- Tills configured to NOT open on cash (possible cover-up)
--   SELECT terminal_id, actor, COUNT(*) FROM drawer_events
--   WHERE restaurant_id = ? AND opened = FALSE
--   GROUP BY terminal_id, actor;
-- ═══════════════════════════════════════════════════
