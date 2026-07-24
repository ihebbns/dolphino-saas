// ═══════════════════════════════════════════════════
// /api/me/stock-log — STOCK AUDIT TRAIL + ÉCART REPORT  (WEB ONLY)
//
// Authenticated by the client's own api_key.
//
// GET  ?key=API[&item=ID][&limit=200]
//   → { movements, variance, totals }
//     movements : every stock change, newest first — what moved, how much, why,
//                 WHO did it and when. This is the anti-theft record.
//     variance  : per product, théorique vs compté vs écart, in the same shape
//                 as the cash clôture the owner already understands.
//
// POST /api/me/stock-log { key, item_id, kind, delta|count_value, reason }
//   → record a web-side movement: receive (livraison), waste, adjust, count.
//     'sale' is rejected here — only the POS may sell.
//
// ── WHY THIS IS WEB ONLY ───────────────────────────────────────────────
// In practice owners hand the EXE manager PIN to their cashiers, so nothing
// shown inside the EXE can be trusted to stay private. The person making an
// adjustment must not be able to check whether it has been noticed, so the
// movement history and the écart are never exposed to the POS — only here,
// behind the owner's own web password.
// ═══════════════════════════════════════════════════

import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { getApiKey } from '@/lib/auth'
import { recordMovement, isMovementKind, ledgerReady } from '@/lib/stock'

export const runtime = 'edge'

const cors = (r: NextResponse) => {
  r.headers.set('Access-Control-Allow-Origin', '*')
  r.headers.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  r.headers.set('Access-Control-Allow-Headers', 'Content-Type,X-Api-Key')
  return r
}
export async function OPTIONS() { return cors(new NextResponse(null, { status: 200 })) }

function getKey(req: Request, body?: any): string {
  return (body && body.key) || getApiKey(req) || new URL(req.url).searchParams.get('key') || ''
}

async function resolveRestaurant(key: string) {
  const rows = await sql`
    SELECT id, name FROM restaurants
    WHERE api_key = ${key} AND plan NOT IN ('suspended', 'suspended_dash')
    LIMIT 1`
  return rows.length ? rows[0] : null
}

export async function GET(req: Request) {
  const key = getKey(req)
  if (!key) return cors(NextResponse.json({ ok: false, error: 'Clé manquante' }, { status: 400 }))

  try {
    const rest = await resolveRestaurant(key)
    if (!rest) return cors(NextResponse.json({ ok: false, error: 'Compte introuvable ou suspendu' }, { status: 403 }))
    const rid = rest.id

    if (!(await ledgerReady())) {
      return cors(NextResponse.json({
        ok: true, ready: false, movements: [], variance: [], totals: null,
        note: 'Journal de stock non initialisé — exécutez migration-stock-movements.sql',
      }))
    }

    const url = new URL(req.url)
    const item = String(url.searchParams.get('item') ?? '').slice(0, 64)
    const limitRaw = parseInt(String(url.searchParams.get('limit') ?? '200'))
    const limit = Math.min(1000, Math.max(1, Number.isFinite(limitRaw) ? limitRaw : 200))

    // ── Audit trail ──────────────────────────────────────────────────────
    const movements = item
      ? await sql`
          SELECT m.id, m.item_id, s.item_name, s.item_emoji, m.kind, m.delta, m.count_value,
                 m.expected_value, m.reason, m.actor, m.source, m.terminal_id, m.sale_num,
                 m.client_ts, m.created_at
          FROM stock_movements m
          LEFT JOIN stock s ON s.restaurant_id = m.restaurant_id AND s.item_id = m.item_id
          WHERE m.restaurant_id = ${rid} AND m.item_id = ${item}
          ORDER BY m.client_ts DESC, m.id DESC
          LIMIT ${limit}`
      : await sql`
          SELECT m.id, m.item_id, s.item_name, s.item_emoji, m.kind, m.delta, m.count_value,
                 m.expected_value, m.reason, m.actor, m.source, m.terminal_id, m.sale_num,
                 m.client_ts, m.created_at
          FROM stock_movements m
          LEFT JOIN stock s ON s.restaurant_id = m.restaurant_id AND s.item_id = m.item_id
          WHERE m.restaurant_id = ${rid}
          ORDER BY m.client_ts DESC, m.id DESC
          LIMIT ${limit}`

    // ── Variance: théorique vs compté, per product ───────────────────────
    // Derived straight from the ledger view so it can never drift from the log.
    const variance = await sql`
      SELECT d.item_id,
             s.item_name,
             s.item_emoji,
             s.category,
             s.cost::float          AS cost,
             d.quantity::float      AS theorique,
             d.last_count_value::float AS dernier_compte,
             d.last_count_at,
             d.sold_since::float     AS vendu_depuis,
             d.received_since::float AS recu_depuis,
             d.wasted_since::float   AS perte_depuis,
             d.adjusted_since::float AS ajuste_depuis
      FROM stock_derived d
      LEFT JOIN stock s ON s.restaurant_id = d.restaurant_id AND s.item_id = d.item_id
      WHERE d.restaurant_id = ${rid}
      ORDER BY s.category NULLS LAST, s.item_name NULLS LAST`

    // ── Écart history: every count that disagreed with the system ─────────
    // This is the list the owner actually acts on.
    const ecarts = await sql`
      SELECT m.item_id, s.item_name, s.item_emoji,
             m.count_value::float    AS compte,
             m.expected_value::float AS theorique,
             (m.count_value - m.expected_value)::float AS ecart,
             ((m.count_value - m.expected_value) * COALESCE(s.cost, 0))::float AS ecart_valeur,
             m.reason, m.actor, m.source, m.client_ts
      FROM stock_movements m
      LEFT JOIN stock s ON s.restaurant_id = m.restaurant_id AND s.item_id = m.item_id
      WHERE m.restaurant_id = ${rid}
        AND m.kind = 'count'
        AND m.expected_value IS NOT NULL
        AND m.count_value <> m.expected_value
      ORDER BY m.client_ts DESC
      LIMIT 200`

    // ── Headline numbers ─────────────────────────────────────────────────
    const [totals] = await sql`
      SELECT
        COALESCE(SUM(-m.delta * COALESCE(s.cost, 0)) FILTER (WHERE m.kind = 'waste'), 0)::float  AS valeur_pertes,
        COALESCE(SUM(-m.delta) FILTER (WHERE m.kind = 'waste'), 0)::float                        AS unites_pertes,
        COUNT(*) FILTER (WHERE m.kind = 'adjust')::int                                           AS nb_ajustements,
        COALESCE(SUM(m.delta) FILTER (WHERE m.kind = 'adjust' AND m.delta < 0), 0)::float         AS unites_ajustees_negatif,
        COUNT(DISTINCT m.actor) FILTER (WHERE m.kind IN ('adjust','waste','count'))::int          AS nb_intervenants
      FROM stock_movements m
      LEFT JOIN stock s ON s.restaurant_id = m.restaurant_id AND s.item_id = m.item_id
      WHERE m.restaurant_id = ${rid}`

    return cors(NextResponse.json({
      ok: true, ready: true, name: rest.name,
      movements, variance, ecarts, totals,
    }))
  } catch (e: any) {
    return cors(NextResponse.json({ ok: false, error: e.message }, { status: 500 }))
  }
}

