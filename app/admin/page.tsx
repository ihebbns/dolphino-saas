'use client'
import React, { useState, useEffect } from 'react'
import { useTheme } from '../ui/useTheme'

const API = process.env.NEXT_PUBLIC_API_URL || ''
// There is deliberately NO admin key constant here. The only copy of that
// secret lives server-side (ADMIN_SECRET_KEY) — anything defined in this file
// ships in the public JS bundle for anyone who opens devtools on /admin, so a
// password embedded here is not a password, it's a public one. Login always
// round-trips through the server; a network failure is an error, never a
// local bypass.

// ═══════════════ ADMIN PAGE ═══════════════
export default function AdminPage() {
  const [authed, setAuthed] = useState(false)

  // Was a third theme key (`servio_admin_theme`), so admin disagreed with both the
  // dashboard and the client pages. Same hook as everywhere else now.
  const { dark, toggle: toggleTheme } = useTheme()

  useEffect(() => {
    // Session persistence only checks that a key was previously validated by
    // the server (see Login below) — never re-derives or assumes one.
    if (sessionStorage.getItem('servio_admin_key')) setAuthed(true)
  }, [])

  if (!authed) return <Login dark={dark} toggleTheme={toggleTheme} onLogin={(validatedKey) => { sessionStorage.setItem('servio_admin_key', validatedKey); setAuthed(true) }} />
  return <Panel dark={dark} toggleTheme={toggleTheme} onLogout={() => { sessionStorage.removeItem('servio_admin_key'); setAuthed(false) }} />
}

// ═══════════════ THEME WRAPPER ═══════════════
function Wrap({ dark, children }: { dark: boolean, children: React.ReactNode }) {
  const vars = dark ? {
    '--bg':'#0A0704','--panel':'#0F0C08','--card':'#161210','--card-h':'#1E1810',
    '--gold':'#C8913A','--gold-l':'#E8A84C','--gold-dim':'rgba(200,145,58,.08)',
    '--txt':'#F0E8D8','--muted':'#7A6E5F','--div':'#231C12',
    '--green':'#3DB87A','--red':'#E05252','--blue':'#4A90D9','--orange':'#E8882A',
    '--green-dim':'rgba(61,184,122,.1)','--red-dim':'rgba(224,82,82,.1)',
    '--radius':'12px','--shadow':'0 4px 20px rgba(0,0,0,.3)',
  } : {
    '--bg':'#F5F0E8','--panel':'#FFFFFF','--card':'#F0EBE0','--card-h':'#E8E0D0',
    '--gold':'#B8782A','--gold-l':'#8A5A1A','--gold-dim':'rgba(184,120,42,.06)',
    '--txt':'#1A1208','--muted':'#8A7A6A','--div':'#DDD5C5',
    '--green':'#2A8A5A','--red':'#C04040','--blue':'#2A70B8','--orange':'#C06818',
    '--green-dim':'rgba(42,138,90,.08)','--red-dim':'rgba(192,64,64,.08)',
    '--radius':'12px','--shadow':'0 4px 20px rgba(0,0,0,.06)',
  }
  return <div style={{ ...vars, minHeight:'100vh', background:'var(--bg)', color:'var(--txt)', fontFamily:'system-ui,-apple-system,sans-serif', fontSize:'14px' } as any}>{children}</div>
}

// ═══════════════ LOGIN ═══════════════
function Login({ dark, toggleTheme, onLogin }: { dark:boolean, toggleTheme:()=>void, onLogin:(validatedKey:string)=>void }) {
  const [pass, setPass] = useState('')
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    // Always the server's call, no exceptions — a network failure is an
    // error state, never a reason to authenticate locally.
    try {
      const res = await fetch(`${API}/api/admin/clients`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ admin_key: pass }) })
      if (res.ok) onLogin(pass)
      else setErr('Mot de passe incorrect')
    } catch {
      setErr('Erreur de connexion')
    }
    setLoading(false)
  }

  return (
    <Wrap dark={dark}>
      <div style={{ position:'absolute', top:'16px', right:'16px' }}>
        <button onClick={toggleTheme} style={{ background:'var(--card)', border:'1px solid var(--div)', borderRadius:'8px', padding:'8px 12px', color:'var(--muted)', cursor:'pointer' }}>{dark?'☀️':'🌙'}</button>
      </div>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'center', minHeight:'100vh', padding:'20px' }}>
        <form onSubmit={submit} style={{ background:'var(--panel)', border:'1px solid var(--div)', borderRadius:'20px', padding:'48px 40px', width:'100%', maxWidth:'380px', textAlign:'center', boxShadow:'var(--shadow)' }}>
          <div style={{ fontSize:'48px', marginBottom:'8px' }}>⚡</div>
          <div style={{ fontSize:'24px', fontWeight:'800', color:'var(--gold-l)', letterSpacing:'3px', marginBottom:'4px' }}>SERVIO</div>
          <div style={{ fontSize:'11px', color:'var(--muted)', letterSpacing:'2px', textTransform:'uppercase', marginBottom:'32px' }}>Admin Panel</div>
          <input type="password" value={pass} onChange={e=>{setPass(e.target.value);setErr('')}} placeholder="Mot de passe admin"
            style={{ width:'100%', background:'var(--card)', border:'1.5px solid var(--div)', borderRadius:'10px', padding:'14px 16px', color:'var(--txt)', fontSize:'15px', outline:'none', marginBottom:'14px', boxSizing:'border-box' }} autoFocus />
          {err && <div style={{ color:'var(--red)', fontSize:'12px', marginBottom:'10px', padding:'8px', background:'var(--red-dim)', borderRadius:'8px' }}>{err}</div>}
          <button type="submit" disabled={loading} style={{ width:'100%', padding:'14px', background:'linear-gradient(135deg,var(--gold),var(--gold-l))', border:'none', borderRadius:'10px', color:'#fff', fontSize:'15px', fontWeight:'700', cursor:'pointer', opacity:loading?.6:1 }}>
            {loading ? '...' : 'Accéder'}
          </button>
        </form>
      </div>
    </Wrap>
  )
}

// ═══════════════ SCHEDULE SECTION ═══════════════
function ScheduleSection({ apiKey, suspendAt, onAction, onCancel }: { apiKey:string, suspendAt?:string, onAction:(key:string,action:string,days?:number,target?:string)=>void, onCancel:()=>void }) {
  const [target, setTarget] = useState('suspend_all')
  const [days, setDays] = useState(30)
  const [customDate, setCustomDate] = useState('')

  const targets = [
    { id:'suspend_all', label:'🔒 Tout', desc:'EXE + Dashboard' },
    { id:'suspend_exe', label:'💻 EXE seul', desc:'Dashboard reste' },
    { id:'suspend_dash', label:'📊 Dashboard seul', desc:'EXE reste' },
  ]

  function scheduleNow(){
    const d = customDate ? Math.ceil((new Date(customDate).getTime() - Date.now()) / (24*60*60*1000)) : days
    if(d <= 0){ alert('Date invalide'); return; }
    onAction(apiKey, 'schedule', d, target)
  }

  return (
    <div style={{ marginBottom:'16px' }}>
      {/* Target selection */}
      <div style={{ fontSize:'10px', color:'var(--muted)', marginBottom:'6px' }}>Cible de la suspension :</div>
      <div style={{ display:'flex', gap:'6px', marginBottom:'12px' }}>
        {targets.map(t => (
          <button key={t.id} onClick={() => setTarget(t.id)} style={{
            flex:1, padding:'10px 6px', background: target===t.id ? 'var(--gold-dim)' : 'var(--card)',
            border: `1.5px solid ${target===t.id ? 'var(--gold)' : 'var(--div)'}`,
            borderRadius:'8px', cursor:'pointer', fontSize:'11px', fontWeight:'600', textAlign:'center',
            color: target===t.id ? 'var(--gold-l)' : 'var(--muted)', transition:'all .12s'
          }}>
            <div>{t.label}</div>
            <div style={{ fontSize:'9px', opacity:.7, marginTop:'2px' }}>{t.desc}</div>
          </button>
        ))}
      </div>

      {/* Quick days */}
      <div style={{ fontSize:'10px', color:'var(--muted)', marginBottom:'6px' }}>Suspendre dans :</div>
      <div style={{ display:'flex', gap:'6px', marginBottom:'10px' }}>
        {[3,7,15,30,60].map(d => (
          <button key={d} onClick={() => { setDays(d); setCustomDate(''); }} style={{
            flex:1, padding:'10px 4px', background: days===d && !customDate ? 'var(--gold-dim)' : 'var(--card)',
            border: `1px solid ${days===d && !customDate ? 'var(--gold)' : 'var(--div)'}`,
            borderRadius:'6px', cursor:'pointer', fontSize:'12px', fontWeight:'600', textAlign:'center',
            color: days===d && !customDate ? 'var(--gold-l)' : 'var(--muted)'
          }}>
            {d}j
          </button>
        ))}
      </div>

      {/* Custom date */}
      <div style={{ display:'flex', gap:'8px', alignItems:'center', marginBottom:'12px' }}>
        <span style={{ fontSize:'11px', color:'var(--muted)' }}>Ou date précise :</span>
        <input type="date" value={customDate} onChange={e => setCustomDate(e.target.value)}
          min={new Date(Date.now() + 86400000).toISOString().split('T')[0]}
          style={{ flex:1, background:'var(--card)', border:'1px solid var(--div)', borderRadius:'6px', padding:'8px', color:'var(--txt)', fontSize:'12px', outline:'none' }} />
      </div>

      {/* Confirm button */}
      <button onClick={scheduleNow} style={{ width:'100%', padding:'12px', background:'linear-gradient(135deg,var(--gold),var(--gold-l))', border:'none', borderRadius:'8px', color:'#fff', cursor:'pointer', fontSize:'13px', fontWeight:'700' }}>
        ⏰ Programmer la suspension ({customDate || days+' jours'}) — {targets.find(t=>t.id===target)?.label}
      </button>

      {/* Cancel existing */}
      {suspendAt && (
        <button onClick={onCancel} style={{ width:'100%', padding:'12px', background:'var(--card)', border:'1px solid var(--div)', borderRadius:'10px', color:'var(--green)', cursor:'pointer', fontSize:'13px', fontWeight:'600', marginTop:'8px' }}>
          ✕ Annuler la programmation ({new Date(suspendAt).toLocaleDateString('fr-TN')})
        </button>
      )}
    </div>
  )
}

