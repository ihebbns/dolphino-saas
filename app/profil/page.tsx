'use client'
// ═══════════════════════════════════════════════════════════════════
// Profil — one place for "me and my account".
//
// Replaces Établissement in the navigation. The owner had two settings
// destinations and no obvious home for their own credentials; now there is one.
//
// SCOPE NOTE — this is presentation only, as asked. The establishment details
// section reuses the existing /api/me/config endpoint, so it saves for real.
// Password change and staff accounts are rendered as the real forms but are
// DISABLED, because the backend for them does not exist yet: today the API key
// IS the password, and there are no per-person web accounts. Shipping fake
// inputs that silently do nothing would be worse than saying so.
// ═══════════════════════════════════════════════════════════════════
import { useEffect, useState } from 'react'
import { Shell, LoginGate, Loading, useApiKey, apiGet, apiPost, Icon } from '../ui/Shell'

export default function ProfilPage() {
  const { key, checked } = useApiKey()
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState('')
  const [restName, setRestName] = useState('')
  const [city, setCity] = useState('')
  const [phone, setPhone] = useState('')
  const [plan, setPlan] = useState('')
  const [saving, setSaving] = useState(false)
  const [reveal, setReveal] = useState(false)
  const [pwEmail, setPwEmail] = useState('')
  const [pwCur, setPwCur] = useState('')
  const [pwNew, setPwNew] = useState('')
  const [pwBusy, setPwBusy] = useState(false)

  async function changePassword() {
    setPwBusy(true); setMsg('')
    const d = await apiPost('/api/me/password', { email: pwEmail, current: pwCur, next: pwNew })
    setPwBusy(false)
    if (d.ok) {
      setPwCur(''); setPwNew('')
      setMsg('✓ Mot de passe modifié' + (d.upgraded ? ' et sécurisé' : ''))
    } else setMsg(d.error || 'Erreur')
  }

  useEffect(() => { if (checked && key) load(key) }, [checked, key])

  async function load(k: string) {
    setLoading(true)
    const d = await apiGet('/api/me/config', k)
    if (d.ok) {
      setRestName(d.name || '')
      setCity(d.city || '')
      setPhone(d.phone || '')
      setPlan(d.plan || '')
    } else setMsg(d.error || 'Chargement impossible')
    setLoading(false)
  }

  async function save() {
    if (!key) return
    setSaving(true); setMsg('')
    const d = await apiPost('/api/me/config', { key, name: restName, city, phone })
    setSaving(false)
    setMsg(d.ok ? '✓ Enregistré' : (d.error || 'Erreur'))
  }

  if (!checked) return null
  if (!key) return <LoginGate />

  const masked = key.length > 8 ? key.slice(0, 4) + '••••••••' + key.slice(-4) : '••••••••'

  return (
    <Shell active="/profil" title="Profil" subtitle="Votre compte et votre établissement" restName={restName}>
      {msg && (
        <div className={'notice ' + (msg.startsWith('✓') ? 'nOk' : 'nDanger')}>
          <span className="noticeIcon"><Icon name={msg.startsWith('✓') ? 'check' : 'close'} size={16} /></span>
          <div>{msg}</div>
        </div>
      )}

      {loading ? <Loading /> : (
        <>
          {/* ── Établissement ─────────────────────────────────────── */}
          <div className="card mb14">
            <div className="cardPad">
              <div className="strong mb14">Établissement</div>

              <div className="field mb14">
                <label className="label" htmlFor="pf-name">Nom</label>
                <input id="pf-name" className="input" value={restName} onChange={e => setRestName(e.target.value)} />
              </div>
              <div className="field mb14">
                <label className="label" htmlFor="pf-city">Ville</label>
                <input id="pf-city" className="input" value={city} onChange={e => setCity(e.target.value)} />
              </div>
              <div className="field mb14">
                <label className="label" htmlFor="pf-phone">Téléphone</label>
                <input id="pf-phone" className="input" value={phone} onChange={e => setPhone(e.target.value)} />
              </div>

              <button className="btn btnPrimary" onClick={save} disabled={saving}>
                {saving ? 'Enregistrement…' : 'Enregistrer'}
              </button>
            </div>
          </div>

          {/* Licence key hidden — the client does not need to see or manage it,
              and exposing it invites sharing it, which is the one credential that
              gives full access to their data. */}

          {/* ── Mot de passe ──────────────────────────────────────── */}
          {/* Authenticated by the current password, not by the api_key stored in
              this browser — otherwise anyone with access to a terminal could
              take over the account. */}
          <div className="card mb14">
            <div className="cardPad">
              <div className="strong mb14">Mot de passe</div>

              <div className="field mb14">
                <label className="label" htmlFor="pf-email">Email du compte</label>
                <input id="pf-email" className="input" type="email" value={pwEmail}
                  onChange={e => setPwEmail(e.target.value)} autoComplete="username" />
              </div>
              <div className="field mb14">
                <label className="label" htmlFor="pf-old">Mot de passe actuel</label>
                <input id="pf-old" className="input" type="password" value={pwCur}
                  onChange={e => setPwCur(e.target.value)} autoComplete="current-password" />
              </div>
              <div className="field mb14">
                <label className="label" htmlFor="pf-new">Nouveau mot de passe</label>
                <input id="pf-new" className="input" type="password" value={pwNew}
                  onChange={e => setPwNew(e.target.value)} autoComplete="new-password" />
                <span className="help">8 caractères minimum.</span>
              </div>

              <button className="btn btnPrimary" onClick={changePassword}
                disabled={pwBusy || !pwEmail || !pwCur || pwNew.length < 8}>
                {pwBusy ? 'Modification…' : 'Changer le mot de passe'}
              </button>
            </div>
          </div>

          {/* ── Utilisateurs — feature not built yet, removed to avoid confusion ── */}
        </>
      )}
    </Shell>
  )
}
