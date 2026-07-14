// ═══════════════════════════════════════════════════
// POST /api/cloture
// Called by EXE on Clôture — saves full session data
// ═══════════════════════════════════════════════════
import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { getApiKey } from '@/lib/auth'

export const runtime = 'edge'

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
  const key = getApiKey(req)
  if (!key) return cors(NextResponse.json({ ok: false, error: 'API key required' }, { status: 401 }))

  const rows = await sql`SELECT id FROM restaurants WHERE api_key=${key} AND plan!='suspended' LIMIT 1`
  if (!rows.length) return cors(NextResponse.json({ ok: false, error: 'Invalid key' }, { status: 403 }))
  const rid = rows[0].id

  let body: any
  try { body = await req.json() } catch { return cors(NextResponse.json({ ok: false, error: 'Bad JSON' }, { status: 400 })) }

  const bizDate      = (body.businessDate || new Date().toISOString().split('T')[0]).slice(0, 10)
  const total        = parseFloat(body.total)        || 0
  const ordersCount  = parseInt(body.ordersCount)    || 0
  const cashTotal    = parseFloat(body.cashTotal)    || 0
  const cardTotal    = parseFloat(body.cardTotal)    || 0
  const mobileTotal  = parseFloat(body.mobileTotal)  || 0
  const fondInitial  = parseFloat(body.fondInitial)  || 0
  const montantCompte= parseFloat(body.montantCompte)|| 0
  const theorique    = parseFloat(body.theorique)    || 0
  const ecart        = parseFloat(body.ecart)        || 0
  const cashier      = (body.cashier || '').slice(0, 80)

  // Save to day_closures (full data with ecart)
  await sql`
    INSERT INTO day_closures
      (restaurant_id, business_date, total, orders_count, cash_total, card_total,
       mobile_total, fond_initial, montant_compte, theorique, ecart, cashier, closed_at)
    VALUES
      (${rid}, ${bizDate}::date, ${total}, ${ordersCount}, ${cashTotal}, ${cardTotal},
       ${mobileTotal}, ${fondInitial}, ${montantCompte}, ${theorique}, ${ecart}, ${cashier}, NOW())
    ON CONFLICT (restaurant_id, business_date)
    DO UPDATE SET
      total=${total}, orders_count=${ordersCount},
      cash_total=${cashTotal}, card_total=${cardTotal}, mobile_total=${mobileTotal},
      fond_initial=${fondInitial}, montant_compte=${montantCompte},
      theorique=${theorique}, ecart=${ecart}, cashier=${cashier}, closed_at=NOW()
  `

  // Also save to sessions table
  await sql`
    INSERT INTO sessions
      (restaurant_id, business_date, cashier, opened_at, closed_at,
       fond_initial, total_sales, orders_count, cash_sales, card_sales,
       mobile_sales, montant_compte, theorique, ecart)
    VALUES
      (${rid}, ${bizDate}::date, ${cashier}, NOW(), NOW(),
       ${fondInitial}, ${total}, ${ordersCount}, ${cashTotal}, ${cardTotal},
       ${mobileTotal}, ${montantCompte}, ${theorique}, ${ecart})
    ON CONFLICT (restaurant_id, business_date)
    DO UPDATE SET
      total_sales=${total}, orders_count=${ordersCount},
      cash_sales=${cashTotal}, card_sales=${cardTotal}, mobile_sales=${mobileTotal},
      fond_initial=${fondInitial}, montant_compte=${montantCompte},
      theorique=${theorique}, ecart=${ecart}, cashier=${cashier}, closed_at=NOW()
  `

  return cors(NextResponse.json({ ok: true, businessDate: bizDate }))
}