// ═══════════════ QR & LINK SECTION ═══════════════
// Everything a manager needs to hand a client their public ordering link
// without touching a database or asking the developer to look it up: view
// it, generate/edit it, and print QR codes — the general link for any
// client, plus one per table if that client's floor plan is already synced
// (same pos_tables data the till itself pushes via /api/me/tables, so this
// never needs the client's own EXE to be rebuilt or even present).
function QrSection({ client, adminKey, hasTables, onSlugSaved }: { client:any, adminKey:string, hasTables:boolean, onSlugSaved:(slug:string|null)=>void }) {
  const [slugInput, setSlugInput] = useState(client.public_slug || '')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [copied, setCopied] = useState(false)
  const [tables, setTables] = useState<any[]>([])
  const [tablesLoading, setTablesLoading] = useState(false)
  const [tablesLoaded, setTablesLoaded] = useState(false)

  useEffect(() => { setSlugInput(client.public_slug || ''); setErr('') }, [client.api_key])

  useEffect(() => {
    if (!hasTables || !client.public_slug || tablesLoaded) return
    setTablesLoading(true)
    fetch(`${API}/api/me/tables?key=${encodeURIComponent(client.api_key)}`)
      .then(r => r.json())
      .then(d => { if (d.ok) setTables(d.tables || []) })
      .catch(() => {})
      .finally(() => { setTablesLoading(false); setTablesLoaded(true) })
  }, [hasTables, client.public_slug, client.api_key, tablesLoaded])

  function slugify(name: string) {
    return name.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'client'
  }

  async function saveSlug(value: string) {
    setSaving(true); setErr('')
    try {
      const res = await fetch(`${API}/api/admin/clients`, {
        method:'PATCH', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ admin_key: adminKey, id: client.id, public_slug: value }),
      })
      const data = await res.json()
      if (data.ok) { setSlugInput(data.public_slug || ''); onSlugSaved(data.public_slug || null); setTablesLoaded(false) }
      else setErr(data.error || 'Erreur')
    } catch { setErr('Erreur de connexion') }
    setSaving(false)
  }

  function generate() { saveSlug(slugify(client.name) + '-' + Math.random().toString(36).slice(2, 6)) }

  function copyLink() {
    navigator.clipboard.writeText(`https://servio.tn/moi/${client.public_slug}`).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 2000)
    })
  }

  const qS: React.CSSProperties = { flex:1, background:'var(--card)', border:'1.5px solid var(--div)', borderRadius:'8px', padding:'10px 12px', color:'var(--txt)', fontSize:'13px', outline:'none', fontFamily:'monospace' }

  return (
    <div>
      <div style={{ fontSize:'11px', color:'var(--muted)', fontWeight:'600', marginBottom:'8px', textTransform:'uppercase', letterSpacing:'1px' }}>Lien de commande public</div>

      <div style={{ display:'flex', gap:'6px', marginBottom:'6px' }}>
        <input style={qS} value={slugInput} onChange={e=>setSlugInput(e.target.value)} placeholder="ex: cafe-central-a91f" />
        <button onClick={()=>saveSlug(slugInput)} disabled={saving} style={{ padding:'0 14px', background:'var(--card)', border:'1px solid var(--div)', borderRadius:'8px', color:'var(--gold-l)', cursor: saving ? 'default' : 'pointer', fontSize:'12px', fontWeight:700 }}>
          {saving ? '…' : '✓ Enregistrer'}
        </button>
      </div>
      {err && <div style={{ color:'var(--red)', fontSize:'11px', marginBottom:'10px' }}>{err}</div>}

      {!client.public_slug && (
        <button onClick={generate} disabled={saving} style={{ width:'100%', padding:'10px', background:'var(--gold-dim)', border:'1px solid var(--gold)', borderRadius:'8px', color:'var(--gold-l)', cursor: saving ? 'default' : 'pointer', fontSize:'12px', fontWeight:700, marginBottom:'14px' }}>
          ⚡ Générer un lien automatiquement
        </button>
      )}

      {client.public_slug && (
        <>
          <div style={{ display:'flex', alignItems:'center', gap:'8px', background:'var(--card)', border:'1px solid var(--div)', borderRadius:'8px', padding:'10px 12px', marginBottom:'14px' }}>
            <code style={{ flex:1, fontSize:'12px', color:'var(--blue)', wordBreak:'break-all' as const }}>servio.tn/moi/{client.public_slug}</code>
            <button onClick={copyLink} style={{ padding:'6px 10px', background:'var(--panel)', border:'1px solid var(--div)', borderRadius:'6px', color: copied ? 'var(--green)' : 'var(--muted)', cursor:'pointer', fontSize:'11px', flexShrink:0 }}>
              {copied ? '✓ Copié' : '📋 Copier'}
            </button>
          </div>

          <div id="qr-print-area">
            <div style={{ textAlign:'center' as const, marginBottom:'14px' }}>
              <img src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(`https://servio.tn/moi/${client.public_slug}`)}`} alt="QR code" style={{ borderRadius:'8px', border:'1px solid var(--div)' }} />
              <div style={{ fontSize:'11px', color:'var(--muted)', marginTop:'6px' }}>{client.name} — lien général</div>
            </div>

            {hasTables && (
              <div style={{ marginTop:'10px' }}>
                <div style={{ fontSize:'11px', color:'var(--muted)', fontWeight:'600', marginBottom:'8px', textTransform:'uppercase', letterSpacing:'1px' }}>
                  QR par table {!tablesLoading && tables.length > 0 ? `(${tables.length})` : ''}
                </div>
                {tablesLoading ? (
                  <div style={{ textAlign:'center' as const, color:'var(--muted)', fontSize:'12px', padding:'12px' }}>Chargement…</div>
                ) : tables.length === 0 ? (
                  <div style={{ textAlign:'center' as const, color:'var(--muted)', fontSize:'12px', padding:'12px' }}>Aucune table synchronisée pour le moment — le client doit d&apos;abord ouvrir une table sur sa caisse.</div>
                ) : (
                  <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(110px,1fr))', gap:'10px' }}>
                    {tables.map((t:any) => {
                      const url = `https://servio.tn/moi/${client.public_slug}?table=${t.num}&sec=${encodeURIComponent(t.sec||'')}`
                      return (
                        <div key={t.id} style={{ textAlign:'center' as const, background:'var(--card)', border:'1px solid var(--div)', borderRadius:'8px', padding:'8px' }}>
                          <img src={`https://api.qrserver.com/v1/create-qr-code/?size=100x100&data=${encodeURIComponent(url)}`} alt={`QR Table ${t.num}`} style={{ width:'100%', borderRadius:'4px' }} />
                          <div style={{ fontSize:'11px', fontWeight:700, marginTop:'4px' }}>Table {t.num}</div>
                          <div style={{ fontSize:'9px', color:'var(--muted)' }}>{t.sec}</div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          <button onClick={() => window.print()} style={{ width:'100%', padding:'12px', background:'linear-gradient(135deg,var(--gold),var(--gold-l))', border:'none', borderRadius:'10px', color:'#fff', cursor:'pointer', fontSize:'13px', fontWeight:'700', marginTop:'14px' }}>
            🖨️ Imprimer
          </button>
        </>
      )}
    </div>
  )
}

