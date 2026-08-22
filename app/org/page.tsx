'use client'
import { useState, useEffect } from 'react'
import s from '../dashboard.module.css'
import { useTheme } from '../ui/useTheme'

// ═══════════════════════════════════════════════════
// /org — login + location picker for an org owner managing several
// restaurants. Entirely new page, reached only by someone who explicitly
// knows about it — a single-location owner (La Coupole, Test Cafe Servio)
// never lands here and never sets d_org_token, so /dashboard's existing
// login flow is completely unaffected by this file's existence.
//
// Picking a restaurant writes d_api_key/d_rest_info — the EXACT same
// localStorage keys the single-location Login() in app/dashboard/page.tsx
// already writes — then hands off to /dashboard, which picks it up with
// zero awareness an org was ever involved.
// ═══════════════════════════════════════════════════

const API = process.env.NEXT_PUBLIC_API_URL || 'https://servio.tn'

type Restaurant = { id: number; name: string; city: string; api_key: string; plan: string }

function OrgLogin({ onLogin }: { onLogin: (token: string) => void }) {
  const [email, setEmail] = useState('')
  const [pass, setPass] = useState('')
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)
  const { theme, toggle } = useTheme()

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr(''); setLoading(true)
    try {
      const res = await fetch(`${API}/api/org/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: pass }),
      })
      const data = await res.json()
      if (!data.ok) { setErr(data.error || 'Erreur'); setLoading(false); return }
      localStorage.setItem('d_org_token', data.token)
      onLogin(data.token)
    } catch { setErr('Impossible de contacter le serveur.') }
    setLoading(false)
  }

  return (
    <div className={s.loginWrap}>
      <button onClick={toggle} style={{ position: 'absolute', top: 16, right: 16, background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', opacity: .6 }}>
        {theme === 'dark' ? '☀️' : '🌙'}
      </button>
      <form className={s.loginBox} onSubmit={submit}>
        <div className={s.loginLogo}>⚡</div>
        <div className={s.loginBrand}>SERVIO OS</div>
        <div className={s.loginSub}>Espace multi-établissements</div>
        <div className={s.formGroup}>
          <label>Email</label>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="votre@email.com" required autoComplete="email" />
        </div>
        <div className={s.formGroup}>
          <label>Mot de passe</label>
          <input type="password" value={pass} onChange={e => setPass(e.target.value)} placeholder="••••••••" required />
        </div>
        {err && <div className={s.loginErr}>⚠ {err}</div>}
        <button className={s.btnLogin} disabled={loading} type="submit">
          {loading ? <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}><span className={s.spinner} /> Connexion...</span> : 'Se connecter →'}
        </button>
      </form>
    </div>
  )
}

function LocationPicker({ token }: { token: string }) {
  const [restaurants, setRestaurants] = useState<Restaurant[] | null>(null)
  const [err, setErr] = useState('')
  const { theme, toggle } = useTheme()

  useEffect(() => {
    fetch(`${API}/api/org/restaurants`, { headers: { Authorization: `Bearer ${token}` } })
      .then(res => res.json())
      .then(data => {
        if (!data.ok) { setErr(data.error || 'Erreur'); return }
        setRestaurants(data.restaurants)
      })
      .catch(() => setErr('Impossible de contacter le serveur.'))
  }, [token])

  function choose(r: Restaurant) {
    localStorage.setItem('d_api_key', r.api_key)
    localStorage.setItem('d_rest_info', JSON.stringify({ name: r.name, city: r.city }))
    window.location.href = '/dashboard'
  }

  function logout() {
    localStorage.removeItem('d_org_token')
    window.location.reload()
  }

  return (
    <div className={s.loginWrap}>
      <button onClick={toggle} style={{ position: 'absolute', top: 16, right: 16, background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', opacity: .6 }}>
        {theme === 'dark' ? '☀️' : '🌙'}
      </button>
      <div className={s.loginBox} style={{ maxWidth: 440 }}>
        <div className={s.loginLogo}>⚡</div>
        <div className={s.loginBrand}>SERVIO OS</div>
        <div className={s.loginSub}>Choisissez un établissement</div>

        {err && <div className={s.loginErr}>⚠ {err}</div>}

        {!restaurants && !err && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '24px 0' }}><span className={s.spinner} /></div>
        )}

        {restaurants && restaurants.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 13, padding: '16px 0' }}>
            Aucun établissement rattaché à ce compte pour le moment.
          </div>
        )}

        {restaurants && restaurants.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, margin: '8px 0 4px' }}>
            {restaurants.map(r => (
              <button
                key={r.id}
                onClick={() => choose(r)}
                className={s.btnIcon}
                style={{ width: '100%', textAlign: 'left', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px', height: 'auto' }}
              >
                <span>
                  <div style={{ fontWeight: 700 }}>{r.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>{r.city}</div>
                </span>
                <span style={{ fontSize: 18 }}>→</span>
              </button>
            ))}
          </div>
        )}

        <button className={s.btnLogout} onClick={logout} style={{ marginTop: 12, width: '100%' }}>
          <span>Déconnecter</span>
        </button>
      </div>
    </div>
  )
}

export default function OrgHome() {
  const [token, setToken] = useState<string | null>(null)

  useEffect(() => {
    const t = localStorage.getItem('d_org_token')
    if (t) setToken(t)
  }, [])

  if (!token) return <OrgLogin onLogin={setToken} />
  return <LocationPicker token={token} />
}
