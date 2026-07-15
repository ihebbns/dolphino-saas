'use client'
import { useState, useEffect } from 'react'

const API = process.env.NEXT_PUBLIC_API_URL || 'https://dolphino-saas.vercel.app'
const ADMIN_KEY = 'dolphino-admin-iheb-2026' // change this to your secret

function f(n: any) { return Number(n).toFixed(3) }

// ════════════════ LOGIN ════════════════
function AdminLogin({ onLogin }: { onLogin: () => void }) {
  const [pass, setPass] = useState('')
  const [err,  setErr]  = useState('')

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (pass === ADMIN_KEY) {
      sessionStorage.setItem('admin_auth', '1')
      onLogin()
    } else {
      setErr('Mot de passe incorrect.')
    }
  }

  return (
    <div style={{ minHeight:'100vh', background:'#080604', display:'flex', alignItems:'center', justifyContent:'center' }}>
      <form onSubmit={submit} style={{ background:'#0F0C08', border:'1px solid #231C12', borderRadius:'16px', padding:'40px 32px', width:'320px', textAlign:'center' }}>
        <div style={{ fontSize:'42px', marginBottom:'8px' }}>⚡</div>
        <div style={{ fontFamily:'serif', fontSize:'22px', color:'#E8A84C', marginBottom:'4px' }}>SERVIO OS</div>
        <div style={{ fontSize:'11px', color:'#7A6E5F', letterSpacing:'2px', textTransform:'uppercase', marginBottom:'28px' }}>Admin Panel</div>
        <input
          type="password"
          value={pass}
          onChange={e => setPass(e.target.value)}
          placeholder="Mot de passe admin"
          style={{ width:'100%', background:'#181310', border:'1px solid #231C12', borderRadius:'8px', padding:'12px', color:'#F0E8D8', fontSize:'14px', outline:'none', marginBottom:'12px', boxSizing:'border-box' }}
          autoFocus
        />
        {err && <div style={{ color:'#E05252', fontSize:'12px', marginBottom:'10px' }}>{err}</div>}
        <button type="submit" style={{ width:'100%', padding:'12px', background:'linear-gradient(135deg,#C8913A,#E8A84C)', border:'none', borderRadius:'8px', color:'#080604', fontSize:'14px', fontWeight:'700', cursor:'pointer' }}>
          Accéder
        </button>
      </form>
    </div>
  )
}

