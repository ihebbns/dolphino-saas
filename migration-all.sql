-- ═══════════════════════════════════════════════════════════════════════════════
-- SERVIO — ALL MIGRATIONS (run once in Neon SQL Editor)
--
-- This file concatenates every migration in the correct dependency order.
-- Every statement is idempotent (CREATE TABLE IF NOT EXISTS, CREATE OR REPLACE
-- VIEW, ADD COLUMN IF NOT EXISTS) so re-running it is safe.
--
-- Order:
--   1. database.sql          — base tables (restaurants, sales, sessions, stock)
--   2. migration-sessions.sql          — session_id linkage, multi-clôture/day
--   3. migration-credits.sql           — ardoises / receivables
--   4. migration-stock-movements.sql   — append-only stock ledger
--   5. migration-drawer-log.sql        — drawer trail (tiroir)
--   6. migration-ingredients.sql       — ingredients + recipes + views
--   7. migration-ingredient-movements.sql — ingredient ledger + deductions
--   8. migration-admin-crm.sql         — CRM fields on restaurants
--   9. migration-cost-profit.sql       — cost/profit columns on stock
--  10. migration-retail-stock.sql      — retail stock extensions
--  11. migration-demo-requests.sql     — demo form storage
--  12. migration-saas-selfservice.sql  — self-service signup
--  13. migration-product-tracking.sql — ONE tracking mode per product
-- ═══════════════════════════════════════════════════════════════════════════════


-- ═══════════════════ database.sql ═══════════════════

-- ═══════════════════════════════════════════════════
-- SERVIO OS POS SaaS — PostgreSQL Schema for Neon
-- Paste this in: neon.tech → your project → SQL Editor → Run
-- ═══════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS restaurants (
  id            SERIAL PRIMARY KEY,
  name          VARCHAR(100) NOT NULL,
  owner_email   VARCHAR(150) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  api_key       VARCHAR(64)  NOT NULL UNIQUE,
  city          VARCHAR(80)  DEFAULT '',
  phone         VARCHAR(30)  DEFAULT '',
  plan          VARCHAR(20)  DEFAULT 'active',
  config        JSONB        DEFAULT '{}',
  menu_json     JSONB        DEFAULT '{}',
  created_at    TIMESTAMPTZ  DEFAULT NOW()
);

-- config JSONB stores:
--   logo, logoLetter, tagline, currency, primaryColor,
--   managerName, managerPin, cashierName, cashierPin,
--   zone1Cats, zone2Cats, boissonCats, zone1Label, zone2Label,
--   syncEnabled
--
-- menu_json JSONB stores the full menu:
--   { "Pizza": { "icon": "🍕", "items": [...] }, ... }

CREATE TABLE IF NOT EXISTS sales (
  id            SERIAL PRIMARY KEY,
  restaurant_id INTEGER       NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  num           INTEGER       NOT NULL,
  business_date DATE          NOT NULL,
  sale_date     VARCHAR(30)   DEFAULT '',
  sale_time     VARCHAR(30)   DEFAULT '',
  items         JSONB         NOT NULL DEFAULT '[]',
  subtotal      NUMERIC(10,3) DEFAULT 0,
  discount      NUMERIC(10,3) DEFAULT 0,
  disc_pct      INTEGER       DEFAULT 0,
  grand         NUMERIC(10,3) DEFAULT 0,
  pay_method    VARCHAR(20)   DEFAULT 'cash',
  received      NUMERIC(10,3) DEFAULT 0,
  monnaie       NUMERIC(10,3) DEFAULT 0,
  order_type    VARCHAR(20)   DEFAULT 'place',
  cli_name      VARCHAR(100)  DEFAULT '',
  cli_tel       VARCHAR(30)   DEFAULT '',
  cashier       VARCHAR(80)   DEFAULT '',
  synced_at     TIMESTAMPTZ   DEFAULT NOW(),
  UNIQUE (restaurant_id, num, business_date)
);

CREATE INDEX IF NOT EXISTS idx_sales_restaurant_date
  ON sales(restaurant_id, business_date);

