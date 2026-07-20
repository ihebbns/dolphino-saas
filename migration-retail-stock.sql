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
