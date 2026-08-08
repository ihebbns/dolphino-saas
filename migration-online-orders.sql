-- ═══════════════════════════════════════════════════
-- MIGRATION: public ordering page (Fidélité Phase 3)
--
-- Two additions:
--   restaurants.public_slug  → the URL-safe identifier used in the public
--                               page (servio.tn/moi/<slug>). Deliberately
--                               NOT the api_key — that credential drives the
--                               POS/dashboard sync and must never appear in
--                               a link a customer can screenshot or forward.
--   online_orders             → orders submitted from that public page,
--                               queued for staff to accept/reject at the
--                               till. Prices are ALWAYS recomputed
--                               server-side from the live menu at submit
--                               time — a public unauthenticated endpoint can
--                               never be trusted to report its own total.
-- ═══════════════════════════════════════════════════

ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS public_slug VARCHAR(60);
CREATE UNIQUE INDEX IF NOT EXISTS idx_restaurants_public_slug
  ON restaurants(public_slug) WHERE public_slug IS NOT NULL;

CREATE TABLE IF NOT EXISTS online_orders (
  id             BIGSERIAL     PRIMARY KEY,
  restaurant_id  INTEGER       NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,

  client_name    VARCHAR(120)  NOT NULL,
  client_phone   VARCHAR(40)   NOT NULL,

  order_type     VARCHAR(20)   NOT NULL DEFAULT 'emporter', -- sur_place | emporter | livraison
  items_json     JSONB         NOT NULL,   -- [{id,name,e,p,qty,variant}]
  total          NUMERIC(12,3) NOT NULL,
  note           VARCHAR(300)  DEFAULT '',

  -- pending -> accepted|rejected. Staff-driven, never auto-transitions.
  status         VARCHAR(20)   NOT NULL DEFAULT 'pending',
  responded_by   VARCHAR(80)   DEFAULT '',

  created_at     TIMESTAMPTZ   DEFAULT NOW(),
  responded_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_online_orders_queue
  ON online_orders(restaurant_id, status, created_at);
