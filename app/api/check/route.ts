// ═══════════════════════════════════════════════════
// GET /api/check?key=XXX
// Called by POS app on startup + every 30min
// Returns: { ok, active, message, config, menu }
//
// - If suspended → active:false + lock message
// - If active → returns full config + menu for the POS to apply
// - If DB unreachable → active:true (don't block the app)
// ═══════════════════════════════════════════════════

import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { getApiKey } from '@/lib/auth'

export const runtime = 'edge'

// Default module set — mirrors the universal POS template's CLIENT_CONFIG.modules.
// Existing clients (no `modules` in their stored config) get this baseline; their
// old baked apps simply ignore it, so behavior is unchanged.
const DEFAULT_MODULES = {
  tables: false, barcode: false, credit: true, stockTracking: true,
  poleDisplay: true, kitchenTickets: true, printEnabled: true, dashboard: true, menuManage: true,
}

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
  if (!key) return cors(NextResponse.json({ ok: false, active: false, message: 'Clé API manquante.' }))

  try {
    const rows = await sql`
      SELECT plan, name, city, phone, config, menu_json, suspend_at,
             trial_ends_at, stripe_subscription_id
      FROM restaurants
      WHERE api_key = ${key}
      LIMIT 1
    `

    if (!rows.length) {
      return cors(NextResponse.json({
        ok: false, active: false,
        message: 'Licence non reconnue. Contactez le développeur.'
      }))
    }

    const r = rows[0]

    // Check scheduled suspend
    if (r.suspend_at && new Date(r.suspend_at) <= new Date() && r.plan === 'active') {
      // Auto-suspend has triggered — use configured target or default to 'suspended' (both)
      const cfg = (r.config && typeof r.config === 'object') ? r.config : {}
      const suspendPlan = cfg.suspend_target || 'suspended'
      await sql`UPDATE restaurants SET plan = ${suspendPlan} WHERE api_key = ${key}`
      r.plan = suspendPlan
    }

    // Free-trial expiry — only affects self-service 'trial' clients (never 'active' ones)
    if (r.plan === 'trial') {
      const expired = r.trial_ends_at && new Date(r.trial_ends_at) <= new Date()
      const hasSub  = !!r.stripe_subscription_id
      if (expired && !hasSub) {
        await sql`UPDATE restaurants SET plan = 'trial_expired' WHERE api_key = ${key}`
        r.plan = 'trial_expired'
      }
    }

    if (r.plan === 'trial_expired') {
      return cors(NextResponse.json({
        ok: true, active: false,
        message: `Votre essai gratuit est terminé.\n\nActivez votre abonnement pour continuer à utiliser l'application.`
      }))
    }

    if (r.plan === 'suspended' || r.plan === 'suspended_exe') {
      return cors(NextResponse.json({
        ok: true, active: false,
        message: `Licence suspendue.\n\nVeuillez régler votre solde pour réactiver l'application.\n\nContactez le développeur:\n📞 +216 52 050 581`
      }))
    }

    // Build config response — merge DB config with defaults
    const dbConfig = (r.config && typeof r.config === 'object') ? r.config : {}
    const dbModules = (dbConfig.modules && typeof dbConfig.modules === 'object') ? dbConfig.modules : {}
    const config = {
      restaurantName: r.name,
      restaurantCity: r.city || 'Tunisie',
      phone: r.phone || '+216 52 050 581',
      logoLetter: (r.name || 'R').charAt(0).toUpperCase(),
      tagline: `${r.name} — POS Pro`,
      currency: 'DT',
      primaryColor: '#C8913A',
      managerName: 'Manager',
      managerPin: '1234',
      cashierName: 'Caissier',
      cashierPin: '0000',
      zone1Cats: ['Pizza', 'Chapati', 'Baguette', 'Makloub'],
      zone2Cats: ['Libanais', 'Sandwichs', 'Tacos', 'Plat', 'Brik', 'Panini'],
      boissonCats: ['Boisson'],
      ...dbConfig,
      // Always send a complete module set (stored modules override the baseline).
      // Old baked apps ignore this key; the universal POS applies it at runtime.
      modules: { ...DEFAULT_MODULES, ...dbModules },
    }

    // Menu — return as-is from DB (empty object = POS uses its local default)
    const menu = (r.menu_json && typeof r.menu_json === 'object' && Object.keys(r.menu_json).length > 0)
      ? r.menu_json
      : null

    return cors(NextResponse.json({
      ok: true,
      active: true,
      name: r.name,
      config,
      menu,
    }))

  } catch (e: any) {
    // DB unreachable — don't block the app
    return cors(NextResponse.json({ ok: true, active: true, config: null, menu: null }))
  }
}
