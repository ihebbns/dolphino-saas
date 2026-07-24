// ═══════════════════════════════════════════════════
// Client self-service config (authenticated by the client's own api_key).
// GET  /api/me/config?key=API      → load own profile + config + modules
// POST /api/me/config { key, ... }  → save own name/logo/tagline/modules/menu
//
// The api_key is the client's secret (same one the POS + dashboard use).
// This endpoint can NEVER change plan / trial / api_key — a client cannot
// extend their own trial or unsuspend themselves.
// ═══════════════════════════════════════════════════

import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'

export const runtime = 'edge'

const MODULE_KEYS = [
  'tables', 'barcode', 'credit', 'stockTracking', 'poleDisplay',
  'kitchenTickets', 'printEnabled', 'dashboard', 'menuManage',
]

const cors = (r: NextResponse) => {
  r.headers.set('Access-Control-Allow-Origin', '*')
  r.headers.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  r.headers.set('Access-Control-Allow-Headers', 'Content-Type,X-Api-Key')
  return r
}
export async function OPTIONS() { return cors(new NextResponse(null, { status: 200 })) }

function getKey(req: Request, body?: any): string {
  return (body && body.key) || req.headers.get('x-api-key') || new URL(req.url).searchParams.get('key') || ''
}
function sanitizeModules(input: any): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  if (input && typeof input === 'object') {
    for (const k of MODULE_KEYS) if (typeof input[k] === 'boolean') out[k] = input[k]
  }
  return out
}

export async function GET(req: Request) {
  const key = getKey(req)
  if (!key) return cors(NextResponse.json({ ok: false, error: 'Clé manquante' }, { status: 400 }))
  try {
    const rows = await sql`
      SELECT name, city, phone, plan, plan_tier, trial_ends_at, config, menu_json
      FROM restaurants WHERE api_key = ${key} LIMIT 1
    `
    if (!rows.length) return cors(NextResponse.json({ ok: false, error: 'Compte introuvable' }, { status: 404 }))
    const r = rows[0]
    const config = (r.config && typeof r.config === 'object') ? r.config : {}
    return cors(NextResponse.json({
      ok: true,
      name: r.name, city: r.city, phone: r.phone,
      plan: r.plan, plan_tier: r.plan_tier, trial_ends_at: r.trial_ends_at,
      config,
      modules: config.modules || {},
      menu: r.menu_json || {},
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

  try {
    const rows = await sql`SELECT config FROM restaurants WHERE api_key = ${key} LIMIT 1`
    if (!rows.length) return cors(NextResponse.json({ ok: false, error: 'Compte introuvable' }, { status: 404 }))

    const current = (rows[0].config && typeof rows[0].config === 'object') ? rows[0].config : {}
    const nextConfig: any = { ...current }

    if (typeof body.logo === 'string')       nextConfig.logo = body.logo.slice(0, 8)
    if (typeof body.logoLetter === 'string')  nextConfig.logoLetter = body.logoLetter.slice(0, 2).toUpperCase()
    if (typeof body.tagline === 'string')     nextConfig.tagline = body.tagline.slice(0, 120)
    if (typeof body.currency === 'string')    nextConfig.currency = body.currency.slice(0, 6)
    if (body.modules)                         nextConfig.modules = { ...(current.modules || {}), ...sanitizeModules(body.modules) }
    if (body.tableCount !== undefined)        nextConfig.tableCount = parseInt(body.tableCount) || 12
    if (Array.isArray(body.sections))         nextConfig.sections = body.sections.map((s: any) => String(s).slice(0, 40)).filter(Boolean)

    await sql`UPDATE restaurants SET config = ${JSON.stringify(nextConfig)}::jsonb WHERE api_key = ${key}`

    if (typeof body.name === 'string' && body.name.trim())  await sql`UPDATE restaurants SET name  = ${body.name.trim().slice(0, 100)} WHERE api_key = ${key}`
    if (typeof body.city === 'string')                      await sql`UPDATE restaurants SET city  = ${body.city.slice(0, 80)}        WHERE api_key = ${key}`
    if (typeof body.phone === 'string')                     await sql`UPDATE restaurants SET phone = ${body.phone.slice(0, 30)}       WHERE api_key = ${key}`
    if (body.menu && typeof body.menu === 'object' && Object.keys(body.menu).length > 0) {
      await sql`UPDATE restaurants SET menu_json = ${JSON.stringify(body.menu)}::jsonb WHERE api_key = ${key}`
    }

    return cors(NextResponse.json({ ok: true, modules: nextConfig.modules || {} }))
  } catch (e: any) {
    return cors(NextResponse.json({ ok: false, error: e.message }, { status: 500 }))
  }
}
