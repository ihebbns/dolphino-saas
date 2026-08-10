'use client'
// ═══════════════════════════════════════════════════════════════════
// /kitchen/[slug] — a cloud-synced kitchen display screen ANY device can
// open in a plain browser (a cheap tablet, an old laptop, a smart TV) —
// no EXE install needed. Reads/writes the SAME kds_tickets rows the till's
// own embedded KDS overlay does, so bumping a ticket here clears it
// everywhere, and vice versa.
//
// Gated by a SIMPLE password set by the admin (restaurants.config.
// kdsPassword) — deliberately NOT the restaurant's api_key/syncKey. That
// credential grants full POS-sync access; handing it to a shared kitchen
// tablet would be a much bigger blast radius than this screen needs, and
// it's an ugly string for non-technical staff to type. This page can only
// ever view tickets and bump them (see /api/public/[slug]/kds) — never
// touch anything else the real api_key could. Entered once per device,
// remembered in localStorage after that.
// ═══════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useState } from 'react'

export default function KitchenScreen({ params }: { params: { slug: string } }) {
  const slug = params.slug
  const [info, setInfo] = useState<any>(null)
  const [loadError, setLoadError] = useState('')

  const [password, setPassword] = useState('')
  const [pwInput, setPwInput] = useState('')
  const [authError, setAuthError] = useState('')
  const [checking, setChecking] = useState(false)

  const [tickets, setTickets] = useState<any[]>([])
  const [notReady, setNotReady] = useState('')
  const [zoneFilter, setZoneFilter] = useState('all')
  const [now, setNow] = useState(() => Date.now())

  const [dark, setDark] = useState(true)
  useEffect(() => {
    try { const saved = localStorage.getItem('servio_kitchen_theme_' + slug); if (saved) setDark(saved === 'dark') } catch {}
  }, [slug])
  function toggleTheme() {
    setDark(d => { const next = !d; try { localStorage.setItem('servio_kitchen_theme_' + slug, next ? 'dark' : 'light') } catch {}; return next })
  }
  const { S, C } = useMemo(() => makeStyles(dark), [dark])

  // Public branding (name/logo) — safe, unauthenticated, same endpoint the
  // customer ordering page uses.
  useEffect(() => {
    fetch(`/api/public/${slug}/menu`)
      .then(r => r.json())
      .then(d => { if (d.ok) setInfo(d); else setLoadError(d.error || 'Erreur') })
      .catch(() => setLoadError('Impossible de contacter le serveur'))
  }, [slug])

  useEffect(() => {
    try { const saved = localStorage.getItem('servio_kitchen_pw_' + slug); if (saved) setPassword(saved) } catch {}
  }, [slug])

  async function submitPassword() {
    if (!pwInput.trim()) return
    setChecking(true); setAuthError('')
    try {
      const res = await fetch(`/api/public/${slug}/kds?password=${encodeURIComponent(pwInput.trim())}`)
      const data = await res.json()
      if (data.ok) {
        try { localStorage.setItem('servio_kitchen_pw_' + slug, pwInput.trim()) } catch {}
        setPassword(pwInput.trim())
      } else {
        setAuthError(data.error || 'Mot de passe invalide')
      }
    } catch { setAuthError('Impossible de contacter le serveur') }
    setChecking(false)
  }

  // Poll every 5s once authenticated — same cadence the till's own
  // pollOnlineOrders() uses, close enough to "live" for a kitchen queue.
  useEffect(() => {
    if (!password) return
    let stopped = false
    async function poll() {
      try {
        const res = await fetch(`/api/public/${slug}/kds?password=${encodeURIComponent(password)}`)
        const data = await res.json()
        if (stopped) return
        if (data.ok && data.ready !== false) {
          setTickets(Array.isArray(data.tickets) ? data.tickets : [])
          setNotReady('')
        } else if (data.ready === false) {
          setNotReady(data.note || 'Non initialisé')
        } else if (!data.ok && data.error) {
          setAuthError(data.error)
        }
      } catch {}
    }
    poll()
    const iv = setInterval(poll, 5000)
    return () => { stopped = true; clearInterval(iv) }
  }, [password, slug])

  // Elapsed-time labels tick forward even with nothing new arriving.
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 20000)
    return () => clearInterval(iv)
  }, [])

  async function bump(id: string) {
    // Optimistic — the next poll (≤5s) reconciles with the server either way.
    setTickets(ts => ts.map(t => t.id === id ? { ...t, bumped: true, bumpedAt: Date.now() } : t))
    try {
      await fetch(`/api/public/${slug}/kds`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, action: 'bump', ticket_key: id, actor: 'Écran cuisine' }),
      })
    } catch {}
  }

  const pending = useMemo(() => tickets.filter(t => !t.bumped), [tickets])
  const zones = useMemo(() => {
    const seen = new Map<string, string>()
    pending.forEach(t => { if (t.zone && !seen.has(t.zone)) seen.set(t.zone, t.zoneLabel || t.zone) })
    return Array.from(seen, ([key, label]) => ({ key, label }))
  }, [pending])
  const visible = useMemo(
    () => pending.filter(t => zoneFilter === 'all' || t.zone === zoneFilter).sort((a, b) => a.sentAt - b.sentAt),
    [pending, zoneFilter]
  )

  function elapsedMin(sentAt: number) { return Math.max(0, Math.floor((now - sentAt) / 60000)) }
  function urgencyColor(mins: number) { return mins >= 12 ? '#E05252' : mins >= 6 ? '#E8882A' : '#3DB87A' }

  const spinKeyframes = <style>{'@keyframes spin{to{transform:rotate(360deg)}}'}</style>

  if (loadError) return <div style={S.center}><div style={{ color: '#E05252' }}>{loadError}</div></div>
  if (!info) return <div style={S.center}>{spinKeyframes}<div style={S.spinner} /></div>

  const themeBtn = <button onClick={toggleTheme} style={S.themeBtn} title="Changer le thème">{dark ? '☀️' : '🌙'}</button>
  const themeBtnInline = <button onClick={toggleTheme} style={S.themeBtnInline} title="Changer le thème">{dark ? '☀️' : '🌙'}</button>

  if (!password) {
    return (
      <div style={S.center}>
        {themeBtn}
        <div style={S.loginCard}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>🖥️</div>
          <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 4 }}>{info.name}</div>
          <div style={{ fontSize: 12, color: C.muted, marginBottom: 24, textTransform: 'uppercase', letterSpacing: 1 }}>Écran Cuisine</div>
          <input
            type="password" value={pwInput} onChange={e => setPwInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') submitPassword() }}
            placeholder="Mot de passe" autoFocus
            style={S.input}
          />
          {authError && <div style={{ color: '#E05252', fontSize: 12, marginTop: 8 }}>{authError}</div>}
          <button onClick={submitPassword} disabled={checking} style={S.btnPrimary}>{checking ? '…' : 'Ouvrir'}</button>
        </div>
      </div>
    )
  }

  if (notReady) return <div style={S.center}><div style={{ color: C.muted, textAlign: 'center', maxWidth: 400, padding: 20 }}>{notReady}</div></div>

  return (
    <div style={S.wrap}>
      <div style={S.header}>
        <div style={{ fontSize: 16, fontWeight: 800, color: C.gold }}>🖥️ {info.name} — Écran Cuisine</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ fontSize: 12, color: C.muted }}>{pending.length} bon(s) en attente</div>
          {themeBtnInline}
        </div>
      </div>
      {zones.length > 1 && (
        <div style={S.tabs}>
          <button onClick={() => setZoneFilter('all')} style={zoneFilter === 'all' ? S.tabOn : S.tabOff}>Tout</button>
          {zones.map(z => (
            <button key={z.key} onClick={() => setZoneFilter(z.key)} style={zoneFilter === z.key ? S.tabOn : S.tabOff}>{z.label}</button>
          ))}
        </div>
      )}
      <div style={S.grid}>
        {visible.length === 0 ? (
          <div style={{ gridColumn: '1/-1', textAlign: 'center', color: C.muted, padding: '60px 20px', fontSize: 14 }}>✓ Aucun bon en attente — cuisine à jour</div>
        ) : visible.map(t => {
          const mins = elapsedMin(t.sentAt)
          const color = urgencyColor(mins)
          const label = t.tblNum ? `Table ${t.tblNum}${t.tblSec ? ' — ' + t.tblSec : ''}` : `Commande #${String(t.num || 0).padStart(3, '0')}`
          return (
            <div key={t.id} style={{ ...S.card, borderLeftColor: color }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                <div style={{ fontWeight: 800, fontSize: 14 }}>{label}</div>
                <div style={{ fontSize: 12, fontWeight: 700, color, whiteSpace: 'nowrap' }}>🕐 {mins} min</div>
              </div>
              <div style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5 }}>{t.zoneLabel}</div>
              <div style={{ flex: 1 }}>
                {(t.items || []).map((it: any, i: number) => (
                  <div key={i}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: 13 }}>
                      <span>{it.qty}x {it.name}{it.variant ? ` (${it.variant})` : ''}</span>
                    </div>
                    {it.note && <div style={{ fontSize: 11, color: '#E8882A', paddingLeft: 8 }}>↳ {it.note}</div>}
                  </div>
                ))}
              </div>
              <button onClick={() => bump(t.id)} style={S.bumpBtn}>✓ Terminé</button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function makeStyles(dark: boolean): { S: Record<string, React.CSSProperties>, C: Record<string, string> } {
  const C = dark
    ? { bg: '#0A0704', panel: '#161210', border: '#231C12', input: '#0F0C08', text: '#F0E8D8', muted: '#7A6E5F', gold: '#E8A84C' }
    : { bg: '#F5F1E8', panel: '#FFFFFF', border: '#E3DACB', input: '#F5F1E8', text: '#2A2118', muted: '#8A7E6C', gold: '#B87A28' }
  const S: Record<string, React.CSSProperties> = {
    center: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: C.bg, color: C.text, fontFamily: '-apple-system,Segoe UI,system-ui,sans-serif', position: 'relative' },
    spinner: { width: 32, height: 32, border: `3px solid ${C.border}`, borderTopColor: '#C8913A', borderRadius: '50%', animation: 'spin .8s linear infinite' },
    loginCard: { background: C.panel, border: `1px solid ${C.border}`, borderRadius: 20, padding: '48px 40px', width: '100%', maxWidth: 380, textAlign: 'center', margin: 20 },
    input: { width: '100%', background: C.input, border: `1.5px solid ${C.border}`, borderRadius: 10, padding: '14px 16px', color: C.text, fontSize: 15, outline: 'none', boxSizing: 'border-box' },
    btnPrimary: { width: '100%', padding: 14, marginTop: 14, background: 'linear-gradient(135deg,#C8913A,#E8A84C)', border: 'none', borderRadius: 10, color: '#080604', fontSize: 15, fontWeight: 700, cursor: 'pointer' },
    wrap: { minHeight: '100vh', background: C.bg, color: C.text, fontFamily: '-apple-system,Segoe UI,system-ui,sans-serif', display: 'flex', flexDirection: 'column' },
    header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '14px 18px', borderBottom: `1px solid ${C.border}`, background: C.panel },
    tabs: { display: 'flex', gap: 8, padding: '10px 18px', borderBottom: `1px solid ${C.border}`, flexWrap: 'wrap' },
    tabOn: { padding: '6px 14px', borderRadius: 20, border: '1px solid #C8913A', background: '#C8913A', color: '#080604', fontSize: 12, fontWeight: 700, cursor: 'pointer' },
    tabOff: { padding: '6px 14px', borderRadius: 20, border: `1px solid ${C.border}`, background: C.panel, color: C.muted, fontSize: 12, fontWeight: 700, cursor: 'pointer' },
    grid: { flex: 1, overflowY: 'auto', padding: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(230px,1fr))', gap: 12, alignContent: 'start' },
    card: { background: C.panel, border: `1px solid ${C.border}`, borderLeft: '4px solid', borderRadius: 10, padding: 14, display: 'flex', flexDirection: 'column', gap: 8 },
    bumpBtn: { padding: 9, background: 'linear-gradient(135deg,#C8913A,#E8A84C)', border: 'none', borderRadius: 7, color: '#080604', fontWeight: 700, fontSize: 12, cursor: 'pointer' },
    themeBtn: { position: 'absolute', top: 16, right: 16, width: 36, height: 36, borderRadius: 10, border: `1px solid ${C.border}`, background: C.panel, color: C.text, fontSize: 16, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' },
    themeBtnInline: { width: 32, height: 32, borderRadius: 8, border: `1px solid ${C.border}`, background: C.bg, color: C.text, fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  }
  return { S, C }
}
