// ═══════════════════════════════════════════════════
// /api/me/tables — cross-till table state + audit trail (table-service base)
//
// GET  ?key=API
//   → live floor-plan state for every table (last pushed by whichever till
//     last touched it) + the most recent audit entries, so a newly-opened
//     till or the manager's "Vue temps réel" screen converges onto what
//     every other station already sees.
//
// POST { key, tables:[{id,num,sec,status,items,disc,note,by,at,closedAt,
//                       orderNum,sentItems,updatedAt}],
//              audit:[{uid,tableId,num,sec,action,detail,actor,sessionId,at}] }
//   → a till pushes its current table snapshot + whatever audit entries it
//     hasn't confirmed sent yet. Tables are upserted by (restaurant, table
//     key), last-write-wins by `updatedAt` (an epoch-ms the till stamps
//     itself) so a delayed/retried push can never clobber a newer one that
//     already landed. Audit entries are append-only, deduped by uid — a
//     retried push can never double-log a real event.
//
// Requires migration-pos-tables.sql. Degrades gracefully without it.
// ═══════════════════════════════════════════════════

import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { getApiKey } from '@/lib/auth'
import {
  isMissingSchema, serverError, notReadyPayload, missingRelations, dbIdentity,
} from '@/lib/apiError'

export const runtime = 'edge'

const cors = (r: NextResponse) => {
  r.headers.set('Access-Control-Allow-Origin', '*')
  r.headers.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  r.headers.set('Access-Control-Allow-Headers', 'Content-Type,X-Api-Key')
  return r
}
export async function OPTIONS() { return cors(new NextResponse(null, { status: 200 })) }

const clip = (v: any, n: number) => String(v ?? '').slice(0, n)
// Number(null) is 0, not NaN — a naive Number.isFinite(Number(v)) check would
// silently turn a genuinely-absent closedAt/at into 0 instead of NULL, which
// then round-trips through Postgres's BIGINT-as-string back to the POS as a
// truthy "0" and breaks any `if(!tbl.closedAt)` check there.
const bigintOrNull = (v: any) => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? Math.trunc(n) : null
}

function getKey(req: Request, body?: any): string {
  return (body && body.key) || getApiKey(req) || new URL(req.url).searchParams.get('key') || ''
}

async function resolveRestaurant(key: string) {
  const rows = await sql`
    SELECT id FROM restaurants WHERE api_key = ${key} AND plan NOT IN ('suspended', 'suspended_exe') LIMIT 1`
  return rows.length ? rows[0] : null
}

const NEEDS = ['pos_tables', 'table_audit_log']
async function missingTables(): Promise<string[]> {
  return missingRelations(sql, NEEDS)
}
async function notReady(missing: string[]) {
  const id = await dbIdentity(sql)
  return cors(NextResponse.json(
    notReadyPayload('migration-pos-tables.sql', { tables: [], audit: [], db: id }, missing)
  ))
}

export async function GET(req: Request) {
  const key = getKey(req)
  if (!key) return cors(NextResponse.json({ ok: false, error: 'Clé manquante' }, { status: 400 }))
  try {
    const rest = await resolveRestaurant(key)
    if (!rest) return cors(NextResponse.json({ ok: false, error: 'Compte introuvable ou suspendu' }, { status: 403 }))

    const gaps = await missingTables()
    if (gaps.length) return notReady(gaps)

    const rows = await sql`
      SELECT table_key, num, sec, status, items, disc::float AS disc, note,
             opened_by, opened_at, closed_at, order_num, sent_items, updated_at
      FROM pos_tables WHERE restaurant_id = ${rest.id}`
    const tables = rows.map((r: any) => ({
      id: r.table_key, num: r.num, sec: r.sec, status: r.status,
      items: r.items || [], disc: r.disc || 0, note: r.note || '',
      by: r.opened_by || '',
      // BIGINT columns come back from the driver as strings (precision
      // safety for values beyond JS's safe-integer range) — cast explicitly
      // rather than let a numeric-looking string round-trip to the POS as-is,
      // where "0" is truthy and would break `if(!tbl.closedAt)` checks there.
      at: r.opened_at != null ? Number(r.opened_at) : null,
      closedAt: r.closed_at != null ? Number(r.closed_at) : null,
      orderNum: r.order_num, sentItems: r.sent_items || [], updatedAt: Number(r.updated_at) || 0,
    }))

    // Recent-only, not the full history — this endpoint's job is bringing a
    // till's local copy up to date with what it might have missed, not
    // serving as the reporting view for a manager's full reconciliation
    // (that reads tblAuditForTable() locally, already merged from prior pulls).
    const auditRows = await sql`
      SELECT uid, table_key, num, sec, action, detail, actor, session_id, at
      FROM table_audit_log WHERE restaurant_id = ${rest.id}
      ORDER BY at DESC LIMIT 500`
    const audit = auditRows.map((r: any) => ({
      uid: r.uid, tableId: r.table_key, num: r.num, sec: r.sec,
      action: r.action, detail: r.detail || '', actor: r.actor || '',
      sessionId: r.session_id || '', at: Number(r.at),
    }))

    return cors(NextResponse.json({ ok: true, ready: true, tables, audit }))
  } catch (err: any) {
    if (isMissingSchema(err)) {
      const gaps = await missingTables()
      const id = await dbIdentity(sql)
      return cors(NextResponse.json({
        ok: true, ready: false, tables: [], audit: [],
        note: `Schéma incomplet : ${String(err?.message || '').slice(0, 200)}`,
        missing: gaps, db: id,
      }))
    }
    return cors(NextResponse.json(serverError('tables GET', err), { status: 500 }))
  }
}

