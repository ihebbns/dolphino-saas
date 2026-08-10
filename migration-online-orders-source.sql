-- ═══════════════════════════════════════════════════
-- MIGRATION: distinguish where an online order was placed from
--
-- 'kiosk' (self-order touchscreen, servio.tn/kiosk) vs 'moi' (the general
-- account-gated link/QR, servio.tn/moi) — both land in the exact same
-- online_orders queue and always have, but the pickup board and the
-- kitchen ticket prefix (see printOnlineOrderKitchenTicket in the POS)
-- now label each so staff and customers can tell them apart at a glance,
-- the same way a plain digit ticket already reads as a regular counter
-- order.
-- ═══════════════════════════════════════════════════

ALTER TABLE online_orders ADD COLUMN IF NOT EXISTS source VARCHAR(20) NOT NULL DEFAULT 'moi';
