// ═══════════════════════════════════════════════════
// /api/me/credits — CLIENT CREDIT (ardoises / receivables)
//
// POST { key, clients:[{cid,name,phone,balance,archived?,ts?}],
//              movements:[{uid,cid,kind,delta,payMethod?,items?,saleNum?,
//                          reason?,actor?,sessionId?,ts}],
//              terminalId? }
//   → the till pushes its ardoises up. Balances are upserted; movements are
//     appended idempotently on (restaurant, uid) because the POS re-sends until
//     the server confirms.
//
// GET  ?key=API[&client=CID][&limit=200]
//   → who owes what, total receivable, per-client history, and any drift between
//     the balance the till reports and the sum of its own movements.
//
// ── OWNERSHIP (ARCHITECTURE.md §2) ────────────────────────────────────
// The EXE owns credit — an ardoise is opened, charged and settled at the counter.
// This endpoint is WRITE-from-POS / READ-for-owner. It deliberately exposes no
// way for the web to create a credit sale, exactly as the web cannot invent a
// stock sale.
//
// Requires migration-credits.sql. Degrades gracefully without it so deploying
// ahead of the migration cannot break a till's sync loop.
// ═══════════════════════════════════════════════════

import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { getApiKey } from '@/lib/auth'
import {
  isMissingSchema, serverError, notReadyPayload, missingRelations, dbIdentity,
} from '@/lib/apiError'

export const runtime = 'edge'

const KINDS = ['credit', 'payment', 'adjust']

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

/** Reject an unparseable or implausible client clock so one badly-dated till
 *  cannot poison the ordering of the history. */
function safeTs(v: any): string {
  const t = v ? Date.parse(String(v)) : NaN
  if (!Number.isFinite(t)) return new Date().toISOString()
  const now = Date.now()
  if (t < now - 5 * 365 * 24 * 3600 * 1000 || t > now + 2 * 24 * 3600 * 1000) return new Date().toISOString()
  return new Date(t).toISOString()
}

/** Deterministic fallback key for clients created before `cid` existed, so the
 *  same person converges to the same row instead of duplicating on every sync. */
function slugKey(name: string): string {
  const base = String(name || '').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return ('c_' + (base || 'sans-nom')).slice(0, 64)
}

/** The relations this endpoint reads. Both tables are needed, not just `credits`
 *  — checking one and then querying the other is how a raw `relation does not
 *  exist` reached the UI in the first place. */
const NEEDS = ['credits', 'credit_movements']

/**
 * Which relations are missing, or [] when everything is present.
 *
 * Asks the catalog instead of running `SELECT 1 FROM credits`. The old probe
 * treated ANY failure as "not migrated", so a permission problem or a connection
 * hiccup produced "exécutez migration-credits.sql" — advice that is wrong and
 * unfalsifiable. The catalog answers the actual question.
 */
async function missingTables(): Promise<string[]> {
  return missingRelations(sql, NEEDS)
}

/** Not-ready response that says WHICH relation is absent and WHICH database was
 *  inspected, so "I already ran the migration" is diagnosable in one look. */
