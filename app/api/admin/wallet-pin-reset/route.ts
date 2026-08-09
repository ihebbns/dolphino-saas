// ═══════════════════════════════════════════════════
// POST /api/admin/wallet-pin-reset — clear a customer's self-service wallet
// PIN (and any active lockout), from the admin panel.
//
// Body: { admin_key, api_key, phone }
//
// The public /api/public/[slug]/wallet PIN is self-service, not identity-
// verified (no OTP/SMS) — a customer who forgets it, or gets locked out
// after 5 wrong guesses, has no way to reset it themselves. This is that
// recovery path: a support action only the developer (holder of
// ADMIN_SECRET_KEY) can take, after however they choose to confirm it's
// really that customer asking (phone call, in person, etc — same trust
// model as any small business "reset my card" request).
// ═══════════════════════════════════════════════════

import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { serverError } from '@/lib/apiError'

// No fallback: a hardcoded default here would let anyone who's ever seen
// this source (public GitHub repo) call every admin action on every tenant
// the moment ADMIN_SECRET_KEY is unset in the deployment env — fail closed
// instead, same as every other /api/admin/* route.
const ADMIN_KEY = process.env.ADMIN_SECRET_KEY || ''

const clip = (v: any, n: number) => String(v ?? '').slice(0, n)

export async function POST(req: Request) {
  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ ok: false, error: 'Bad JSON' }, { status: 400 }) }
  if (!ADMIN_KEY || body?.admin_key !== ADMIN_KEY) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const apiKey = body?.api_key
  const phone = clip(body?.phone, 40).replace(/\s+/g, '')
  if (!apiKey) return NextResponse.json({ ok: false, error: 'Missing api_key' }, { status: 400 })
  if (!phone) return NextResponse.json({ ok: false, error: 'Numéro requis' }, { status: 400 })

  try {
    const rows = await sql`SELECT id FROM restaurants WHERE api_key = ${apiKey} LIMIT 1`
    if (!rows.length) return NextResponse.json({ ok: false, error: 'Client introuvable' }, { status: 404 })
    const rid = rows[0].id

    const res = await sql`
      UPDATE wallets SET pin_hash = NULL, pin_set_at = NULL, pin_fail_count = 0, pin_locked_until = NULL
      WHERE restaurant_id = ${rid} AND phone = ${phone} AND archived = FALSE
      RETURNING name`
    if (!res.length) return NextResponse.json({ ok: false, error: 'Aucune carte trouvée pour ce numéro' }, { status: 404 })

    return NextResponse.json({ ok: true, name: res[0].name })
  } catch (e: any) {
    return NextResponse.json(serverError('admin wallet-pin-reset', e), { status: 500 })
  }
}
