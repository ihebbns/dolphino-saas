// ═══════════════════════════════════════════════════
// POST /api/public/[slug]/order — a customer submits an order from the
// public ordering page. Lands as a 'pending' row in online_orders for
// staff to accept/reject from the till (see /api/me/online-orders).
//
// Body: { phone, name, items:[{id, variantLabel?, qty}], orderType, note?,
//         tableNum?, tableSec? }
//
// tableNum/tableSec come from a table's QR code (/moi/<slug>?table=N&sec=SEC)
// — when present, the till's accept flow merges the items straight onto
// that table's running tab instead of the generic pickup/delivery queue
// (see window.tblMergeOnlineOrder in the table-service POS). Forces
// orderType to 'sur_place' since a table order is definitionally dine-in.
//
// SECURITY: this is an unauthenticated public endpoint. The one rule that
// matters — prices and item existence are ALWAYS recomputed from the live
// menu_json server-side. A public endpoint can never be trusted to report
// its own total; every field from the request body is treated as "which
// item, how many", never "how much it costs".
// ═══════════════════════════════════════════════════

import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { serverError } from '@/lib/apiError'

export const runtime = 'edge'

const clip = (v: any, n: number) => String(v ?? '').slice(0, n)
const ORDER_TYPES = ['sur_place', 'emporter', 'livraison']

export async function POST(req: Request, { params }: { params: { slug: string } }) {
  const slug = String(params.slug || '').slice(0, 60)
  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ ok: false, error: 'Bad JSON' }, { status: 400 }) }

  const phone = clip(body?.phone, 40).replace(/\s+/g, '')
  const name = clip(body?.name, 120).trim()
  const note = clip(body?.note, 300)
  const reqItems: any[] = Array.isArray(body?.items) ? body.items.slice(0, 50) : []

  const tableNumRaw = parseInt(String(body?.tableNum))
  const tableNum = Number.isFinite(tableNumRaw) && tableNumRaw > 0 ? tableNumRaw : null
  const tableSec = tableNum != null ? clip(body?.tableSec, 80) : null
  // A table order is dine-in by definition — the customer is sitting at it
  // right now, regardless of whatever the ordering page's own type selector
  // (built before table-QR ordering existed) happened to send.
  const orderType = tableNum != null ? 'sur_place' : (ORDER_TYPES.includes(body?.orderType) ? body.orderType : 'emporter')

  if (!slug) return NextResponse.json({ ok: false, error: 'Lien invalide' }, { status: 400 })
  // Phone is optional here (kiosk orders are a walk-up name-only flow) — the
  // customer-account page (/moi/[slug]) still collects it in its own UI since
  // it doubles as the wallet-lookup identity there; this is just the floor.
  if (!name) return NextResponse.json({ ok: false, error: 'Nom requis' }, { status: 400 })
  if (!reqItems.length) return NextResponse.json({ ok: false, error: 'Panier vide' }, { status: 400 })

  try {
    const rest = await sql`
      SELECT id, config, menu_json FROM restaurants
      WHERE public_slug = ${slug} AND plan NOT IN ('suspended', 'suspended_exe') LIMIT 1`
    if (!rest.length) return NextResponse.json({ ok: false, error: 'Commerce introuvable' }, { status: 404 })
    const rid = rest[0].id
    const modules = (rest[0].config?.modules && typeof rest[0].config.modules === 'object') ? rest[0].config.modules : {}
    if (modules.onlineOrders !== true) {
      return NextResponse.json({ ok: false, error: 'Les commandes en ligne ne sont pas activées pour ce commerce' }, { status: 403 })
    }

    // Flatten the live menu into a lookup by item id, keeping each variant's
    // own price — this is the ONLY source of truth for what gets charged.
    // Also keep the category name each item came from (Object.entries, not
    // .values) — the till's kitchen-zone routing matches on category
    // (ZONE1_CATS/ZONE2_CATS/etc. check item.cat), and without it here an
    // online/QR order's items carry no category at all, so they can silently
    // match NO kitchen zone and never print a kitchen ticket anywhere.
    const menuRaw = (rest[0].menu_json && typeof rest[0].menu_json === 'object') ? rest[0].menu_json : {}
    const byId = new Map<string, any>()
    for (const [catName, catVal] of Object.entries<any>(menuRaw)) {
      const items = Array.isArray(catVal) ? catVal : (catVal?.items ?? [])
      for (const it of items) if (it?.id) byId.set(String(it.id), { ...it, __cat: catName })
    }

    // Same rupture flag the till itself blocks a sale on — a stale client
    // menu (customer had the page open while staff marked something out)
    // can never sneak a rupture item into a paid order. Same module gate as
    // the menu route: rupture only means something once stock is tracked.
    let outOfStock = new Set<string>()
    if (modules.stockTracking !== false) {
      const stockRows = await sql`
        SELECT item_id FROM stock WHERE restaurant_id = ${rid} AND is_available = FALSE`
      outOfStock = new Set(stockRows.map((s: any) => String(s.item_id)))
    }

    const orderItems: any[] = []
    let total = 0
    const droppedOutOfStock: string[] = []
    for (const ri of reqItems) {
      const menuItem = byId.get(clip(ri?.id, 64))
      if (!menuItem) continue // unknown/stale item id — silently dropped, never trusted
      if (outOfStock.has(String(menuItem.id))) { droppedOutOfStock.push(menuItem.name); continue }
      const qty = Math.max(1, Math.min(20, parseInt(String(ri?.qty)) || 1))

      let price: number, variantLabel = ''
      if (Array.isArray(menuItem.v) && menuItem.v.length) {
        const variant = menuItem.v.find((v: any) => v?.l === ri?.variantLabel) || menuItem.v[0]
        price = Number(variant?.p) || 0
        variantLabel = String(variant?.l || '')
      } else {
        price = Number(menuItem.p) || 0
      }
      if (!(price > 0)) continue

      orderItems.push({ id: menuItem.id, name: menuItem.name, e: menuItem.e || '🍽️', p: price, qty, variant: variantLabel, cat: menuItem.__cat || '' })
      total += price * qty
    }

    if (!orderItems.length) {
      const error = droppedOutOfStock.length
        ? `Rupture de stock : ${droppedOutOfStock.join(', ')}`
        : 'Aucun article valide'
      return NextResponse.json({ ok: false, error }, { status: 400 })
    }
    total = Math.round(total * 1000) / 1000

    const [row] = await sql`
      INSERT INTO online_orders (restaurant_id, client_name, client_phone, order_type, items_json, total, note, table_num, table_sec)
      VALUES (${rid}, ${name}, ${phone}, ${orderType}, ${JSON.stringify(orderItems)}, ${total}, ${note}, ${tableNum}, ${tableSec})
      RETURNING id`

    return NextResponse.json({
      ok: true, order_id: row.id, total, items: orderItems,
      // Order still went through with whatever WAS available — the client
      // shows this as a heads-up, not a failure.
      droppedOutOfStock: droppedOutOfStock.length ? droppedOutOfStock : undefined,
    })
  } catch (e: any) {
    return NextResponse.json(serverError('public order', e), { status: 500 })
  }
}
