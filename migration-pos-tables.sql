-- ═══════════════════════════════════════════════════
-- MIGRATION: cross-till table state + audit trail (table-service base)
--
-- Two problems, two tables:
--
-- pos_tables    — live floor-plan state (who's on table 5, since when, what's
--                 on it), so every till and the manager's "Vue temps réel"
--                 screen agree in near-real-time, not just the till that
--                 happens to own that section. Upserted on every table
--                 mutation; last-write-wins by updated_at (a bigint epoch-ms
--                 the POS already stamps locally), guarded by the WHERE on
--                 the ON CONFLICT clause so a delayed/retried push can never
--                 clobber a newer push that already landed.
--
-- table_audit_log — append-only paper trail: every open/item-change/send/
--                 bill/payment/close, who did it, when. This is the actual
--                 loss-prevention tool — a manager compares this against
--                 camera footage by hand (no camera/AI integration here,
--                 that's a separate project). Never updated after insert,
--                 deduped by (restaurant_id, uid) so a retried push can't
--                 double-log a real event.
-- ═══════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS pos_tables (
  id             SERIAL PRIMARY KEY,
  restaurant_id  INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  table_key      VARCHAR(64) NOT NULL,
  num            INTEGER NOT NULL DEFAULT 0,
  sec            VARCHAR(80) NOT NULL DEFAULT '',
  status         VARCHAR(16) NOT NULL DEFAULT 'free',
  items          JSONB NOT NULL DEFAULT '[]',
  disc           NUMERIC(10,3) NOT NULL DEFAULT 0,
  note           TEXT DEFAULT '',
  opened_by      VARCHAR(120) DEFAULT '',
  opened_at      BIGINT,
  closed_at      BIGINT,
  order_num      INTEGER,
  sent_items     JSONB DEFAULT '[]',
  updated_at     BIGINT NOT NULL DEFAULT 0,
  UNIQUE (restaurant_id, table_key)
);
CREATE INDEX IF NOT EXISTS idx_pos_tables_restaurant ON pos_tables(restaurant_id);

CREATE TABLE IF NOT EXISTS table_audit_log (
  id             SERIAL PRIMARY KEY,
  restaurant_id  INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  uid            VARCHAR(64) NOT NULL,
  table_key      VARCHAR(64) NOT NULL,
  num            INTEGER,
  sec            VARCHAR(80),
  action         VARCHAR(24) NOT NULL,
  detail         TEXT DEFAULT '',
  actor          VARCHAR(120) DEFAULT '',
  session_id     VARCHAR(64) DEFAULT '',
  at             BIGINT NOT NULL,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (restaurant_id, uid)
);
CREATE INDEX IF NOT EXISTS idx_table_audit_restaurant_at ON table_audit_log(restaurant_id, at DESC);
