'use client'
import { useState, useEffect } from 'react'

const API = process.env.NEXT_PUBLIC_API_URL || ''
const ADMIN_KEY = 'servio-admin-2026'
const BUILD_SERVER = 'http://localhost:4500'

function f(n: any) { return Number(n).toFixed(3) }

// ═══════════════ STYLES ═══════════════
const S = {
  wrap: { minHeight:'100vh', background:'#080604', color:'#F0E8D8', fontFamily:'system-ui,sans-serif', fontSize:'14px' },
  hdr: { background:'#0F0C08', borderBottom:'1px solid #231C12', padding:'0 24px', height:'56px', display:'flex', alignItems:'center', justifyContent:'space-between' } as any,
  brand: { fontFamily:'serif', fontSize:'20px', color:'#E8A84C' },
  content: { maxWidth:'1000px', margin:'0 auto', padding:'24px' },
  card: { background:'#0F0C08', border:'1px solid #231C12', borderRadius:'12px', overflow:'hidden', marginBottom:'20px' } as any,
  cardHdr: { padding:'14px 20px', borderBottom:'1px solid #231C12', display:'flex', justifyContent:'space-between', alignItems:'center', background:'#181310' } as any,
  cardTitle: { fontWeight:'700', fontSize:'15px', color:'#E8A84C' },
  row: { display:'flex', alignItems:'center', gap:'12px', padding:'14px 20px', borderBottom:'1px solid #1A1410' } as any,
  badge: (plan: string) => ({ padding:'3px 10px', borderRadius:'20px', fontSize:'11px', fontWeight:'700', background: plan==='active'?'rgba(61,184,122,.15)':'rgba(224,82,82,.15)', color: plan==='active'?'#3DB87A':'#E05252', border:`1px solid ${plan==='active'?'rgba(61,184,122,.3)':'rgba(224,82,82,.3)'}` }),
  btnGold: { padding:'8px 16px', background:'linear-gradient(135deg,#C8913A,#E8A84C)', border:'none', borderRadius:'7px', color:'#080604', fontSize:'13px', fontWeight:'700', cursor:'pointer' } as any,
  btnRed: { padding:'6px 14px', background:'rgba(224,82,82,.15)', border:'1px solid rgba(224,82,82,.3)', borderRadius:'6px', color:'#E05252', fontSize:'12px', fontWeight:'600', cursor:'pointer' } as any,
  btnGreen: { padding:'6px 14px', background:'rgba(61,184,122,.15)', border:'1px solid rgba(61,184,122,.3)', borderRadius:'6px', color:'#3DB87A', fontSize:'12px', fontWeight:'600', cursor:'pointer' } as any,
  inp: { background:'#181310', border:'1px solid #231C12', borderRadius:'7px', padding:'9px 12px', color:'#F0E8D8', fontSize:'13px', outline:'none', width:'100%', boxSizing:'border-box' } as any,
  label: { fontSize:'11px', color:'#7A6E5F', textTransform:'uppercase' as any, letterSpacing:'1px', display:'block', marginBottom:'4px' },
  grid2: { display:'grid', gridTemplateColumns:'1fr 1fr', gap:'12px', padding:'20px' } as any,
  grid3: { display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'12px', padding:'20px' } as any,
  tab: (active: boolean) => ({ padding:'10px 20px', cursor:'pointer', borderBottom: active?'2px solid #E8A84C':'2px solid transparent', color: active?'#E8A84C':'#7A6E5F', fontWeight: active?'700':'400', fontSize:'13px' }),
}

// ═══════════════ LOGIN ═══════════════
function AdminLogin({ onLogin }: { onLogin: () => void }) {
  const [pass, setPass] = useState('')
  const [err, setErr] = useState('')
  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (pass === ADMIN_KEY) { sessionStorage.setItem('admin_auth','1'); onLogin() }
    else setErr('Mot de passe incorrect.')
  }
  return (
    <div style={{ minHeight:'100vh', background:'#080604', display:'flex', alignItems:'center', justifyContent:'center' }}>
      <form onSubmit={submit} style={{ background:'#0F0C08', border:'1px solid #231C12', borderRadius:'16px', padding:'40px 32px', width:'320px', textAlign:'center' }}>
        <div style={{ fontSize:'42px', marginBottom:'8px' }}>⚡</div>
        <div style={{ fontFamily:'serif', fontSize:'22px', color:'#E8A84C', marginBottom:'4px' }}>SERVIO OS</div>
        <div style={{ fontSize:'11px', color:'#7A6E5F', letterSpacing:'2px', textTransform:'uppercase', marginBottom:'28px' }}>Admin Panel</div>
        <input type="password" value={pass} onChange={e=>setPass(e.target.value)} placeholder="Mot de passe admin" style={{ ...S.inp, marginBottom:'12px' }} autoFocus />
        {err && <div style={{ color:'#E05252', fontSize:'12px', marginBottom:'10px' }}>{err}</div>}
        <button type="submit" style={S.btnGold}>Accéder</button>
      </form>
    </div>
  )
}

