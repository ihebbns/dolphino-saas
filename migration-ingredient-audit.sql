-- Ingredient lifecycle audit: creation, edits, archive and restore.
-- Safe to run more than once. Quantity changes remain in ingredient_movements.

CREATE TABLE IF NOT EXISTS ingredient_events (
  id            BIGSERIAL PRIMARY KEY,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  ing_key       VARCHAR(64) NOT NULL,
  kind          VARCHAR(16) NOT NULL CHECK (kind IN ('created','updated','archived','restored')),
  reason        VARCHAR(200) DEFAULT '',
  actor         VARCHAR(80) DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ingevent_recent
  ON ingredient_events(restaurant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ingevent_ingredient
  ON ingredient_events(restaurant_id, ing_key, created_at DESC);
