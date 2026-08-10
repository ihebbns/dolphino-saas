import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { getApiKey } from '@/lib/auth'
import { serverError } from '@/lib/apiError'

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
  if (!key) return cors(NextResponse.json({ ok:false, error:'API key required' }, { status:401 }))

  const rows = await sql`SELECT id FROM restaurants WHERE api_key=${key} AND plan NOT IN ('suspended','suspended_exe') LIMIT 1`
  if (!rows.length) return cors(NextResponse.json({ ok:false, error:'Invalid key' }, { status:403 }))
  const rid = rows[0].id

  let sale: any
  try { sale = await req.json() } catch { return cors(NextResponse.json({ ok:false, error:'Bad JSON' }, { status:400 })) }
  if (!sale?.num || !sale?.g) return cors(NextResponse.json({ ok:false, error:'Invalid data' }, { status:400 }))

  const bizDate  = (sale.businessDate || new Date().toISOString().split('T')[0]).slice(0,10)
  const items    = JSON.stringify(sale.items || [])
  const num      = parseInt(sale.num)
  const sessionId = String(sale.sessionId ?? sale.session_id ?? '').slice(0, 64)
  // Optional per-ticket cost-of-goods-sold snapshot (POS may or may not send it).
  // Old clients that don't send `cogs` → 0. Never negative.
  const cogs      = Math.max(0, parseFloat(sale.cogs ?? sale.cogs_total) || 0)

  // A void re-posts the SAME sale (same num/business_date/cashier, so it lands
  // on the existing row via ON CONFLICT) with these fields set locally by the
  // till — see confirmVoidSale() in the POS. `sales.voided OR EXCLUDED.voided`
  // below is what makes this monotonic (see migration-sales-void.sql header).
  const voided    = sale.voided === true
  const voidReason = String(sale.voidReason ?? '').slice(0, 200)
  const voidedBy  = String(sale.voidedBy ?? '').slice(0, 80)
  const voidedAt  = sale.voidedAt ? new Date(sale.voidedAt).toISOString() : null
  // Which channel this sale started life as — 'caisse' (typed at the till,
  // the default) unless the POS is finalizing an accepted kiosk/moi order
  // (see encaisser()/finalizeOnlinePaidOrderSale()), in which case it stamps
  // the order's own source through. Purely a dashboard filter/badge — never
  // changes how the sale itself is processed.
  const source = ['kiosk', 'moi'].includes(String(sale.source)) ? String(sale.source) : 'caisse'

  try {
    // Attempt 1: fully-migrated DB (has session_id, cogs, void, AND source columns)
    try {
      await sql`
        INSERT INTO sales
          (restaurant_id,num,business_date,sale_date,sale_time,items,subtotal,discount,disc_pct,grand,pay_method,received,monnaie,order_type,cli_name,cli_tel,cashier,session_id,cogs,voided,void_reason,void_by,voided_at,source)
        VALUES
          (${rid},${num},${bizDate},${(sale.date||'').slice(0,30)},${(sale.time||'').slice(0,30)},
           ${items}::jsonb,${+sale.s||0},${+sale.d||0},${+sale.disc||0},${+sale.g},
           ${(sale.payMode||'cash').slice(0,20)},${+sale.r||+sale.g},${+sale.monnaie||0},
           ${(sale.type||'place').slice(0,20)},${(sale.cliName||'').slice(0,100)},
           ${(sale.cliTel||'').slice(0,30)},${(sale.cashier||'').slice(0,80)},${sessionId},${cogs},
           ${voided},${voidReason},${voidedBy},${voidedAt},${source})
        ON CONFLICT (restaurant_id,num,business_date,cashier)
        DO UPDATE SET session_id = EXCLUDED.session_id, cogs = EXCLUDED.cogs,
          voided      = sales.voided OR EXCLUDED.voided,
          void_reason = CASE WHEN EXCLUDED.voided THEN EXCLUDED.void_reason ELSE sales.void_reason END,
          void_by     = CASE WHEN EXCLUDED.voided THEN EXCLUDED.void_by     ELSE sales.void_by     END,
          voided_at   = CASE WHEN EXCLUDED.voided THEN COALESCE(sales.voided_at, EXCLUDED.voided_at) ELSE sales.voided_at END`
    } catch (cogsErr: any) {
      // Attempt 2: cogs column missing — keep session_id (works after the session_id migration)
      try {
        await sql`
          INSERT INTO sales
            (restaurant_id,num,business_date,sale_date,sale_time,items,subtotal,discount,disc_pct,grand,pay_method,received,monnaie,order_type,cli_name,cli_tel,cashier,session_id)
          VALUES
            (${rid},${num},${bizDate},${(sale.date||'').slice(0,30)},${(sale.time||'').slice(0,30)},
             ${items}::jsonb,${+sale.s||0},${+sale.d||0},${+sale.disc||0},${+sale.g},
             ${(sale.payMode||'cash').slice(0,20)},${+sale.r||+sale.g},${+sale.monnaie||0},
             ${(sale.type||'place').slice(0,20)},${(sale.cliName||'').slice(0,100)},
             ${(sale.cliTel||'').slice(0,30)},${(sale.cashier||'').slice(0,80)},${sessionId})
          ON CONFLICT (restaurant_id,num,business_date,cashier)
          DO UPDATE SET session_id = EXCLUDED.session_id`
      } catch (colErr: any) {
        // Attempt 3: oldest schema — no session_id and no cogs columns
        await sql`
          INSERT INTO sales
            (restaurant_id,num,business_date,sale_date,sale_time,items,subtotal,discount,disc_pct,grand,pay_method,received,monnaie,order_type,cli_name,cli_tel,cashier)
          VALUES
            (${rid},${num},${bizDate},${(sale.date||'').slice(0,30)},${(sale.time||'').slice(0,30)},
             ${items}::jsonb,${+sale.s||0},${+sale.d||0},${+sale.disc||0},${+sale.g},
             ${(sale.payMode||'cash').slice(0,20)},${+sale.r||+sale.g},${+sale.monnaie||0},
             ${(sale.type||'place').slice(0,20)},${(sale.cliName||'').slice(0,100)},
             ${(sale.cliTel||'').slice(0,30)},${(sale.cashier||'').slice(0,80)})
          ON CONFLICT (restaurant_id,num,business_date,cashier) DO NOTHING`
      }
    }
    return cors(NextResponse.json({ ok:true, num }))
  } catch(e:any) {
    return cors(NextResponse.json(serverError('sync', e), { status:500 }))
  }
}
