'use client'
import { useState, useEffect } from 'react'

const API = process.env.NEXT_PUBLIC_API_URL || ''
const ADMIN_KEY = 'servio-admin-iheb-2026'

// ═══════════════ ADMIN PAGE ═══════════════
export default function AdminPage() {
  const [authed, setAuthed] = useState(false)
  const [dark, setDark] = useState(true)

  useEffect(() => {
    if (sessionStorage.getItem('servio_admin') === '1') setAuthed(true)
    const saved = localStorage.getItem('servio_admin_theme')
    if (saved === 'light') setDark(false)
  }, [])

  function toggleTheme() {
    setDark(!dark)
    localStorage.setItem('servio_admin_theme', dark ? 'light' : 'dark')
  }

  if (!authed) return <Login dark={dark} toggleTheme={toggleTheme} onLogin={() => { sessionStorage.setItem('servio_admin','1'); setAuthed(true) }} />
  return <Panel dark={dark} toggleTheme={toggleTheme} onLogout={() => { sessionStorage.removeItem('servio_admin'); setAuthed(false) }} />
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
function Login({ dark, toggleTheme, onLogin }: { dark:boolean, toggleTheme:()=>void, onLogin:()=>void }) {
  const [pass, setPass] = useState('')
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    // Test against API
    try {
      const res = await fetch(`${API}/api/admin/clients`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ admin_key: pass }) })
      if (res.ok) { onLogin(); sessionStorage.setItem('servio_admin_key', pass) }
      else setErr('Mot de passe incorrect')
    } catch { 
      // Fallback: local check
      if (pass === ADMIN_KEY) onLogin()
      else setErr('Erreur de connexion')
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

// ═══════════════ PANEL ═══════════════
function Panel({ dark, toggleTheme, onLogout }: { dark:boolean, toggleTheme:()=>void, onLogout:()=>void }) {
  const [clients, setClients] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState('')
  const [actionClient, setActionClient] = useState<any>(null)
  const [demoRequests, setDemoRequests] = useState<any[]>([])
  const [showDemos, setShowDemos] = useState(false)

  const key = sessionStorage.getItem('servio_admin_key') || ADMIN_KEY

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
    setActionClient(null)
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

      <div style={{ maxWidth:'1000px', margin:'0 auto', padding:'24px' }}>
        {/* KPIs */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:'14px', marginBottom:'24px' }}>
          {[
            { label:'Total clients', val:clients.length, color:'var(--gold-l)', icon:'👥' },
            { label:'Actifs', val:active, color:'var(--green)', icon:'✓' },
            { label:'Suspendus', val:suspended, color:'var(--red)', icon:'🔒' },
          ].map((k,i) => (
            <div key={i} style={{ background:'var(--panel)', border:'1px solid var(--div)', borderRadius:'12px', padding:'20px', textAlign:'center', position:'relative', overflow:'hidden' }}>
              <div style={{ position:'absolute', top:0, left:0, right:0, height:'3px', background:k.color }}/>
              <div style={{ fontSize:'32px', fontWeight:'800', color:k.color }}>{k.val}</div>
              <div style={{ fontSize:'12px', color:'var(--muted)', marginTop:'4px' }}>{k.label}</div>
            </div>
          ))}
        </div>

        {/* Info bar */}
        <div style={{ background:'var(--card)', border:'1px solid var(--div)', borderRadius:'10px', padding:'12px 18px', marginBottom:'20px', fontSize:'12px', color:'var(--muted)', display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:'8px' }}>
          <span>📂 Pour créer un nouveau client + EXE → <code style={{ color:'var(--gold-l)', background:'var(--panel)', padding:'2px 8px', borderRadius:'4px' }}>node build-server.js</code> puis ouvrir <code style={{ color:'var(--gold-l)', background:'var(--panel)', padding:'2px 8px', borderRadius:'4px' }}>localhost:4500</code></span>
        </div>

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
              <div key={i} style={{ padding:'16px 20px', borderBottom:'1px solid var(--div)', display:'flex', alignItems:'center', gap:'12px', flexWrap:'wrap' }}>
                {/* Client info */}
                <div style={{ flex:1, minWidth:'180px' }}>
                  <div style={{ fontWeight:'700', fontSize:'14px' }}>{c.name}</div>
                  <div style={{ fontSize:'11px', color:'var(--muted)', marginTop:'2px' }}>{c.owner_email} · {c.city || ''}</div>
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
                  <button onClick={() => setActionClient(c)} style={{ padding:'7px 14px', background:'var(--card)', border:'1px solid var(--div)', borderRadius:'8px', color:'var(--muted)', cursor:'pointer', fontSize:'12px', fontWeight:'600' }}>
                    Actions ▾
                  </button>
                ) : (
                  <button onClick={() => doAction(c.api_key, 'activate')} style={{ padding:'7px 14px', background:'var(--green-dim)', border:'1px solid rgba(61,184,122,.3)', borderRadius:'8px', color:'var(--green)', cursor:'pointer', fontSize:'12px', fontWeight:'600' }}>
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
        <div onClick={() => setActionClient(null)} style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.7)', zIndex:200, display:'flex', alignItems:'center', justifyContent:'center', backdropFilter:'blur(4px)', padding:'20px' }}>
          <div onClick={e => e.stopPropagation()} style={{ background:'var(--panel)', border:'1px solid var(--div)', borderRadius:'16px', padding:'28px', width:'100%', maxWidth:'420px', boxShadow:'var(--shadow)', maxHeight:'90vh', overflowY:'auto' }}>
            <div style={{ fontSize:'16px', fontWeight:'700', marginBottom:'4px' }}>{actionClient.name}</div>
            <div style={{ fontSize:'12px', color:'var(--muted)', marginBottom:'20px' }}>{actionClient.api_key}</div>
            
            {/* Suspend options */}
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

            {/* Schedule options */}
            <div style={{ fontSize:'11px', color:'var(--muted)', fontWeight:'600', marginBottom:'8px', textTransform:'uppercase', letterSpacing:'1px' }}>Programmer une suspension</div>
            <ScheduleSection apiKey={actionClient.api_key} suspendAt={actionClient.suspend_at} onAction={doAction} onCancel={() => doAction(actionClient.api_key, 'cancel_schedule')} />

            <button onClick={() => setActionClient(null)} style={{ width:'100%', padding:'12px', background:'var(--card)', border:'1px solid var(--div)', borderRadius:'10px', color:'var(--muted)', cursor:'pointer', fontSize:'13px', marginTop:'4px' }}>
              Fermer
            </button>
          </div>
        </div>
      )}
    </Wrap>
  )
}
