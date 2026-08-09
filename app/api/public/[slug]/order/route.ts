// ═══════════════════════════════════════════════════
// POST /api/public/[slug]/order — a customer submits an order from the
// public ordering page. Lands as a 'pending' row in online_orders for
// staff to accept/reject from the till (see /api/me/online-orders).
//
// Body: { phone, name, items:[{id, variantLabel?, qty}], orderType, note?,
//         tableNum?, tableSec?, payMethod?, pin? }
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
//
// ── PAYING WITH WALLET BALANCE (payMethod: 'wallet') ──────────────────────
// Deliberately requires BOTH modules.wallet AND modules.walletPinProtected
// to be on — spending real balance off a bare phone number (no PIN) would
// be exactly the "anyone who knows your number can touch your money" gap
// the PIN system exists to close. A restaurant that hasn't turned on PIN
// protection simply can't offer wallet-pay online; cash-on-pickup/delivery
// (the default, unchanged) is always available regardless.
// The PIN is re-verified HERE, server-side, against the live wallets row —
// never trusted from whatever the client claims it already checked. Balance
// is deducted with a single atomic `UPDATE ... WHERE balance >= total`, so
// a double-submit or a concurrent order can't both succeed against a
// balance that only covers one of them.
// ═══════════════════════════════════════════════════

import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { serverError } from '@/lib/apiError'
import { verifyWalletPin } from '@/lib/walletPin'
import { randomUUID } from 'crypto'

export const runtime = 'nodejs'

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
  const payMethod = body?.payMethod === 'wallet' ? 'wallet' : 'cash'
  const pin = clip(body?.pin, 4)

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
  if (payMethod === 'wallet' && !phone) return NextResponse.json({ ok: false, error: 'Numéro requis pour payer par fidélité' }, { status: 400 })
  // A table's bill is shared/split/tipped at checkout — "these items were
  // already paid separately online" has no clean place to go there without
  // double-charging whoever settles the table. Wallet-pay is pickup/
  // delivery only; the /moi UI already only offers the toggle in that case,
  // this is the server-side backstop against a modified/replayed request.
  if (payMethod === 'wallet' && tableNum != null) {
    return NextResponse.json({ ok: false, error: 'Le paiement par fidélité n\'est pas disponible pour une commande à table' }, { status: 400 })
  }

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

    // ── Pay with wallet balance instead of cash-on-pickup ─────────────────
    let paidNow = false
    let walletClientKey: string | null = null
    if (payMethod === 'wallet') {
      if (modules.wallet !== true || modules.walletPinProtected !== true) {
        return NextResponse.json({ ok: false, error: 'Le paiement par fidélité n\'est pas disponible pour ce commerce' }, { status: 403 })
      }
      const result = await verifyWalletPin(sql, rid, phone, pin)
      if (result.ok === false) {
        if (result.reason === 'not_found') return NextResponse.json({ ok: false, error: 'Aucune carte fidélité trouvée pour ce numéro' }, { status: 404 })
        if (result.reason === 'no_pin') return NextResponse.json({ ok: false, error: 'Configurez d\'abord votre code PIN dans "Mon compte"' }, { status: 400 })
        if (result.reason === 'locked') return NextResponse.json({ ok: false, error: 'Compte fidélité temporairement bloqué — réessayez plus tard', locked: true, lockedUntil: result.lockedUntil }, { status: 423 })
        if (result.reason === 'wrong') return NextResponse.json({ ok: false, error: 'Code PIN incorrect', attemptsLeft: result.attemptsLeft }, { status: 401 })
        return NextResponse.json({ ok: false, error: 'Code PIN invalide' }, { status: 400 })
      }

      // Atomic check-and-deduct — the WHERE guard means a double-submit or a
      // concurrent order for the same wallet can never both succeed against
      // a balance that only covers one of them (whichever request's UPDATE
      // commits first wins; the other sees balance already too low).
      const [deducted] = await sql`
        UPDATE wallets SET balance = balance - ${total}
        WHERE restaurant_id = ${rid} AND client_key = ${result.client.client_key} AND balance >= ${total}
        RETURNING balance::float AS balance`
      if (!deducted) {
        return NextResponse.json({ ok: false, error: `Solde insuffisant (${result.client.balance.toFixed(3)} DT disponible, ${total.toFixed(3)} DT requis)` }, { status: 400 })
      }
      walletClientKey = result.client.client_key
      paidNow = true

      const itemsSummary = clip(orderItems.map(it => `${it.qty}x ${it.name}`).join(', '), 400)
      try {
        await sql`
          INSERT INTO wallet_movements (restaurant_id, client_key, kind, delta, items_summary, reason, actor, client_ts, client_uid)
          VALUES (${rid}, ${walletClientKey}, 'spend', ${-total}, ${itemsSummary}, 'Commande en ligne', 'Client (en ligne)', NOW(), ${randomUUID()})`
      } catch (e: any) {
        // Balance is already deducted at this point — the movement row is
        // the audit trail, not the source of truth for the balance itself.
        // Losing it would make reconciliation harder but never re-credits
        // or double-charges anything; logging it beats silently swallowing
        // a real inconsistency.
        console.error('[public order] wallet_movements insert failed after deduct', e?.message || e)
      }
    }

    const [row] = await sql`
      INSERT INTO online_orders (restaurant_id, client_name, client_phone, order_type, items_json, total, note, table_num, table_sec, paid, paid_by, paid_at)
      VALUES (${rid}, ${name}, ${phone}, ${orderType}, ${JSON.stringify(orderItems)}, ${total}, ${note}, ${tableNum}, ${tableSec},
              ${paidNow}, ${paidNow ? 'Client (fidélité)' : null}, ${paidNow ? new Date().toISOString() : null})
      RETURNING id`

    return NextResponse.json({
      ok: true, order_id: row.id, total, items: orderItems, paid: paidNow,
      // Order still went through with whatever WAS available — the client
      // shows this as a heads-up, not a failure.
      droppedOutOfStock: droppedOutOfStock.length ? droppedOutOfStock : undefined,
    })
  } catch (e: any) {
    return NextResponse.json(serverError('public order', e), { status: 500 })
  }
}
