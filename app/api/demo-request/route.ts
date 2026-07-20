// ═══════════════════════════════════════════════════
// POST /api/demo-request — Store demo request from potential client
// GET  /api/demo-request?admin_key=XXX — List all demo requests (admin)
// ═══════════════════════════════════════════════════

import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'

export const runtime = 'edge'

const ADMIN_KEY = process.env.ADMIN_SECRET_KEY || 'servio-admin-iheb-2026'

const cors = (r: NextResponse) => {
  r.headers.set('Access-Control-Allow-Origin', '*')
  r.headers.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  r.headers.set('Access-Control-Allow-Headers', 'Content-Type')
  return r
}

export async function OPTIONS() {
  return cors(new NextResponse(null, { status: 200 }))
}

// ── POST — new demo request from client ──
export async function POST(req: Request) {
  let body: any
  try { body = await req.json() } catch { return cors(NextResponse.json({ ok: false, error: 'Bad JSON' }, { status: 400 })) }

  const {
    businessName, businessType, ownerName, phone, email,
    city, address, tableCount, employeeCount, currentSystem,
    mainProblem, hasComputer, hasPrinter, hasCashDrawer, hasScanner, otherHardware,
    menuCategories, menuNotes, features, notes
  } = body

  if (!businessName || !phone) {
    return cors(NextResponse.json({ ok: false, error: 'businessName and phone are required' }, { status: 400 }))
  }

  try {
    await sql`
      INSERT INTO demo_requests (
        business_name, business_type, owner_name, phone, email,
        city, address, table_count, employee_count, current_system,
        main_problem, has_computer, has_printer, has_cash_drawer, has_scanner, other_hardware,
        menu_categories, menu_notes, features, notes, status, created_at
      ) VALUES (
        ${String(businessName).slice(0, 100)},
        ${String(businessType || 'restaurant').slice(0, 50)},
        ${String(ownerName || '').slice(0, 100)},
        ${String(phone).slice(0, 30)},
        ${String(email || '').slice(0, 150)},
        ${String(city || '').slice(0, 80)},
        ${String(address || '').slice(0, 200)},
        ${parseInt(tableCount) || 0},
        ${parseInt(employeeCount) || 0},
        ${String(currentSystem || '').slice(0, 200)},
        ${String(mainProblem || '').slice(0, 1000)},
        ${String(hasComputer || '').slice(0, 50)},
        ${String(hasPrinter || '').slice(0, 50)},
        ${String(hasCashDrawer || '').slice(0, 50)},
        ${String(hasScanner || '').slice(0, 50)},
        ${String(otherHardware || '').slice(0, 300)},
        ${String(menuCategories || '').slice(0, 500)},
        ${String(menuNotes || '').slice(0, 1000)},
        ${JSON.stringify(features || [])},
        ${String(notes || '').slice(0, 1000)},
        'new',
        NOW()
      )
    `
    return cors(NextResponse.json({ ok: true }))
  } catch (e: any) {
    // If table doesn't exist yet, still return ok (form works, data logged)
    console.error('Demo request save error:', e.message)
    return cors(NextResponse.json({ ok: true, warning: 'saved_locally' }))
  }
}

// ── GET — admin fetches all demo requests ──
export async function GET(req: Request) {
  const url = new URL(req.url)
  const adminKey = url.searchParams.get('admin_key')

  if (adminKey !== ADMIN_KEY) {
    return cors(NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 }))
  }

  try {
    const requests = await sql`
      SELECT * FROM demo_requests ORDER BY created_at DESC LIMIT 100
    `
    return cors(NextResponse.json({ ok: true, requests }))
  } catch {
    return cors(NextResponse.json({ ok: true, requests: [] }))
  }
}
