// ═══════════════════════════════════════════════════
// GET /api/public/[slug]/menu — the ONE public, unauthenticated read for the
// customer-facing ordering page (servio.tn/moi/<slug>).
//
// Deliberately resolves by public_slug, NEVER by api_key — that credential
// drives the POS/dashboard sync and must never be reachable from a link a
// customer can screenshot or forward. This route returns only what a
// stranger is allowed to see: identity for branding, and the menu with
// SELLING price only (no cost, no barcode, no internal ids beyond what the
// POS already exposes to every cashier).
// ═══════════════════════════════════════════════════

import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { serverError } from '@/lib/apiError'

export const runtime = 'edge'

function itemPrice(it: any): number {
  if (Array.isArray(it?.v) && it.v.length) {
    const prices = it.v.map((v: any) => Number(v?.p) || 0).filter((n: number) => n > 0)
    return prices.length ? Math.min(...prices) : 0
  }
  return Number(it?.p) || 0
}

export async function GET(_req: Request, { params }: { params: { slug: string } }) {
  const slug = String(params.slug || '').slice(0, 60)
  if (!slug) return NextResponse.json({ ok: false, error: 'Lien invalide' }, { status: 400 })

  try {
    const rows = await sql`
      SELECT id, name, config, menu_json FROM restaurants
      WHERE public_slug = ${slug} AND plan NOT IN ('suspended', 'suspended_exe')
      LIMIT 1`
    if (!rows.length) return NextResponse.json({ ok: false, error: 'Commerce introuvable' }, { status: 404 })

    const r = rows[0]
    const config = (r.config && typeof r.config === 'object') ? r.config : {}
    const modules = (config.modules && typeof config.modules === 'object') ? config.modules : {}
    const onlineOrdersEnabled = modules.onlineOrders === true

    // A restaurant that hasn't turned online ordering on at all shouldn't
    // have its catalog/pricing sitting in this response either — the UI
    // already refuses to let anyone order (see /moi's "not available"
    // screen), but the full menu was still being fetched and handed to the
    // client underneath that message, visible to anyone who opens the
    // network tab. No menu, no stock lookup, nothing to leak. walletEnabled
    // stays accurate either way — checking a loyalty balance is unrelated
    // to whether this restaurant takes online orders.
    const menu: Record<string, any> = {}
    if (onlineOrdersEnabled) {
      const menuRaw = (r.menu_json && typeof r.menu_json === 'object') ? r.menu_json : {}

      // Same gate the POS itself uses (isStockEnabled()) — rupture only means
      // something once stock is actually being tracked for this client.
      let outOfStock = new Set<string>()
      if (modules.stockTracking !== false) {
        const stockRows = await sql`
          SELECT item_id FROM stock WHERE restaurant_id = ${r.id} AND is_available = FALSE`
        outOfStock = new Set(stockRows.map((s: any) => String(s.item_id)))
      }

      // Strip to exactly what a customer needs to browse and order — no cost,
      // no barcode, no track_mode, nothing internal. Out-of-stock items stay
      // visible but flagged, not hidden — same as a real kiosk shows a
      // grayed-out "sold out" tile rather than making the item vanish.
      for (const [catName, catVal] of Object.entries<any>(menuRaw)) {
        const items = Array.isArray(catVal) ? catVal : (catVal?.items ?? [])
        const cleanItems = items
          .filter((it: any) => it && it.name)
          .map((it: any) => ({
            id: String(it.id ?? ''),
            name: String(it.name).slice(0, 100),
            e: String(it.e || it.emoji || '🍽️').slice(0, 10),
            price: itemPrice(it),
            variants: Array.isArray(it.v) ? it.v.map((v: any) => ({ label: String(v?.l || ''), price: Number(v?.p) || 0 })) : null,
            available: !outOfStock.has(String(it.id ?? '')),
          }))
        if (cleanItems.length) menu[catName] = { icon: catVal?.icon || '📦', items: cleanItems }
      }
    }

    return NextResponse.json({
      ok: true,
      name: r.name,
      logo: config.logo || '🏪',
      tagline: config.tagline || '',
      currency: config.currency || 'DT',
      onlineOrdersEnabled,
      walletEnabled: modules.wallet === true,
      // Wallet-pay (paying for an order with balance, not just viewing it)
      // additionally requires PIN protection — see /api/public/[slug]/order.
      walletPayEnabled: modules.wallet === true && modules.walletPinProtected === true,
      menu,
    })
  } catch (e: any) {
    return NextResponse.json(serverError('public menu', e), { status: 500 })
  }
}
