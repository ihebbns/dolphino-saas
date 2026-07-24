// ═══════════════════════════════════════════════════
// POST /api/signup — public self-service signup + 14-day free trial
// Body: { businessName, ownerName?, email, password, phone?, city?,
//         businessType? ('fastfood'|'cafe'|'retail'), modules? {...} }
//
// businessType only PRE-FILLS a sensible module preset. The client can freely
// override any individual module (a café can skip tables, a shop can skip barcode).
// Returns: { ok, api_key, token, name, plan, trial_ends_at }
// ═══════════════════════════════════════════════════

import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { signToken } from '@/lib/auth'
import bcrypt from 'bcryptjs'
import { randomBytes } from 'crypto'

export const runtime = 'nodejs'

const TRIAL_DAYS = 14

// Baseline modules (shared features on, verticals off)
const DEFAULT_MODULES = {
  tables: false, barcode: false, credit: true, stockTracking: true,
  poleDisplay: true, kitchenTickets: true, printEnabled: true, dashboard: true, menuManage: true,
}
// Business-type presets — only a STARTING POINT, fully overridable by the client
const PRESET_MODULES: Record<string, Record<string, boolean>> = {
  cafe:     { tables: true,  barcode: false, kitchenTickets: true  },
  fastfood: { tables: false, barcode: false, kitchenTickets: true  },
  retail:   { tables: false, barcode: true,  kitchenTickets: false },
}
const MODULE_KEYS = Object.keys(DEFAULT_MODULES)

const cors = (r: NextResponse) => {
  r.headers.set('Access-Control-Allow-Origin', '*')
  r.headers.set('Access-Control-Allow-Methods', 'POST,OPTIONS')
  r.headers.set('Access-Control-Allow-Headers', 'Content-Type')
  return r
}

export async function OPTIONS() {
  return cors(new NextResponse(null, { status: 200 }))
}

function genApiKey() {
  const rand = randomBytes(4).toString('hex').toUpperCase()   // 8 hex chars
  const num  = String(1000 + Math.floor(Math.random() * 9000)) // 4 digits
  return `SRVO-${rand}-${num}`
}

// Only accept known boolean module keys from the client
function sanitizeModules(input: any): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  if (input && typeof input === 'object') {
    for (const k of MODULE_KEYS) {
      if (typeof input[k] === 'boolean') out[k] = input[k]
    }
  }
  return out
}

export async function POST(req: Request) {
  let body: any
  try { body = await req.json() } catch { return cors(NextResponse.json({ ok: false, error: 'Bad JSON' }, { status: 400 })) }

  const businessName = String(body.businessName || '').trim().slice(0, 100)
  const ownerName    = String(body.ownerName || '').trim().slice(0, 100)
  const email        = String(body.email || '').trim().toLowerCase().slice(0, 150)
  const password     = String(body.password || '').trim()
  const phone        = String(body.phone || '').trim().slice(0, 30)
  const city         = String(body.city || '').trim().slice(0, 80)
  const businessType = ['cafe', 'fastfood', 'retail'].includes(body.businessType) ? body.businessType : 'fastfood'

  if (!businessName || !email || !password) {
    return cors(NextResponse.json({ ok: false, error: 'Nom du commerce, email et mot de passe requis.' }, { status: 400 }))
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return cors(NextResponse.json({ ok: false, error: 'Email invalide.' }, { status: 400 }))
  }
  if (password.length < 6) {
    return cors(NextResponse.json({ ok: false, error: 'Mot de passe trop court (min. 6 caractères).' }, { status: 400 }))
  }

  // Reject duplicate email up front (friendlier than a raw unique-violation)
  try {
    const existing = await sql`SELECT id FROM restaurants WHERE owner_email = ${email} LIMIT 1`
    if (existing.length) {
      return cors(NextResponse.json({ ok: false, error: 'Un compte existe déjà avec cet email.' }, { status: 409 }))
    }
  } catch { /* if the check fails we still try the insert, which enforces uniqueness */ }

  // Modules: defaults ← business-type preset ← client's explicit choices
  const modules = { ...DEFAULT_MODULES, ...(PRESET_MODULES[businessType] || {}), ...sanitizeModules(body.modules) }
  const config  = { modules, businessType, ownerName }

  const hash      = await bcrypt.hash(password, 10)
  const apiKey    = genApiKey()
  const trialEnds = new Date(Date.now() + TRIAL_DAYS * 86400000).toISOString()

  try {
    const rows = await sql`
      INSERT INTO restaurants
        (name, owner_email, password_hash, api_key, city, phone, plan, plan_tier, business_type, trial_ends_at, config)
      VALUES
        (${businessName}, ${email}, ${hash}, ${apiKey}, ${city}, ${phone}, 'trial', 'starter', ${businessType}, ${trialEnds}, ${JSON.stringify(config)}::jsonb)
      RETURNING id
    `
    const token = await signToken({ rid: rows[0].id, name: businessName, key: apiKey })
    return cors(NextResponse.json({
      ok: true,
      api_key: apiKey,
      token,
      name: businessName,
      plan: 'trial',
      trial_ends_at: trialEnds,
      modules,
    }))
  } catch (e: any) {
    // Unique violation (race) or missing columns (migration not run)
    const msg = /unique|duplicate/i.test(e.message || '')
      ? 'Un compte existe déjà avec cet email.'
      : ('Erreur création du compte: ' + (e.message || 'inconnue'))
    return cors(NextResponse.json({ ok: false, error: msg }, { status: 500 }))
  }
}