-- ── DRINK STOCK ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS stock (
  id            SERIAL PRIMARY KEY,
  restaurant_id INTEGER      NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  item_id       VARCHAR(64)  NOT NULL,
  item_name     VARCHAR(100) NOT NULL,
  item_emoji    VARCHAR(10)  DEFAULT '🥤',
  quantity      INTEGER      NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ  DEFAULT NOW(),
  UNIQUE (restaurant_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_stock_restaurant ON stock(restaurant_id);

-- ── DAY CLOSURES ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS day_closures (
  id            SERIAL PRIMARY KEY,
  restaurant_id INTEGER       NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  business_date DATE          NOT NULL,
  closed_at     TIMESTAMPTZ   DEFAULT NOW(),
  total         NUMERIC(10,3) DEFAULT 0,
  orders_count  INTEGER       DEFAULT 0,
  cash_total    NUMERIC(10,3) DEFAULT 0,
  card_total    NUMERIC(10,3) DEFAULT 0,
  mobile_total  NUMERIC(10,3) DEFAULT 0,
  fond_initial  NUMERIC(10,3) DEFAULT 0,
  montant_compte NUMERIC(10,3) DEFAULT 0,
  theorique     NUMERIC(10,3) DEFAULT 0,
  ecart         NUMERIC(10,3) DEFAULT 0,
  cashier       VARCHAR(80)   DEFAULT '',
  UNIQUE (restaurant_id, business_date)
);

-- ── SESSIONS (one per service/shift) ─────────────────
CREATE TABLE IF NOT EXISTS sessions (
  id             SERIAL PRIMARY KEY,
  restaurant_id  INTEGER       NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  business_date  DATE          NOT NULL,
  cashier        VARCHAR(80)   DEFAULT '',
  opened_at      TIMESTAMPTZ   DEFAULT NOW(),
  closed_at      TIMESTAMPTZ,
  fond_initial   NUMERIC(10,3) DEFAULT 0,
  total_sales    NUMERIC(10,3) DEFAULT 0,
  orders_count   INTEGER       DEFAULT 0,
  cash_sales     NUMERIC(10,3) DEFAULT 0,
  card_sales     NUMERIC(10,3) DEFAULT 0,
  mobile_sales   NUMERIC(10,3) DEFAULT 0,
  montant_compte NUMERIC(10,3),
  theorique      NUMERIC(10,3),
  ecart          NUMERIC(10,3),
  UNIQUE (restaurant_id, business_date)
);

CREATE INDEX IF NOT EXISTS idx_sessions_restaurant ON sessions(restaurant_id);

-- Test restaurant — password is: dolphino123
INSERT INTO restaurants (name, owner_email, password_hash, api_key, city, phone, plan)
VALUES (
  'Dolphino Restaurant',
  'iheb@dolphino.tn',
  '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uZutLjAu2',
  'DOLPH-TEST-KEY-001',
  'Kelibia',
  '+216 XX XXX XXX',
  'active'
) ON CONFLICT DO NOTHING;


-- ═══════════════════════════════════════════════════
-- MIGRATION: Add config + menu_json columns (run if upgrading existing DB)
-- ═══════════════════════════════════════════════════
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS config    JSONB DEFAULT '{}';
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS menu_json JSONB DEFAULT '{}';


-- ═══════════════════════════════════════════════════
-- MIGRATION: Add suspend_at for scheduled suspension
-- ═══════════════════════════════════════════════════
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS suspend_at TIMESTAMPTZ DEFAULT NULL;
-- plan values: 'active', 'suspended' (both), 'suspended_exe' (EXE only), 'suspended_dash' (dashboard only)


-- ═══════════════════════════════════════════════════
-- MIGRATION: Allow same ticket number from different cashiers (multi-terminal)
-- ═══════════════════════════════════════════════════
ALTER TABLE sales DROP CONSTRAINT IF EXISTS sales_restaurant_id_num_business_date_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_unique_per_cashier ON sales(restaurant_id, num, business_date, cashier);


-- ═══════════════════════════════════════════════════
-- MIGRATION: Add session_id to sales (links each sale to its caisse session)
-- Uses a stable client-generated key (e.g. "S1784xxxx_ab12c") sent by the POS
-- with every sale AND with the clôture, so the dashboard can group orders
-- by the exact caisse session they belong to.
-- ═══════════════════════════════════════════════════
ALTER TABLE sales    ADD COLUMN IF NOT EXISTS session_id VARCHAR(64) DEFAULT '';
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS session_id VARCHAR(64) DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_sales_session    ON sales(session_id);
CREATE INDEX IF NOT EXISTS idx_sessions_session ON sessions(session_id);


-- ═══════════════════ migration-sessions.sql ═══════════════════

-- ═══════════════════════════════════════════════════
-- MIGRATION: Per-caissier sessions + session_id linkage
-- Run this ONCE in Neon → SQL Editor
-- ═══════════════════════════════════════════════════

-- 1) Link each sale to its exact caisse session (stable client key)
ALTER TABLE sales    ADD COLUMN IF NOT EXISTS session_id VARCHAR(64) DEFAULT '';
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS session_id VARCHAR(64) DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_sales_session    ON sales(session_id);
CREATE INDEX IF NOT EXISTS idx_sessions_session ON sessions(session_id);

-- 2) Allow MULTIPLE sessions per day (multiple caissiers / shifts).
--    Without this, a second clôture the same day overwrites the first one.
ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_restaurant_id_business_date_key;

