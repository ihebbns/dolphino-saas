// ═══════════════════════════════════════════════════
// /api/public/[slug]/kds — the kitchen SCREEN's own endpoint (see
// app/kitchen/[slug]/page.tsx), separate from /api/me/kds (the till's).
//
// Authenticated by a simple password (restaurants.config.kdsPassword),
// admin-set — deliberately NOT the restaurant's api_key/syncKey. That
// credential grants full POS-sync privileges; handing it to a shared
// kitchen tablet as a "password" would be a much bigger blast radius than
// this screen needs, and it's an ugly string for non-technical staff to
// type. This route can only ever READ tickets and BUMP them — there is no
// 'add' action here, so even a leaked kitchen password can't be used to
// inject fake tickets into the queue. Only an authenticated till (real
// api_key, via /api/me/kds) can create one.
//
// GET  ?password=XXXX             → same ticket list shape as /api/me/kds
// POST { password, action:'bump', ticket_key, actor? }
// ═══════════════════════════════════════════════════

import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { serverError, isMissingSchema, notReadyPayload, missingRelations } from '@/lib/apiError'

export const runtime = 'edge'

const clip = (v: any, n: number) => String(v ?? '').slice(0, n)

async function resolveRestaurant(slug: string, password: string) {
  const rows = await sql`
    SELECT id, config FROM restaurants
    WHERE public_slug = ${slug} AND plan NOT IN ('suspended', 'suspended_exe') LIMIT 1`
  if (!rows.length) return { error: 'Commerce introuvable' as const, status: 404 }
  const cfg = (rows[0].config && typeof rows[0].config === 'object') ? rows[0].config : {}
  const configured = typeof cfg.kdsPassword === 'string' && cfg.kdsPassword.length > 0
  if (!configured) return { error: 'Écran cuisine non configuré — contactez le développeur' as const, status: 403 }
  if (cfg.kdsPassword !== password) return { error: 'Mot de passe incorrect' as const, status: 401 }
  return { id: rows[0].id }
}

const NEEDS = ['kds_tickets']
async function missingTables(): Promise<string[]> { return missingRelations(sql, NEEDS) }

export async function GET(req: Request, { params }: { params: { slug: string } }) {
  const slug = String(params.slug || '').slice(0, 60)
  const password = clip(new URL(req.url).searchParams.get('password'), 40)
  if (!slug) return NextResponse.json({ ok: false, error: 'Lien invalide' }, { status: 400 })
  if (!password) return NextResponse.json({ ok: false, error: 'Mot de passe requis' }, { status: 400 })

  try {
    const rest = await resolveRestaurant(slug, password)
    if ('error' in rest) return NextResponse.json({ ok: false, error: rest.error }, { status: rest.status })

    const gaps = await missingTables()
    if (gaps.length) return NextResponse.json(notReadyPayload('migration-kds.sql', { tickets: [] }, gaps))

    const rows = await sql`
      SELECT ticket_key, num, tbl_num, tbl_sec, cli_name, zone, zone_label, items,
             sent_at, bumped, bumped_at, bumped_by
      FROM kds_tickets
      WHERE restaurant_id = ${rest.id} AND sent_at > NOW() - INTERVAL '24 hours'
      ORDER BY sent_at ASC`
    const tickets = rows.map((r: any) => ({
      id: r.ticket_key, num: r.num, tblNum: r.tbl_num, tblSec: r.tbl_sec, cliName: r.cli_name || '',
      zone: r.zone, zoneLabel: r.zone_label || '', items: r.items || [],
      sentAt: new Date(r.sent_at).getTime(),
      bumped: !!r.bumped, bumpedAt: r.bumped_at ? new Date(r.bumped_at).getTime() : null, bumpedBy: r.bumped_by || '',
    }))
    return NextResponse.json({ ok: true, ready: true, tickets })
  } catch (err: any) {
    if (isMissingSchema(err)) {
      const gaps = await missingTables()
      return NextResponse.json(notReadyPayload('migration-kds.sql', { tickets: [] }, gaps))
    }
    return NextResponse.json(serverError('public kds GET', err), { status: 500 })
  }
}

export async function POST(req: Request, { params }: { params: { slug: string } }) {
  const slug = String(params.slug || '').slice(0, 60)
  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ ok: false, error: 'Bad JSON' }, { status: 400 }) }
  const password = clip(body?.password, 40)
  if (!slug) return NextResponse.json({ ok: false, error: 'Lien invalide' }, { status: 400 })
  if (!password) return NextResponse.json({ ok: false, error: 'Mot de passe requis' }, { status: 400 })
  if (body?.action !== 'bump') return NextResponse.json({ ok: false, error: 'Action invalide' }, { status: 400 })

  try {
    const rest = await resolveRestaurant(slug, password)
    if ('error' in rest) return NextResponse.json({ ok: false, error: rest.error }, { status: rest.status })

    const gaps = await missingTables()
    if (gaps.length) return NextResponse.json(notReadyPayload('migration-kds.sql', {}, gaps))

    const ticketKey = clip(body.ticket_key, 64)
    if (!ticketKey) return NextResponse.json({ ok: false, error: 'ticket_key requis' }, { status: 400 })
    await sql`
      UPDATE kds_tickets SET bumped = TRUE, bumped_at = NOW(), bumped_by = ${clip(body.actor, 80) || 'Écran cuisine'}
      WHERE restaurant_id = ${rest.id} AND ticket_key = ${ticketKey} AND bumped = FALSE`
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    if (isMissingSchema(err)) return NextResponse.json(notReadyPayload('migration-kds.sql', {}))
    return NextResponse.json(serverError('public kds POST', err), { status: 500 })
  }
}
