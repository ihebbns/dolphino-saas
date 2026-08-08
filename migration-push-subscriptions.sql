-- ═══════════════════════════════════════════════════
-- MIGRATION: web push subscriptions for order-ready notifications
--
-- Free alternative/companion to the WhatsApp integration (see
-- SETUP-WHATSAPP.md) — no external account, no per-message cost, but only
-- works if the customer keeps /moi open (or installed to their home
-- screen) and grants notification permission. Subscriptions are scoped to
-- ONE order, not a persistent customer identity — /moi has no login, so
-- there's no stable identity to attach a long-lived subscription to, and a
-- per-order subscription is exactly the lifetime this actually needs.
-- ═══════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id             SERIAL PRIMARY KEY,
  restaurant_id  INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  order_id       BIGINT NOT NULL REFERENCES online_orders(id) ON DELETE CASCADE,
  endpoint       TEXT NOT NULL,
  p256dh         TEXT NOT NULL,
  auth           TEXT NOT NULL,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (order_id, endpoint)
);

CREATE INDEX IF NOT EXISTS idx_push_subs_order ON push_subscriptions(order_id);