-- 3) (Safety) make sure sales can hold same ticket number from different cashiers
ALTER TABLE sales DROP CONSTRAINT IF EXISTS sales_restaurant_id_num_business_date_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_unique_per_cashier
  ON sales(restaurant_id, num, business_date, cashier);


-- ═══════════════════ migration-credits.sql ═══════════════════

-- ═══════════════════════════════════════════════════
-- MIGRATION: CLIENT CREDIT (ardoises / accounts receivable)
-- Run in the Neon SQL Editor. Additive and safe to re-run.
--
-- ── WHY THIS EXISTS ───────────────────────────────────────────────────
-- Until now an ardoise lived ONLY in one till's localStorage key
-- 'servio-credits-v1'. No table, no endpoint, no sync. If that machine died,
-- was stolen, or had its browser data cleared, the record of who owes money was
-- gone — and the owner could never see it from the web. For a café running
-- ardoises this is usually the most valuable list in the business.
--
-- ── OWNERSHIP (see ARCHITECTURE.md §2) ────────────────────────────────
-- The EXE owns credit: an ardoise is opened, charged and settled at the counter.
-- The web READS it. The web may never invent a credit sale, exactly as it may
-- never invent a stock sale.
--
-- ── TWO TABLES, MIRRORING THE STOCK DESIGN (§6) ───────────────────────
--   credits            → current balance per client (a CACHE, pushed by the POS)
--   credit_movements    → append-only history, the auditable truth
-- Keeping both lets the web detect drift between what the till says a client
-- owes and what the movements add up to. A mismatch is worth investigating.
--
-- ACCOUNTING RULE the movements encode (§3): a credit sale increases the debt
-- and counts as revenue on the day of the sale; a repayment decreases the debt
-- and is a cash pay-in, NEVER a second sale. Otherwise the same money is counted
-- twice in revenue.
-- ═══════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS credits (
  id             BIGSERIAL     PRIMARY KEY,
  restaurant_id  INTEGER       NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,

  -- Stable per-client key generated by the POS. The POS previously identified a
  -- client only by array position, which cannot survive a sync, so new clients
  -- carry a `cid` and older ones get a deterministic slug of their name.
  client_key     VARCHAR(64)   NOT NULL,

  name           VARCHAR(120)  NOT NULL,
  phone          VARCHAR(40)   DEFAULT '',

  -- What the till says is owed right now. Cache: the movements are the truth.
  balance        NUMERIC(12,3) NOT NULL DEFAULT 0,

  -- Set when the client is removed on the till. Kept rather than deleted: a
  -- deleted ardoise that still had a balance is itself a finding.
  archived       BOOLEAN       NOT NULL DEFAULT FALSE,
  archived_at    TIMESTAMPTZ,

  terminal_id    VARCHAR(64)   DEFAULT '',
  client_ts      TIMESTAMPTZ,                -- last change according to the till
  updated_at     TIMESTAMPTZ   DEFAULT NOW(),
  created_at     TIMESTAMPTZ   DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_credits_key
  ON credits(restaurant_id, client_key);

-- "Who owes me money", biggest debt first — the main report.
CREATE INDEX IF NOT EXISTS idx_credits_balance
  ON credits(restaurant_id, balance DESC)
  WHERE archived = FALSE;


CREATE TABLE IF NOT EXISTS credit_movements (
  id             BIGSERIAL     PRIMARY KEY,
  restaurant_id  INTEGER       NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  client_key     VARCHAR(64)   NOT NULL,

  --   'credit'  → goods taken on account. Debt UP.   (delta > 0)
  --   'payment' → client settled part or all.  Debt DOWN. (delta < 0)
  --   'adjust'  → manual correction, reason required.
  kind           VARCHAR(16)   NOT NULL,

  -- Signed change to the debt, so SUM(delta) is the balance.
  delta          NUMERIC(12,3) NOT NULL,

  -- How a repayment arrived. Only 'cash' puts money in the drawer, which is why
  -- the POS opens the drawer for cash settlements only.
  pay_method     VARCHAR(20)   DEFAULT '',

  -- Human-readable summary of the goods, for a credit sale.
  items_summary  VARCHAR(400)  DEFAULT '',
  sale_num       INTEGER,                    -- ticket number when it was a sale
  reason         VARCHAR(200)  DEFAULT '',

  actor          VARCHAR(80)   DEFAULT '',   -- who was logged in at the till
  session_id     VARCHAR(64)   DEFAULT '',
  terminal_id    VARCHAR(64)   DEFAULT '',

  -- Authoritative for ordering. A till can be offline for hours and flush later,
  -- so never sort this table by created_at.
  client_ts      TIMESTAMPTZ   NOT NULL,

  -- Idempotency: the POS re-sends until the server confirms.
  client_uid     VARCHAR(64)   NOT NULL,

  created_at     TIMESTAMPTZ   DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_creditmov_uid
  ON credit_movements(restaurant_id, client_uid);

CREATE INDEX IF NOT EXISTS idx_creditmov_client
  ON credit_movements(restaurant_id, client_key, client_ts DESC);

CREATE INDEX IF NOT EXISTS idx_creditmov_recent
  ON credit_movements(restaurant_id, client_ts DESC);


-- ═══════════════════════════════════════════════════
-- VIEW: balance derived from the movements, next to the balance the till
-- reported. `drift` should always be 0; anything else means the till's cache and
-- its own history disagree, which is worth a look.
-- ═══════════════════════════════════════════════════
CREATE OR REPLACE VIEW credit_reconciliation AS
SELECT
  c.restaurant_id,
  c.client_key,
  c.name,
  c.phone,
  c.balance                                             AS balance_pos,
  COALESCE(m.derived, 0)                                AS balance_derived,
  c.balance - COALESCE(m.derived, 0)                    AS drift,
  COALESCE(m.nb_credits, 0)                             AS nb_credits,
  COALESCE(m.nb_payments, 0)                            AS nb_payments,
  COALESCE(m.total_credit, 0)                           AS total_pris,
  COALESCE(m.total_paid, 0)                             AS total_regle,
  m.last_movement_at,
  c.archived
FROM credits c
LEFT JOIN (
  SELECT restaurant_id,
         client_key,
         SUM(delta)                                              AS derived,
         COUNT(*) FILTER (WHERE kind = 'credit')::int             AS nb_credits,
         COUNT(*) FILTER (WHERE kind = 'payment')::int            AS nb_payments,
         COALESCE(SUM(delta) FILTER (WHERE delta > 0), 0)         AS total_credit,
         COALESCE(SUM(-delta) FILTER (WHERE delta < 0), 0)        AS total_paid,
         MAX(client_ts)                                           AS last_movement_at
  FROM credit_movements
  GROUP BY restaurant_id, client_key
) m ON m.restaurant_id = c.restaurant_id AND m.client_key = c.client_key;


-- ═══════════════════════════════════════════════════
-- Useful queries once data arrives:
--
--   -- Total receivable (créances) outstanding
--   SELECT COALESCE(SUM(balance),0) FROM credits
--   WHERE restaurant_id = ? AND archived = FALSE AND balance > 0;
--
--   -- Debts the till and its own history disagree about
--   SELECT * FROM credit_reconciliation
--   WHERE restaurant_id = ? AND ABS(drift) > 0.001;
--
--   -- Archived clients who still owed money when they were deleted
--   SELECT name, balance, archived_at FROM credits
--   WHERE restaurant_id = ? AND archived = TRUE AND balance > 0;
--
--   -- Oldest untouched debts (chase list)
--   SELECT r.name, r.balance_pos, r.last_movement_at
--   FROM credit_reconciliation r
--   WHERE r.restaurant_id = ? AND r.archived = FALSE AND r.balance_pos > 0
--   ORDER BY r.last_movement_at NULLS FIRST;
-- ═══════════════════════════════════════════════════


-- ═══════════════════ migration-stock-movements.sql ═══════════════════

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


-- ═══════════════════ migration-drawer-log.sql ═══════════════════

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


-- ═══════════════════ migration-ingredients.sql ═══════════════════

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


-- ═══════════════════ migration-ingredient-movements.sql ═══════════════════

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


-- ═══════════════════ migration-admin-crm.sql ═══════════════════

-- ═══════════════════════════════════════════════════
-- MIGRATION: Admin CRM columns on restaurants
-- Run in Neon SQL Editor. 100% ADDITIVE and safe to re-run.
--
-- Turns the client list into a real sales tool: notes, next contact date,
-- what the client needs, their status from your perspective.
-- ═══════════════════════════════════════════════════

-- When you plan to call/visit this client next.
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS next_contact    DATE;

-- Free-form notes visible only to admin. What was discussed, what they asked for.
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS admin_notes     TEXT DEFAULT '';

-- What they still need from you (comma-separated tags or free text).
-- e.g. "installation imprimante, formation caissier, mise à jour EXE"
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS needs           TEXT DEFAULT '';

-- Your sales status for this lead/client.
-- 'prospect' | 'trial' | 'active' | 'churned' | 'paused'
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS crm_status      VARCHAR(20) DEFAULT 'active';

-- When you last interacted with them (updated by you manually from the CRM).
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS last_contact    DATE;

-- Monthly price they pay (so you see revenue at a glance).
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS monthly_price   NUMERIC(8,3) DEFAULT 0;


-- ═══════════════════ migration-cost-profit.sql ═══════════════════

-- ═══════════════════════════════════════════════════
-- MIGRATION: Cost / COGS + day-accurate profit analytics (WEB side)
-- Run in Neon SQL Editor. 100% ADDITIVE — safe to run on the LIVE DB and
-- safe to re-run (every statement is ADD COLUMN IF NOT EXISTS). Existing rows,
-- existing clients and old POS builds are completely unaffected.
--
-- ── CORE IDEA ──────────────────────────────────────────
-- Daily profit is computed from the product cost that was FROZEN into each
-- sale line at sale time (stored per line inside sales.items[].c). Changing a
-- product's cost later must NEVER alter any past day. The columns below store
-- the CURRENT cost catalog (used only for FUTURE sales + stock valuation) and
-- an OPTIONAL per-sale COGS snapshot the POS may send.
-- ═══════════════════════════════════════════════════

-- ── sales.cogs ─────────────────────────────────────────
-- Optional cost-of-goods-sold total for the ticket, as sent by the POS at sale
-- time (a snapshot — NOT recomputed from the current catalog). The dashboard
-- still derives COGS from items[].c for day-accurate profit; this column is a
-- convenience/cross-check field. Old POS clients that don't send it default 0.
ALTER TABLE sales ADD COLUMN IF NOT EXISTS cogs NUMERIC(10,3) DEFAULT 0;

-- ── stock: current cost catalog ────────────────────────
-- cost / sell_price / category / barcode may already exist (see
-- migration-retail-stock.sql). Repeating them here with IF NOT EXISTS is a
-- no-op when present and keeps THIS migration self-contained.
ALTER TABLE stock ADD COLUMN IF NOT EXISTS cost          NUMERIC(10,3) DEFAULT 0;      -- prix d'achat actuel (unitaire)
ALTER TABLE stock ADD COLUMN IF NOT EXISTS sell_price    NUMERIC(10,3) DEFAULT 0;      -- prix de vente actuel (unitaire)
ALTER TABLE stock ADD COLUMN IF NOT EXISTS category      VARCHAR(80)   DEFAULT '';     -- rayon / catégorie
ALTER TABLE stock ADD COLUMN IF NOT EXISTS barcode       VARCHAR(64)   DEFAULT '';     -- code-barres
ALTER TABLE stock ADD COLUMN IF NOT EXISTS tracked       BOOLEAN       DEFAULT true;   -- suivi de stock activé (oui/non)
ALTER TABLE stock ADD COLUMN IF NOT EXISTS low_threshold INTEGER       DEFAULT 5;      -- seuil d'alerte "stock bas"

-- Note: changing stock.cost only affects FUTURE sales. Past days stay locked
-- because their cost is frozen inside sales.items[].c at the moment of sale.


-- ═══════════════════ migration-retail-stock.sql ═══════════════════

-- ═══════════════════════════════════════════════════
-- MIGRATION: Expand stock table for retail (parapharmacie, superette, etc.)
-- Adds barcode, cost (prix achat), category, and sell_price columns
-- Run this in Neon SQL Editor after the base schema
-- ═══════════════════════════════════════════════════

ALTER TABLE stock ADD COLUMN IF NOT EXISTS barcode    VARCHAR(64)   DEFAULT '';
ALTER TABLE stock ADD COLUMN IF NOT EXISTS cost       NUMERIC(10,3) DEFAULT 0;
ALTER TABLE stock ADD COLUMN IF NOT EXISTS category   VARCHAR(100)  DEFAULT '';
ALTER TABLE stock ADD COLUMN IF NOT EXISTS sell_price NUMERIC(10,3) DEFAULT 0;

-- Index for barcode lookup (fast scan search from dashboard)
CREATE INDEX IF NOT EXISTS idx_stock_barcode ON stock(restaurant_id, barcode) WHERE barcode != '';


-- ═══════════════════ migration-demo-requests.sql ═══════════════════

-- ═══════════════════════════════════════════════════
-- MIGRATION: Demo requests table
-- Stores potential client form submissions from /demo page
-- Run in Neon SQL Editor
-- ═══════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS demo_requests (
  id               SERIAL PRIMARY KEY,
  business_name    VARCHAR(100) NOT NULL,
  business_type    VARCHAR(50)  DEFAULT 'restaurant',
  owner_name       VARCHAR(100) DEFAULT '',
  phone            VARCHAR(30)  NOT NULL,
  email            VARCHAR(150) DEFAULT '',
  city             VARCHAR(80)  DEFAULT '',
  address          VARCHAR(200) DEFAULT '',
  table_count      INTEGER      DEFAULT 0,
  employee_count   INTEGER      DEFAULT 0,
  current_system   VARCHAR(200) DEFAULT '',
  main_problem     TEXT         DEFAULT '',
  has_computer     VARCHAR(50)  DEFAULT '',
  has_printer      VARCHAR(50)  DEFAULT '',
  has_cash_drawer  VARCHAR(50)  DEFAULT '',
  has_scanner      VARCHAR(50)  DEFAULT '',
  other_hardware   VARCHAR(300) DEFAULT '',
  menu_categories  VARCHAR(500) DEFAULT '',
  menu_notes       TEXT         DEFAULT '',
  features         JSONB        DEFAULT '[]',
  notes            TEXT         DEFAULT '',
  status           VARCHAR(20)  DEFAULT 'new',  -- new, contacted, demo_done, converted, rejected
  created_at       TIMESTAMPTZ  DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_demo_requests_status ON demo_requests(status);
CREATE INDEX IF NOT EXISTS idx_demo_requests_date ON demo_requests(created_at DESC);


-- ═══════════════════ migration-saas-selfservice.sql ═══════════════════

-- ═══════════════════════════════════════════════════
-- MIGRATION: Self-service SaaS (signup + trial + Stripe billing)
-- Run in Neon SQL Editor. 100% ADDITIVE — safe on the live DB.
-- Existing clients (plan='active', no modules in config) are unaffected.
-- ═══════════════════════════════════════════════════

-- Free-trial expiry timestamp (NULL for existing/manual clients)
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ DEFAULT NULL;

-- Subscription tier chosen at signup / checkout (starter | pro | ...)
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS plan_tier VARCHAR(20) DEFAULT 'starter';

-- Stripe references (filled by the billing webhook)
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS stripe_customer_id     VARCHAR(80) DEFAULT NULL;
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS stripe_subscription_id VARCHAR(80) DEFAULT NULL;

-- Business vertical chosen at signup (fastfood | cafe | retail) — drives default modules
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS business_type VARCHAR(20) DEFAULT 'fastfood';

-- Track when the current subscription period ends (optional, from Stripe)
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS current_period_end TIMESTAMPTZ DEFAULT NULL;

-- ── plan values now in use ─────────────────────────────
--   'active'          → paid / manually-provisioned client (existing behavior, unchanged)
--   'trial'           → self-service signup inside the free-trial window
--   'trial_expired'   → trial ended, no active subscription (app locked, dashboard open to upgrade)
--   'suspended'       → both app + dashboard locked
--   'suspended_exe'   → POS app locked, dashboard still open
--   'suspended_dash'  → dashboard locked, POS app still open
--
-- ── config JSONB now may also store ────────────────────
--   modules: { tables, barcode, credit, stockTracking, poleDisplay,
--              kitchenTickets, printEnabled, dashboard, menuManage }  (booleans)
--   tableCount (int), sections (text[])
-- Existing clients have no `modules` key → the POS keeps its built-in defaults.


-- ═══════════════════ migration-product-tracking.sql ═══════════════════

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
