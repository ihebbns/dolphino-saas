// ═══════════════════════════════════════════════════
// /api/me/wallet — CLIENT WALLET (carte de fidélité prépayée)
//
// POST { key, clients:[{cid,name,phone,balance,archived?,ts?}],
//              movements:[{uid,cid,kind,delta,payMethod?,items?,saleNum?,
//                          reason?,actor?,sessionId?,ts}],
//              terminalId? }
//   → the till pushes its wallets up. Balances are upserted; movements are
//     appended idempotently on (restaurant, uid) because the POS re-sends until
//     the server confirms.
//
// GET  ?key=API[&client=CID][&limit=200]
//   → who has how much prepaid, total outstanding balance, per-client history,
//     and any drift between the balance the till reports and its own history.
//
// ── OWNERSHIP ──────────────────────────────────────────────────────────
// The EXE owns the wallet exactly as it owns credit (see /api/me/credits) — a
// recharge is taken and a spend happens at the counter. This endpoint is
// WRITE-from-POS / READ-for-owner, with ONE exception: kind 'bonus' may be
// written by the web (the monthly spend-tier reward job), since only the web
// can compute a month of sales across all sync'd data.
//
// Requires migration-wallet.sql. Degrades gracefully without it.
// ═══════════════════════════════════════════════════

import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { getApiKey } from '@/lib/auth'
import {
  isMissingSchema, serverError, notReadyPayload, missingRelations, dbIdentity,
} from '@/lib/apiError'

export const runtime = 'edge'

const KINDS = ['topup', 'spend', 'adjust', 'bonus']

const cors = (r: NextResponse) => {
  r.headers.set('Access-Control-Allow-Origin', '*')
  r.headers.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  r.headers.set('Access-Control-Allow-Headers', 'Content-Type,X-Api-Key')
  return r
}
export async function OPTIONS() { return cors(new NextResponse(null, { status: 200 })) }

const clip = (v: any, n: number) => String(v ?? '').slice(0, n)
const n3 = (v: any) => {
  const f = parseFloat(String(v))
  return Number.isFinite(f) ? Math.round(f * 1000) / 1000 : 0
}

function safeTs(v: any): string {
  const t = v ? Date.parse(String(v)) : NaN
  if (!Number.isFinite(t)) return new Date().toISOString()
  const now = Date.now()
  if (t < now - 5 * 365 * 24 * 3600 * 1000 || t > now + 2 * 24 * 3600 * 1000) return new Date().toISOString()
  return new Date(t).toISOString()
}

function slugKey(name: string): string {
  const base = String(name || '').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return ('w_' + (base || 'sans-nom')).slice(0, 64)
}

const NEEDS = ['wallets', 'wallet_movements']

async function missingTables(): Promise<string[]> {
  return missingRelations(sql, NEEDS)
}

async function notReady(missing: string[]) {
  const id = await dbIdentity(sql)
  return cors(NextResponse.json(
    notReadyPayload('migration-wallet.sql', { clients: [], movements: [], totals: null, db: id }, missing)
  ))
}

async function resolveRestaurant(key: string) {
  const rows = await sql`
    SELECT id, name FROM restaurants
    WHERE api_key = ${key} AND plan NOT IN ('suspended', 'suspended_dash')
    LIMIT 1`
  return rows.length ? rows[0] : null
}

function getKey(req: Request, body?: any): string {
  return (body && body.key) || getApiKey(req) || new URL(req.url).searchParams.get('key') || ''
}

