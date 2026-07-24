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
  if (!key) return cors(NextResponse.json({ ok: false, error: 'API key required' }, { status: 401 }))

  const rows = await sql`SELECT * FROM restaurants WHERE api_key=${key} AND plan NOT IN ('suspended', 'suspended_dash') LIMIT 1`
  if (!rows.length) return cors(NextResponse.json({ ok: false, error: 'Invalid key' }, { status: 403 }))
  const rest = rows[0]
  const rid = rest.id

  let date = new URL(req.url).searchParams.get('date') || ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    // Default: current business day (5 AM cutoff — same as POS)
    // If it's before 5 AM, show yesterday's business day
    const now = new Date()
    if (now.getHours() < 5) {
      now.setDate(now.getDate() - 1)
    }
    date = now.toISOString().split('T')[0]
  }

  // ═══ KPIs du jour ═══
  const [kpis] = await sql`
    SELECT
      COUNT(*)::int AS total_orders,
      COALESCE(SUM(grand),0)::float AS total_revenue,
      COALESCE(AVG(grand),0)::float AS avg_ticket,
      COALESCE(MAX(grand),0)::float AS max_ticket,
      COALESCE(MIN(CASE WHEN grand > 0 THEN grand END),0)::float AS min_ticket,
      COALESCE(SUM(CASE WHEN pay_method='cash' THEN grand ELSE 0 END),0)::float AS cash_total,
      COALESCE(SUM(CASE WHEN pay_method='card' THEN grand ELSE 0 END),0)::float AS card_total,
      COALESCE(SUM(CASE WHEN pay_method='mob'  THEN grand ELSE 0 END),0)::float AS mobile_total,
      COALESCE(SUM(CASE WHEN order_type='place' THEN 1 ELSE 0 END),0)::int AS sur_place,
      COALESCE(SUM(CASE WHEN order_type='take'  THEN 1 ELSE 0 END),0)::int AS emporter,
      COALESCE(SUM(CASE WHEN order_type='del'   THEN 1 ELSE 0 END),0)::int AS livraison,
      COALESCE(SUM(CASE WHEN order_type='table' THEN 1 ELSE 0 END),0)::int AS table_service
    FROM sales WHERE restaurant_id=${rid} AND business_date=${date}::date`

  // ═══ Comparaison vs même jour semaine dernière ═══
  const [lastWeekSameDay] = await sql`
    SELECT
      COUNT(*)::int AS orders,
      COALESCE(SUM(grand),0)::float AS revenue
    FROM sales
    WHERE restaurant_id=${rid}
      AND business_date = (${date}::date - INTERVAL '7 days')`

  // ═══ Revenu par heure (peak hours) ═══
  const hourly = await sql`
    SELECT
      CASE
        WHEN sale_time ~ '^\d{2}:\d{2}' THEN SUBSTRING(sale_time FROM 1 FOR 2)::int
        ELSE 0
      END AS hour,
      COUNT(*)::int AS orders,
      COALESCE(SUM(grand),0)::float AS revenue
    FROM sales
    WHERE restaurant_id=${rid} AND business_date=${date}::date
    GROUP BY hour ORDER BY hour`

  // ═══ Semaine (7 derniers jours) ═══
  const weekly = await sql`
    SELECT business_date::text AS day,
           COALESCE(SUM(grand),0)::float AS revenue,
           COUNT(*)::int AS orders,
           COALESCE(AVG(grand),0)::float AS avg_ticket
    FROM sales
    WHERE restaurant_id=${rid}
      AND business_date >= (${date}::date - INTERVAL '6 days')
      AND business_date <= ${date}::date
    GROUP BY business_date ORDER BY business_date ASC`

  // ═══ Top produits (best sellers) ═══
  const allSales = await sql`SELECT items FROM sales WHERE restaurant_id=${rid} AND business_date=${date}::date`
  const productStats: Record<string, { qty: number, revenue: number }> = {}
  for (const row of allSales) {
    for (const it of (row.items || [])) {
      const n = it.name || '?'
      const qty = parseInt(it.qty) || 1
      const price = parseFloat(it.price) || 0
      if (!productStats[n]) productStats[n] = { qty: 0, revenue: 0 }
      productStats[n].qty += qty
      productStats[n].revenue += price * qty
    }
  }
  const topItems = Object.entries(productStats)
    .sort((a, b) => (b[1].qty - a[1].qty) || (b[1].revenue - a[1].revenue))
    .slice(0, 15)
    .map(([name, stats]) => ({ name, qty: stats.qty, revenue: stats.revenue }))

  // Bottom items (least sold — products that might need attention)
  const bottomItems = Object.entries(productStats)
    .sort((a, b) => a[1].qty - b[1].qty)
    .slice(0, 5)
    .map(([name, stats]) => ({ name, qty: stats.qty, revenue: stats.revenue }))

  // ═══ RENTABILITÉ / BÉNÉFICE (day-accurate, from FROZEN per-line cost it.c) ═══
  // CORE RULE: profit is derived ONLY from the cost that was frozen into each
  // sale line at sale time (it.c). We NEVER read a product's *current* cost, so
  // editing a cost later cannot change any past day. A line whose `c` is missing
  // (old POS) is treated as cost 0 (never shown as guaranteed profit) and counts
  // against the "coverage" figure. A line with c=0 is a KNOWN cost (100% margin).
  const lineHasCost = (it: any) =>
    it && it.c !== undefined && it.c !== null && String(it.c) !== '' && !isNaN(parseFloat(it.c))
  const lineUnitCost = (it: any) => (lineHasCost(it) ? Math.max(0, parseFloat(it.c)) : 0)
  const lineQty = (it: any) => parseInt(it?.qty) || 1
  const linePrice = (it: any) => Math.max(0, parseFloat(it?.price ?? it?.p) || 0)

  const revenue = +kpis.total_revenue || 0     // SUM(grand) — headline revenue
  let dayCogs = 0                              // SUM(unitCost * qty)
  let dayLineRevenue = 0                       // SUM(price * qty) over all lines
  let dayLineRevenueWithCost = 0               // SUM(price * qty) over lines whose cost is KNOWN
  const prodProfit: Record<string, { qty: number; revenue: number; cost: number; linesMissingCost: number }> = {}

  for (const row of allSales) {
    for (const it of (row.items || [])) {
      const qty = lineQty(it)
      const price = linePrice(it)
      const unitCost = lineUnitCost(it)
      const lineRev = price * qty
      const lineCost = unitCost * qty
      dayCogs += lineCost
      dayLineRevenue += lineRev
      if (lineHasCost(it)) dayLineRevenueWithCost += lineRev

      const name = it.name || '?'
      if (!prodProfit[name]) prodProfit[name] = { qty: 0, revenue: 0, cost: 0, linesMissingCost: 0 }
      prodProfit[name].qty += qty
      prodProfit[name].revenue += lineRev
      prodProfit[name].cost += lineCost
      if (!lineHasCost(it)) prodProfit[name].linesMissingCost += 1
    }
  }

  const netProfit = revenue - dayCogs
  const profit = {
    revenue,
    cogs: dayCogs,
    netProfit,
    marginPct: revenue > 0 ? (netProfit / revenue) * 100 : 0,
    coveragePct: dayLineRevenue > 0 ? Math.min(100, (dayLineRevenueWithCost / dayLineRevenue) * 100) : 0,
  }

  const productProfit = Object.entries(prodProfit)
    .map(([name, p]) => ({
      name,
      qty: p.qty,
      revenue: p.revenue,
      cost: p.cost,
      profit: p.revenue - p.cost,
      marginPct: p.revenue > 0 ? ((p.revenue - p.cost) / p.revenue) * 100 : 0,
      costKnown: p.linesMissingCost === 0,   // false if ANY sold unit lacked a frozen cost
    }))
    .sort((a, b) => b.profit - a.profit)

  // ═══ Tendance bénéfice vs CA — 7 derniers jours business ═══
  const trendSales = await sql`
    SELECT business_date::text AS day, grand::float AS grand, items
    FROM sales
    WHERE restaurant_id=${rid}
      AND business_date >= (${date}::date - INTERVAL '6 days')
      AND business_date <= ${date}::date`
  const trendMap: Record<string, { revenue: number; cogs: number }> = {}
  for (const row of trendSales) {
    const d = row.day
    if (!trendMap[d]) trendMap[d] = { revenue: 0, cogs: 0 }
    trendMap[d].revenue += +row.grand || 0
    for (const it of (row.items || [])) {
      trendMap[d].cogs += lineUnitCost(it) * lineQty(it)
    }
  }
  const [tY, tM, tD] = date.split('-').map(Number)
  const profitTrend: { day: string; revenue: number; cogs: number; netProfit: number }[] = []
  for (let i = 6; i >= 0; i--) {
    const key = new Date(Date.UTC(tY, tM - 1, tD - i)).toISOString().split('T')[0]
    const e = trendMap[key] || { revenue: 0, cogs: 0 }
    profitTrend.push({ day: key, revenue: e.revenue, cogs: e.cogs, netProfit: e.revenue - e.cogs })
  }

  // ═══ Ventes récentes (50 dernières) ═══
  const recent = await sql`
    SELECT num, sale_time, order_type, grand::float, pay_method,
           cashier, disc_pct, cli_name, cli_tel,
           received::float, monnaie::float, session_id,
           items, jsonb_array_length(items) AS item_count
    FROM sales WHERE restaurant_id=${rid} AND business_date=${date}::date
    ORDER BY num DESC LIMIT 1000`

  // ═══ Performance par serveur/caissier ═══
  const byCashier = await sql`
    SELECT
      cashier,
      COUNT(*)::int AS orders,
      COALESCE(SUM(grand),0)::float AS revenue,
      COALESCE(AVG(grand),0)::float AS avg_ticket
    FROM sales
    WHERE restaurant_id=${rid} AND business_date=${date}::date AND cashier != ''
    GROUP BY cashier ORDER BY revenue DESC`

  // ═══ Sessions caisse ═══
  const sessions = await sql`
    SELECT
      id,
      session_id,
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
      ecart::float,
      cash_movements
    FROM sessions
    WHERE restaurant_id=${rid}
      AND business_date = ${date}::date
    ORDER BY closed_at DESC`

  // ═══ Stock ═══
  // Defensive: tracked / low_threshold may not be migrated yet on the live DB.
  let stock: any[]
  try {
    stock = await sql`
      SELECT item_id, item_name, item_emoji, quantity, barcode, cost, category, sell_price, tracked, low_threshold, updated_at
      FROM stock
      WHERE restaurant_id = ${rid}
      ORDER BY category ASC, item_name ASC`
  } catch {
    stock = await sql`
      SELECT item_id, item_name, item_emoji, quantity, barcode, cost, category, sell_price, updated_at
      FROM stock
      WHERE restaurant_id = ${rid}
      ORDER BY category ASC, item_name ASC`
  }

  // ═══ Valorisation du stock + alertes stock bas ═══
  // totalValue = SUM(quantity * cost) at CURRENT cost (this is a live snapshot,
  // not a historical figure). lowStock = tracked items at/under their threshold.
  let stockTotalValue = 0
  const lowStock: any[] = []
  for (const it of stock) {
    const qty = parseInt(String(it.quantity)) || 0
    const cost = Math.max(0, parseFloat(it.cost) || 0)
    stockTotalValue += qty * cost
    const tracked = (it.tracked === undefined || it.tracked === null) ? true : !!it.tracked
    const threshold = (it.low_threshold === undefined || it.low_threshold === null) ? 5 : (parseInt(String(it.low_threshold)) || 0)
    if (tracked && qty <= threshold) {
      lowStock.push({
        item_id: it.item_id,
        item_name: it.item_name,
        item_emoji: it.item_emoji || '📦',
        category: it.category || '',
        quantity: qty,
        low_threshold: threshold,
        cost,
        sell_price: Math.max(0, parseFloat(it.sell_price) || 0),
      })
    }
  }
  lowStock.sort((a, b) => a.quantity - b.quantity)
  const stockValuation = { totalValue: stockTotalValue, lowStock }

  // ═══ Peak hour identification ═══
  let peakHour = null
  let peakRevenue = 0
  for (const h of hourly) {
    if (h.revenue > peakRevenue) { peakRevenue = h.revenue; peakHour = h.hour }
  }

  // ═══ Insights (auto-generated) ═══
  const insights: string[] = []
  const todayRev = kpis.total_revenue || 0
  const lastWeekRev = lastWeekSameDay?.revenue || 0
  if (lastWeekRev > 0) {
    const change = ((todayRev - lastWeekRev) / lastWeekRev * 100).toFixed(0)
    if (todayRev > lastWeekRev) insights.push(`📈 +${change}% vs même jour la semaine dernière`)
    else if (todayRev < lastWeekRev) insights.push(`📉 ${change}% vs même jour la semaine dernière`)
    else insights.push(`➡️ Même revenu que la semaine dernière`)
  }
  if (peakHour !== null) insights.push(`⏰ Heure de pointe: ${peakHour}h00 (${peakRevenue.toFixed(3)} DT)`)
  if (topItems.length > 0) insights.push(`⭐ Produit star: ${topItems[0].name} (${topItems[0].qty} vendus)`)
  if (kpis.total_orders > 0 && kpis.avg_ticket) insights.push(`🎫 Ticket moyen: ${kpis.avg_ticket.toFixed(3)} DT`)

  return cors(NextResponse.json({
    ok: true,
    restaurant: { name: rest.name, city: rest.city },
    date,
    businessDayInfo: 'Jour business: 05h00 → 05h00 (les ventes entre minuit et 5h comptent pour le jour précédent)',
    kpis,
    comparison: {
      lastWeekOrders: lastWeekSameDay?.orders || 0,
      lastWeekRevenue: lastWeekRev,
      changePercent: lastWeekRev > 0 ? ((todayRev - lastWeekRev) / lastWeekRev * 100) : null
    },
    hourly,
    peakHour: peakHour !== null ? { hour: peakHour, revenue: peakRevenue } : null,
    weekly,
    topItems,
    bottomItems,
    byCashier,
    recent,
    sessions,
    stock,
    insights,
    // ── Cost / profit analytics (day-accurate, frozen-cost based) ──
    profit,
    productProfit,
    profitTrend,
    stockValuation,
  }))
}