// ═══════════════ PANEL ═══════════════
function Panel({ dark, toggleTheme, onLogout }: { dark:boolean, toggleTheme:()=>void, onLogout:()=>void }) {
  const [clients, setClients] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState('')
  const [actionClient, setActionClient] = useState<any>(null)
  // Modules for whichever client the action modal is currently open for. Loaded
  // fresh each time the modal opens rather than trusted from the client list,
  // since the list only carries plan/suspend_at, not the full config blob.
  const [moduleCfg, setModuleCfg] = useState<{ config: any; modules: Record<string, boolean> } | null>(null)
  const [moduleLoading, setModuleLoading] = useState(false)
  const [moduleSaving, setModuleSaving] = useState(false)
  const [rewardBusy, setRewardBusy] = useState(false)
  const [rewardResult, setRewardResult] = useState<any>(null)
  const [pinResetPhone, setPinResetPhone] = useState('')
  const [pinResetBusy, setPinResetBusy] = useState(false)
  const [pinResetMsg, setPinResetMsg] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [demoRequests, setDemoRequests] = useState<any[]>([])
  const [showDemos, setShowDemos] = useState(false)
  const [modalTab, setModalTab] = useState<'apercu'|'modules'|'qr'|'compte'>('apercu')
  const [overview, setOverview] = useState<{ dashboard:any; wallet:any; orders:any } | null>(null)
  const [overviewLoading, setOverviewLoading] = useState(false)

  const key = sessionStorage.getItem('servio_admin_key') || ''
  // Panel only ever renders after AdminPage confirms a validated key is
  // stored, so this is a defensive backstop, not the real gate — but if it
  // ever IS empty, fail back to the login screen rather than sending blank
  // credentials to admin endpoints.
  useEffect(() => { if (!key) onLogout() }, [key])

  async function loadClients() {
    setLoading(true)
    try {
      const res = await fetch(`${API}/api/admin/clients`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ admin_key: key }) })
      const data = await res.json()
      if (data.ok) setClients(data.clients)
      else flash('Erreur: ' + data.error)
    } catch { flash('Erreur de connexion') }
    setLoading(false)
  }

  async function loadDemoRequests() {
    try {
      const res = await fetch(`${API}/api/demo-request?admin_key=${key}`)
      const data = await res.json()
      if (data.ok) setDemoRequests(data.requests || [])
    } catch { /* silent */ }
  }

  function openClient(c: any) {
    setActionClient(c); setModalTab('apercu')
    loadModules(c.api_key); loadOverview(c)
  }
  function closeModal() {
    setActionClient(null); setModuleCfg(null); setRewardResult(null); setOverview(null)
  }

  async function doAction(apiKey: string, action: string, days?: number, target?: string) {
    try {
      const body: any = { admin_key: key, api_key: apiKey, action }
      if (days) body.days = days
      if (target) body.suspend_target = target
      const res = await fetch(`${API}/api/admin/suspend`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) })
      const data = await res.json()
      if (data.ok) { flash('✓ Action effectuée'); loadClients() }
      else flash('Erreur: ' + data.error)
    } catch { flash('Erreur de connexion') }
    closeModal()
  }

  // ── Overview tab: today's activity, at a glance ────────────────────────
  // Calls the SAME endpoints the client's own dashboard/POS call, using
  // their own api_key (already visible in the client list — this isn't a
  // new privilege, just admin reading what that client can already read).
  // No new backend surface, so nothing here can drift from what the owner
  // themselves would see.
  async function loadOverview(c: any) {
    setOverviewLoading(true)
    setOverview(null)
    try {
      const [dashRes, walletRes, ordersRes] = await Promise.all([
        fetch(`${API}/api/dashboard?key=${encodeURIComponent(c.api_key)}`).then(r => r.json()).catch(() => null),
        fetch(`${API}/api/me/wallet?key=${encodeURIComponent(c.api_key)}`).then(r => r.json()).catch(() => null),
        fetch(`${API}/api/me/online-orders?key=${encodeURIComponent(c.api_key)}`).then(r => r.json()).catch(() => null),
      ])
      setOverview({
        dashboard: dashRes?.ok ? dashRes : null,
        wallet: walletRes?.ok ? walletRes : null,
        orders: ordersRes?.ok ? ordersRes : null,
      })
    } catch { /* tab shows its own empty state */ }
    setOverviewLoading(false)
  }

  // ── Module distribution for an EXISTING client ────────────────────────
  // Reads the client's real config (not just modules) so saving never wipes
  // tagline/logo/zones/etc — only the modules key changes, the rest is
  // round-tripped exactly as the server had it.
  async function loadModules(apiKey: string) {
    setModuleLoading(true)
    setModuleCfg(null); setRewardResult(null)
    try {
      const res = await fetch(`${API}/api/admin/config?admin_key=${encodeURIComponent(key)}&api_key=${encodeURIComponent(apiKey)}`)
      const data = await res.json()
      if (data.ok) {
        const config = data.config || {}
        setModuleCfg({ config, modules: { ...(config.modules || {}) } })
      } else flash('Erreur: ' + data.error)
    } catch { flash('Erreur de connexion') }
    setModuleLoading(false)
  }

  function toggleModule(id: string) {
    setModuleCfg(prev => {
      if (!prev) return prev
      const current = prev.modules[id]
      // Undefined means "server default" — flip from the module's REAL default
      // (see MODULES_DEFAULT_OFF), not a blind assumption that undefined = on.
      const effective = current === undefined ? !MODULES_DEFAULT_OFF.has(id) : current
      return { ...prev, modules: { ...prev.modules, [id]: !effective } }
    })
  }

  async function saveModules(apiKey: string) {
    if (!moduleCfg) return
    setModuleSaving(true)
    try {
      const config = { ...moduleCfg.config, modules: moduleCfg.modules }
      const res = await fetch(`${API}/api/admin/config`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ admin_key: key, api_key: apiKey, config }),
      })
      const data = await res.json()
      if (data.ok) flash('✓ Modules enregistrés — actifs au prochain contrôle de licence (≤30 min)')
      else flash('Erreur: ' + data.error)
    } catch { flash('Erreur de connexion') }
    setModuleSaving(false)
  }

  // Runs the SAME job the monthly cron runs (see /api/cron/wallet-rewards),
  // for one client on demand — testing it, or running it by hand before a
  // cron schedule is actually deployed. Idempotent: running it twice for the
  // same month credits nothing the second time (see wallet_reward_runs).
  async function runRewards(apiKey: string) {
    setRewardBusy(true)
    setRewardResult(null)
    try {
      const res = await fetch(`${API}/api/admin/wallet-rewards`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ admin_key: key, api_key: apiKey }),
      })
      const data = await res.json()
      if (data.ok) setRewardResult(data)
      else flash('Erreur: ' + data.error)
    } catch { flash('Erreur de connexion') }
    setRewardBusy(false)
  }

  // Support action for a customer locked out of (or who forgot) their
  // self-service wallet PIN — see /api/admin/wallet-pin-reset for why this
  // has to be a developer-side action (no OTP/SMS to reset it themselves).
  async function resetWalletPin(apiKey: string) {
    if (!pinResetPhone.trim()) return
    setPinResetBusy(true)
    setPinResetMsg('')
    try {
      const res = await fetch(`${API}/api/admin/wallet-pin-reset`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ admin_key: key, api_key: apiKey, phone: pinResetPhone.trim() }),
      })
      const data = await res.json()
      if (data.ok) { setPinResetMsg(`✓ Code PIN réinitialisé pour ${data.name} — prochaine consultation en demandera un nouveau`); setPinResetPhone('') }
      else setPinResetMsg('Erreur: ' + data.error)
    } catch { setPinResetMsg('Erreur de connexion') }
    setPinResetBusy(false)
  }

  function flash(m: string) { setMsg(m); setTimeout(() => setMsg(''), 3000) }

  useEffect(() => { loadClients(); loadDemoRequests() }, [])

  const active = clients.filter(c => c.plan === 'active').length
  const suspended = clients.filter(c => c.plan !== 'active').length

  return (
    <Wrap dark={dark}>
      {/* Header */}
      <header style={{ background:'var(--panel)', borderBottom:'1px solid var(--div)', padding:'0 24px', height:'56px', display:'flex', alignItems:'center', justifyContent:'space-between', position:'sticky', top:0, zIndex:100 }}>
        <div style={{ display:'flex', alignItems:'center', gap:'10px' }}>
          <div style={{ fontSize:'20px' }}>⚡</div>
          <span style={{ fontSize:'16px', fontWeight:'700', color:'var(--gold-l)' }}>SERVIO</span>
          <span style={{ fontSize:'12px', color:'var(--muted)' }}>Admin</span>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
          {msg && <span style={{ fontSize:'12px', color:msg.startsWith('✓')?'var(--green)':'var(--red)', padding:'4px 10px', background:msg.startsWith('✓')?'var(--green-dim)':'var(--red-dim)', borderRadius:'6px' }}>{msg}</span>}
          <button onClick={loadClients} style={{ background:'var(--card)', border:'1px solid var(--div)', borderRadius:'8px', padding:'7px 12px', color:'var(--muted)', cursor:'pointer', fontSize:'13px' }}>↻</button>
          <button onClick={toggleTheme} style={{ background:'var(--card)', border:'1px solid var(--div)', borderRadius:'8px', padding:'7px 12px', color:'var(--muted)', cursor:'pointer' }}>{dark?'☀️':'🌙'}</button>
          <button onClick={onLogout} style={{ background:'none', border:'1px solid var(--div)', borderRadius:'8px', padding:'7px 14px', color:'var(--muted)', cursor:'pointer', fontSize:'12px' }}>Déconnecter</button>
        </div>
      </header>

      <div style={{ maxWidth:'1100px', margin:'0 auto', padding:'24px' }}>
        {/* KPIs */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:'14px', marginBottom:'24px' }}>
          {[
            { label:'Total clients', val:clients.length, color:'var(--gold-l)', icon:'👥' },
            { label:'Actifs', val:active, color:'var(--green)', icon:'✓' },
            { label:'Suspendus', val:suspended, color:'var(--red)', icon:'🔒' },
          ].map((k,i) => (
            <div key={i} style={{ background:'var(--panel)', border:'1px solid var(--div)', borderRadius:'14px', padding:'22px', textAlign:'center', position:'relative', overflow:'hidden' }}>
              <div style={{ position:'absolute', top:0, left:0, right:0, height:'3px', background:k.color }}/>
              <div style={{ fontSize:'13px', marginBottom:'4px' }}>{k.icon}</div>
              <div style={{ fontSize:'34px', fontWeight:'800', color:k.color, lineHeight:1.1 }}>{k.val}</div>
              <div style={{ fontSize:'12px', color:'var(--muted)', marginTop:'4px' }}>{k.label}</div>
            </div>
          ))}
        </div>

        {/* ── Create a client — two clear paths ──────────────────────────
            "Compte web" is DB-only (no POS): useful for a quick dashboard-
            only trial. A real client needs the till too, and that step
            genuinely cannot happen from this hosted page — electron-builder
            needs a real Windows machine — so the full flow is the local
            tools/new-client wizard, pointed to explicitly rather than left
            for the admin to discover on their own. */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'14px', marginBottom:'20px' }}>
          <div style={{ background:'var(--card)', border:'1px solid var(--div)', borderRadius:'12px', padding:'16px 18px' }}>
            <div style={{ fontSize:'13px', fontWeight:'700', marginBottom:'4px' }}>💻 Client complet (POS + Web)</div>
            <div style={{ fontSize:'11px', color:'var(--muted)', marginBottom:'10px', lineHeight:1.5 }}>
              Assistant local avec menu, zones cuisine et build de l&apos;EXE en un seul flux.
            </div>
            <code style={{ display:'block', background:'var(--bg)', border:'1px solid var(--div)', borderRadius:'8px', padding:'8px 10px', fontSize:'11px', color:'var(--gold-l)', fontFamily:'monospace' }}>
              node tools/new-client/server.mjs
            </code>
            <div style={{ fontSize:'10px', color:'var(--muted)', marginTop:'6px' }}>→ ouvre http://localhost:4790 (depuis servio-pos-package/)</div>
          </div>
          <div style={{ background:'var(--card)', border:'1px solid var(--div)', borderRadius:'12px', padding:'16px 18px', display:'flex', flexDirection:'column' }}>
            <div style={{ fontSize:'13px', fontWeight:'700', marginBottom:'4px' }}>⚡ Compte web seul (rapide)</div>
            <div style={{ fontSize:'11px', color:'var(--muted)', marginBottom:'10px', lineHeight:1.5, flex:1 }}>
              Crée uniquement le compte tableau de bord — sans EXE. Utile pour un accès démo/test immédiat.
            </div>
            <button onClick={() => setShowAdd(!showAdd)} style={{ background:'linear-gradient(135deg,var(--gold),var(--gold-l))', border:'none', borderRadius:'8px', padding:'10px 16px', color:'#fff', cursor:'pointer', fontSize:'13px', fontWeight:'700' }}>
              {showAdd ? '✕ Fermer' : '+ Compte web seul'}
            </button>
          </div>
        </div>

        {/* ── Add Client Form (web-only account) ─────────────────────────── */}
        {showAdd && <AddClientForm adminKey={key} onDone={() => { setShowAdd(false); loadClients(); flash('✓ Client créé') }} onError={(e) => flash(e)} />}

        {/* Client list */}
        <div style={{ background:'var(--panel)', border:'1px solid var(--div)', borderRadius:'12px', overflow:'hidden' }}>
          <div style={{ padding:'16px 20px', borderBottom:'1px solid var(--div)', display:'flex', alignItems:'center', justifyContent:'space-between', background:'var(--card)' }}>
            <span style={{ fontWeight:'700', fontSize:'15px', color:'var(--gold-l)' }}>👥 Clients</span>
            <span style={{ fontSize:'11px', color:'var(--muted)' }}>{clients.length} total</span>
          </div>

          {loading ? (
            <div style={{ padding:'40px', textAlign:'center', color:'var(--muted)' }}>Chargement...</div>
          ) : clients.length === 0 ? (
            <div style={{ padding:'40px', textAlign:'center', color:'var(--muted)' }}>Aucun client</div>
          ) : (
            clients.map((c, i) => (
              <div key={i} onClick={() => openClient(c)}
                style={{ padding:'16px 20px', borderBottom:'1px solid var(--div)', display:'flex', alignItems:'center', gap:'12px', flexWrap:'wrap', cursor:'pointer', transition:'background .1s' }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--card)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                {/* Client info */}
                <div style={{ flex:1, minWidth:'180px' }}>
                  <div style={{ fontWeight:'700', fontSize:'14px' }}>{c.name}</div>
                  <div style={{ fontSize:'11px', color:'var(--muted)', marginTop:'2px' }}>{c.owner_email} · {c.city || ''}</div>
                  {c.public_slug ? (
                    <div style={{ fontSize:'10px', color:'var(--blue)', marginTop:'3px', fontFamily:'monospace' }}>🔗 servio.tn/moi/{c.public_slug}</div>
                  ) : (
                    <div style={{ fontSize:'10px', color:'var(--muted)', marginTop:'3px', fontStyle:'italic' }}>🔗 Pas de lien de commande — voir Détails</div>
                  )}
                  {c.suspend_at && <div style={{ fontSize:'10px', color:'var(--orange)', marginTop:'3px' }}>⏰ Auto-suspend: {new Date(c.suspend_at).toLocaleDateString('fr-TN')}</div>}
                </div>

                {/* API key */}
                <div style={{ fontSize:'11px', color:'var(--muted)', fontFamily:'monospace', padding:'4px 8px', background:'var(--card)', borderRadius:'4px' }}>{c.api_key}</div>

                {/* Status badge */}
                <span style={{ padding:'4px 12px', borderRadius:'20px', fontSize:'11px', fontWeight:'600',
                  background: c.plan==='active' ? 'var(--green-dim)' : 'var(--red-dim)',
                  color: c.plan==='active' ? 'var(--green)' : c.plan==='suspended_exe' ? 'var(--orange)' : c.plan==='suspended_dash' ? 'var(--blue)' : 'var(--red)',
                  border: `1px solid ${c.plan==='active'?'rgba(61,184,122,.2)':'rgba(224,82,82,.2)'}`,
                }}>
                  {c.plan==='active'?'✓ Actif':c.plan==='suspended_exe'?'💻 EXE bloqué':c.plan==='suspended_dash'?'📊 Dash bloqué':'✗ Tout suspendu'}
                </span>

                {/* Actions */}
                {c.plan === 'active' ? (
                  <button onClick={e => { e.stopPropagation(); openClient(c) }} style={{ padding:'7px 14px', background:'var(--card)', border:'1px solid var(--div)', borderRadius:'8px', color:'var(--muted)', cursor:'pointer', fontSize:'12px', fontWeight:'600' }}>
                    Détails →
                  </button>
                ) : (
                  <button onClick={e => { e.stopPropagation(); doAction(c.api_key, 'activate') }} style={{ padding:'7px 14px', background:'var(--green-dim)', border:'1px solid rgba(61,184,122,.3)', borderRadius:'8px', color:'var(--green)', cursor:'pointer', fontSize:'12px', fontWeight:'600' }}>
                    🔓 Réactiver
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Demo Requests Section */}
      <div style={{ background:'var(--panel)', border:'1px solid var(--div)', borderRadius:'12px', overflow:'hidden', marginTop:'20px' }}>
        <div onClick={() => { setShowDemos(!showDemos); if(!showDemos && !demoRequests.length) loadDemoRequests(); }} style={{ padding:'16px 20px', borderBottom: showDemos ? '1px solid var(--div)' : 'none', display:'flex', alignItems:'center', justifyContent:'space-between', background:'var(--card)', cursor:'pointer' }}>
          <span style={{ fontWeight:'700', fontSize:'15px', color:'var(--orange)' }}>📋 Demandes de demo ({demoRequests.length})</span>
          <span style={{ fontSize:'12px', color:'var(--muted)' }}>{showDemos ? '▲ Fermer' : '▼ Ouvrir'}</span>
        </div>

        {showDemos && (
          <div style={{ maxHeight:'600px', overflowY:'auto' }}>
            {demoRequests.length === 0 ? (
              <div style={{ padding:'40px', textAlign:'center', color:'var(--muted)' }}>Aucune demande</div>
            ) : (
              demoRequests.map((d: any, i: number) => (
                <div key={i} style={{ padding:'16px 20px', borderBottom:'1px solid var(--div)' }}>
                  {/* Header */}
                  <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'10px' }}>
                    <div>
                      <div style={{ fontWeight:'700', fontSize:'14px' }}>{d.business_name}</div>
                      <div style={{ fontSize:'11px', color:'var(--muted)' }}>{d.business_type} · {d.city || '—'} · {new Date(d.created_at).toLocaleDateString('fr-TN')} {new Date(d.created_at).toLocaleTimeString('fr-TN')}</div>
                    </div>
                    <span style={{ padding:'3px 10px', borderRadius:'12px', fontSize:'10px', fontWeight:'600',
                      background: d.status==='new' ? 'var(--gold-dim)' : d.status==='contacted' ? 'rgba(74,144,217,.1)' : d.status==='converted' ? 'var(--green-dim)' : 'var(--card)',
                      color: d.status==='new' ? 'var(--gold-l)' : d.status==='contacted' ? 'var(--blue)' : d.status==='converted' ? 'var(--green)' : 'var(--muted)',
                      border: '1px solid var(--div)',
                    }}>{d.status === 'new' ? '🆕 Nouveau' : d.status === 'contacted' ? '📞 Contacte' : d.status === 'converted' ? '✓ Converti' : d.status}</span>
                  </div>
                  {/* Details grid */}
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'6px 16px', fontSize:'12px', background:'var(--card)', borderRadius:'8px', padding:'12px', marginBottom:'8px' }}>
                    <div><span style={{ color:'var(--muted)' }}>👤 Gerant:</span> {d.owner_name || '—'}</div>
                    <div><span style={{ color:'var(--muted)' }}>📞 Tel:</span> <strong style={{ color:'var(--gold-l)' }}>{d.phone}</strong></div>
                    <div><span style={{ color:'var(--muted)' }}>📧 Email:</span> {d.email || '—'}</div>
                    <div><span style={{ color:'var(--muted)' }}>📍 Adresse:</span> {d.address || '—'}</div>
                    <div><span style={{ color:'var(--muted)' }}>🪑 Tables:</span> {d.table_count || '—'}</div>
                    <div><span style={{ color:'var(--muted)' }}>👥 Employes:</span> {d.employee_count || '—'}</div>
                    <div style={{ gridColumn:'1/-1' }}><span style={{ color:'var(--muted)' }}>💻 Systeme actuel:</span> {d.current_system || '—'}</div>
                    {d.main_problem && <div style={{ gridColumn:'1/-1' }}><span style={{ color:'var(--muted)' }}>⚠️ Probleme:</span> <span style={{ color:'var(--red)' }}>{d.main_problem}</span></div>}
                    {d.has_computer && <div><span style={{ color:'var(--muted)' }}>🖥️ PC:</span> {d.has_computer}</div>}
                    {d.has_printer && <div><span style={{ color:'var(--muted)' }}>🖨️ Imprimante:</span> {d.has_printer}</div>}
                    {d.has_cash_drawer && <div><span style={{ color:'var(--muted)' }}>💰 Tiroir:</span> {d.has_cash_drawer}</div>}
                    {d.has_scanner && <div><span style={{ color:'var(--muted)' }}>📱 Scanner:</span> {d.has_scanner}</div>}
                    {d.other_hardware && <div style={{ gridColumn:'1/-1' }}><span style={{ color:'var(--muted)' }}>🔧 Autre materiel:</span> {d.other_hardware}</div>}
                  </div>
                  {/* Menu & features */}
                  {d.menu_categories && <div style={{ fontSize:'11px', marginBottom:'4px' }}><span style={{ color:'var(--muted)' }}>🍽️ Menu:</span> {d.menu_categories}</div>}
                  {d.menu_notes && <div style={{ fontSize:'11px', marginBottom:'4px', color:'var(--muted)' }}>📝 {d.menu_notes}</div>}
                  {d.features && Array.isArray(d.features) && d.features.length > 0 && (
                    <div style={{ display:'flex', gap:'4px', flexWrap:'wrap', marginTop:'6px' }}>
                      {d.features.map((feat: string, fi: number) => (
                        <span key={fi} style={{ padding:'2px 8px', fontSize:'10px', background:'var(--gold-dim)', border:'1px solid var(--div)', borderRadius:'10px', color:'var(--gold-l)' }}>{feat}</span>
                      ))}
                    </div>
                  )}
                  {d.notes && <div style={{ fontSize:'11px', color:'var(--muted)', marginTop:'6px', fontStyle:'italic' }}>💬 {d.notes}</div>}
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Action modal */}
      {actionClient && (
        <div onClick={closeModal} style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.7)', zIndex:200, display:'flex', alignItems:'center', justifyContent:'center', backdropFilter:'blur(4px)', padding:'20px' }}>
          <div onClick={e => e.stopPropagation()} style={{ background:'var(--panel)', border:'1px solid var(--div)', borderRadius:'16px', padding:'28px', width:'100%', maxWidth:'480px', boxShadow:'var(--shadow)', maxHeight:'90vh', overflowY:'auto' }}>
            <div style={{ fontSize:'16px', fontWeight:'700', marginBottom:'4px' }}>{actionClient.name}</div>
            <div style={{ fontSize:'12px', color:'var(--muted)', marginBottom:'18px' }}>{actionClient.api_key}</div>

            {/* Tabs */}
            <div style={{ display:'flex', gap:'4px', marginBottom:'18px', background:'var(--card)', borderRadius:'10px', padding:'4px' }}>
              {[['apercu','📊 Aperçu'],['modules','🧩 Modules'],['qr','🔗 Lien & QR'],['compte','⚙️ Compte']].map(([id,label]) => (
                <button key={id} onClick={() => setModalTab(id as any)} style={{
                  flex:1, padding:'8px 6px', borderRadius:'8px', border:'none', cursor:'pointer', fontSize:'12px', fontWeight:'700',
                  background: modalTab===id ? 'var(--panel)' : 'transparent',
                  color: modalTab===id ? 'var(--gold-l)' : 'var(--muted)',
                  boxShadow: modalTab===id ? 'var(--shadow)' : 'none',
                }}>{label}</button>
              ))}
            </div>

            {/* ── Aperçu — today's activity, at a glance. Same data the
                client's own dashboard/POS would show, just read via their
                api_key from here instead of asked-for-and-copy-pasted. ── */}
            {modalTab === 'apercu' && (
              overviewLoading ? (
                <div style={{ padding:'30px', textAlign:'center', color:'var(--muted)', fontSize:'12px' }}>Chargement…</div>
              ) : (
                <div style={{ marginBottom:'8px' }}>
                  <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:'8px', marginBottom:'16px' }}>
                    {[
                      { label:'CA aujourd\'hui', val: overview?.dashboard ? `${(overview.dashboard.kpis?.total_revenue||0).toFixed(3)} DT` : '—' },
                      { label:'Commandes', val: overview?.dashboard ? String(overview.dashboard.kpis?.total_orders||0) : '—' },
                      { label:'Ticket moyen', val: overview?.dashboard ? `${(overview.dashboard.kpis?.avg_ticket||0).toFixed(3)} DT` : '—' },
                    ].map((s,i) => (
                      <div key={i} style={{ background:'var(--card)', border:'1px solid var(--div)', borderRadius:'10px', padding:'12px 8px', textAlign:'center' }}>
                        <div style={{ fontSize:'15px', fontWeight:'800', color:'var(--gold-l)' }}>{s.val}</div>
                        <div style={{ fontSize:'10px', color:'var(--muted)', marginTop:'2px' }}>{s.label}</div>
                      </div>
                    ))}
                  </div>

                  {overview?.wallet?.totals && (
                    <div style={{ background:'var(--card)', border:'1px solid var(--div)', borderRadius:'10px', padding:'12px 14px', marginBottom:'10px' }}>
                      <div style={{ fontSize:'11px', fontWeight:'700', color:'var(--muted)', marginBottom:'6px', textTransform:'uppercase', letterSpacing:'.5px' }}>💳 Fidélité</div>
                      <div style={{ display:'flex', justifyContent:'space-between', fontSize:'13px' }}>
                        <span>{overview.wallet.totals.nb_avec_solde} carte{overview.wallet.totals.nb_avec_solde !== 1 ? 's' : ''} avec solde</span>
                        <strong style={{ color:'var(--green)' }}>{(overview.wallet.totals.total_solde||0).toFixed(3)} DT</strong>
                      </div>
                    </div>
                  )}

                  {overview?.orders && (
                    <div style={{ background:'var(--card)', border:'1px solid var(--div)', borderRadius:'10px', padding:'12px 14px', marginBottom:'10px' }}>
                      <div style={{ fontSize:'11px', fontWeight:'700', color:'var(--muted)', marginBottom:'6px', textTransform:'uppercase', letterSpacing:'.5px' }}>🌐 Commandes en ligne</div>
                      <div style={{ display:'flex', justifyContent:'space-between', fontSize:'13px', marginBottom:'4px' }}>
                        <span>En attente à la caisse</span>
                        <strong style={{ color: overview.orders.pending?.length ? 'var(--gold-l)' : 'var(--muted)' }}>{overview.orders.pending?.length || 0}</strong>
                      </div>
                      <div style={{ display:'flex', justifyContent:'space-between', fontSize:'13px' }}>
                        <span>Non payées</span>
                        <strong style={{ color: overview.orders.unpaid?.length ? 'var(--red)' : 'var(--muted)' }}>{overview.orders.unpaid?.length || 0}</strong>
                      </div>
                    </div>
                  )}

                  {!overview?.dashboard && !overview?.wallet && !overview?.orders && (
                    <div style={{ padding:'20px', textAlign:'center', color:'var(--muted)', fontSize:'12px' }}>Aucune activité à afficher pour le moment.</div>
                  )}

                  <div style={{ fontSize:'11px', color:'var(--muted)', marginTop:'12px', paddingTop:'12px', borderTop:'1px solid var(--div)' }}>
                    {actionClient.owner_email} · {actionClient.city || '—'}{actionClient.phone ? ' · '+actionClient.phone : ''}
                  </div>
                </div>
              )
            )}

            {/* ── Modules — distribute/remove features on an already-created
                client. Undefined = server default (see DEFAULT_MODULES in
                /api/check); explicit true/false always wins. Reaches the
                till through the same license check the EXE already polls,
                no rebuild needed. ── */}
            {modalTab === 'modules' && (moduleLoading ? (
              <div style={{ padding:'20px', textAlign:'center', color:'var(--muted)', fontSize:'12px' }}>Chargement…</div>
            ) : !moduleCfg ? (
              <div style={{ padding:'20px', textAlign:'center', color:'var(--red)', fontSize:'12px' }}>Échec du chargement</div>
            ) : (
              <div style={{ display:'flex', flexDirection:'column', gap:'2px', marginBottom:'12px' }}>
                {MODULES_LIST.map(m => {
                  const val = moduleCfg.modules[m.id]
                  const on = val === undefined ? !MODULES_DEFAULT_OFF.has(m.id) : val
                  return (
                    <label key={m.id} style={{ display:'flex', alignItems:'center', gap:'10px', padding:'8px 6px', borderRadius:'8px', cursor:'pointer' }}>
                      <input type="checkbox" checked={on} onChange={() => toggleModule(m.id)} style={{ width:'16px', height:'16px', accentColor:'var(--gold)', flexShrink:0 }} />
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontSize:'13px', fontWeight:'600' }}>{m.label}</div>
                        <div style={{ fontSize:'11px', color:'var(--muted)' }}>{m.desc}</div>
                      </div>
                      {val === undefined && <span style={{ fontSize:'10px', color:'var(--muted)', fontStyle:'italic' }}>défaut</span>}
                    </label>
                  )
                })}
                <button
                  onClick={() => saveModules(actionClient.api_key)}
                  disabled={moduleSaving}
                  style={{ marginTop:'10px', padding:'12px', background:'linear-gradient(135deg,var(--gold),var(--gold-l))', border:'none', borderRadius:'10px', color:'#fff', cursor: moduleSaving ? 'default':'pointer', fontSize:'13px', fontWeight:'700', opacity: moduleSaving ? 0.7 : 1 }}
                >
                  {moduleSaving ? '…' : '✓ Enregistrer les modules'}
                </button>

                {/* Récompense mensuelle — same job the cron runs, triggerable
                    by hand for testing or before a cron schedule is set up.
                    Only shown once wallet is confirmed on for this client,
                    same "défaut"-aware check used above. */}
                {(moduleCfg.modules['wallet'] === undefined ? !MODULES_DEFAULT_OFF.has('wallet') : moduleCfg.modules['wallet']) && (
                  <div style={{ marginTop: '14px', paddingTop: '14px', borderTop: '1px solid var(--div)' }}>
                    <div style={{ fontSize: '11px', color: 'var(--muted)', fontWeight: '600', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '1px' }}>
                      Récompense mensuelle (Fidélité)
                    </div>
                    <button
                      onClick={() => runRewards(actionClient.api_key)}
                      disabled={rewardBusy}
                      style={{ width: '100%', padding: '12px', background: 'var(--card)', border: '1px solid var(--div)', borderRadius: '10px', color: 'var(--gold-l)', cursor: rewardBusy ? 'default' : 'pointer', fontSize: '13px', fontWeight: '700', opacity: rewardBusy ? 0.7 : 1 }}
                    >
                      {rewardBusy ? '…' : '🎁 Calculer la récompense (mois dernier)'}
                    </button>
                    {rewardResult && (
                      <div style={{ marginTop: '10px', fontSize: '12px' }}>
                        <div style={{ color: 'var(--muted)', marginBottom: '6px' }}>Période : {rewardResult.period}</div>
                        {rewardResult.results.length === 0 ? (
                          <div style={{ color: 'var(--muted)' }}>Aucun client n&apos;a rechargé ce mois-ci.</div>
                        ) : rewardResult.results.map((r: any, i: number) => (
                          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', color: r.applied ? 'var(--green)' : 'var(--muted)' }}>
                            <span>{r.name} ({r.qualifying_spend.toFixed(3)} DT)</span>
                            <span>{r.applied ? `+${r.amount.toFixed(3)} DT (${(r.tier_pct * 100).toFixed(0)}%)` : (r.reason || '—')}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* PIN reset — only relevant once walletPinProtected is on;
                    the public page has no self-recovery (no OTP/SMS), so a
                    forgotten/locked-out PIN can only be cleared from here. */}
                {(moduleCfg.modules['walletPinProtected'] === undefined ? !MODULES_DEFAULT_OFF.has('walletPinProtected') : moduleCfg.modules['walletPinProtected']) && (
                  <div style={{ marginTop: '14px', paddingTop: '14px', borderTop: '1px solid var(--div)' }}>
                    <div style={{ fontSize: '11px', color: 'var(--muted)', fontWeight: '600', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '1px' }}>
                      Réinitialiser un code PIN (client bloqué/oublié)
                    </div>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <input value={pinResetPhone} onChange={e => setPinResetPhone(e.target.value)} placeholder="Téléphone du client" style={{ flex: 1, background: 'var(--card)', border: '1.5px solid var(--div)', borderRadius: '8px', padding: '10px 12px', color: 'var(--txt)', fontSize: '13px', outline: 'none' }} />
                      <button onClick={() => resetWalletPin(actionClient.api_key)} disabled={pinResetBusy} style={{ padding: '0 14px', background: 'var(--card)', border: '1px solid var(--div)', borderRadius: '8px', color: 'var(--gold-l)', cursor: pinResetBusy ? 'default' : 'pointer', fontSize: '12px', fontWeight: 700 }}>
                        {pinResetBusy ? '…' : 'Réinitialiser'}
                      </button>
                    </div>
                    {pinResetMsg && <div style={{ marginTop: '8px', fontSize: '12px', color: pinResetMsg.startsWith('✓') ? 'var(--green)' : 'var(--red)' }}>{pinResetMsg}</div>}
                  </div>
                )}
              </div>
            ))}

            {/* ── Lien & QR — public ordering link + printable QR codes ── */}
            {modalTab === 'qr' && (
              <>
                <QrSection
                  client={actionClient}
                  adminKey={key}
                  hasTables={!!moduleCfg && (moduleCfg.modules['tables'] === undefined ? !MODULES_DEFAULT_OFF.has('tables') : moduleCfg.modules['tables'])}
                  onSlugSaved={(slug) => {
                    setActionClient((ac: any) => ac ? { ...ac, public_slug: slug } : ac)
                    setClients(cs => cs.map(c => c.api_key === actionClient.api_key ? { ...c, public_slug: slug } : c))
                  }}
                />
                {!(moduleCfg && (moduleCfg.modules['onlineOrders'] === undefined ? !MODULES_DEFAULT_OFF.has('onlineOrders') : moduleCfg.modules['onlineOrders'])) && (
                  <div style={{ marginTop:'14px', padding:'10px 12px', background:'var(--red-dim)', border:'1px solid rgba(224,82,82,.3)', borderRadius:'8px', color:'var(--red)', fontSize:'11px' }}>
                    ⚠ Le module &quot;Commandes en ligne&quot; est désactivé pour ce client — ce lien ne fonctionnera pas tant qu&apos;il n&apos;est pas activé dans l&apos;onglet Modules.
                  </div>
                )}
              </>
            )}

            {/* ── Compte — suspend/schedule/reactivate ── */}
            {modalTab === 'compte' && (
              <>
                <div style={{ fontSize:'11px', color:'var(--muted)', fontWeight:'600', marginBottom:'8px', textTransform:'uppercase', letterSpacing:'1px' }}>Suspendre</div>
                <div style={{ display:'flex', flexDirection:'column', gap:'8px', marginBottom:'16px' }}>
                  <button onClick={() => doAction(actionClient.api_key, 'suspend_all')} style={{ padding:'14px', background:'var(--red-dim)', border:'1px solid rgba(224,82,82,.3)', borderRadius:'10px', color:'var(--red)', cursor:'pointer', fontSize:'13px', fontWeight:'600', textAlign:'left' }}>
                    🔒 Suspendre TOUT <span style={{ float:'right', opacity:.6 }}>EXE + Dashboard</span>
                  </button>
                  <button onClick={() => doAction(actionClient.api_key, 'suspend_exe')} style={{ padding:'14px', background:'var(--card)', border:'1px solid var(--div)', borderRadius:'10px', color:'var(--orange)', cursor:'pointer', fontSize:'13px', fontWeight:'600', textAlign:'left' }}>
                    💻 Suspendre EXE seul <span style={{ float:'right', opacity:.6, color:'var(--muted)' }}>Dashboard reste actif</span>
                  </button>
                  <button onClick={() => doAction(actionClient.api_key, 'suspend_dash')} style={{ padding:'14px', background:'var(--card)', border:'1px solid var(--div)', borderRadius:'10px', color:'var(--blue)', cursor:'pointer', fontSize:'13px', fontWeight:'600', textAlign:'left' }}>
                    📊 Suspendre Dashboard seul <span style={{ float:'right', opacity:.6, color:'var(--muted)' }}>EXE reste actif</span>
                  </button>
                </div>

                <div style={{ fontSize:'11px', color:'var(--muted)', fontWeight:'600', marginBottom:'8px', textTransform:'uppercase', letterSpacing:'1px' }}>Programmer une suspension</div>
                <ScheduleSection apiKey={actionClient.api_key} suspendAt={actionClient.suspend_at} onAction={doAction} onCancel={() => doAction(actionClient.api_key, 'cancel_schedule')} />
              </>
            )}

            <button onClick={closeModal} style={{ width:'100%', padding:'12px', background:'var(--card)', border:'1px solid var(--div)', borderRadius:'10px', color:'var(--muted)', cursor:'pointer', fontSize:'13px', marginTop:'4px' }}>
              Fermer
            </button>
          </div>
        </div>
      )}
    </Wrap>
  )
}


// ═══════════════ ADD CLIENT FORM ═══════════════

const MODULES_LIST = [
  { id:'stockTracking',  label:'📦 Stock produits',        desc:"Comptage à l'unité, seuils, livraisons" },
  { id:'ingredients',    label:'🧪 Ingrédients & recettes', desc:'Coût auto, déduction sur vente' },
  { id:'credits',        label:'📒 Crédit client',          desc:'Ardoises / créances' },
  { id:'wallet',         label:'💳 Fidélité',               desc:'Solde prépayé + bonus 30% à la recharge' },
  { id:'walletPinProtected', label:'🔐 PIN fidélité',       desc:'Exige un code à 4 chiffres pour consulter le solde en ligne (recommandé — sans PIN, un numéro de téléphone connu suffit à voir le solde de quelqu\'un)' },
  { id:'sessions',       label:'🔒 Clôtures caisse',        desc:'Fond, compté, écart' },
  { id:'delivery',       label:'🛵 Livraison',              desc:'Type de commande + livraison' },
  { id:'tables',         label:'🪑 Plan de salle',          desc:'Tables, zones' },
  { id:'onlineOrders',   label:'🌐 Commandes en ligne',     desc:'Page publique + QR code (voir onglet Lien & QR)' },
  { id:'kitchenTickets', label:'🧑‍🍳 Tickets cuisine',        desc:'2 zones configurables' },
  { id:'barcode',        label:'⎸⎸ Code-barres',           desc:'Scanner USB, recherche' },
  { id:'printEnabled',   label:'🖨️ Impression tickets',     desc:'Ticket thermique 80mm' },
  { id:'dashboard',      label:'📊 Dashboard distant',      desc:'Accès web en temps réel' },
]

// Real server defaults (mirrors DEFAULT_MODULES in app/api/check/route.ts) — a
// module absent from every list below defaults ON, because that's what every
// isXEnabled() on the till actually does: `!(modules && modules.x === false)`
// treats "key not present" as enabled. Only list the modules that default OFF.
const MODULES_DEFAULT_OFF = new Set(['tables', 'barcode', 'wallet', 'onlineOrders', 'walletPinProtected'])

const PRESETS: Record<string, { label:string; emoji:string; modules:string[]; zone1:string; zone2:string; zone1Cats:string; zone2Cats:string }> = {
  cafe:     { label:'Café / Salon de thé',    emoji:'☕', modules:['sessions','credits','kitchenTickets','printEnabled','dashboard'], zone1:'BAR — Boissons', zone2:'CUISINE — Pâtisserie', zone1Cats:'Café,Thé,Jus,Boisson', zone2Cats:'Pâtisserie,Sandwich' },
  fastfood: { label:'Fast Food / Restaurant', emoji:'🍔', modules:['sessions','credits','delivery','kitchenTickets','printEnabled','dashboard'], zone1:'CUISINE — Plats chauds', zone2:'BAR — Boissons', zone1Cats:'Pizza,Plat,Sandwich,Tacos', zone2Cats:'Boisson,Jus' },
  retail:   { label:'Superette / Boutique',   emoji:'🏪', modules:['stockTracking','sessions','barcode','printEnabled','dashboard'], zone1:'', zone2:'', zone1Cats:'', zone2Cats:'' },
  pharma:   { label:'Parapharmacie',          emoji:'💊', modules:['stockTracking','sessions','barcode','printEnabled','dashboard'], zone1:'', zone2:'', zone1Cats:'', zone2Cats:'' },
  custom:   { label:'Personnalisé',           emoji:'⚙️', modules:['sessions','printEnabled'], zone1:'', zone2:'', zone1Cats:'', zone2Cats:'' },
}

function AddClientForm({ adminKey, onDone, onError }: { adminKey:string; onDone:()=>void; onError:(m:string)=>void }) {
  const [step, setStep]          = useState(1)
  const [preset, setPreset]      = useState('')
  const [name, setName]          = useState('')
  const [tagline, setTagline]    = useState('')
  const [logo, setLogo]          = useState('☕')
  const [city, setCity]          = useState('')
  const [phone, setPhone]        = useState('')
  const [email, setEmail]        = useState('')
  const [pass, setPass]          = useState('')
  const [apiKey, setApiKey]      = useState(()=>'SRVO-'+Math.random().toString(36).substring(2,7).toUpperCase()+'-001')
  const [mgrName, setMgrName]    = useState('Manager')
  const [mgrPin,  setMgrPin]     = useState('1234')
  const [cshName, setCshName]    = useState('Caissier')
  const [cshPin,  setCshPin]     = useState('0000')
  const [z1l, setZ1l]            = useState('')
  const [z2l, setZ2l]            = useState('')
  const [z1c, setZ1c]            = useState('')
  const [z2c, setZ2c]            = useState('')
  const [mods, setMods]          = useState<Record<string,boolean>>({ sessions:true, printEnabled:true })
  const [saving, setSaving]      = useState(false)
  const [done, setDone]          = useState<any>(null)

  const toggleMod = (id:string) => setMods(m=>({...m,[id]:!m[id]}))
  const genKey    = () => setApiKey('SRVO-'+Math.random().toString(36).substring(2,7).toUpperCase()+'-001')

  function applyPreset(id:string){
    const p=PRESETS[id]; if(!p) return
    setPreset(id); setLogo(p.emoji); setZ1l(p.zone1); setZ2l(p.zone2); setZ1c(p.zone1Cats); setZ2c(p.zone2Cats)
    const m:Record<string,boolean>={}
    MODULES_LIST.forEach(mod=>{ m[mod.id]=p.modules.includes(mod.id) })
    setMods(m); setStep(2)
  }

  async function submit(){
    if(!name||!email||!pass||!apiKey){ onError('Nom, email, mot de passe et clé API obligatoires'); return }
    setSaving(true)
    try {
      const res = await fetch('/api/admin/clients',{
        method:'PUT', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({ admin_key:adminKey, name:name.trim(), email:email.trim(), password:pass,
          api_key:apiKey.trim(), city:city.trim(), phone:phone.trim(), modules:mods,
          config_extra:{ tagline:tagline||name, logo, zone1Label:z1l, zone2Label:z2l,
            zone1Cats:z1c?z1c.split(',').map((s:string)=>s.trim()).filter(Boolean):undefined,
            zone2Cats:z2c?z2c.split(',').map((s:string)=>s.trim()).filter(Boolean):undefined,
          },
        }),
      })
      const data = await res.json()
      if(data.ok){ setDone({ name:name.trim(), apiKey:apiKey.trim(), email:email.trim(), mgrPin, cshPin, mgrName, cshName, logo, tagline:tagline||name, city, phone, z1l, z2l, z1c, z2c }); setStep(5); onDone() }
      else onError(data.error||'Erreur lors de la création')
    } catch { onError('Impossible de contacter le serveur') }
    setSaving(false)
  }

  const iS:React.CSSProperties = { width:'100%', background:'var(--card)', border:'1.5px solid var(--div)', borderRadius:'8px', padding:'11px 14px', color:'var(--txt)', fontSize:'14px', outline:'none', boxSizing:'border-box' }
  const lS:React.CSSProperties = { fontSize:'11px', color:'var(--muted)', fontWeight:600, marginBottom:'4px', textTransform:'uppercase' as const, letterSpacing:'0.5px', display:'block' }
  const g2:React.CSSProperties = { display:'grid', gridTemplateColumns:'1fr 1fr', gap:'14px', marginBottom:'14px' }
  const bN:React.CSSProperties = { padding:'14px', border:'none', borderRadius:'10px', background:'linear-gradient(135deg,var(--gold),var(--gold-l))', color:'#fff', fontSize:'15px', fontWeight:700, cursor:'pointer', width:'100%', marginBottom:'8px' }
  const bB:React.CSSProperties = { padding:'12px', border:'1px solid var(--div)', borderRadius:'10px', background:'var(--card)', color:'var(--muted)', fontSize:'13px', fontWeight:600, cursor:'pointer', width:'100%', marginBottom:'8px' }
  const wrap:React.CSSProperties = { background:'var(--panel)', border:'1px solid var(--div)', borderRadius:'16px', padding:'28px', marginBottom:'20px' }
  const sNames = ['Type','Identité','Utilisateurs','Modules','Prêt']

  // ── Step 5: success + build instructions ───────────────────────────
  if(step===5 && done){
    const folder = done.name.replace(/\s+/g,'_').replace(/[^a-zA-Z0-9_]/g,'')
    const cfg = `  name:        '${done.name.toUpperCase()}',\n  tagline:     '${done.tagline}',\n  logo:        '${done.logo}',\n  logoLetter:  '${done.name.charAt(0).toUpperCase()}',\n  city:        '${done.city||'Tunisie'}',\n  phone:       '${done.phone||'+216 XX XXX XXX'}',\n  currency:    'DT',\n  syncEnabled: true,\n  syncUrl:     'https://servio.tn/api/sync',\n  syncKey:     '${done.apiKey}',\n  posStockLocked: false,\n  managerName: '${done.mgrName}',\n  managerPin:  '${done.mgrPin}',\n  cashierName: '${done.cshName}',\n  cashierPin:  '${done.cshPin}',\n  zone1Cats:   [${(done.z1c||'').split(',').filter((s:string)=>s.trim()).map((s:string)=>`'${s.trim()}'`).join(',')}],\n  zone2Cats:   [${(done.z2c||'').split(',').filter((s:string)=>s.trim()).map((s:string)=>`'${s.trim()}'`).join(',')}],\n  boissonCats: [],\n  zone1Label:  '${done.z1l||'BAR'}',\n  zone2Label:  '${done.z2l||'CUISINE'}',`
    const pre:React.CSSProperties = { background:'#0A0704', color:'#E8A84C', padding:'12px', borderRadius:'8px', fontSize:'11px', overflowX:'auto' as const, margin:0, whiteSpace:'pre-wrap' as const, wordBreak:'break-all' as const, fontFamily:'Consolas,monospace', border:'1px solid var(--div)' }
    return (
      <div style={wrap}>
        <div style={{ textAlign:'center', marginBottom:'24px' }}>
          <div style={{ fontSize:'48px' }}>✅</div>
          <div style={{ fontSize:'20px', fontWeight:800, color:'var(--green)', marginTop:'8px' }}>{done.name} créé avec succès !</div>
          <div style={{ fontSize:'13px', color:'var(--muted)', marginTop:'4px' }}>Base de données provisionnée · Clé API active</div>
        </div>
        <div style={{ background:'var(--card)', border:'1px solid var(--div)', borderRadius:'12px', padding:'16px', marginBottom:'16px' }}>
          <div style={{ fontSize:'12px', fontWeight:700, color:'var(--gold-l)', marginBottom:'10px', textTransform:'uppercase' as const }}>📋 Informations à transmettre au client</div>
          {[['Dashboard URL','https://servio.tn'],['Email',done.email],['Clé API / syncKey',done.apiKey],['PIN Manager',done.mgrPin],['PIN Caissier',done.cshPin]].map(([l,v])=>(
            <div key={l} style={{ display:'flex', justifyContent:'space-between', padding:'7px 0', borderBottom:'1px solid var(--div)', fontSize:'13px' }}>
              <span style={{ color:'var(--muted)' }}>{l}</span>
              <strong style={{ fontFamily:'monospace' }}>{v}</strong>
            </div>
          ))}
        </div>
        <div style={{ background:'var(--card)', border:'1px solid var(--div)', borderRadius:'12px', padding:'16px', marginBottom:'16px' }}>
          <div style={{ fontSize:'12px', fontWeight:700, color:'var(--gold-l)', marginBottom:'12px', textTransform:'uppercase' as const }}>🔨 Construire l'EXE (à faire en local)</div>
          {[
            {n:'1',t:'Créer le dossier client',c:`mkdir servio-pos-package\\clients\\${folder}`},
            {n:'2',t:'Copier le template Cafeina',c:`copy servio-pos-package\\clients\\Cafeina\\index.html servio-pos-package\\clients\\${folder}\\index.html`},
            {n:'3',t:'Remplacer dans CLIENT_CONFIG :',c:`const CLIENT_CONFIG = {\n${cfg}\n};`},
            {n:'4',t:'Construire (~3 min)',c:`cd servio-pos-package\nnode _build-client.js ${folder}`},
            {n:'5',t:'Fichiers livrables',c:`dist_clients\\${folder}\\${folder}_Setup.exe\ndist_clients\\${folder}\\${folder}_Portable.exe`},
          ].map(({n,t,c})=>(
            <div key={n} style={{ marginBottom:'14px' }}>
              <div style={{ fontSize:'12px', color:'var(--muted)', marginBottom:'6px' }}>
                <span style={{ display:'inline-block', width:'20px', height:'20px', borderRadius:'50%', background:'var(--gold-dim)', color:'var(--gold-l)', fontSize:'11px', fontWeight:700, textAlign:'center' as const, lineHeight:'20px', marginRight:'6px' }}>{n}</span>{t}
              </div>
              <pre style={pre}>{c}</pre>
            </div>
          ))}
        </div>
        <button onClick={()=>{ setStep(1);setDone(null);setName('');setEmail('');setPass('');setApiKey('SRVO-'+Math.random().toString(36).substring(2,7).toUpperCase()+'-001');setPreset('') }} style={bN}>+ Créer un autre client</button>
      </div>
    )
  }

  return (
    <div style={wrap}>
      {/* Step indicator */}
      <div style={{ display:'flex', gap:'6px', marginBottom:'24px', alignItems:'center' }}>
        {sNames.map((s,i)=>(
          <React.Fragment key={s}>
            <div style={{ fontSize:'11px', fontWeight:700, padding:'5px 10px', borderRadius:'20px', whiteSpace:'nowrap' as const,
              background:step===i+1?'var(--gold-dim)':step>i+1?'var(--green-dim)':'var(--card)',
              color:step===i+1?'var(--gold-l)':step>i+1?'var(--green)':'var(--muted)',
              border:`1px solid ${step===i+1?'var(--gold)':step>i+1?'rgba(61,184,122,.3)':'var(--div)'}`,
            }}>{step>i+1?'✓ ':''}{s}</div>
            {i<sNames.length-1&&<div style={{ flex:1, height:'1px', background:'var(--div)' }}/>}
          </React.Fragment>
        ))}
      </div>

      {/* STEP 1 — Type */}
      {step===1&&(
        <div>
          <div style={{ fontSize:'16px', fontWeight:700, color:'var(--gold-l)', marginBottom:'16px' }}>Choisir le type d'activité</div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(140px,1fr))', gap:'10px' }}>
            {Object.entries(PRESETS).map(([id,p])=>(
              <button key={id} type="button" onClick={()=>applyPreset(id)} style={{ padding:'18px 12px', borderRadius:'12px', textAlign:'center' as const, cursor:'pointer',
                background:preset===id?'var(--gold-dim)':'var(--card)', border:`2px solid ${preset===id?'var(--gold)':'var(--div)'}`,
                color:preset===id?'var(--gold-l)':'var(--txt)', transition:'all .12s' }}>
                <div style={{ fontSize:'28px', marginBottom:'8px' }}>{p.emoji}</div>
                <div style={{ fontSize:'12px', fontWeight:700 }}>{p.label}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* STEP 2 — Identity */}
      {step===2&&(
        <div>
          <div style={{ fontSize:'16px', fontWeight:700, color:'var(--gold-l)', marginBottom:'16px' }}>Identité du commerce</div>
          <div style={g2}>
            <div><label style={lS}>Nom du commerce *</label><input style={iS} value={name} onChange={e=>setName(e.target.value)} placeholder="Café Central" autoFocus/></div>
            <div><label style={lS}>Emoji logo</label><input style={{...iS,fontSize:'24px',textAlign:'center'}} value={logo} onChange={e=>setLogo(e.target.value)} maxLength={4}/></div>
            <div><label style={lS}>Tagline</label><input style={iS} value={tagline} onChange={e=>setTagline(e.target.value)} placeholder="Café & Lounge — Tunis"/></div>
            <div><label style={lS}>Ville</label><input style={iS} value={city} onChange={e=>setCity(e.target.value)} placeholder="Tunis"/></div>
            <div><label style={lS}>Email propriétaire *</label><input style={iS} type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="gerant@email.com"/></div>
            <div><label style={lS}>Téléphone</label><input style={iS} value={phone} onChange={e=>setPhone(e.target.value)} placeholder="+216 XX XXX XXX"/></div>
            <div><label style={lS}>Mot de passe dashboard *</label><input style={iS} value={pass} onChange={e=>setPass(e.target.value)} placeholder="••••••••"/></div>
            <div><label style={lS}>Clé API (syncKey) *</label>
              <div style={{ display:'flex', gap:'6px' }}><input style={{...iS,fontFamily:'monospace',fontSize:'12px'}} value={apiKey} onChange={e=>setApiKey(e.target.value)}/><button type="button" onClick={genKey} style={{ padding:'0 12px', background:'var(--card)', border:'1px solid var(--div)', borderRadius:'8px', color:'var(--muted)', cursor:'pointer', fontSize:'18px', flexShrink:0 }}>⟳</button></div>
            </div>
          </div>
          <div style={g2}>
            <div><label style={lS}>Zone 1 label cuisine</label><input style={iS} value={z1l} onChange={e=>setZ1l(e.target.value)} placeholder="BAR — Boissons"/></div>
            <div><label style={lS}>Zone 1 catégories (virgule)</label><input style={iS} value={z1c} onChange={e=>setZ1c(e.target.value)} placeholder="Café,Thé,Jus"/></div>
            <div><label style={lS}>Zone 2 label cuisine</label><input style={iS} value={z2l} onChange={e=>setZ2l(e.target.value)} placeholder="CUISINE — Pâtisserie"/></div>
            <div><label style={lS}>Zone 2 catégories (virgule)</label><input style={iS} value={z2c} onChange={e=>setZ2c(e.target.value)} placeholder="Pâtisserie,Sandwich"/></div>
          </div>
          <button onClick={()=>setStep(3)} disabled={!name||!email||!pass||!apiKey} style={{...bN,opacity:(!name||!email||!pass||!apiKey)?.5:1}}>Suivant →</button>
          <button onClick={()=>setStep(1)} style={bB}>← Retour</button>
        </div>
      )}

      {/* STEP 3 — Users */}
      {step===3&&(
        <div>
          <div style={{ fontSize:'16px', fontWeight:700, color:'var(--gold-l)', marginBottom:'16px' }}>Utilisateurs & PINs</div>
          <div style={g2}>
            <div><label style={lS}>Nom Manager</label><input style={iS} value={mgrName} onChange={e=>setMgrName(e.target.value)}/></div>
            <div><label style={lS}>PIN Manager (4 chiffres)</label><input style={iS} value={mgrPin} onChange={e=>setMgrPin(e.target.value.slice(0,4))} placeholder="1234" maxLength={4} type="password"/></div>
            <div><label style={lS}>Nom Caissier</label><input style={iS} value={cshName} onChange={e=>setCshName(e.target.value)}/></div>
            <div><label style={lS}>PIN Caissier (4 chiffres)</label><input style={iS} value={cshPin} onChange={e=>setCshPin(e.target.value.slice(0,4))} placeholder="0000" maxLength={4} type="password"/></div>
          </div>
          <div style={{ background:'var(--gold-dim)', border:'1px solid var(--gold)', borderRadius:'10px', padding:'12px 16px', fontSize:'12px', color:'var(--gold-l)', marginBottom:'16px' }}>💡 Ces PINs sont incorporés dans l'EXE lors du build. Modifiables depuis la caisse après installation.</div>
          <button onClick={()=>setStep(4)} style={bN}>Suivant →</button>
          <button onClick={()=>setStep(2)} style={bB}>← Retour</button>
        </div>
      )}

      {/* STEP 4 — Modules */}
      {step===4&&(
        <div>
          <div style={{ fontSize:'16px', fontWeight:700, color:'var(--gold-l)', marginBottom:'16px' }}>Modules activés</div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(190px,1fr))', gap:'10px', marginBottom:'20px' }}>
            {MODULES_LIST.map(m=>(
              <button key={m.id} type="button" onClick={()=>toggleMod(m.id)} style={{ display:'flex', flexDirection:'column', gap:'3px', padding:'14px', borderRadius:'10px', textAlign:'left' as const, cursor:'pointer',
                background:mods[m.id]?'var(--gold-dim)':'var(--card)', border:`1.5px solid ${mods[m.id]?'var(--gold)':'var(--div)'}`,
                color:mods[m.id]?'var(--gold-l)':'var(--muted)', transition:'all .12s' }}>
                <span style={{ fontSize:'13px', fontWeight:700 }}>{m.label}</span>
                <span style={{ fontSize:'11px', opacity:.8 }}>{m.desc}</span>
              </button>
            ))}
          </div>
          <button onClick={submit} disabled={saving} style={{...bN,opacity:saving?.6:1}}>{saving?'⏳ Création en cours…':'⚡ Créer le client'}</button>
          <button onClick={()=>setStep(3)} style={bB}>← Retour</button>
        </div>
      )}
    </div>
  )
}