// ─────────────────────────────────────────────────────────────────────────
// POST — the till pushes its wallets (or the web credits a monthly bonus)
// ─────────────────────────────────────────────────────────────────────────
export async function POST(req: Request) {
  let body: any
  try { body = await req.json() } catch { return cors(NextResponse.json({ ok: false, error: 'Bad JSON' }, { status: 400 })) }

  const key = getKey(req, body)
  if (!key) return cors(NextResponse.json({ ok: false, error: 'Clé manquante' }, { status: 400 }))

  if (body.action === 'delete' && body.client_key) {
    try {
      const rest = await resolveRestaurant(key)
      if (!rest) return cors(NextResponse.json({ ok: false, error: 'Compte introuvable ou suspendu' }, { status: 403 }))
      const rid = rest.id

      const gaps = await missingTables()
      if (gaps.length) return notReady(gaps)

      const clientKey = clip(body.client_key, 64)
      await sql`DELETE FROM wallet_movements WHERE restaurant_id = ${rid} AND client_key = ${clientKey}`
      await sql`DELETE FROM wallets          WHERE restaurant_id = ${rid} AND client_key = ${clientKey}`
      return cors(NextResponse.json({ ok: true, deleted: true }))
    } catch (err: any) {
      if (isMissingSchema(err)) {
        const gaps = await missingTables()
        return cors(NextResponse.json(notReadyPayload('migration-wallet.sql', { deleted: false }, gaps)))
      }
      return cors(NextResponse.json(serverError('wallet DELETE', err), { status: 500 }))
    }
  }

  // ── Monthly bonus, written by the web's own reward job (see /api/wallet-rewards) ──
  // The only path where a movement can originate server-side rather than from
  // the till, because only the web can compute a month of spend.
  if (body.action === 'bonus') {
    try {
      const rest = await resolveRestaurant(key)
      if (!rest) return cors(NextResponse.json({ ok: false, error: 'Compte introuvable ou suspendu' }, { status: 403 }))
      const rid = rest.id
      const gaps = await missingTables()
      if (gaps.length) return notReady(gaps)

      const clientKey = clip(body.client_key, 64)
      const amount = n3(body.amount)
      const uid = clip(body.uid, 64)
      if (!clientKey || !uid || !(amount > 0)) {
        return cors(NextResponse.json({ ok: false, error: 'Paramètres invalides' }, { status: 400 }))
      }

      const res = await sql`
        INSERT INTO wallet_movements
          (restaurant_id, client_key, kind, delta, reason, actor, client_ts, client_uid)
        VALUES
          (${rid}, ${clientKey}, 'bonus', ${amount}, ${clip(body.reason, 200) || 'Récompense mensuelle'},
           'web', NOW(), ${uid})
        ON CONFLICT (restaurant_id, client_uid) DO NOTHING
        RETURNING id`
      if (res.length) {
        await sql`
          UPDATE wallets SET balance = balance + ${amount}, updated_at = NOW()
          WHERE restaurant_id = ${rid} AND client_key = ${clientKey}`
      }
      return cors(NextResponse.json({ ok: true, applied: res.length > 0 }))
    } catch (err: any) {
      if (isMissingSchema(err)) return cors(NextResponse.json(notReadyPayload('migration-wallet.sql', {})))
      return cors(NextResponse.json(serverError('wallet bonus', err), { status: 500 }))
    }
  }

  const clients: any[] = Array.isArray(body.clients) ? body.clients : []
  const movements: any[] = Array.isArray(body.movements) ? body.movements : []
  if (!clients.length && !movements.length) return cors(NextResponse.json({ ok: true, clients: 0, movements: 0 }))

  const terminalId = clip(body.terminalId, 64)

  try {
    const rest = await resolveRestaurant(key)
    if (!rest) return cors(NextResponse.json({ ok: false, error: 'Compte introuvable ou suspendu' }, { status: 403 }))
    const rid = rest.id

    const gapsPost = await missingTables()
    if (gapsPost.length) {
      return cors(NextResponse.json(notReadyPayload('migration-wallet.sql', { clients: 0, movements: 0 }, gapsPost)))
    }

    const explicitClients = new Set(
      movements.map(m => clip(m?.cid, 64) || (clip(m?.name, 120).trim() ? slugKey(clip(m?.name, 120)) : '')).filter(Boolean)
    )
    let upserted = 0
    let inferred = 0
    for (const c of clients.slice(0, 1000)) {
      const name = clip(c?.name, 120).trim()
      if (!name) continue
      const clientKey = clip(c?.cid, 64) || slugKey(name)
      const archived = !!c?.archived
      const nextBalance = n3(c?.balance)
      const previous = await sql`
        SELECT balance::float AS balance FROM wallets
        WHERE restaurant_id = ${rid} AND client_key = ${clientKey} LIMIT 1`
      const before = n3(previous[0]?.balance)

      await sql`
        INSERT INTO wallets
          (restaurant_id, client_key, name, phone, balance, archived, archived_at, terminal_id, client_ts, updated_at)
        VALUES
          (${rid}, ${clientKey}, ${name}, ${clip(c?.phone, 40)}, ${nextBalance},
           ${archived}, ${archived ? safeTs(c?.ts) : null}, ${terminalId}, ${safeTs(c?.ts)}, NOW())
        ON CONFLICT (restaurant_id, client_key) DO UPDATE SET
          name        = EXCLUDED.name,
          phone       = EXCLUDED.phone,
          balance     = EXCLUDED.balance,
          archived    = EXCLUDED.archived,
          archived_at = COALESCE(wallets.archived_at, EXCLUDED.archived_at),
          terminal_id = EXCLUDED.terminal_id,
          client_ts   = EXCLUDED.client_ts,
          updated_at  = NOW()`
      upserted++

      const delta = n3(nextBalance - before)
      if (delta !== 0 && !explicitClients.has(clientKey)) {
        const kind = delta > 0 ? 'topup' : 'spend'
        const uid = `balance:${clientKey.slice(0, 22)}:${before}:${nextBalance}:${Date.parse(safeTs(c?.ts))}`
        const insertedFallback = await sql`
          INSERT INTO wallet_movements
            (restaurant_id, client_key, kind, delta, reason, terminal_id, client_ts, client_uid)
          VALUES
            (${rid}, ${clientKey}, ${kind}, ${delta}, ${'Synchronisation caisse'},
             ${terminalId}, ${safeTs(c?.ts)}, ${uid})
          ON CONFLICT (restaurant_id, client_uid) DO NOTHING
          RETURNING id`
        if (insertedFallback.length) inferred++
      }
    }

    let inserted = 0, skipped = 0
    for (const m of movements.slice(0, 2000)) {
      const uid = clip(m?.uid, 64)
      const kind = clip(m?.kind, 16)
      const name = clip(m?.name, 120).trim()
      const clientKey = clip(m?.cid, 64) || (name ? slugKey(name) : '')
      if (!uid || !clientKey || !KINDS.includes(kind)) { skipped++; continue }

      // Normalise the sign here rather than trusting the client: a topup
      // increases the balance, a spend reduces it.
      const raw = n3(m?.delta)
      let delta = raw
      if (kind === 'topup') delta = Math.abs(raw)
      else if (kind === 'spend') delta = -Math.abs(raw)
      if (delta === 0) { skipped++; continue }

      const saleNumRaw = parseInt(String(m?.saleNum))
      const res = await sql`
        INSERT INTO wallet_movements
          (restaurant_id, client_key, kind, delta, pay_method, items_summary,
           sale_num, reason, actor, session_id, terminal_id, client_ts, client_uid)
        VALUES
          (${rid}, ${clientKey}, ${kind}, ${delta}, ${clip(m?.payMethod, 20)},
           ${clip(m?.items, 400)}, ${Number.isFinite(saleNumRaw) ? saleNumRaw : null},
           ${clip(m?.reason, 200)}, ${clip(m?.actor, 80)}, ${clip(m?.sessionId, 64)},
           ${terminalId}, ${safeTs(m?.ts)}, ${uid})
        ON CONFLICT (restaurant_id, client_uid) DO NOTHING
        RETURNING id`
      if (res.length) inserted++; else skipped++
    }

    return cors(NextResponse.json({ ok: true, ready: true, clients: upserted, movements: inserted, inferred, skipped }))
  } catch (err: any) {
    if (isMissingSchema(err)) {
      return cors(NextResponse.json(notReadyPayload('migration-wallet.sql', { clients: 0, movements: 0 })))
    }
    return cors(NextResponse.json(serverError('wallet POST', err), { status: 500 }))
  }
}

