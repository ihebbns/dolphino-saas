import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { signToken } from '@/lib/auth'
import bcrypt from 'bcryptjs'

// ═══════════════════════════════════════════════════
// POST /api/org/login — org-owner login for multi-location accounts.
// Separate credential space from restaurants.owner_email — an org owner is
// not required to also be a restaurant-row owner, so this can never collide
// with an existing single-location account (La Coupole, Test Cafe Servio).
// Mirrors /api/login's bcrypt/plaintext-fallback pattern.
// ═══════════════════════════════════════════════════

export const runtime = 'nodejs'

const cors = (r: NextResponse) => {
  r.headers.set('Access-Control-Allow-Origin', '*')
  r.headers.set('Access-Control-Allow-Methods', 'POST,OPTIONS')
  r.headers.set('Access-Control-Allow-Headers', 'Content-Type,Authorization')
  return r
}

export async function OPTIONS() {
  return cors(new NextResponse(null, { status: 200 }))
}

export async function POST(req: Request) {
  let body: any
  try { body = await req.json() } catch { return cors(NextResponse.json({ ok: false, error: 'Bad JSON' }, { status: 400 })) }

  const email = (body.email || '').trim().toLowerCase()
  const pass = (body.password || '').trim()
  if (!email || !pass) return cors(NextResponse.json({ ok: false, error: 'Email et mot de passe requis' }, { status: 400 }))

  const rows = await sql`SELECT * FROM organizations WHERE owner_email=${email} LIMIT 1`
  const org = rows[0]

  let passwordOk = false
  if (org) {
    if (org.password_hash.startsWith('$2')) {
      passwordOk = await bcrypt.compare(pass, org.password_hash)
    } else {
      passwordOk = (pass === org.password_hash)
    }
  }

  if (!org || !passwordOk)
    return cors(NextResponse.json({ ok: false, error: 'Email ou mot de passe incorrect' }, { status: 401 }))

  const token = await signToken({ oid: org.id, name: org.name, kind: 'org' })
  return cors(NextResponse.json({ ok: true, token, name: org.name }))
}
