// ═══════════════════════════════════════════════════
// POST /api/admin/suspend — Granular client suspension
//
// Actions:
//   suspend_all    — block EXE + dashboard
//   suspend_exe    — block EXE only (client can still see dashboard)
//   suspend_dash   — block dashboard only (EXE still works)
//   activate       — remove all blocks
//   schedule       — auto-suspend after X days
//   cancel_schedule — cancel scheduled suspend
//
// Body: { admin_key, api_key, action, days? }
// ═══════════════════════════════════════════════════

import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'

export const runtime = 'edge'

const ADMIN_KEY = process.env.ADMIN_SECRET_KEY || 'servio-admin-iheb-2026'

export async function POST(req: Request) {
  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ ok: false, error: 'Bad JSON' }, { status: 400 }) }

  if (body.admin_key !== ADMIN_KEY) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  const clientKey = (body.api_key || '').trim()
  const action = body.action

  if (!clientKey) return NextResponse.json({ ok: false, error: 'Missing api_key' }, { status: 400 })

  const validActions = ['suspend_all', 'suspend_exe', 'suspend_dash', 'activate', 'schedule', 'cancel_schedule']
  if (!validActions.includes(action)) {
    return NextResponse.json({ ok: false, error: 'Invalid action. Use: ' + validActions.join(', ') }, { status: 400 })
  }

  let plan = 'active'
  let suspendAt: string | null = null

  switch (action) {
    case 'suspend_all':
      plan = 'suspended'
      break
    case 'suspend_exe':
      plan = 'suspended_exe'
      break
    case 'suspend_dash':
      plan = 'suspended_dash'
      break
    case 'activate':
      plan = 'active'
      suspendAt = null
      await sql`UPDATE restaurants SET plan = 'active', suspend_at = NULL WHERE api_key = ${clientKey}`
      return NextResponse.json({ ok: true, action, api_key: clientKey, plan: 'active' })
    case 'schedule':
      const days = parseInt(body.days) || 30
      const suspendTarget = body.suspend_target || 'suspended' // 'suspended', 'suspended_exe', 'suspended_dash'
      const scheduleDate = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
      await sql`UPDATE restaurants SET suspend_at = ${scheduleDate}::timestamptz, config = jsonb_set(COALESCE(config,'{}'), '{suspend_target}', ${JSON.stringify(suspendTarget)}::jsonb) WHERE api_key = ${clientKey}`
      return NextResponse.json({ ok: true, action, api_key: clientKey, suspend_at: scheduleDate, days, suspend_target: suspendTarget })
    case 'cancel_schedule':
      await sql`UPDATE restaurants SET suspend_at = NULL WHERE api_key = ${clientKey}`
      return NextResponse.json({ ok: true, action, api_key: clientKey })
  }

  await sql`UPDATE restaurants SET plan = ${plan} WHERE api_key = ${clientKey}`

  return NextResponse.json({ ok: true, action, api_key: clientKey, plan })
}