// ─────────────────────────────────────────────────────────────────────────
// GET — the owner's loyalty-wallet view
// ─────────────────────────────────────────────────────────────────────────
export async function GET(req: Request) {
  const key = getKey(req)
  if (!key) return cors(NextResponse.json({ ok: false, error: 'Clé manquante' }, { status: 400 }))

  try {
    const rest = await resolveRestaurant(key)
    if (!rest) return cors(NextResponse.json({ ok: false, error: 'Compte introuvable ou suspendu' }, { status: 403 }))
    const rid = rest.id

    const gaps = await missingTables()
    if (gaps.length) return notReady(gaps)

    const url = new URL(req.url)
    const client = clip(url.searchParams.get('client'), 64)
    const limitRaw = parseInt(String(url.searchParams.get('limit') ?? '200'))
    const limit = Math.min(1000, Math.max(1, Number.isFinite(limitRaw) ? limitRaw : 200))

    const clients = await sql`
      SELECT w.client_key, w.name, w.phone,
             w.balance::float                                AS balance,
             COALESCE(m.derived, 0)::float                   AS balance_derived,
             (w.balance - COALESCE(m.derived, 0))::float     AS drift,
             COALESCE(m.nb_topups, 0)                         AS nb_topups,
             COALESCE(m.nb_spends, 0)                         AS nb_spends,
             COALESCE(m.total_topup, 0)::float                AS total_recharge,
             COALESCE(m.total_spend, 0)::float                AS total_depense,
             m.last_movement_at,
             w.archived
      FROM wallets w
      LEFT JOIN (
        SELECT restaurant_id, client_key,
               SUM(delta)                                        AS derived,
               COUNT(*) FILTER (WHERE kind = 'topup')::int        AS nb_topups,
               COUNT(*) FILTER (WHERE kind = 'spend')::int        AS nb_spends,
               COALESCE(SUM(delta) FILTER (WHERE delta > 0), 0)   AS total_topup,
               COALESCE(SUM(-delta) FILTER (WHERE delta < 0), 0)  AS total_spend,
               MAX(client_ts)                                     AS last_movement_at
        FROM wallet_movements
        WHERE restaurant_id = ${rid}
        GROUP BY restaurant_id, client_key
      ) m ON m.restaurant_id = w.restaurant_id AND m.client_key = w.client_key
      WHERE w.restaurant_id = ${rid}
      ORDER BY w.archived ASC, w.balance DESC, w.name ASC`

    const movements = client
      ? await sql`
          SELECT m.id, m.client_key, w.name, m.kind, m.delta::float, m.pay_method,
                 m.items_summary, m.sale_num, m.reason, m.actor, m.client_ts
          FROM wallet_movements m
          LEFT JOIN wallets w ON w.restaurant_id = m.restaurant_id AND w.client_key = m.client_key
          WHERE m.restaurant_id = ${rid} AND m.client_key = ${client}
          ORDER BY m.client_ts DESC, m.id DESC
          LIMIT ${limit}`
      : await sql`
          SELECT m.id, m.client_key, w.name, m.kind, m.delta::float, m.pay_method,
                 m.items_summary, m.sale_num, m.reason, m.actor, m.client_ts
          FROM wallet_movements m
          LEFT JOIN wallets w ON w.restaurant_id = m.restaurant_id AND w.client_key = m.client_key
          WHERE m.restaurant_id = ${rid}
          ORDER BY m.client_ts DESC, m.id DESC
          LIMIT ${limit}`

    const [totals] = await sql`
      SELECT
        COALESCE(SUM(balance) FILTER (WHERE archived = FALSE), 0)::float AS total_solde,
        COUNT(*) FILTER (WHERE archived = FALSE AND balance > 0)::int    AS nb_avec_solde,
        COUNT(*) FILTER (WHERE archived = FALSE)::int                   AS nb_clients
      FROM wallets
      WHERE restaurant_id = ${rid}`

    return cors(NextResponse.json({
      ok: true, ready: true, name: rest.name,
      clients, movements, totals,
    }))
  } catch (err: any) {
    if (isMissingSchema(err)) {
      const gaps = await missingTables()
      const id = await dbIdentity(sql)
      return cors(NextResponse.json({
        ok: true, ready: false,
        clients: [], movements: [], totals: null,
        note: `Schéma incomplet : ${String(err?.message || '').slice(0, 200)}`,
        missing: gaps, db: id,
      }))
    }
    return cors(NextResponse.json(serverError('wallet GET', err), { status: 500 }))
  }
}
