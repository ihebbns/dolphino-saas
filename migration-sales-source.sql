-- ═══════════════════════════════════════════════════
-- MIGRATION: which channel a sale actually came from
--
-- The owner's dashboard "Commandes" list already shows every sale in one
-- place — this just adds a simple filter/badge on top: 'caisse' (typed at
-- the till, the default), 'kiosk', or 'moi' (the customer's own phone/QR
-- link). Set by the POS at checkout time when a sale started life as an
-- accepted online/kiosk order (see encaisser() and
-- finalizeOnlinePaidOrderSale() — both now stamp od.source from the
-- online order they're finalizing).
-- ═══════════════════════════════════════════════════

ALTER TABLE sales ADD COLUMN IF NOT EXISTS source VARCHAR(20) NOT NULL DEFAULT 'caisse';
