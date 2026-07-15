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
  if (!key) return cors(NextResponse.json({ ok:false, error:'API key required' }, { status:401 }))

  const rows = await sql`SELECT * FROM restaurants WHERE api_key=${key} AND plan!='suspended' LIMIT 1`
  if (!rows.length) return cors(NextResponse.json({ ok:false, error:'Invalid key' }, { status:403 }))
  const rest = rows[0]
  const rid  = rest.id

  let date = new URL(req.url).searchParams.get('date') || new Date().toISOString().split('T')[0]
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) date = new Date().toISOString().split('T')[0]

  // KPIs
  const [kpis] = await sql`
    SELECT
      COUNT(*)::int AS total_orders,
      COALESCE(SUM(grand),0)::float AS total_revenue,
      COALESCE(AVG(grand),0)::float AS avg_ticket,
      COALESCE(SUM(CASE WHEN pay_method='cash' THEN grand ELSE 0 END),0)::float AS cash_total,
      COALESCE(SUM(CASE WHEN pay_method='card' THEN grand ELSE 0 END),0)::float AS card_total,
      COALESCE(SUM(CASE WHEN pay_method='mob'  THEN grand ELSE 0 END),0)::float AS mobile_total,
      COALESCE(SUM(CASE WHEN order_type='place' THEN 1 ELSE 0 END),0)::int AS sur_place,
      COALESCE(SUM(CASE WHEN order_type='take'  THEN 1 ELSE 0 END),0)::int AS emporter,
      COALESCE(SUM(CASE WHEN order_type='del'   THEN 1 ELSE 0 END),0)::int AS livraison
    FROM sales WHERE restaurant_id=${rid} AND business_date=${date}::date`

  // Weekly
  const weekly = await sql`
    SELECT business_date::text AS day,
           COALESCE(SUM(grand),0)::float AS revenue,
           COUNT(*)::int AS orders
    FROM sales
    WHERE restaurant_id=${rid}
      AND business_date >= (${date}::date - INTERVAL '6 days')
      AND business_date <= ${date}::date
    GROUP BY business_date ORDER BY business_date ASC`

  // Top items
  const allSales = await sql`SELECT items FROM sales WHERE restaurant_id=${rid} AND business_date=${date}::date`
  const counts: Record<string,number> = {}
  for (const row of allSales) {
    for (const it of (row.items||[])) {
      const n = it.name||'?'
      counts[n] = (counts[n]||0) + (parseInt(it.qty)||1)
    }
  }
  const topItems = Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([name,qty])=>({name,qty}))

  // Recent sales — include full items for click-to-detail
  const recent = await sql`
    SELECT num, sale_time, order_type, grand::float, pay_method,
           cashier, disc_pct, cli_name, cli_tel,
           items, jsonb_array_length(items) AS item_count
    FROM sales WHERE restaurant_id=${rid} AND business_date=${date}::date
    ORDER BY num DESC LIMIT 50`

  // Sessions — filtered by selected date
  const sessions = await sql`
    SELECT
      business_date::text AS day,
      cashier,
      opened_at,
      closed_at,
      fond_initial::float,
      total_sales::float,
      orders_count,
      cash_sales::float,
      card_sales::float,
      mobile_sales::float,
      montant_compte::float,
      theorique::float,
      ecart::float
    FROM sessions
    WHERE restaurant_id=${rid}
      AND business_date = ${date}::date
    ORDER BY closed_at DESC`

  return cors(NextResponse.json({
    ok:true,
    restaurant:{ name:rest.name, city:rest.city },
    date, kpis, weekly, topItems, recent, sessions
  }))
}
