import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { signToken } from '@/lib/auth'
import bcrypt from 'bcryptjs'

export const runtime = 'nodejs'

const cors = (r: NextResponse) => {
  r.headers.set('Access-Control-Allow-Origin', '*')
  r.headers.set('Access-Control-Allow-Methods', 'POST,OPTIONS')
  r.headers.set('Access-Control-Allow-Headers', 'Content-Type,X-Api-Key')
  return r
}

export async function OPTIONS() {
  return cors(new NextResponse(null, { status: 200 }))
}

export async function POST(req: Request) {
  let body: any
  try { body = await req.json() } catch { return cors(NextResponse.json({ ok:false, error:'Bad JSON' }, { status:400 })) }

  const email = (body.email||'').trim().toLowerCase()
  const pass  = (body.password||'').trim()
  if (!email || !pass) return cors(NextResponse.json({ ok:false, error:'Email and password required' }, { status:400 }))

  const rows = await sql`SELECT * FROM restaurants WHERE owner_email=${email} LIMIT 1`
  const r = rows[0]

  // support both bcrypt hash and plain text password (for initial setup)
  let passwordOk = false
  if (r) {
    if (r.password_hash.startsWith('$2')) {
      passwordOk = await bcrypt.compare(pass, r.password_hash)
    } else {
      // plain text fallback for initial setup
      passwordOk = (pass === r.password_hash)
    }
  }

  if (!r || !passwordOk)
    return cors(NextResponse.json({ ok:false, error:'Email ou mot de passe incorrect' }, { status:401 }))

  if (r.plan === 'suspended')
    return cors(NextResponse.json({ ok:false, error:'Compte suspendu' }, { status:403 }))

  const token = await signToken({ rid:r.id, name:r.name, key:r.api_key })
  return cors(NextResponse.json({ ok:true, token, name:r.name, city:r.city, api_key:r.api_key, plan:r.plan }))
}
