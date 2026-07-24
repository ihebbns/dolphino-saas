'use client'
import { useState } from 'react'

const API = process.env.NEXT_PUBLIC_API_URL || ''

// Module catalogue (label + icon). Order matters for display.
const MODULES: { key: string; icon: string; label: string; desc: string }[] = [
  { key: 'tables',         icon: '🪑', label: 'Gestion des tables',   desc: 'Plan de salle, service à table' },
  { key: 'barcode',        icon: '⎸⎹', label: 'Scan code-barres',     desc: 'Douchette / lecteur (commerce)' },
  { key: 'credit',         icon: '📒', label: 'Crédit clients',       desc: 'Comptes & ardoises clients' },
  { key: 'stockTracking',  icon: '📦', label: 'Gestion de stock',     desc: 'Quantités, alertes rupture' },
  { key: 'poleDisplay',    icon: '🖥️', label: 'Afficheur client',     desc: 'Écran prix client (VFD)' },
  { key: 'kitchenTickets', icon: '🍳', label: 'Tickets cuisine',      desc: 'Bons de préparation' },
  { key: 'printEnabled',   icon: '🖨️', label: 'Impression tickets',   desc: 'Ticket de caisse client' },
  { key: 'dashboard',      icon: '📊', label: 'Tableau de bord',      desc: 'Rapports & statistiques' },
  { key: 'menuManage',     icon: '🛠️', label: 'Gestion du menu',      desc: 'Éditeur produits intégré' },
]

const DEFAULTS: Record<string, boolean> = {
  tables: false, barcode: false, credit: true, stockTracking: true,
  poleDisplay: true, kitchenTickets: true, printEnabled: true, dashboard: true, menuManage: true,
}
const PRESETS: Record<string, Record<string, boolean>> = {
  cafe:     { ...DEFAULTS, tables: true,  barcode: false, kitchenTickets: true  },
  fastfood: { ...DEFAULTS, tables: false, barcode: false, kitchenTickets: true  },
  retail:   { ...DEFAULTS, tables: false, barcode: true,  kitchenTickets: false },
}
const TYPES = [
  { id: 'fastfood', icon: '🍔', label: 'Fast Food' },
  { id: 'cafe',     icon: '☕', label: 'Café / Restaurant' },
  { id: 'retail',   icon: '🏪', label: 'Commerce / Retail' },
]

