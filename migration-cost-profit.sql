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