async function notReady(missing: string[]) {
  const id = await dbIdentity(sql)
  return cors(NextResponse.json(
    notReadyPayload(
      'migration-credits.sql',
      { clients: [], movements: [], totals: null, db: id },
      missing,
    )
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
// POST — the till pushes its ardoises
// ─────────────────────────────────────────────────────────────────────────
export async function POST(req: Request) {
  let body: any
  try { body = await req.json() } catch { return cors(NextResponse.json({ ok: false, error: 'Bad JSON' }, { status: 400 })) }

  const key = getKey(req, body)
  if (!key) return cors(NextResponse.json({ ok: false, error: 'Clé manquante' }, { status: 400 }))

  const clients: any[] = Array.isArray(body.clients) ? body.clients : []
  const movements: any[] = Array.isArray(body.movements) ? body.movements : []
  if (!clients.length && !movements.length) return cors(NextResponse.json({ ok: true, clients: 0, movements: 0 }))

  const terminalId = clip(body.terminalId, 64)

  try {
    const rest = await resolveRestaurant(key)
    if (!rest) return cors(NextResponse.json({ ok: false, error: 'Compte introuvable ou suspendu' }, { status: 403 }))
    const rid = rest.id

    // Acknowledge so the till stops retrying forever, but report not-ready.
    const gapsPost = await missingTables()
    if (gapsPost.length) {
      return cors(NextResponse.json(
        notReadyPayload('migration-credits.sql', { clients: 0, movements: 0 }, gapsPost)
      ))
    }

    // ── Balances ──────────────────────────────────────────────────────
    let upserted = 0
    for (const c of clients.slice(0, 1000)) {
      const name = clip(c?.name, 120).trim()
      if (!name) continue
      const clientKey = clip(c?.cid, 64) || slugKey(name)
      const archived = !!c?.archived

      await sql`
        INSERT INTO credits
          (restaurant_id, client_key, name, phone, balance, archived, archived_at, terminal_id, client_ts, updated_at)
        VALUES
          (${rid}, ${clientKey}, ${name}, ${clip(c?.phone, 40)}, ${n3(c?.balance)},
           ${archived}, ${archived ? safeTs(c?.ts) : null}, ${terminalId}, ${safeTs(c?.ts)}, NOW())
        ON CONFLICT (restaurant_id, client_key) DO UPDATE SET
          name        = EXCLUDED.name,
          phone       = EXCLUDED.phone,
          balance     = EXCLUDED.balance,
          archived    = EXCLUDED.archived,
          archived_at = COALESCE(credits.archived_at, EXCLUDED.archived_at),
          terminal_id = EXCLUDED.terminal_id,
          client_ts   = EXCLUDED.client_ts,
          updated_at  = NOW()`
      upserted++
    }

    // ── History ───────────────────────────────────────────────────────
    let inserted = 0, skipped = 0
    for (const m of movements.slice(0, 2000)) {
      const uid = clip(m?.uid, 64)
      const kind = clip(m?.kind, 16)
      const name = clip(m?.name, 120).trim()
      const clientKey = clip(m?.cid, 64) || (name ? slugKey(name) : '')
      // Without a uid the row could duplicate endlessly; without a client key it
      // belongs to nobody.
      if (!uid || !clientKey || !KINDS.includes(kind)) { skipped++; continue }

      // Normalise the sign here rather than trusting the client: a credit
      // increases the debt, a payment reduces it.
      const raw = n3(m?.delta)
      let delta = raw
      if (kind === 'credit') delta = Math.abs(raw)
      else if (kind === 'payment') delta = -Math.abs(raw)
      if (delta === 0) { skipped++; continue }

      const saleNumRaw = parseInt(String(m?.saleNum))
      const res = await sql`
        INSERT INTO credit_movements
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

    return cors(NextResponse.json({ ok: true, ready: true, clients: upserted, movements: inserted, skipped }))
  } catch (err: any) {
    // Acknowledge rather than 500: a till that gets an error here retries the
    // same batch forever. Missing schema is our problem to fix, not the till's.
    if (isMissingSchema(err)) {
      return cors(NextResponse.json(notReadyPayload('migration-credits.sql', { clients: 0, movements: 0 })))
    }
    return cors(NextResponse.json(serverError('credits POST', err), { status: 500 }))
  }
}

// ─────────────────────────────────────────────────────────────────────────
// GET — the owner's receivables view
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

    // Balances plus the drift between the till's cache and its own history.
    //
    // This is the same shape as the `credit_reconciliation` view but computed
    // inline on purpose: a database that has the tables from an earlier run of
    // the migration but not the view would otherwise throw a raw
    // `relation does not exist` straight onto the owner's screen. The view stays
    // in the migration for ad-hoc SQL; nothing in the app depends on it.
    const clients = await sql`
      SELECT c.client_key, c.name, c.phone,
             c.balance::float                                AS balance,
             COALESCE(m.derived, 0)::float                   AS balance_derived,
             (c.balance - COALESCE(m.derived, 0))::float     AS drift,
             COALESCE(m.nb_credits, 0)                       AS nb_credits,
             COALESCE(m.nb_payments, 0)                      AS nb_payments,
             COALESCE(m.total_credit, 0)::float              AS total_pris,
             COALESCE(m.total_paid, 0)::float                AS total_regle,
             m.last_movement_at,
             c.archived
      FROM credits c
      LEFT JOIN (
        SELECT restaurant_id, client_key,
               SUM(delta)                                        AS derived,
               COUNT(*) FILTER (WHERE kind = 'credit')::int       AS nb_credits,
               COUNT(*) FILTER (WHERE kind = 'payment')::int      AS nb_payments,
               COALESCE(SUM(delta) FILTER (WHERE delta > 0), 0)   AS total_credit,
               COALESCE(SUM(-delta) FILTER (WHERE delta < 0), 0)  AS total_paid,
               MAX(client_ts)                                     AS last_movement_at
        FROM credit_movements
        WHERE restaurant_id = ${rid}
        GROUP BY restaurant_id, client_key
      ) m ON m.restaurant_id = c.restaurant_id AND m.client_key = c.client_key
      WHERE c.restaurant_id = ${rid}
      ORDER BY c.archived ASC, c.balance DESC, c.name ASC`

    const movements = client
      ? await sql`
          SELECT m.id, m.client_key, c.name, m.kind, m.delta::float, m.pay_method,
                 m.items_summary, m.sale_num, m.reason, m.actor, m.client_ts
          FROM credit_movements m
          LEFT JOIN credits c ON c.restaurant_id = m.restaurant_id AND c.client_key = m.client_key
          WHERE m.restaurant_id = ${rid} AND m.client_key = ${client}
          ORDER BY m.client_ts DESC, m.id DESC
          LIMIT ${limit}`
      : await sql`
          SELECT m.id, m.client_key, c.name, m.kind, m.delta::float, m.pay_method,
                 m.items_summary, m.sale_num, m.reason, m.actor, m.client_ts
          FROM credit_movements m
          LEFT JOIN credits c ON c.restaurant_id = m.restaurant_id AND c.client_key = m.client_key
          WHERE m.restaurant_id = ${rid}
          ORDER BY m.client_ts DESC, m.id DESC
          LIMIT ${limit}`

    const [totals] = await sql`
      SELECT
        COALESCE(SUM(balance) FILTER (WHERE archived = FALSE AND balance > 0), 0)::float AS total_creances,
        COUNT(*) FILTER (WHERE archived = FALSE AND balance > 0)::int                    AS nb_debiteurs,
        COUNT(*) FILTER (WHERE archived = FALSE)::int                                    AS nb_clients,
        -- An ardoise deleted on the till while still owing money is a finding.
        COALESCE(SUM(balance) FILTER (WHERE archived = TRUE AND balance > 0), 0)::float  AS creances_archivees,
        COUNT(*) FILTER (WHERE archived = TRUE AND balance > 0)::int                     AS nb_archives_avec_dette
      FROM credits
      WHERE restaurant_id = ${rid}`

    return cors(NextResponse.json({
      ok: true, ready: true, name: rest.name,
      clients, movements, totals,
    }))
  } catch (err: any) {
    // A missing column or relation: find out exactly what's absent so the user
    // sees a precise message, not a generic "run the migration" that may already
    // have been run.
    if (isMissingSchema(err)) {
      const gaps = await missingTables()
      const id = await dbIdentity(sql)
      // If both tables are confirmed present, the error is a missing COLUMN.
      // Surface the actual Postgres message so the user knows exactly what to add.
      return cors(NextResponse.json({
        ok: true, ready: false,
        clients: [], movements: [], totals: null,
        note: gaps.length
          ? `Tables absentes : ${gaps.join(', ')} — exécutez migration-credits.sql`
          : `Colonne manquante : ${String(err?.message || '').slice(0, 300)}`,
        missing: gaps, db: id,
      }))
    }
    return cors(NextResponse.json(serverError('credits GET', err), { status: 500 }))
  }
}
