-- ═══════════════════════════════════════════════════
-- MIGRATION: Credits table (client debt tracking)
-- Run in Neon SQL Editor
-- ═══════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS credits (
  id              SERIAL PRIMARY KEY,
  restaurant_id   INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  client_name     VARCHAR(100) NOT NULL,
  phone           VARCHAR(30)  DEFAULT '',
  balance         NUMERIC(10,3) DEFAULT 0,
  history         JSONB DEFAULT '[]',
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (restaurant_id, client_name)
);

CREATE INDEX IF NOT EXISTS idx_credits_restaurant ON credits(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_credits_balance ON credits(restaurant_id, balance DESC);
