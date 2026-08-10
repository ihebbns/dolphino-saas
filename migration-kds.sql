-- ═══════════════════════════════════════════════════
-- MIGRATION: CLOUD-SYNCED KITCHEN DISPLAY SCREEN (KDS)
-- Additive and safe to re-run.
--
-- ── WHY ────────────────────────────────────────────────────────────────
-- The KDS used to live entirely in one till's localStorage — bump a
-- ticket on the register's own screen, and a SEPARATE physical kitchen
-- screen would never know, since there was no shared source of truth.
-- This table is that source of truth: any till pushes tickets here the
-- moment an order is sent to kitchen, any device (the till's own overlay,
-- or a browser tab on a cheap tablet mounted in the kitchen — see
-- /kitchen/[slug]) polls and bumps against the SAME rows.
--
-- ticket_key is the till's own client-generated id (e.g. 'k1738..._ab12')
-- — reused as the natural idempotency key, so a retried push after a
-- flaky connection can never create a duplicate ticket.
-- ═══════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS kds_tickets (
  id             BIGSERIAL     PRIMARY KEY,
  restaurant_id  INTEGER       NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,

  ticket_key     VARCHAR(64)   NOT NULL,
  num            VARCHAR(20)   DEFAULT '',   -- order number, e.g. "007" or "WEB007"
  tbl_num        INTEGER,
  tbl_sec        VARCHAR(80),
  cli_name       VARCHAR(120)  DEFAULT '',

  zone           VARCHAR(20)   NOT NULL,
  zone_label     VARCHAR(80)   DEFAULT '',
  items          JSONB         NOT NULL DEFAULT '[]',

  sent_at        TIMESTAMPTZ   NOT NULL,
  bumped         BOOLEAN       NOT NULL DEFAULT FALSE,
  bumped_at      TIMESTAMPTZ,
  bumped_by      VARCHAR(80)   DEFAULT '',

  created_at     TIMESTAMPTZ   DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_kds_ticket_key
  ON kds_tickets(restaurant_id, ticket_key);

CREATE INDEX IF NOT EXISTS idx_kds_recent
  ON kds_tickets(restaurant_id, sent_at DESC);
