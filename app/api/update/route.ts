// ═══════════════════════════════════════════════════
// GET /api/update?key=XXX
// Called by POS EXE on startup to check for updates
// Returns: { ok, version, updateUrl } or { ok, version: null } (no update)
//
// The version is stored in the restaurant's config.appVersion field.
// When you push an update, increment the version in the DB.
// ═══════════════════════════════════════════════════

import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { getApiKey } from '@/lib/auth'

export const runtime = 'edge'

const cors = (r: NextResponse) => {
  r.headers.set('Access-Control-Allow-Origin', '*')
  r.headers.set('Access-Control-Allow-Methods', 'GET,OPTIONS')
  r.headers.set('Access-Control-Allow-Headers', 'Content-Type,X-Api-Key')
  return r
}

export async function OPTIONS() {
  return cors(new NextResponse(null, { status: 200 }))
}

export async function GET(req: Request) {
  const key = getApiKey(req)
  if (!key) return cors(NextResponse.json({ ok: false }))

  try {
    const rows = await sql`
      SELECT config, plan FROM restaurants WHERE api_key = ${key} LIMIT 1
    `
    if (!rows.length) return cors(NextResponse.json({ ok: false }))

    const r = rows[0]
    if (r.plan === 'suspended') return cors(NextResponse.json({ ok: true, version: null }))

    const config = r.config || {}
    const version = config.appVersion || null
    const updateUrl = config.updateUrl || null

    return cors(NextResponse.json({
      ok: true,
      version,
      updateUrl,
    }))
  } catch (e) {
    return cors(NextResponse.json({ ok: true, version: null }))
  }
}
