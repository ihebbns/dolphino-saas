-- ═══════════════════════════════════════════════════
-- MIGRATION: CLIENT WALLET (carte de fidélité prépayée)
-- Additive and safe to re-run. Same two-table shape as migration-credits.sql,
-- deliberately — a wallet is the mirror image of an ardoise: a BALANCE THE
-- CLIENT OWNS instead of a debt they owe, but the ownership/sync/replay rules
-- are identical.
--
-- ── OWNERSHIP ──────────────────────────────────────────────────────────
-- The EXE owns the wallet exactly as it owns credit: a recharge is taken and a
-- spend happens at the counter. This endpoint is WRITE-from-POS / READ-for-owner.
--
-- ── THE 30% BONUS ─────────────────────────────────────────────────────
-- Computed on the TILL, same as a credit sale amount is computed on the till —
-- the server trusts what it's told, exactly as it already does for credits.
-- A 100 DT recharge becomes a 130 DT 'topup' movement; the extra 30 DT is not a
-- separate line, it's just already inside the delta the till sends.
--
--   wallets           → current balance per client (a CACHE, pushed by the POS)
--   wallet_movements   → append-only history, the auditable truth
--     'topup'  → client paid in, balance UP (delta > 0, already includes bonus)
--     'spend'  → paid for a sale with wallet balance, balance DOWN (delta < 0)
--     'adjust' → manual correction, reason required
--     'bonus'  → monthly spend-tier reward, credited by the WEB (not the till) —
--                the one case where the web is allowed to write a movement,
--                since it's the only side that can compute a month of sales
-- ═══════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS wallets (
  id             BIGSERIAL     PRIMARY KEY,
  restaurant_id  INTEGER       NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,

  client_key     VARCHAR(64)   NOT NULL,
  name           VARCHAR(120)  NOT NULL,
  phone          VARCHAR(40)   DEFAULT '',

  -- What the till says the client has available right now. Cache: the
  -- movements are the truth.
  balance        NUMERIC(12,3) NOT NULL DEFAULT 0,

  archived       BOOLEAN       NOT NULL DEFAULT FALSE,
  archived_at    TIMESTAMPTZ,

  terminal_id    VARCHAR(64)   DEFAULT '',
  client_ts      TIMESTAMPTZ,
  updated_at     TIMESTAMPTZ   DEFAULT NOW(),
  created_at     TIMESTAMPTZ   DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_wallets_key
  ON wallets(restaurant_id, client_key);

CREATE INDEX IF NOT EXISTS idx_wallets_balance
  ON wallets(restaurant_id, balance DESC)
  WHERE archived = FALSE;


CREATE TABLE IF NOT EXISTS wallet_movements (
  id             BIGSERIAL     PRIMARY KEY,
  restaurant_id  INTEGER       NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  client_key     VARCHAR(64)   NOT NULL,

  kind           VARCHAR(16)   NOT NULL,   -- topup | spend | adjust | bonus
  delta          NUMERIC(12,3) NOT NULL,   -- signed change to the balance

  pay_method     VARCHAR(20)   DEFAULT '', -- how a topup arrived (cash/card)
  -- Real money paid, for a 'topup' — separate from `delta` (the bonus-inclusive
  -- credited amount). NULL for non-topup kinds. See migration-wallet-paid-amount.sql
  -- for why this must stay distinct from delta: reward-tier eligibility (Phase 2)
  -- is computed on this, never on delta, or the bonus would earn more bonus.
  paid_amount    NUMERIC(12,3),
  items_summary  VARCHAR(400)  DEFAULT '', -- goods bought, for a spend
  sale_num       INTEGER,
  reason         VARCHAR(200)  DEFAULT '',

  actor          VARCHAR(80)   DEFAULT '',
  session_id     VARCHAR(64)   DEFAULT '',
  terminal_id    VARCHAR(64)   DEFAULT '',

  client_ts      TIMESTAMPTZ   NOT NULL,
  client_uid     VARCHAR(64)   NOT NULL,

  created_at     TIMESTAMPTZ   DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_walletmov_uid
  ON wallet_movements(restaurant_id, client_uid);

CREATE INDEX IF NOT EXISTS idx_walletmov_client
  ON wallet_movements(restaurant_id, client_key, client_ts DESC);

CREATE INDEX IF NOT EXISTS idx_walletmov_recent
  ON wallet_movements(restaurant_id, client_ts DESC);


-- ═══════════════════════════════════════════════════
-- VIEW: balance derived from the movements, next to the balance the till
-- reported — same reconciliation idea as credit_reconciliation.
-- ═══════════════════════════════════════════════════
CREATE OR REPLACE VIEW wallet_reconciliation AS
SELECT
  w.restaurant_id,
  w.client_key,
  w.name,
  w.phone,
  w.balance                                             AS balance_pos,
  COALESCE(m.derived, 0)                                AS balance_derived,
  w.balance - COALESCE(m.derived, 0)                    AS drift,
  COALESCE(m.nb_topups, 0)                              AS nb_topups,
  COALESCE(m.nb_spends, 0)                              AS nb_spends,
  COALESCE(m.total_topup, 0)                            AS total_recharge,
  COALESCE(m.total_spend, 0)                            AS total_depense,
  m.last_movement_at,
  w.archived
FROM wallets w
LEFT JOIN (
  SELECT restaurant_id,
         client_key,
         SUM(delta)                                              AS derived,
         COUNT(*) FILTER (WHERE kind = 'topup')::int              AS nb_topups,
         COUNT(*) FILTER (WHERE kind = 'spend')::int              AS nb_spends,
         COALESCE(SUM(delta) FILTER (WHERE delta > 0), 0)         AS total_topup,
         COALESCE(SUM(-delta) FILTER (WHERE delta < 0), 0)        AS total_spend,
         MAX(client_ts)                                           AS last_movement_at
  FROM wallet_movements
  GROUP BY restaurant_id, client_key
) m ON m.restaurant_id = w.restaurant_id AND m.client_key = w.client_key;
