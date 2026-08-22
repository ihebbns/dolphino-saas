import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { verifyOrgToken } from '@/lib/orgAuth'

// ═══════════════════════════════════════════════════
// GET /api/org/restaurants — list the restaurants linked to the caller's
// organization. The only place multiple restaurants' api_key values are
// ever returned together — gated by the org JWT (verifyOrgToken), never by
// the global admin secret used in /api/admin/*.
//
// Each restaurant's api_key is exactly what the dashboard already stores in
// localStorage under d_api_key for a single-location login — picking one
// here just hands the dashboard that same string, so every existing
// /api/me/*, /api/sync, /api/dashboard route keeps working unmodified.
// ═══════════════════════════════════════════════════

export const runtime = 'nodejs'

const cors = (r: NextResponse) => {
  r.headers.set('Access-Control-Allow-Origin', '*')
  r.headers.set('Access-Control-Allow-Methods', 'GET,OPTIONS')
  r.headers.set('Access-Control-Allow-Headers', 'Content-Type,Authorization')
  return r
}

export async function OPTIONS() {
  return cors(new NextResponse(null, { status: 200 }))
}

export async function GET(req: Request) {
  const org = await verifyOrgToken(req)
  if (!org) return cors(NextResponse.json({ ok: false, error: 'Non autorisé' }, { status: 401 }))

  const rows = await sql`
    SELECT id, name, city, api_key, plan
    FROM restaurants
    WHERE organization_id = ${org.oid}
    ORDER BY name`

  return cors(NextResponse.json({ ok: true, restaurants: rows }))
}
