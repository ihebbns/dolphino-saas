// POST /api/admin/config — save client config
// Body: { admin_key, api_key, config: {...} }

import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'

export const runtime = 'edge'

const ADMIN_KEY = process.env.ADMIN_SECRET_KEY || 'dolphino-admin-iheb-2026'

export async function POST(req: Request) {
  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ ok:false, error:'Bad JSON' }, { status:400 }) }
  if (body?.admin_key !== ADMIN_KEY) return NextResponse.json({ ok:false, error:'Unauthorized' }, { status:401 })

  const { api_key, config } = body
  if (!api_key || !config) return NextResponse.json({ ok:false, error:'Missing api_key or config' }, { status:400 })

  await sql`UPDATE restaurants SET config = ${JSON.stringify(config)}::jsonb WHERE api_key = ${api_key}`
  return NextResponse.json({ ok: true })
}

export async function GET(req: Request) {
  const url    = new URL(req.url)
  const adminK = url.searchParams.get('admin_key')
  const apiKey = url.searchParams.get('api_key')

  if (adminK !== ADMIN_KEY) return NextResponse.json({ ok:false, error:'Unauthorized' }, { status:401 })
  if (!apiKey) return NextResponse.json({ ok:false, error:'Missing api_key' }, { status:400 })

  const rows = await sql`SELECT config, name, city FROM restaurants WHERE api_key = ${apiKey} LIMIT 1`
  if (!rows.length) return NextResponse.json({ ok:false, error:'Not found' }, { status:404 })

  return NextResponse.json({ ok:true, config: rows[0].config, name: rows[0].name, city: rows[0].city })
}
