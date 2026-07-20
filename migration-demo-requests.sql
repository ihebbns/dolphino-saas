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