// ═══════════════ MENU EDITOR COMPONENT ═══════════════
function MenuEditor({ menu, setMenu }: { menu: any, setMenu: (m: any) => void }) {
  const [selCat, setSelCat] = useState(Object.keys(menu)[0] || '')
  const [newCatName, setNewCatName] = useState('')
  const [newCatIcon, setNewCatIcon] = useState('')
  const [newItemName, setNewItemName] = useState('')
  const [newItemEmoji, setNewItemEmoji] = useState('')
  const [newItemPrice, setNewItemPrice] = useState('')
  const [newItemHasVar, setNewItemHasVar] = useState(false)
  const [newItemPriceMoy, setNewItemPriceMoy] = useState('')
  const [newItemPriceMax, setNewItemPriceMax] = useState('')

  function addCategory() {
    if (!newCatName.trim()) return
    const m = { ...menu, [newCatName.trim()]: { icon: newCatIcon || '🍽️', items: [] } }
    setMenu(m)
    setSelCat(newCatName.trim())
    setNewCatName(''); setNewCatIcon('')
  }

  function deleteCategory(cat: string) {
    if (!confirm(`Supprimer la catégorie "${cat}" et tous ses articles ?`)) return
    const m = { ...menu }; delete m[cat]; setMenu(m)
    setSelCat(Object.keys(m)[0] || '')
  }

  function addItem() {
    if (!newItemName.trim() || !selCat) return
    const id = selCat.slice(0,2).toLowerCase() + (menu[selCat]?.items?.length || 0 + 1)
    let item: any = { id, name: newItemName.trim(), e: newItemEmoji || '🍽️' }
    if (newItemHasVar) {
      item.v = [{ l:'Moy', p: parseFloat(newItemPriceMoy) || 0 }, { l:'Max', p: parseFloat(newItemPriceMax) || 0 }]
    } else {
      item.p = parseFloat(newItemPrice) || 0
    }
    const m = { ...menu }
    m[selCat] = { ...m[selCat], items: [...(m[selCat]?.items || []), item] }
    setMenu(m)
    setNewItemName(''); setNewItemEmoji(''); setNewItemPrice(''); setNewItemPriceMoy(''); setNewItemPriceMax(''); setNewItemHasVar(false)
  }

  function deleteItem(cat: string, idx: number) {
    const m = { ...menu }
    m[cat] = { ...m[cat], items: m[cat].items.filter((_: any, i: number) => i !== idx) }
    setMenu(m)
  }

  function updateItemPrice(cat: string, idx: number, price: number) {
    const m = { ...menu }
    const items = [...m[cat].items]
    items[idx] = { ...items[idx], p: price }
    m[cat] = { ...m[cat], items }
    setMenu(m)
  }

  const cats = Object.keys(menu)
  const currentItems = menu[selCat]?.items || []

  return (
    <div style={S.card}>
      <div style={S.cardHdr}>
        <span style={S.cardTitle}>🍽️ Menu — Catégories & Articles</span>
        <span style={{ fontSize:'12px', color:'#7A6E5F' }}>{cats.length} catégories, {cats.reduce((s,c) => s + (menu[c]?.items?.length||0), 0)} articles</span>
      </div>

      {/* Category tabs */}
      <div style={{ display:'flex', flexWrap:'wrap', borderBottom:'1px solid #231C12', padding:'0 12px' }}>
        {cats.map(c => (
          <div key={c} style={S.tab(c===selCat)} onClick={() => setSelCat(c)}>
            {menu[c]?.icon} {c}
          </div>
        ))}
      </div>

      {/* Add category */}
      <div style={{ display:'flex', gap:'8px', padding:'12px 20px', borderBottom:'1px solid #231C12' }}>
        <input style={{ ...S.inp, width:'50px' }} value={newCatIcon} onChange={e=>setNewCatIcon(e.target.value)} placeholder="🍕" />
        <input style={{ ...S.inp, flex:1 }} value={newCatName} onChange={e=>setNewCatName(e.target.value)} placeholder="Nouvelle catégorie..." onKeyDown={e=>e.key==='Enter'&&addCategory()} />
        <button style={S.btnGold} onClick={addCategory}>+ Catégorie</button>
        {selCat && <button style={S.btnRed} onClick={() => deleteCategory(selCat)}>🗑️</button>}
      </div>

      {/* Items list */}
      <div style={{ maxHeight:'300px', overflowY:'auto' }}>
        {currentItems.length === 0 && <div style={{ padding:'20px', textAlign:'center', color:'#7A6E5F' }}>Aucun article dans cette catégorie</div>}
        {currentItems.map((it: any, i: number) => (
          <div key={i} style={{ ...S.row, background: i%2===0?'transparent':'#181310' }}>
            <span style={{ fontSize:'18px', width:'28px' }}>{it.e}</span>
            <span style={{ flex:1, fontSize:'13px' }}>{it.name}</span>
            {it.v ? (
              <span style={{ color:'#E8A84C', fontSize:'12px' }}>{it.v[0]?.p} / {it.v[1]?.p} DT</span>
            ) : (
              <input style={{ ...S.inp, width:'70px', textAlign:'right', color:'#E8A84C', fontWeight:'700' }}
                type="number" step="0.5" value={it.p||0}
                onChange={e => updateItemPrice(selCat, i, parseFloat(e.target.value)||0)} />
            )}
            <button style={{ ...S.btnRed, padding:'4px 8px' }} onClick={() => deleteItem(selCat, i)}>✕</button>
          </div>
        ))}
      </div>

      {/* Add item */}
      <div style={{ padding:'16px 20px', borderTop:'1px solid #231C12', background:'#0A0804' }}>
        <div style={{ fontSize:'11px', color:'#7A6E5F', fontWeight:'600', marginBottom:'8px' }}>AJOUTER UN ARTICLE</div>
        <div style={{ display:'flex', gap:'8px', marginBottom:'8px', flexWrap:'wrap' }}>
          <input style={{ ...S.inp, width:'50px' }} value={newItemEmoji} onChange={e=>setNewItemEmoji(e.target.value)} placeholder="🍕" />
          <input style={{ ...S.inp, flex:1, minWidth:'140px' }} value={newItemName} onChange={e=>setNewItemName(e.target.value)} placeholder="Nom de l'article" />
        </div>
        <div style={{ display:'flex', gap:'8px', alignItems:'center', marginBottom:'8px' }}>
          <label style={{ fontSize:'12px', color:'#7A6E5F', cursor:'pointer', display:'flex', alignItems:'center', gap:'4px' }}>
            <input type="checkbox" checked={newItemHasVar} onChange={e=>setNewItemHasVar(e.target.checked)} /> 2 tailles (Moy/Max)
          </label>
        </div>
        {!newItemHasVar ? (
          <input style={{ ...S.inp, width:'120px' }} type="number" step="0.5" value={newItemPrice} onChange={e=>setNewItemPrice(e.target.value)} placeholder="Prix (DT)" />
        ) : (
          <div style={{ display:'flex', gap:'8px' }}>
            <input style={{ ...S.inp, width:'100px' }} type="number" step="0.5" value={newItemPriceMoy} onChange={e=>setNewItemPriceMoy(e.target.value)} placeholder="Prix Moy" />
            <input style={{ ...S.inp, width:'100px' }} type="number" step="0.5" value={newItemPriceMax} onChange={e=>setNewItemPriceMax(e.target.value)} placeholder="Prix Max" />
          </div>
        )}
        <button style={{ ...S.btnGold, marginTop:'10px' }} onClick={addItem}>+ Ajouter l'article</button>
      </div>
    </div>
  )
}

