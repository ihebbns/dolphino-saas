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