export async function POST(req: Request) {
  let body: any
  try { body = await req.json() } catch { return cors(NextResponse.json({ ok: false, error: 'Bad JSON' }, { status: 400 })) }
  const key = getKey(req, body)
  if (!key) return cors(NextResponse.json({ ok: false, error: 'Clé manquante' }, { status: 400 }))

  const tables: any[] = Array.isArray(body.tables) ? body.tables : []
  const audit: any[] = Array.isArray(body.audit) ? body.audit : []
  if (!tables.length && !audit.length) return cors(NextResponse.json({ ok: true, tables: 0, audit: 0 }))

  try {
    const rest = await resolveRestaurant(key)
    if (!rest) return cors(NextResponse.json({ ok: false, error: 'Compte introuvable ou suspendu' }, { status: 403 }))
    const rid = rest.id

    const gaps = await missingTables()
    if (gaps.length) return cors(NextResponse.json(notReadyPayload('migration-pos-tables.sql', { tables: 0, audit: 0 }, gaps)))

    let tablesWritten = 0
    for (const t of tables.slice(0, 500)) {
      const tableKey = clip(t?.id, 64)
      if (!tableKey) continue
      const res = await sql`
        INSERT INTO pos_tables
          (restaurant_id, table_key, num, sec, status, items, disc, note,
           opened_by, opened_at, closed_at, order_num, sent_items, updated_at)
        VALUES
          (${rid}, ${tableKey}, ${parseInt(String(t?.num)) || 0}, ${clip(t?.sec, 80)},
           ${clip(t?.status, 16) || 'free'}, ${JSON.stringify(t?.items || [])}, ${Number(t?.disc) || 0},
           ${clip(t?.note, 500)}, ${clip(t?.by, 120)}, ${bigintOrNull(t?.at)}, ${bigintOrNull(t?.closedAt)},
           ${Number.isFinite(parseInt(String(t?.orderNum))) ? parseInt(String(t?.orderNum)) : null},
           ${JSON.stringify(t?.sentItems || [])}, ${bigintOrNull(t?.updatedAt) || 0})
        ON CONFLICT (restaurant_id, table_key) DO UPDATE SET
          num = EXCLUDED.num, sec = EXCLUDED.sec, status = EXCLUDED.status,
          items = EXCLUDED.items, disc = EXCLUDED.disc, note = EXCLUDED.note,
          opened_by = EXCLUDED.opened_by, opened_at = EXCLUDED.opened_at,
          closed_at = EXCLUDED.closed_at, order_num = EXCLUDED.order_num,
          sent_items = EXCLUDED.sent_items, updated_at = EXCLUDED.updated_at
        WHERE pos_tables.updated_at <= EXCLUDED.updated_at
        RETURNING id`
      if (res.length) tablesWritten++
    }

    let auditWritten = 0
    for (const e of audit.slice(0, 1000)) {
      const uid = clip(e?.uid, 64)
      const tableKey = clip(e?.tableId, 64)
      const at = bigintOrNull(e?.at)
      if (!uid || !tableKey || at == null) continue
      const res = await sql`
        INSERT INTO table_audit_log
          (restaurant_id, uid, table_key, num, sec, action, detail, actor, session_id, at)
        VALUES
          (${rid}, ${uid}, ${tableKey}, ${parseInt(String(e?.num)) || null}, ${clip(e?.sec, 80)},
           ${clip(e?.action, 24)}, ${clip(e?.detail, 500)}, ${clip(e?.actor, 120)}, ${clip(e?.sessionId, 64)}, ${at})
        ON CONFLICT (restaurant_id, uid) DO NOTHING
        RETURNING id`
      if (res.length) auditWritten++
    }

    return cors(NextResponse.json({ ok: true, tables: tablesWritten, audit: auditWritten }))
  } catch (err: any) {
    if (isMissingSchema(err)) {
      return cors(NextResponse.json(notReadyPayload('migration-pos-tables.sql', { tables: 0, audit: 0 })))
    }
    return cors(NextResponse.json(serverError('tables POST', err), { status: 500 }))
  }
}
