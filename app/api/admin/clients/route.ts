// POST /api/admin/clients { admin_key } → list all clients (with CRM fields)
// PUT  /api/admin/clients { admin_key, name, email, password, api_key, city, phone } → add new client
// PATCH /api/admin/clients { admin_key, id, ...fields } → update CRM fields for one client

import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import bcrypt from 'bcryptjs'
import { serverError } from '@/lib/apiError'

export const runtime = 'nodejs'

const ADMIN_KEY = process.env.ADMIN_SECRET_KEY || 'servio-admin-iheb-2026'

function checkAdmin(body: any) {
  return body?.admin_key === ADMIN_KEY
}

export async function POST(req: Request) {
  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ ok:false, error:'Bad JSON' }, { status:400 }) }
  if (!checkAdmin(body)) return NextResponse.json({ ok:false, error:'Unauthorized' }, { status:401 })

  // CRM columns may not exist yet (migration not run). Fallback gracefully.
  let clients: any[]
  try {
    clients = await sql`
      SELECT id, name, owner_email, api_key, city, phone, plan, plan_tier,
             suspend_at, created_at, business_type,
             next_contact, last_contact, admin_notes, needs, crm_status, monthly_price
      FROM restaurants
      ORDER BY next_contact ASC NULLS LAST, created_at DESC
    `
  } catch {
    clients = await sql`
      SELECT id, name, owner_email, api_key, city, phone, plan, suspend_at, created_at
      FROM restaurants
      ORDER BY created_at DESC
    `
  }
  return NextResponse.json({ ok:true, clients })
}

export async function PUT(req: Request) {
  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ ok:false, error:'Bad JSON' }, { status:400 }) }
  if (!checkAdmin(body)) return NextResponse.json({ ok:false, error:'Unauthorized' }, { status:401 })

  const { name, email, password, api_key, city='', phone='', modules } = body
  if (!name || !email || !password || !api_key) {
    return NextResponse.json({ ok:false, error:'Missing required fields' }, { status:400 })
  }

  const hash = await bcrypt.hash(password, 10)

  // Modules are stored inside config.modules as a { key: boolean } map, the same
  // structure the client's /api/me/config reads and writes.
  const config: Record<string, any> = {}
  if (modules && typeof modules === 'object') {
    config.modules = {}
    for (const [k, v] of Object.entries(modules)) {
      if (typeof v === 'boolean') config.modules[k] = v
    }
  }

  try {
    await sql`
      INSERT INTO restaurants (name, owner_email, password_hash, api_key, city, phone, plan, config)
      VALUES (${name}, ${email.toLowerCase()}, ${hash}, ${api_key}, ${city}, ${phone}, 'active', ${JSON.stringify(config)})
    `
    return NextResponse.json({ ok:true })
  } catch(e: any) {
    return NextResponse.json(serverError('admin/clients', e), { status:500 })
  }
}

// PATCH — update CRM fields for a single client
export async function PATCH(req: Request) {
  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ ok:false, error:'Bad JSON' }, { status:400 }) }
  if (!checkAdmin(body)) return NextResponse.json({ ok:false, error:'Unauthorized' }, { status:401 })

  const id = parseInt(String(body.id))
  if (!id) return NextResponse.json({ ok:false, error:'id requis' }, { status:400 })

  const sets: string[] = []
  const allowed: Record<string, string> = {
    admin_notes: 'text', needs: 'text', crm_status: 'text',
    next_contact: 'date', last_contact: 'date',
    monthly_price: 'number', phone: 'text', city: 'text', name: 'text',
  }

  try {
    // Build dynamic update — only touch fields that were sent.
    for (const [k, type] of Object.entries(allowed)) {
      if (body[k] === undefined) continue
      const v = body[k]
      if (type === 'date') {
        if (v === null || v === '') {
          await sql`UPDATE restaurants SET ${sql(k)} = NULL WHERE id = ${id}`
        } else {
          await sql`UPDATE restaurants SET ${sql(k)} = ${String(v).slice(0, 10)}::date WHERE id = ${id}`
        }
      } else if (type === 'number') {
        await sql`UPDATE restaurants SET ${sql(k)} = ${parseFloat(String(v)) || 0} WHERE id = ${id}`
      } else {
        await sql`UPDATE restaurants SET ${sql(k)} = ${String(v).slice(0, 2000)} WHERE id = ${id}`
      }
    }

    // ── Module toggle (admin only) ────────────────────────────────────
    // Clients cannot change their own modules via /api/me/config. This is the
    // only path. It merges into the existing config.modules, so setting
    // { modules: { ingredients: true } } does not wipe the others.
    if (body.modules && typeof body.modules === 'object') {
      const [row] = await sql`SELECT config FROM restaurants WHERE id = ${id} LIMIT 1`
      const cfg = (row?.config && typeof row.config === 'object') ? row.config : {}
      const cur = (cfg.modules && typeof cfg.modules === 'object') ? cfg.modules : {}
      const next: Record<string, boolean> = { ...cur }
      for (const [mk, mv] of Object.entries(body.modules)) {
        if (typeof mv === 'boolean') next[mk] = mv
      }
      cfg.modules = next
      await sql`UPDATE restaurants SET config = ${JSON.stringify(cfg)}::jsonb WHERE id = ${id}`
    }

    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json(serverError('admin/clients', e), { status:500 })
  }
}
