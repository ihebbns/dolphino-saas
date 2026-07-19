// ═══════════════════════════════════════════════════
// GET /api/update/html?key=XXX
// Returns the latest index.html content for this client
// The POS downloads this and saves it locally
// ═══════════════════════════════════════════════════

import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { getApiKey } from '@/lib/auth'

export const runtime = 'edge'

export async function GET(req: Request) {
  const key = getApiKey(req)
  if (!key) return new NextResponse('Unauthorized', { status: 401 })

  try {
    const rows = await sql`
      SELECT config FROM restaurants WHERE api_key = ${key} AND plan != 'suspended' LIMIT 1
    `
    if (!rows.length) return new NextResponse('Not found', { status: 404 })

    const config = rows[0].config || {}
    const html = config.latestHtml || null

    if (!html) return new NextResponse('No update available', { status: 204 })

    return new NextResponse(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
      }
    })
  } catch (e) {
    return new NextResponse('Error', { status: 500 })
  }
}
