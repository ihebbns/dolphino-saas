'use client'
import { useState, useEffect } from 'react'

const API = process.env.NEXT_PUBLIC_API_URL || ''

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

export default function AccountPage() {
  const [apiKey, setApiKey] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)
  const [msg, setMsg]         = useState('')
  const [data, setData]       = useState<any>(null)

  // form state
  const [name, setName]       = useState('')
  const [logo, setLogo]       = useState('🍽️')
  const [letter, setLetter]   = useState('')
  const [tagline, setTagline] = useState('')
  const [city, setCity]       = useState('')
  const [phone, setPhone]     = useState('')
  const [mods, setMods]       = useState<Record<string, boolean>>({})

  useEffect(() => {
    const k = localStorage.getItem('d_api_key')
    if (!k) { setLoading(false); return }
    setApiKey(k)
    ;(async () => {
      try {
        const res = await fetch(`${API}/api/me/config?key=${encodeURIComponent(k)}`)
        const d = await res.json()
        if (d.ok) {
          setData(d)
          setName(d.name || '')
          setCity(d.city || '')
          setPhone(d.phone || '')
          setLogo(d.config?.logo || '🍽️')
          setLetter(d.config?.logoLetter || (d.name || 'R').charAt(0).toUpperCase())
          setTagline(d.config?.tagline || '')
          setMods(d.modules || {})
        } else { setMsg(d.error || 'Erreur de chargement') }
      } catch { setMsg('Impossible de contacter le serveur.') }
      setLoading(false)
    })()
  }, [])

  function toggle(k: string) { setMods(m => ({ ...m, [k]: !m[k] })) }

  async function save() {
    if (!apiKey) return
    setSaving(true); setMsg('')
    try {
      const res = await fetch(`${API}/api/me/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: apiKey, name, logo, logoLetter: letter, tagline, city, phone, modules: mods }),
      })
      const d = await res.json()
      setMsg(d.ok ? '✓ Enregistré. Les caisses se mettent à jour sous ~30 min (ou au redémarrage).' : ('Erreur: ' + (d.error || '')))
    } catch { setMsg('Erreur réseau.') }
    setSaving(false)
  }

  if (loading) return <div style={S.wrap}><div style={S.box}>Chargement…</div></div>

  if (!apiKey) return (
    <div style={S.wrap}>
      <div style={{ ...S.box, textAlign: 'center' }}>
        <div style={{ fontSize: 34 }}>🔒</div>
        <h1 style={S.brand}>Connexion requise</h1>
        <p style={{ color: '#7A6E5F', fontSize: 13, marginBottom: 16 }}>Connectez-vous pour gérer votre compte.</p>
        <a href="/dashboard" style={{ ...S.btn, display: 'block', textDecoration: 'none' }}>Se connecter →</a>
      </div>
    </div>
  )

  const plan = data?.plan
  const trialEnd = data?.trial_ends_at ? new Date(data.trial_ends_at) : null
  const daysLeft = trialEnd ? Math.ceil((trialEnd.getTime() - Date.now()) / 86400000) : null

  return (
    <div style={S.wrap}>
      <div style={{ ...S.box, maxWidth: 640 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h1 style={S.brand}>⚙️ Mon compte</h1>
          <a href="/dashboard" style={{ color: '#E8A84C', fontSize: 13, textDecoration: 'none' }}>← Tableau de bord</a>
        </div>

        {/* Plan / trial banner */}
        <div style={{ ...S.banner, ...(plan === 'trial' ? S.bannerTrial : plan === 'active' ? S.bannerOk : S.bannerWarn) }}>
          {plan === 'trial' && <>🎁 Essai gratuit — {daysLeft != null && daysLeft >= 0 ? `${daysLeft} jour(s) restant(s)` : 'expiré'}. Contactez-nous pour vous abonner.</>}
          {plan === 'active' && <>✅ Abonnement actif. Merci !</>}
          {plan === 'trial_expired' && <>⛔ Essai terminé — contactez-nous pour réactiver.</>}
          {(plan === 'suspended' || plan === 'suspended_exe' || plan === 'suspended_dash') && <>⛔ Compte suspendu — régularisez pour réactiver.</>}
        </div>

        {/* Identity */}
        <div style={S.grid2}>
          <F label="Nom du commerce"><input style={S.inp} value={name} onChange={e => setName(e.target.value)} /></F>
          <F label="Slogan"><input style={S.inp} value={tagline} onChange={e => setTagline(e.target.value)} placeholder="ex: Café & Restaurant" /></F>
          <F label="Logo (emoji)"><input style={S.inp} value={logo} onChange={e => setLogo(e.target.value)} /></F>
          <F label="Lettre du logo"><input style={S.inp} value={letter} maxLength={2} onChange={e => setLetter(e.target.value.toUpperCase())} /></F>
          <F label="Ville"><input style={S.inp} value={city} onChange={e => setCity(e.target.value)} /></F>
          <F label="Téléphone"><input style={S.inp} value={phone} onChange={e => setPhone(e.target.value)} /></F>
        </div>

        {/* Modules */}
        <div style={{ ...S.label, marginTop: 18 }}>Fonctionnalités (activez / désactivez)</div>
        <div style={S.modGrid}>
          {MODULES.map(m => (
            <div key={m.key} onClick={() => toggle(m.key)} style={{ ...S.modCard, ...(mods[m.key] ? S.modCardOn : {}) }}>
              <span style={{ fontSize: 18 }}>{m.icon}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 700 }}>{m.label}</div>
                <div style={{ fontSize: 10, color: '#7A6E5F' }}>{m.desc}</div>
              </div>
              <span style={{ fontSize: 15 }}>{mods[m.key] ? '✅' : '⬜'}</span>
            </div>
          ))}
        </div>

        {msg && <div style={S.note}>{msg}</div>}

        <button style={{ ...S.btn, opacity: saving ? 0.6 : 1 }} disabled={saving} onClick={save}>
          {saving ? 'Enregistrement…' : 'Enregistrer les modifications'}
        </button>
        <p style={{ fontSize: 11, color: '#7A6E5F', textAlign: 'center', marginTop: 10 }}>
          Clé de licence : <span style={{ fontFamily: 'monospace', color: '#E8A84C' }}>{apiKey}</span>
        </p>
      </div>
    </div>
  )
}

function F({ label, children }: { label: string; children: React.ReactNode }) {
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}><label style={S.label}>{label}</label>{children}</div>
}

const S: Record<string, React.CSSProperties> = {
  wrap: { minHeight: '100vh', background: 'radial-gradient(circle at 30% 20%,rgba(245,158,11,.08),transparent 55%),#0A0704', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, fontFamily: 'system-ui,sans-serif', color: '#F0E8D8' },
  box: { background: '#0F0C08', border: '1px solid #231C12', borderRadius: 16, padding: 28, width: '100%', maxWidth: 560, boxShadow: '0 24px 60px rgba(0,0,0,.5)' },
  brand: { fontSize: 22, fontWeight: 800, color: '#E8A84C', margin: 0 },
  label: { fontSize: 11, color: '#7A6E5F', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 4 },
  grid2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 },
  inp: { background: '#161210', border: '1px solid #231C12', borderRadius: 7, padding: '10px 12px', color: '#F0E8D8', fontSize: 13, outline: 'none', width: '100%' },
  modGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 6 },
  modCard: { display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', border: '1px solid #231C12', borderRadius: 8, cursor: 'pointer', background: '#161210' },
  modCardOn: { borderColor: 'rgba(200,145,58,.5)', background: 'rgba(200,145,58,.06)' },
  btn: { width: '100%', padding: 14, border: 'none', borderRadius: 8, fontSize: 15, fontWeight: 700, cursor: 'pointer', background: 'linear-gradient(135deg,#C8913A,#E8A84C)', color: '#080604', marginTop: 16 },
  banner: { borderRadius: 10, padding: '12px 14px', fontSize: 13, marginBottom: 18, border: '1px solid #231C12' },
  bannerTrial: { background: 'rgba(200,145,58,.08)', borderColor: 'rgba(200,145,58,.3)', color: '#E8A84C' },
  bannerOk: { background: 'rgba(61,184,122,.08)', borderColor: 'rgba(61,184,122,.3)', color: '#3DB87A' },
  bannerWarn: { background: 'rgba(224,82,82,.08)', borderColor: 'rgba(224,82,82,.3)', color: '#E05252' },
  note: { background: '#161210', border: '1px solid #231C12', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: '#F0E8D8', marginTop: 14 },
}
