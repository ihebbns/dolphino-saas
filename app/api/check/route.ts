// ═══════════════════════════════════════════════════
// GET /api/check?key=XXX
// Called by POS app on startup + every 30min
// Returns: { ok, active, message, config }
// ═══════════════════════════════════════════════════

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
  if (!key) return cors(NextResponse.json({ ok: false, active: false, message: 'Clé API manquante.' }))

  try {
    const rows = await sql`
      SELECT plan, name, city, phone, config FROM restaurants WHERE api_key = ${key} LIMIT 1
    `

    if (!rows.length) {
      return cors(NextResponse.json({
        ok: false, active: false,
        message: 'Licence non reconnue. Contactez le développeur.'
      }))
    }

    const r = rows[0]

    if (r.plan === 'suspended') {
      return cors(NextResponse.json({
        ok: true, active: false,
        message: `Licence suspendue.\n\nVeuillez régler votre solde pour réactiver l'application.\n\nContactez le développeur:\n📞 +216 52 050 581`
      }))
    }

    // Default config if none set
    const defaultConfig = {
      restaurantName: r.name,
      restaurantCity: r.city || 'Tunisie',
      logo: '🐬',
      primaryColor: '#C8913A',
      cuisine1Cats: ['Pizza', 'Chapati', 'Baguette', 'Makloub'],
      cuisine2Cats: ['Libanais', 'Sandwichs', 'Tacos', 'Plat', 'Brik', 'Panini'],
      boissonCats:  ['Boisson'],
      phone: r.phone || '+216 52 050 581'
    }

    const config = { ...defaultConfig, ...(r.config && typeof r.config === 'object' ? r.config : {}) }

    return cors(NextResponse.json({
      ok: true,
      active: true,
      name: r.name,
      config
    }))

  } catch(e: any) {
    // DB unreachable — don't block the app
    return cors(NextResponse.json({ ok: true, active: true, config: null }))
  }
}
