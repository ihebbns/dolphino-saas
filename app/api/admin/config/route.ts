// ═══════════════════════════════════════════════════
// POST /api/admin/config — save client config + menu
// GET  /api/admin/config?admin_key=X&api_key=Y — load client config + menu
//
// Body (POST): { admin_key, api_key, config: {...}, menu: {...} }
// config = { logo, logoLetter, tagline, currency, primaryColor, managerName, managerPin, cashierName, cashierPin, zone1Cats, zone2Cats, boissonCats }
// menu   = { "Pizza": { icon: "🍕", items: [...] }, ... }
// ═══════════════════════════════════════════════════

import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'

export const runtime = 'edge'

const ADMIN_KEY = process.env.ADMIN_SECRET_KEY || 'servio-admin-2026'

export async function POST(req: Request) {
  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ ok: false, error: 'Bad JSON' }, { status: 400 }) }
  if (body?.admin_key !== ADMIN_KEY) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const { api_key, config, menu, name, city, phone } = body
  if (!api_key) return NextResponse.json({ ok: false, error: 'Missing api_key' }, { status: 400 })

  // Build SET clauses dynamically based on what's provided
  const updates: string[] = []

  if (config) {
    await sql`UPDATE restaurants SET config = ${JSON.stringify(config)}::jsonb WHERE api_key = ${api_key}`
  }
  if (menu) {
    await sql`UPDATE restaurants SET menu_json = ${JSON.stringify(menu)}::jsonb WHERE api_key = ${api_key}`
  }
  if (name) {
    await sql`UPDATE restaurants SET name = ${name} WHERE api_key = ${api_key}`
  }
  if (city !== undefined) {
    await sql`UPDATE restaurants SET city = ${city} WHERE api_key = ${api_key}`
  }
  if (phone !== undefined) {
    await sql`UPDATE restaurants SET phone = ${phone} WHERE api_key = ${api_key}`
  }

  return NextResponse.json({ ok: true })
}

export async function GET(req: Request) {
  const url    = new URL(req.url)
  const adminK = url.searchParams.get('admin_key')
  const apiKey = url.searchParams.get('api_key')

  if (adminK !== ADMIN_KEY) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  if (!apiKey) return NextResponse.json({ ok: false, error: 'Missing api_key' }, { status: 400 })

  const rows = await sql`
    SELECT name, city, phone, plan, config, menu_json 
    FROM restaurants 
    WHERE api_key = ${apiKey} 
    LIMIT 1
  `
  if (!rows.length) return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 })

  const r = rows[0]
  return NextResponse.json({
    ok: true,
    name: r.name,
    city: r.city,
    phone: r.phone,
    plan: r.plan,
    config: r.config || {},
    menu: r.menu_json || {},
  })
}