export async function POST(req: Request) {
  let body: any
  try { body = await req.json() } catch { return cors(NextResponse.json({ ok: false, error: 'Bad JSON' }, { status: 400 })) }

  const key = getKey(req, body)
  if (!key) return cors(NextResponse.json({ ok: false, error: 'Clé manquante' }, { status: 400 }))

  const itemId = String(body.item_id ?? '').trim().slice(0, 64)
  if (!itemId) return cors(NextResponse.json({ ok: false, error: 'item_id requis' }, { status: 400 }))

  const kind = String(body.kind ?? '').trim()
  if (!isMovementKind(kind)) {
    return cors(NextResponse.json({ ok: false, error: 'kind invalide' }, { status: 400 }))
  }
  // Only the caisse may sell. Allowing it here would let the web fabricate sales.
  if (kind === 'sale') {
    return cors(NextResponse.json({ ok: false, error: "Les ventes ne peuvent venir que de la caisse" }, { status: 400 }))
  }

  const reason = String(body.reason ?? '').slice(0, 200)
  // A manual correction without a stated reason defeats the audit trail.
  if (kind === 'adjust' && !reason) {
    return cors(NextResponse.json({ ok: false, error: 'Motif obligatoire pour un ajustement' }, { status: 400 }))
  }

  try {
    const rest = await resolveRestaurant(key)
    if (!rest) return cors(NextResponse.json({ ok: false, error: 'Compte introuvable ou suspendu' }, { status: 403 }))
    const rid = rest.id

    if (!(await ledgerReady())) {
      return cors(NextResponse.json({
        ok: false,
        error: 'Journal de stock non initialisé — exécutez migration-stock-movements.sql',
      }, { status: 409 }))
    }

    // The stock row must exist before a movement can reference it.
    const known = await sql`SELECT 1 FROM stock WHERE restaurant_id = ${rid} AND item_id = ${itemId} LIMIT 1`
    if (!known.length) {
      return cors(NextResponse.json({ ok: false, error: 'Produit inconnu — enregistrez-le d\'abord dans le catalogue' }, { status: 404 }))
    }

    const quantity = await recordMovement(rid, {
      itemId,
      kind,
      delta: kind === 'count' ? null : parseFloat(String(body.delta)),
      countValue: kind === 'count' ? parseFloat(String(body.count_value)) : null,
      reason,
      actor: String(body.actor ?? 'web').slice(0, 80),
      source: 'web',
      clientTs: body.ts ?? null,
      clientUid: String(body.uid ?? '').slice(0, 64),
    })

    if (quantity === null) {
      return cors(NextResponse.json({ ok: false, error: 'Mouvement ignoré (doublon ou valeur nulle)' }, { status: 409 }))
    }

    return cors(NextResponse.json({ ok: true, item_id: itemId, kind, quantity }))
  } catch (e: any) {
    return cors(NextResponse.json({ ok: false, error: e.message }, { status: 500 }))
  }
}
