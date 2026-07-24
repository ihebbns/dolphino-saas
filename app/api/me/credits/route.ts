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

async function tablesReady(): Promise<boolean> {
  try { await sql`SELECT 1 FROM credits LIMIT 1`; return true } catch { return false }
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
    if (!(await tablesReady())) {
      return cors(NextResponse.json({
        ok: true, ready: false, clients: 0, movements: 0,
        note: 'Tables crédit non initialisées — exécutez migration-credits.sql',
      }))
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
    return cors(NextResponse.json({ ok: false, error: err.message }, { status: 500 }))
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

    if (!(await tablesReady())) {
      return cors(NextResponse.json({
        ok: true, ready: false, clients: [], movements: [], totals: null,
        note: 'Tables crédit non initialisées — exécutez migration-credits.sql',
      }))
    }

    const url = new URL(req.url)
    const client = clip(url.searchParams.get('client'), 64)
    const limitRaw = parseInt(String(url.searchParams.get('limit') ?? '200'))
    const limit = Math.min(1000, Math.max(1, Number.isFinite(limitRaw) ? limitRaw : 200))

    // Balances plus the drift between the till's cache and its own history.
    const clients = await sql`
      SELECT client_key, name, phone,
             balance_pos::float      AS balance,
             balance_derived::float  AS balance_derived,
             drift::float            AS drift,
             nb_credits, nb_payments,
             total_pris::float       AS total_pris,
             total_regle::float      AS total_regle,
             last_movement_at, archived
      FROM credit_reconciliation
      WHERE restaurant_id = ${rid}
      ORDER BY archived ASC, balance_pos DESC, name ASC`

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
    return cors(NextResponse.json({ ok: false, error: err.message }, { status: 500 }))
  }
}
