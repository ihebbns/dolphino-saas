// ═══════════════════════════════════════════════════
// POST /api/admin/suspend
// YOUR secret admin route to suspend/activate a client
// Body: { admin_key: "YOUR_ADMIN_KEY", api_key: "CLIENT_KEY", action: "suspend"|"activate" }
// ═══════════════════════════════════════════════════

import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'

export const runtime = 'edge'

// Change this to your own secret — never share it
const ADMIN_KEY = process.env.ADMIN_SECRET_KEY || 'dolphino-admin-iheb-2026'

export async function POST(req: Request) {
  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ ok: false, error: 'Bad JSON' }, { status: 400 }) }

  if (body.admin_key !== ADMIN_KEY) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  const clientKey = (body.api_key || '').trim()
  const action    = body.action // 'suspend' or 'activate'

  if (!clientKey || !['suspend', 'activate'].includes(action)) {
    return NextResponse.json({ ok: false, error: 'Missing api_key or action' }, { status: 400 })
  }

  const plan = action === 'suspend' ? 'suspended' : 'active'

  await sql`UPDATE restaurants SET plan = ${plan} WHERE api_key = ${clientKey}`

  return NextResponse.json({
    ok: true,
    action,
    api_key: clientKey,
    plan
  })
}
