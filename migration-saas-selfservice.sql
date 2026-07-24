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