// ════════════════ ADMIN PANEL ════════════════
function AdminPanel({ onLogout }: { onLogout: () => void }) {
  const [clients,  setClients]  = useState<any[]>([])
  const [loading,  setLoading]  = useState(false)
  const [msg,      setMsg]      = useState('')
  const [showAdd,  setShowAdd]  = useState(false)

  // New client form
  const [newName,  setNewName]  = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [newPass,  setNewPass]  = useState('')
  const [newKey,   setNewKey]   = useState('')
  const [newCity,  setNewCity]  = useState('')
  const [newPhone, setNewPhone] = useState('')
  const [adding,   setAdding]   = useState(false)

  async function loadClients() {
    setLoading(true)
    try {
      const res = await fetch(`${API}/api/admin/clients`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ admin_key: ADMIN_KEY })
      })
      const data = await res.json()
      if (data.ok) setClients(data.clients)
      else setMsg('Erreur: ' + data.error)
    } catch { setMsg('Erreur de connexion') }
    setLoading(false)
  }

  async function togglePlan(apiKey: string, currentPlan: string) {
    const action = currentPlan === 'suspended' ? 'activate' : 'suspend'
    const label  = action === 'suspend' ? 'Suspendre' : 'Réactiver'
    if (!confirm(`${label} ce client ?`)) return

    try {
      const res = await fetch(`${API}/api/admin/suspend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ admin_key: ADMIN_KEY, api_key: apiKey, action })
      })
      const data = await res.json()
      if (data.ok) {
        flash(`✓ Client ${action === 'suspend' ? 'suspendu' : 'réactivé'}`)
        loadClients()
      } else {
        flash('Erreur: ' + data.error)
      }
    } catch { flash('Erreur de connexion') }
  }

  async function addClient(e: React.FormEvent) {
    e.preventDefault()
    if (!newName || !newEmail || !newPass || !newKey) { flash('Remplissez tous les champs obligatoires'); return }
    setAdding(true)
    try {
      const res = await fetch(`${API}/api/admin/clients`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          admin_key: ADMIN_KEY,
          name: newName, email: newEmail,
          password: newPass, api_key: newKey,
          city: newCity, phone: newPhone
        })
      })
      const data = await res.json()
      if (data.ok) {
        flash('✓ Client ajouté!')
        setNewName(''); setNewEmail(''); setNewPass(''); setNewKey(''); setNewCity(''); setNewPhone('')
        setShowAdd(false)
        loadClients()
      } else {
        flash('Erreur: ' + data.error)
      }
    } catch { flash('Erreur de connexion') }
    setAdding(false)
  }

  function flash(m: string) {
    setMsg(m)
    setTimeout(() => setMsg(''), 3000)
  }

  function generateKey() {
    const id = Math.random().toString(36).slice(2,6).toUpperCase()
    setNewKey('DOLPH-' + id + '-' + Date.now().toString().slice(-4))
  }

  useEffect(() => { loadClients() }, [])

  const s: Record<string, any> = {
    wrap:    { minHeight:'100vh', background:'#080604', color:'#F0E8D8', fontFamily:'system-ui,sans-serif', fontSize:'14px' },
    hdr:     { background:'#0F0C08', borderBottom:'1px solid #231C12', padding:'0 24px', height:'56px', display:'flex', alignItems:'center', justifyContent:'space-between' },
    brand:   { fontFamily:'serif', fontSize:'20px', color:'#E8A84C' },
    content: { maxWidth:'900px', margin:'0 auto', padding:'24px' },
    card:    { background:'#0F0C08', border:'1px solid #231C12', borderRadius:'12px', overflow:'hidden', marginBottom:'20px' },
    cardHdr: { padding:'14px 20px', borderBottom:'1px solid #231C12', display:'flex', justifyContent:'space-between', alignItems:'center', background:'#181310' },
    cardTitle:{ fontWeight:'700', fontSize:'15px', color:'#E8A84C' },
    row:     { display:'flex', alignItems:'center', gap:'12px', padding:'14px 20px', borderBottom:'1px solid #1A1410' },
    badge:   (plan: string) => ({
      padding:'3px 10px', borderRadius:'20px', fontSize:'11px', fontWeight:'700',
      background: plan === 'active' ? 'rgba(61,184,122,.15)' : 'rgba(224,82,82,.15)',
      color:      plan === 'active' ? '#3DB87A' : '#E05252',
      border:     `1px solid ${plan === 'active' ? 'rgba(61,184,122,.3)' : 'rgba(224,82,82,.3)'}`,
    }),
    btnSuspend: { padding:'6px 14px', background:'rgba(224,82,82,.15)', border:'1px solid rgba(224,82,82,.3)', borderRadius:'6px', color:'#E05252', fontSize:'12px', fontWeight:'600', cursor:'pointer' },
    btnActive:  { padding:'6px 14px', background:'rgba(61,184,122,.15)', border:'1px solid rgba(61,184,122,.3)', borderRadius:'6px', color:'#3DB87A', fontSize:'12px', fontWeight:'600', cursor:'pointer' },
    btnAdd:     { padding:'8px 16px', background:'linear-gradient(135deg,#C8913A,#E8A84C)', border:'none', borderRadius:'7px', color:'#080604', fontSize:'13px', fontWeight:'700', cursor:'pointer' },
    inp:     { background:'#181310', border:'1px solid #231C12', borderRadius:'7px', padding:'9px 12px', color:'#F0E8D8', fontSize:'13px', outline:'none', width:'100%', boxSizing:'border-box' as any },
    label:   { fontSize:'11px', color:'#7A6E5F', textTransform:'uppercase' as any, letterSpacing:'1px', display:'block', marginBottom:'4px' },
    formGrid:{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'12px', padding:'20px' },
  }

  return (
    <div style={s.wrap}>
      {/* Header */}
      <div style={s.hdr}>
        <div style={s.brand}>⚡ SERVIO OS — Admin Panel</div>
        <div style={{ display:'flex', gap:'12px', alignItems:'center' }}>
          {msg && <span style={{ fontSize:'12px', color: msg.startsWith('✓') ? '#3DB87A' : '#E05252' }}>{msg}</span>}
          <button onClick={loadClients} style={{ background:'#181310', border:'1px solid #231C12', borderRadius:'6px', padding:'6px 12px', color:'#7A6E5F', cursor:'pointer', fontSize:'12px' }}>↻ Actualiser</button>
          <button onClick={onLogout} style={{ background:'none', border:'1px solid rgba(224,82,82,.3)', borderRadius:'6px', padding:'6px 12px', color:'#E05252', cursor:'pointer', fontSize:'12px' }}>Déconnecter</button>
        </div>
      </div>

      <div style={s.content}>

        {/* Stats */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:'12px', marginBottom:'20px' }}>
          {[
            { label:'Total clients', val: clients.length, color:'#E8A84C' },
            { label:'Actifs', val: clients.filter(c=>c.plan==='active').length, color:'#3DB87A' },
            { label:'Suspendus', val: clients.filter(c=>c.plan==='suspended').length, color:'#E05252' },
          ].map((k,i) => (
            <div key={i} style={{ background:'#0F0C08', border:'1px solid #231C12', borderRadius:'10px', padding:'16px', textAlign:'center' }}>
              <div style={{ fontSize:'28px', fontWeight:'700', color:k.color }}>{k.val}</div>
              <div style={{ fontSize:'11px', color:'#7A6E5F', marginTop:'4px' }}>{k.label}</div>
            </div>
          ))}
        </div>

        {/* Clients list */}
        <div style={s.card}>
          <div style={s.cardHdr}>
            <span style={s.cardTitle}>👥 Clients</span>
            <button style={s.btnAdd} onClick={() => setShowAdd(!showAdd)}>
              {showAdd ? '✕ Annuler' : '+ Nouveau client'}
            </button>
          </div>

          {/* Add client form */}
          {showAdd && (
            <form onSubmit={addClient}>
              <div style={s.formGrid}>
                <div><label style={s.label}>Nom restaurant *</label><input style={s.inp} value={newName} onChange={e=>setNewName(e.target.value)} placeholder="Fast Food Sami" /></div>
                <div><label style={s.label}>Email *</label><input style={s.inp} type="email" value={newEmail} onChange={e=>setNewEmail(e.target.value)} placeholder="owner@email.com" /></div>
                <div><label style={s.label}>Mot de passe *</label><input style={s.inp} value={newPass} onChange={e=>setNewPass(e.target.value)} placeholder="••••••••" /></div>
                <div>
                  <label style={s.label}>Clé API * <button type="button" onClick={generateKey} style={{ marginLeft:'8px', background:'none', border:'1px solid #231C12', borderRadius:'4px', padding:'2px 8px', color:'#C8913A', fontSize:'10px', cursor:'pointer' }}>Générer</button></label>
                  <input style={s.inp} value={newKey} onChange={e=>setNewKey(e.target.value)} placeholder="DOLPH-XXXX-0000" />
                </div>
                <div><label style={s.label}>Ville</label><input style={s.inp} value={newCity} onChange={e=>setNewCity(e.target.value)} placeholder="Kelibia" /></div>
                <div><label style={s.label}>Téléphone</label><input style={s.inp} value={newPhone} onChange={e=>setNewPhone(e.target.value)} placeholder="+216 XX XXX XXX" /></div>
              </div>
              <div style={{ padding:'0 20px 16px', display:'flex', gap:'10px' }}>
                <button type="submit" disabled={adding} style={{ ...s.btnAdd, opacity: adding ? .6 : 1 }}>{adding ? 'Ajout...' : '✓ Ajouter le client'}</button>
              </div>
            </form>
          )}

          {/* Clients table */}
          {loading
            ? <div style={{ padding:'30px', textAlign:'center', color:'#7A6E5F' }}>Chargement...</div>
            : clients.length === 0
              ? <div style={{ padding:'30px', textAlign:'center', color:'#7A6E5F' }}>Aucun client</div>
              : clients.map((c, i) => (
                <div key={i} style={{ ...s.row, background: i%2===0 ? 'transparent' : '#181310' }}>
                  <div style={{ flex:1 }}>
                    <div style={{ fontWeight:'700', fontSize:'14px' }}>{c.name}</div>
                    <div style={{ fontSize:'11px', color:'#7A6E5F', marginTop:'2px' }}>{c.owner_email} · {c.city}</div>
                  </div>
                  <div style={{ fontSize:'11px', color:'#7A6E5F', fontFamily:'monospace' }}>{c.api_key}</div>
                  <span style={s.badge(c.plan)}>{c.plan === 'active' ? '✓ Actif' : '✗ Suspendu'}</span>
                  <button
                    onClick={() => togglePlan(c.api_key, c.plan)}
                    style={c.plan === 'active' ? s.btnSuspend : s.btnActive}
                  >
                    {c.plan === 'active' ? '🔒 Suspendre' : '🔓 Réactiver'}
                  </button>
                </div>
              ))
          }
        </div>

        {/* Client Config Editor */}
        <ConfigEditor clients={clients} adminKey={ADMIN_KEY} onFlash={flash} s={s} />

        {/* Instructions */}
        <div style={{ background:'#0F0C08', border:'1px solid #231C12', borderRadius:'10px', padding:'16px 20px', fontSize:'12px', color:'#7A6E5F', lineHeight:'1.8' }}>
          <div style={{ color:'#E8A84C', fontWeight:'700', marginBottom:'8px' }}>📋 Instructions</div>
          <div>• <b style={{color:'#F0E8D8'}}>Suspendre</b> → l'app client affiche "Application Suspendue" dans les 30 minutes</div>
          <div>• <b style={{color:'#F0E8D8'}}>Réactiver</b> → l'app client reprend normalement au prochain cycle</div>
          <div>• <b style={{color:'#F0E8D8'}}>Contact</b>: 📞 +216 52 050 581</div>
          <div style={{marginTop:'8px'}}>URL Admin: <code style={{color:'#E8A84C'}}>dolphino-saas.vercel.app/admin</code></div>
        </div>

      </div>
    </div>
  )
}

// ════════════════ ROOT ════════════════
export default function AdminPage() {
  const [auth, setAuth] = useState(false)

  useEffect(() => {
    if (sessionStorage.getItem('admin_auth') === '1') setAuth(true)
  }, [])

  function logout() {
    sessionStorage.removeItem('admin_auth')
    setAuth(false)
  }

  return auth
    ? <AdminPanel onLogout={logout} />
    : <AdminLogin onLogin={() => setAuth(true)} />
}
