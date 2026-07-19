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
