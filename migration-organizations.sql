-- ═══════════════════════════════════════════════════
-- MIGRATION: Organizations (optional multi-location support)
-- Run in Neon SQL Editor. 100% ADDITIVE and safe to re-run.
--
-- Lets one owner log in once and manage several restaurants. Purely
-- additive: existing single-location restaurants (organization_id stays
-- NULL) are completely unaffected — every /api/me/*, /api/sync,
-- /api/dashboard etc. route keeps resolving restaurant_id from api_key
-- exactly as before, unaware this table even exists.
-- ═══════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS organizations (
  id            SERIAL PRIMARY KEY,
  name          VARCHAR(100) NOT NULL,
  owner_email   VARCHAR(150) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  created_at    TIMESTAMPTZ  DEFAULT NOW()
);

-- Nullable, additive link. NULL = today's exact single-restaurant behavior.
-- ON DELETE SET NULL (not CASCADE) — deleting an org must never cascade-
-- delete a restaurant and its sales/stock history.
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS organization_id INTEGER
  REFERENCES organizations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_restaurants_org_id ON restaurants(organization_id);
