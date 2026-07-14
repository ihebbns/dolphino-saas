// POST /api/admin/clients { admin_key } → list all clients
// PUT  /api/admin/clients { admin_key, name, email, password, api_key, city, phone } → add new client

import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import bcrypt from 'bcryptjs'

export const runtime = 'nodejs'

const ADMIN_KEY = process.env.ADMIN_SECRET_KEY || 'dolphino-admin-iheb-2026'

function checkAdmin(body: any) {
  return body?.admin_key === ADMIN_KEY
}

export async function POST(req: Request) {
  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ ok:false, error:'Bad JSON' }, { status:400 }) }
  if (!checkAdmin(body)) return NextResponse.json({ ok:false, error:'Unauthorized' }, { status:401 })

  const clients = await sql`
    SELECT id, name, owner_email, api_key, city, phone, plan, created_at
    FROM restaurants
    ORDER BY created_at DESC
  `
  return NextResponse.json({ ok:true, clients })
}

export async function PUT(req: Request) {
  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ ok:false, error:'Bad JSON' }, { status:400 }) }
  if (!checkAdmin(body)) return NextResponse.json({ ok:false, error:'Unauthorized' }, { status:401 })

  const { name, email, password, api_key, city='', phone='' } = body
  if (!name || !email || !password || !api_key) {
    return NextResponse.json({ ok:false, error:'Missing required fields' }, { status:400 })
  }

  const hash = await bcrypt.hash(password, 10)

  try {
    await sql`
      INSERT INTO restaurants (name, owner_email, password_hash, api_key, city, phone, plan)
      VALUES (${name}, ${email.toLowerCase()}, ${hash}, ${api_key}, ${city}, ${phone}, 'active')
    `
    return NextResponse.json({ ok:true })
  } catch(e: any) {
    return NextResponse.json({ ok:false, error: e.message }, { status:500 })
  }
}
