// ═══════════════════════════════════════════════════
// POST /api/me/password — the owner changes their own password.
//
// Built because a real password already exists: /api/login authenticates with
// bcrypt against restaurants.password_hash, created at signup. Without this
// route that credential could never be rotated, which is not acceptable for an
// account holding a business's takings.
//
// Authenticated by the CURRENT password, not by the api_key. The api_key is
// stored in the browser's localStorage, so accepting it here would mean anyone
// who got hold of a terminal could lock the owner out of their own account. The
// email plus the existing password is the only proof that matters.
//
// It also closes a real hole: /api/login accepts a plain-text password_hash as a
// "fallback for initial setup", so any account still holding an unhashed value
// is one leak away from being readable. Changing the password through here
// always writes a bcrypt hash.
// ═══════════════════════════════════════════════════
import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import bcrypt from 'bcryptjs'

export const runtime = 'nodejs'

const cors = (r: NextResponse) => {
  r.headers.set('Access-Control-Allow-Origin', '*')
  r.headers.set('Access-Control-Allow-Headers', 'Content-Type, X-Api-Key')
  r.headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS')
  return r
}
export async function OPTIONS() { return cors(new NextResponse(null, { status: 204 })) }

const MIN_LEN = 8

export async function POST(req: Request) {
  let body: any
  try { body = await req.json() } catch {
    return cors(NextResponse.json({ ok: false, error: 'Requête invalide' }, { status: 400 }))
  }

  const email = String(body.email ?? '').trim().toLowerCase()
  const current = String(body.current ?? '')
  const next = String(body.next ?? '')

  if (!email || !current || !next) {
    return cors(NextResponse.json({ ok: false, error: 'Email, mot de passe actuel et nouveau mot de passe sont requis.' }, { status: 400 }))
  }
  if (next.length < MIN_LEN) {
    return cors(NextResponse.json({ ok: false, error: `Le nouveau mot de passe doit faire au moins ${MIN_LEN} caractères.` }, { status: 400 }))
  }
  if (next === current) {
    return cors(NextResponse.json({ ok: false, error: 'Le nouveau mot de passe est identique à l\'actuel.' }, { status: 400 }))
  }

  try {
    const rows = await sql`
      SELECT id, password_hash FROM restaurants
      WHERE lower(owner_email) = ${email} LIMIT 1`

    // Same generic message whether the account is unknown or the password is
    // wrong, so this cannot be used to discover which emails have accounts.
    const bad = () => cors(NextResponse.json(
      { ok: false, error: 'Email ou mot de passe actuel incorrect.' }, { status: 401 }))

    if (!rows.length) return bad()
    const r = rows[0]
    const stored = String(r.password_hash ?? '')

    const currentOk = stored.startsWith('$2')
      ? await bcrypt.compare(current, stored)
      : current === stored          // legacy plain text, upgraded below
    if (!currentOk) return bad()

    const hash = await bcrypt.hash(next, 10)
    await sql`UPDATE restaurants SET password_hash = ${hash} WHERE id = ${r.id}`

    return cors(NextResponse.json({
      ok: true,
      upgraded: !stored.startsWith('$2'),   // true when a plain-text value was replaced
    }))
  } catch (e: any) {
    return cors(NextResponse.json({ ok: false, error: 'Erreur serveur' }, { status: 500 }))
  }
}