// ═══════════════ CLIENT BUILDER FORM ═══════════════
function ClientBuilder({ onDone, existingClient }: { onDone: () => void, existingClient?: any }) {
  const [step, setStep] = useState(1)
  const [building, setBuilding] = useState(false)
  const [buildMsg, setBuildMsg] = useState('')
  const [buildResult, setBuildResult] = useState<any>(null)
  const [dbCreated, setDbCreated] = useState(false)

  // Step 1: Identity
  const [name, setName] = useState(existingClient?.name || '')
  const [city, setCity] = useState(existingClient?.city || '')
  const [phone, setPhone] = useState(existingClient?.phone || '')
  const [email, setEmail] = useState(existingClient?.owner_email || '')
  const [password, setPassword] = useState('')
  const [logo, setLogo] = useState(existingClient?.config?.logo || '🍽️')
  const [logoLetter, setLogoLetter] = useState('')
  const [tagline, setTagline] = useState('')
  const [currency, setCurrency] = useState('DT')
  const [businessType, setBusinessType] = useState<'fastfood'|'cafe'>('fastfood')
  const [printEnabled, setPrintEnabled] = useState(true)
  const [tableCount, setTableCount] = useState(12)

  // Step 2: PINs
  const [managerName, setManagerName] = useState('Manager')
  const [managerPin, setManagerPin] = useState('1234')
  const [cashierName, setCashierName] = useState('Caissier')
  const [cashierPin, setCashierPin] = useState('0000')

  // Step 3: Menu
  const [menu, setMenu] = useState<any>({})

  // API Key (generated or from existing)
  const [apiKey, setApiKey] = useState(existingClient?.api_key || '')
  const [iconBase64, setIconBase64] = useState('')
  const [iconPreview, setIconPreview] = useState('')

  function generateKey() {
    const id = Math.random().toString(36).slice(2,6).toUpperCase()
    setApiKey('SRVO-' + id + '-' + Date.now().toString().slice(-4))
  }

  function handleIconUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      setIconBase64(result)
      setIconPreview(result)
    }
    reader.readAsDataURL(file)
  }

  // Step 4: Create in DB + Build EXE
  async function createAndBuild() {
    setBuilding(true)
    setBuildMsg('Création du client dans la base de données...')

    // 1. Create client in DB (Vercel API)
    if (!existingClient) {
      try {
        const res = await fetch(`${API}/api/admin/clients`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ admin_key: ADMIN_KEY, name, email, password, api_key: apiKey, city, phone })
        })
        const data = await res.json()
        if (!data.ok) { setBuildMsg('❌ Erreur DB: ' + data.error); setBuilding(false); return }
      } catch (e: any) { setBuildMsg('❌ Erreur connexion DB: ' + e.message); setBuilding(false); return }
    }

    // 2. Save config + menu to DB
    setBuildMsg('Sauvegarde de la configuration...')
    try {
      const config = { logo, logoLetter: logoLetter || name.charAt(0).toUpperCase(), tagline: tagline || `${name} — POS Pro`, currency, managerName, managerPin, cashierName, cashierPin }
      await fetch(`${API}/api/admin/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ admin_key: ADMIN_KEY, api_key: apiKey, config, menu, name, city, phone })
      })
    } catch (e) { /* non-blocking */ }

    setBuildMsg('✅ Client créé dans la base de données!\n\nMaintenant lancez le build EXE...')
    setBuilding(false)
    setDbCreated(true)
  }

  async function buildExe() {
    setBuilding(true)
    setBuildMsg('🔨 Construction de l\'EXE... (~2-3 minutes)\n⚠️ Assurez-vous que build-server.js tourne sur votre PC')

    try {
      const res = await fetch(`${BUILD_SERVER}/build`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name, city, logo, logoLetter: logoLetter || name.charAt(0).toUpperCase(),
          tagline: tagline || `${name} — POS Pro`, phone, currency,
          syncKey: apiKey, managerName, managerPin, cashierName, cashierPin,
          menu: Object.keys(menu).length > 0 ? menu : undefined,
          iconBase64: iconBase64 || undefined,
          businessType, tableCount, printEnabled,
        })
      })
      const data = await res.json()
      if (data.ok) {
        setBuildMsg('✅ EXE construit avec succès!')
        setBuildResult(data)
      } else {
        setBuildMsg('❌ Erreur build: ' + data.error)
      }
    } catch (e: any) {
      setBuildMsg('❌ Build server non accessible.\n\nLancez sur votre PC:\n  cd servio-pos\n  node build-server.js\n\nPuis ouvrez localhost:3000/admin pour builder.')
    }
    setBuilding(false)
  }

  return (
    <div>
      {/* Progress steps */}
      <div style={{ display:'flex', gap:'4px', padding:'16px 20px', borderBottom:'1px solid #231C12' }}>
        {['Identité','PINs','Menu','Générer EXE'].map((s,i) => (
          <div key={i} style={{ flex:1, textAlign:'center', padding:'8px', borderRadius:'6px', fontSize:'12px', fontWeight: step===i+1?'700':'400', background: step===i+1?'rgba(200,145,58,.15)':'transparent', color: step===i+1?'#E8A84C': i+1<step?'#3DB87A':'#7A6E5F', cursor:'pointer', border: step===i+1?'1px solid rgba(200,145,58,.3)':'1px solid transparent' }} onClick={()=>setStep(i+1)}>
            {i+1 < step ? '✓ ' : ''}{s}
          </div>
        ))}
      </div>

      {/* Step 1: Identity */}
      {step === 1 && (
        <div style={S.grid2}>
          <div style={{ gridColumn:'1/-1', marginBottom:'8px' }}>
            <label style={S.label}>Type d'activité *</label>
            <div style={{ display:'flex', gap:'10px', marginTop:'6px' }}>
              <div onClick={()=>setBusinessType('fastfood')} style={{ flex:1, padding:'14px', borderRadius:'10px', border: businessType==='fastfood'?'2px solid #E8A84C':'2px solid #231C12', background: businessType==='fastfood'?'rgba(200,145,58,.1)':'#181310', cursor:'pointer', textAlign:'center' }}>
                <div style={{ fontSize:'24px' }}>🍔</div>
                <div style={{ fontSize:'12px', fontWeight:'700', marginTop:'4px', color: businessType==='fastfood'?'#E8A84C':'#7A6E5F' }}>Fast Food</div>
                <div style={{ fontSize:'10px', color:'#7A6E5F' }}>Commande directe, emporter/livraison</div>
              </div>
              <div onClick={()=>setBusinessType('cafe')} style={{ flex:1, padding:'14px', borderRadius:'10px', border: businessType==='cafe'?'2px solid #E8A84C':'2px solid #231C12', background: businessType==='cafe'?'rgba(200,145,58,.1)':'#181310', cursor:'pointer', textAlign:'center' }}>
                <div style={{ fontSize:'24px' }}>☕</div>
                <div style={{ fontSize:'12px', fontWeight:'700', marginTop:'4px', color: businessType==='cafe'?'#E8A84C':'#7A6E5F' }}>Café / Restaurant</div>
                <div style={{ fontSize:'10px', color:'#7A6E5F' }}>Gestion par tables, paiement au départ</div>
              </div>
            </div>
          </div>
          {businessType === 'cafe' && (
            <>
              <div><label style={S.label}>Nombre de tables</label><input style={S.inp} type="number" value={tableCount} onChange={e=>setTableCount(parseInt(e.target.value)||12)} placeholder="12" /></div>
              <div style={{ display:'flex', alignItems:'center', gap:'8px', paddingTop:'20px' }}>
                <label style={{ fontSize:'12px', color:'#7A6E5F', cursor:'pointer', display:'flex', alignItems:'center', gap:'6px' }}>
                  <input type="checkbox" checked={printEnabled} onChange={e=>setPrintEnabled(e.target.checked)} /> Impression tickets activée
                </label>
              </div>
            </>
          )}
          <div><label style={S.label}>Nom du restaurant *</label><input style={S.inp} value={name} onChange={e=>setName(e.target.value)} placeholder="Fast Food Sami" /></div>
          <div><label style={S.label}>Ville</label><input style={S.inp} value={city} onChange={e=>setCity(e.target.value)} placeholder="Sfax, Tunisie" /></div>
          <div><label style={S.label}>Email propriétaire *</label><input style={S.inp} type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="owner@email.com" /></div>
          <div><label style={S.label}>Mot de passe dashboard *</label><input style={S.inp} value={password} onChange={e=>setPassword(e.target.value)} placeholder="••••••" /></div>
          <div><label style={S.label}>Logo emoji</label><input style={S.inp} value={logo} onChange={e=>setLogo(e.target.value)} placeholder="🍔" /></div>
          <div><label style={S.label}>Lettre logo (header)</label><input style={S.inp} value={logoLetter} onChange={e=>setLogoLetter(e.target.value)} placeholder={name?name[0]?.toUpperCase():'S'} /></div>
          <div><label style={S.label}>Slogan</label><input style={S.inp} value={tagline} onChange={e=>setTagline(e.target.value)} placeholder={`${name||'Restaurant'} — POS Pro`} /></div>
          <div><label style={S.label}>Devise</label><input style={S.inp} value={currency} onChange={e=>setCurrency(e.target.value)} placeholder="DT" /></div>
          <div><label style={S.label}>Téléphone</label><input style={S.inp} value={phone} onChange={e=>setPhone(e.target.value)} placeholder="+216 XX XXX XXX" /></div>
          <div>
            <label style={S.label}>Clé API * <button type="button" onClick={generateKey} style={{ marginLeft:'6px', background:'none', border:'1px solid #231C12', borderRadius:'4px', padding:'2px 8px', color:'#C8913A', fontSize:'10px', cursor:'pointer' }}>Générer</button></label>
            <input style={S.inp} value={apiKey} onChange={e=>setApiKey(e.target.value)} placeholder="SRVO-XXXX-0000" />
          </div>
          <div style={{ gridColumn:'1/-1' }}>
            <label style={S.label}>Logo / Icône EXE (PNG, 256x256 recommandé)</label>
            <div style={{ display:'flex', alignItems:'center', gap:'12px' }}>
              <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleIconUpload} style={{ fontSize:'12px', color:'#7A6E5F' }} />
              {iconPreview && <img src={iconPreview} alt="icon" style={{ width:'48px', height:'48px', borderRadius:'8px', border:'1px solid #231C12', objectFit:'cover' }} />}
            </div>
            <div style={{ fontSize:'10px', color:'#7A6E5F', marginTop:'4px' }}>Cette image sera l'icône de l'EXE et du raccourci Windows</div>
          </div>
          <div style={{ gridColumn:'1/-1', textAlign:'right', paddingTop:'8px' }}>
            <button style={S.btnGold} onClick={()=>setStep(2)} disabled={!name||!email||!apiKey}>Suivant →</button>
          </div>
        </div>
      )}

      {/* Step 2: PINs */}
      {step === 2 && (
        <div style={S.grid2}>
          <div><label style={S.label}>Nom Manager</label><input style={S.inp} value={managerName} onChange={e=>setManagerName(e.target.value)} /></div>
          <div><label style={S.label}>PIN Manager (4 chiffres)</label><input style={S.inp} value={managerPin} onChange={e=>setManagerPin(e.target.value)} maxLength={4} placeholder="1234" /></div>
          <div><label style={S.label}>Nom Caissier</label><input style={S.inp} value={cashierName} onChange={e=>setCashierName(e.target.value)} /></div>
          <div><label style={S.label}>PIN Caissier (4 chiffres)</label><input style={S.inp} value={cashierPin} onChange={e=>setCashierPin(e.target.value)} maxLength={4} placeholder="0000" /></div>
          <div style={{ gridColumn:'1/-1', display:'flex', justifyContent:'space-between', paddingTop:'8px' }}>
            <button style={{ ...S.btnGold, background:'#181310', color:'#7A6E5F', border:'1px solid #231C12' }} onClick={()=>setStep(1)}>← Retour</button>
            <button style={S.btnGold} onClick={()=>setStep(3)}>Suivant → Menu</button>
          </div>
        </div>
      )}

      {/* Step 3: Menu */}
      {step === 3 && (
        <div>
          <MenuEditor menu={menu} setMenu={setMenu} />
          <div style={{ display:'flex', justifyContent:'space-between', padding:'0 20px 16px' }}>
            <button style={{ ...S.btnGold, background:'#181310', color:'#7A6E5F', border:'1px solid #231C12' }} onClick={()=>setStep(2)}>← Retour</button>
            <button style={S.btnGold} onClick={()=>setStep(4)}>Suivant → Générer EXE</button>
          </div>
          <div style={{ padding:'0 20px 12px', fontSize:'11px', color:'#7A6E5F' }}>
            💡 Si vous laissez le menu vide, le POS utilisera le menu par défaut.
          </div>
        </div>
      )}

      {/* Step 4: Summary + Build */}
      {step === 4 && (
        <div style={{ padding:'20px' }}>
          <div style={{ background:'#181310', borderRadius:'10px', padding:'16px', marginBottom:'16px' }}>
            <div style={{ fontSize:'13px', fontWeight:'700', color:'#E8A84C', marginBottom:'10px' }}>📋 Résumé</div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'6px', fontSize:'12px' }}>
              <span style={{ color:'#7A6E5F' }}>Restaurant:</span><span>{logo} {name}</span>
              <span style={{ color:'#7A6E5F' }}>Type:</span><span>{businessType==='cafe'?'☕ Café/Restaurant ('+tableCount+' tables)':'🍔 Fast Food'}</span>
              <span style={{ color:'#7A6E5F' }}>Ville:</span><span>{city || 'Tunisie'}</span>
              <span style={{ color:'#7A6E5F' }}>Email:</span><span>{email}</span>
              <span style={{ color:'#7A6E5F' }}>Clé API:</span><span style={{ fontFamily:'monospace', color:'#E8A84C' }}>{apiKey}</span>
              <span style={{ color:'#7A6E5F' }}>Manager:</span><span>{managerName} (PIN: {managerPin})</span>
              <span style={{ color:'#7A6E5F' }}>Caissier:</span><span>{cashierName} (PIN: {cashierPin})</span>
              <span style={{ color:'#7A6E5F' }}>Menu:</span><span>{Object.keys(menu).length} catégories, {Object.values(menu).reduce((s: number, c: any) => s + (c?.items?.length||0), 0)} articles</span>
              <span style={{ color:'#7A6E5F' }}>Icône EXE:</span><span>{iconBase64 ? '✓ Image uploadée' : 'Servio (par défaut)'}</span>
            </div>
          </div>

          {buildMsg && (
            <div style={{ padding:'12px 16px', borderRadius:'8px', marginBottom:'12px', fontSize:'13px', background: buildMsg.includes('❌')?'rgba(224,82,82,.1)': buildMsg.includes('✅')?'rgba(61,184,122,.1)':'rgba(200,145,58,.1)', color: buildMsg.includes('❌')?'#E05252': buildMsg.includes('✅')?'#3DB87A':'#E8A84C', border:'1px solid', borderColor: buildMsg.includes('❌')?'rgba(224,82,82,.3)': buildMsg.includes('✅')?'rgba(61,184,122,.3)':'rgba(200,145,58,.3)', whiteSpace:'pre-line' }}>
              {buildMsg}
            </div>
          )}

          {buildResult && (
            <div style={{ padding:'12px 16px', borderRadius:'8px', marginBottom:'12px', fontSize:'12px', background:'rgba(61,184,122,.08)', border:'1px solid rgba(61,184,122,.3)', color:'#3DB87A' }}>
              <div style={{ fontWeight:'700', marginBottom:'4px' }}>📦 EXE prêt!</div>
              <div>Dossier: dist_clients/{buildResult.safeName}/</div>
              <div>Fichier: {buildResult.exePath}</div>
            </div>
          )}

          <div style={{ display:'flex', justifyContent:'space-between', flexWrap:'wrap', gap:'8px' }}>
            <button style={{ ...S.btnGold, background:'#181310', color:'#7A6E5F', border:'1px solid #231C12' }} onClick={()=>setStep(3)}>← Retour</button>
            {!dbCreated ? (
              <button style={{ ...S.btnGold, padding:'12px 28px', fontSize:'14px', opacity: building?.6:1 }} onClick={createAndBuild} disabled={building || !name || !apiKey || !email}>
                {building ? '⏳ Création...' : '1️⃣ Créer client dans la DB'}
              </button>
            ) : (
              <button style={{ ...S.btnGold, padding:'12px 28px', fontSize:'14px', background:'linear-gradient(135deg,#3DB87A,#2ea868)', opacity: building?.6:1 }} onClick={buildExe} disabled={building}>
                {building ? '⏳ Construction...' : '2️⃣ Générer l\'EXE (local)'}
              </button>
            )}
          </div>
          {!dbCreated && (
            <div style={{ fontSize:'11px', color:'#7A6E5F', marginTop:'10px', textAlign:'center' }}>
              Étape 1: Crée le client en ligne (fonctionne depuis Vercel).<br/>
              Étape 2: Génère l'EXE (nécessite <code style={{ color:'#E8A84C' }}>node build-server.js</code> sur votre PC).
            </div>
          )}

          {buildResult && (
            <div style={{ textAlign:'center', marginTop:'16px' }}>
              <button style={S.btnGreen} onClick={onDone}>✓ Terminé — Retour à la liste</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ═══════════════ ADMIN PANEL (main) ═══════════════
function AdminPanel({ onLogout }: { onLogout: () => void }) {
  const [clients, setClients] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState('')
  const [view, setView] = useState<'list'|'new'|'config'>('list')
  const [editClient, setEditClient] = useState<any>(null)

  async function loadClients() {
    setLoading(true)
    try {
      const res = await fetch(`${API}/api/admin/clients`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ admin_key: ADMIN_KEY }) })
      const data = await res.json()
      if (data.ok) setClients(data.clients)
      else flash('Erreur: ' + data.error)
    } catch { flash('Erreur de connexion') }
    setLoading(false)
  }

  async function togglePlan(apiKey: string, currentPlan: string) {
    const action = currentPlan === 'suspended' ? 'activate' : 'suspend'
    if (!confirm(`${action === 'suspend' ? 'Suspendre' : 'Réactiver'} ce client ?`)) return
    try {
      const res = await fetch(`${API}/api/admin/suspend`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ admin_key: ADMIN_KEY, api_key: apiKey, action }) })
      const data = await res.json()
      if (data.ok) { flash(`✓ Client ${action==='suspend'?'suspendu':'réactivé'}`); loadClients() }
      else flash('Erreur: ' + data.error)
    } catch { flash('Erreur de connexion') }
  }

  function flash(m: string) { setMsg(m); setTimeout(()=>setMsg(''),3000) }

  useEffect(() => { loadClients() }, [])

  return (
    <div style={S.wrap}>
      {/* Header */}
      <div style={S.hdr}>
        <div style={S.brand}>⚡ SERVIO OS — Admin Panel</div>
        <div style={{ display:'flex', gap:'12px', alignItems:'center' }}>
          {msg && <span style={{ fontSize:'12px', color: msg.startsWith('✓')?'#3DB87A':'#E05252' }}>{msg}</span>}
          <button onClick={loadClients} style={{ background:'#181310', border:'1px solid #231C12', borderRadius:'6px', padding:'6px 12px', color:'#7A6E5F', cursor:'pointer', fontSize:'12px' }}>↻</button>
          <button onClick={onLogout} style={{ background:'none', border:'1px solid rgba(224,82,82,.3)', borderRadius:'6px', padding:'6px 12px', color:'#E05252', cursor:'pointer', fontSize:'12px' }}>Déconnecter</button>
        </div>
      </div>

      <div style={S.content}>
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

        {/* View switcher */}
        {view === 'list' && (
          <div style={S.card}>
            <div style={S.cardHdr}>
              <span style={S.cardTitle}>👥 Clients</span>
              <button style={S.btnGold} onClick={() => setView('new')}>⚡ Nouveau client + EXE</button>
            </div>
            {loading
              ? <div style={{ padding:'30px', textAlign:'center', color:'#7A6E5F' }}>Chargement...</div>
              : clients.length === 0
                ? <div style={{ padding:'30px', textAlign:'center', color:'#7A6E5F' }}>Aucun client</div>
                : clients.map((c, i) => (
                  <div key={i} style={{ ...S.row, background: i%2===0?'transparent':'#181310' }}>
                    <div style={{ flex:1 }}>
                      <div style={{ fontWeight:'700', fontSize:'14px' }}>{c.name}</div>
                      <div style={{ fontSize:'11px', color:'#7A6E5F', marginTop:'2px' }}>{c.owner_email} · {c.city}</div>
                    </div>
                    <div style={{ fontSize:'11px', color:'#7A6E5F', fontFamily:'monospace' }}>{c.api_key}</div>
                    <span style={S.badge(c.plan)}>{c.plan==='active'?'✓ Actif':'✗ Suspendu'}</span>
                    <button onClick={() => togglePlan(c.api_key, c.plan)} style={c.plan==='active'?S.btnRed:S.btnGreen}>
                      {c.plan==='active'?'🔒 Suspendre':'🔓 Réactiver'}
                    </button>
                  </div>
                ))
            }
          </div>
        )}

        {view === 'new' && (
          <div style={S.card}>
            <div style={S.cardHdr}>
              <span style={S.cardTitle}>⚡ Nouveau Client — Assistant de création</span>
              <button style={{ ...S.btnRed, fontSize:'11px' }} onClick={() => setView('list')}>✕ Annuler</button>
            </div>
            <ClientBuilder onDone={() => { setView('list'); loadClients() }} />
          </div>
        )}
      </div>
    </div>
  )
}

// ═══════════════ ROOT COMPONENT ═══════════════
export default function AdminPage() {
  const [authed, setAuthed] = useState(false)

  useEffect(() => {
    if (sessionStorage.getItem('admin_auth') === '1') setAuthed(true)
  }, [])

  if (!authed) return <AdminLogin onLogin={() => setAuthed(true)} />
  return <AdminPanel onLogout={() => { sessionStorage.removeItem('admin_auth'); setAuthed(false) }} />
}