export default function SignupPage() {
  const [type, setType]         = useState('fastfood')
  const [mods, setMods]         = useState<Record<string, boolean>>({ ...PRESETS.fastfood })
  const [businessName, setBN]   = useState('')
  const [ownerName, setON]      = useState('')
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [phone, setPhone]       = useState('')
  const [city, setCity]         = useState('')
  const [err, setErr]           = useState('')
  const [loading, setLoading]   = useState(false)
  const [done, setDone]         = useState<any>(null)

  function pickType(t: string) {
    setType(t)
    setMods({ ...(PRESETS[t] || DEFAULTS) })   // preset is only a starting point
  }
  function toggle(k: string) {
    setMods(m => ({ ...m, [k]: !m[k] }))
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setErr('')
    if (!businessName.trim() || !email.trim() || !password.trim()) {
      setErr('Nom du commerce, email et mot de passe sont requis.')
      return
    }
    setLoading(true)
    try {
      const res = await fetch(`${API}/api/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessName, ownerName, email, password, phone, city, businessType: type, modules: mods }),
      })
      const data = await res.json()
      if (!data.ok) { setErr(data.error || 'Erreur'); setLoading(false); return }
      // Log the client straight into their dashboard
      localStorage.setItem('d_api_key', data.api_key)
      localStorage.setItem('d_rest_info', JSON.stringify({ name: data.name, city }))
      setDone(data)
    } catch {
      setErr('Impossible de contacter le serveur. Réessayez.')
    }
    setLoading(false)
  }

  if (done) {
    const trialEnd = done.trial_ends_at ? new Date(done.trial_ends_at).toLocaleDateString('fr-TN') : ''
    return (
      <div style={S.wrap}>
        <div style={{ ...S.box, textAlign: 'center' }}>
          <div style={{ fontSize: 46 }}>🎉</div>
          <h1 style={S.brand}>Compte créé !</h1>
          <p style={{ color: '#7A6E5F', fontSize: 14, marginBottom: 18 }}>
            Votre essai gratuit de 14 jours a démarré{trialEnd ? ` (jusqu'au ${trialEnd})` : ''}.
          </p>
          <div style={S.keyBox}>
            <div style={{ fontSize: 11, color: '#7A6E5F', marginBottom: 4 }}>VOTRE CLÉ DE LICENCE</div>
            <div style={{ fontFamily: 'monospace', fontSize: 18, color: '#E8A84C', fontWeight: 700, letterSpacing: 1 }}>{done.api_key}</div>
            <div style={{ fontSize: 11, color: '#7A6E5F', marginTop: 6 }}>Gardez-la : elle active votre application POS.</div>
          </div>
          <a href="/dashboard" style={{ ...S.btn, display: 'block', textDecoration: 'none', marginTop: 18 }}>Ouvrir mon tableau de bord →</a>
          <p style={{ fontSize: 12, color: '#7A6E5F', marginTop: 14 }}>
            Téléchargez l'application POS, lancez-la et entrez votre clé de licence pour tout configurer automatiquement.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div style={S.wrap}>
      <form style={S.box} onSubmit={submit}>
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 34 }}>⚡</div>
          <h1 style={S.brand}>Créer votre POS</h1>
          <p style={{ color: '#7A6E5F', fontSize: 13 }}>14 jours gratuits · sans carte bancaire</p>
        </div>

        {/* Business type = starting preset */}
        <label style={S.label}>Type d'activité (pré-remplit les options — modifiables)</label>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {TYPES.map(t => (
            <div key={t.id} onClick={() => pickType(t.id)} style={{ ...S.typeCard, ...(type === t.id ? S.typeCardOn : {}) }}>
              <div style={{ fontSize: 24 }}>{t.icon}</div>
              <div style={{ fontSize: 12, fontWeight: 600 }}>{t.label}</div>
            </div>
          ))}
        </div>

        {/* Individual module toggles — fully independent of the type */}
        <label style={S.label}>Fonctionnalités (activez/désactivez librement)</label>
        <div style={S.modGrid}>
          {MODULES.map(m => (
            <div key={m.key} onClick={() => toggle(m.key)}
                 style={{ ...S.modCard, ...(mods[m.key] ? S.modCardOn : {}) }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 18 }}>{m.icon}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 700 }}>{m.label}</div>
                  <div style={{ fontSize: 10, color: '#7A6E5F' }}>{m.desc}</div>
                </div>
                <span style={{ fontSize: 15 }}>{mods[m.key] ? '✅' : '⬜'}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Identity */}
        <div style={S.grid2}>
          <Field label="Nom du commerce *"><input style={S.inp} value={businessName} onChange={e => setBN(e.target.value)} placeholder="Café Milano" /></Field>
          <Field label="Votre nom"><input style={S.inp} value={ownerName} onChange={e => setON(e.target.value)} placeholder="Prénom Nom" /></Field>
          <Field label="Email *"><input style={S.inp} type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="vous@email.com" autoComplete="email" /></Field>
          <Field label="Mot de passe *"><input style={S.inp} type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="min. 6 caractères" /></Field>
          <Field label="Téléphone"><input style={S.inp} value={phone} onChange={e => setPhone(e.target.value)} placeholder="+216 XX XXX XXX" /></Field>
          <Field label="Ville"><input style={S.inp} value={city} onChange={e => setCity(e.target.value)} placeholder="Sousse, Tunisie" /></Field>
        </div>

        {err && <div style={S.err}>⚠ {err}</div>}

        <button style={{ ...S.btn, opacity: loading ? 0.6 : 1 }} disabled={loading} type="submit">
          {loading ? 'Création...' : 'Démarrer l\'essai gratuit →'}
        </button>
        <p style={{ textAlign: 'center', fontSize: 12, color: '#7A6E5F', marginTop: 14 }}>
          Déjà client ? <a href="/dashboard" style={{ color: '#E8A84C' }}>Se connecter</a>
        </p>
      </form>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={S.label}>{label}</label>
      {children}
    </div>
  )
}

const S: Record<string, React.CSSProperties> = {
  wrap: { minHeight: '100vh', background: 'radial-gradient(circle at 30% 20%,rgba(245,158,11,.08),transparent 55%),#0A0704', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, fontFamily: 'system-ui,sans-serif', color: '#F0E8D8' },
  box: { background: '#0F0C08', border: '1px solid #231C12', borderRadius: 16, padding: 28, width: '100%', maxWidth: 560, boxShadow: '0 24px 60px rgba(0,0,0,.5)' },
  brand: { fontSize: 24, fontWeight: 800, color: '#E8A84C', margin: '6px 0 2px' },
  label: { fontSize: 11, color: '#7A6E5F', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 4 },
  typeCard: { flex: 1, padding: 12, border: '2px solid #231C12', borderRadius: 10, textAlign: 'center', cursor: 'pointer', background: '#161210' },
  typeCardOn: { borderColor: '#C8913A', background: 'rgba(200,145,58,.08)' },
  modGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 18 },
  modCard: { padding: '10px 12px', border: '1px solid #231C12', borderRadius: 8, cursor: 'pointer', background: '#161210' },
  modCardOn: { borderColor: 'rgba(200,145,58,.5)', background: 'rgba(200,145,58,.06)' },
  grid2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 8 },
  inp: { background: '#161210', border: '1px solid #231C12', borderRadius: 7, padding: '10px 12px', color: '#F0E8D8', fontSize: 13, outline: 'none', width: '100%' },
  err: { background: 'rgba(224,82,82,.08)', border: '1px solid rgba(224,82,82,.3)', color: '#E05252', borderRadius: 8, padding: '10px 14px', fontSize: 13, margin: '12px 0' },
  btn: { width: '100%', padding: 14, border: 'none', borderRadius: 8, fontSize: 15, fontWeight: 700, cursor: 'pointer', background: 'linear-gradient(135deg,#C8913A,#E8A84C)', color: '#080604', marginTop: 12 },
  keyBox: { background: '#161210', border: '1px solid #231C12', borderRadius: 10, padding: 16, margin: '10px 0' },
}
