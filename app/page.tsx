'use client'
import { useState, useEffect, useCallback, useMemo } from 'react'
import s from './dashboard.module.css'

const API = process.env.NEXT_PUBLIC_API_URL || 'https://dolphino-saas.vercel.app'
const f   = (n: any) => Number(n || 0).toFixed(3)
const fmt = (n: any) => Number(n || 0).toLocaleString('fr-TN', { minimumFractionDigits: 3 })
const today = () => {
  const d = new Date()
  if (d.getHours() < 5) d.setDate(d.getDate() - 1)
  return d.toISOString().split('T')[0]
}

// ── Theme ──────────────────────────────────────────────
function useTheme() {
  const [theme, setTheme] = useState<'dark'|'light'>('dark')
  useEffect(() => {
    const saved = localStorage.getItem('d_theme') as 'dark'|'light' || 'dark'
    setTheme(saved)
    document.documentElement.setAttribute('data-theme', saved)
  }, [])
  function toggle() {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    localStorage.setItem('d_theme', next)
    document.documentElement.setAttribute('data-theme', next)
  }
  return { theme, toggle }
}

// ── Category emoji map ────────────────────────────────
const CAT_EMOJI: Record<string,string> = {
  Plat:'🍽️', Sandwichs:'🥪', Pizza:'🍕', Makloub:'🌯',
  Libanais:'🫔', Baguette:'🥖', Tacos:'🌮', Panini:'🥙',
  Chapati:'🥙', Brik:'🥟', Boisson:'🥤'
}
function itemEmoji(name: string): string {
  const cat = Object.keys(CAT_EMOJI).find(c => name.startsWith(c + ' ') || name === c)
  return cat ? CAT_EMOJI[cat] : '🍽️'
}
function itemCategory(name: string): string {
  return Object.keys(CAT_EMOJI).find(c => name.startsWith(c + ' ')) || ''
}

// ════════════════ LOGIN ════════════════
function Login({ onLogin }: { onLogin: (d: any) => void }) {
  const [email,   setEmail]   = useState('')
  const [pass,    setPass]    = useState('')
  const [err,     setErr]     = useState('')
  const [loading, setLoading] = useState(false)
  const { theme, toggle }     = useTheme()

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr(''); setLoading(true)
    try {
      const res  = await fetch(`${API}/api/login`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ email, password: pass })
      })
      const data = await res.json()
      if (!data.ok) { setErr(data.error || 'Erreur'); setLoading(false); return }
      localStorage.setItem('d_api_key',   data.api_key)
      localStorage.setItem('d_rest_info', JSON.stringify({ name: data.name, city: data.city }))
      onLogin(data)
    } catch { setErr('Impossible de contacter le serveur.') }
    setLoading(false)
  }

  return (
    <div className={s.loginWrap}>
      <button onClick={toggle} style={{position:'absolute',top:16,right:16,background:'none',border:'none',fontSize:20,cursor:'pointer',opacity:.6}}>
        {theme==='dark'?'☀️':'🌙'}
      </button>
      <form className={s.loginBox} onSubmit={submit}>
        <div className={s.loginLogo}>⚡</div>
        <div className={s.loginBrand}>SERVIO OS</div>
        <div className={s.loginSub}>Dashboard Propriétaire</div>
        <div className={s.formGroup}>
          <label>Email</label>
          <input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="votre@email.com" required autoComplete="email"/>
        </div>
        <div className={s.formGroup}>
          <label>Mot de passe</label>
          <input type="password" value={pass} onChange={e=>setPass(e.target.value)} placeholder="••••••••" required/>
        </div>
        {err && <div className={s.loginErr}>⚠ {err}</div>}
        <button className={s.btnLogin} disabled={loading} type="submit">
          {loading ? <span style={{display:'flex',alignItems:'center',justifyContent:'center',gap:8}}><span className={s.spinner}/> Connexion...</span> : 'Se connecter →'}
        </button>
      </form>
    </div>
  )
}

// ════════════════ KPI CARDS ════════════════
function KpiCards({ k }: { k: any }) {
  const cards = [
    { icon:'💰', val: fmt(k.total_revenue), unit:'DT', lbl:'Total encaissé',    color:'kpiCardGold'   },
    { icon:'🧾', val: k.total_orders,        unit:'',   lbl:'Commandes',         color:'kpiCardGreen'  },
    { icon:'📊', val: fmt(k.avg_ticket),      unit:'DT', lbl:'Ticket moyen',      color:'kpiCardBlue'   },
    { icon:'💵', val: fmt(k.cash_total),      unit:'DT', lbl:'Espèces',           color:'kpiCardOrange' },
    { icon:'💳', val: fmt(+k.card_total + +k.mobile_total), unit:'DT', lbl:'Carte / Mobile', color:'kpiCardPurple' },
    { icon:'🏠', val: k.sur_place, unit:'', lbl:'Sur place',
      sub: `${k.emporter} emporter · ${k.livraison} livraison`, color:'kpiCardGold' },
  ]
  return (
    <div className={s.kpiGrid}>
      {cards.map((c,i) => (
        <div key={i} className={`${s.kpiCard} ${(s as any)[c.color]}`}>
          <div className={s.kpiIcon}>{c.icon}</div>
          <div className={s.kpiVal}>{c.val}{c.unit && <span> {c.unit}</span>}</div>
          <div className={s.kpiLbl}>{c.lbl}</div>
          {c.sub && <div className={s.kpiSub}>{c.sub}</div>}
        </div>
      ))}
    </div>
  )
}

// ════════════════ BAR CHART ════════════════
function BarChart({ weekly, selectedDate }: { weekly: any[], selectedDate: string }) {
  const max = Math.max(...weekly.map((r:any) => +r.revenue), 1)
  return (
    <div className={s.barChart}>
      {weekly.map((r:any, i:number) => {
        const d   = new Date(r.day + 'T12:00')
        const lbl = d.toLocaleDateString('fr-TN', { weekday:'short', day:'numeric' })
        const pct = Math.round(+r.revenue / max * 100)
        const isToday = r.day === selectedDate
        return (
          <div key={i} className={s.barCol} title={`${r.day}: ${f(r.revenue)} DT — ${r.orders} cmd`}>
            <div className={s.barVal}>{+r.revenue > 0 ? f(r.revenue) : ''}</div>
            <div className={s.barWrap}>
              <div className={`${s.bar} ${isToday ? s.barToday : ''}`} style={{ height:`${Math.max(pct,3)}%` }}/>
            </div>
            <div className={s.barLbl} style={isToday?{color:'var(--gold-l)',fontWeight:700}:{}}>{lbl}</div>
          </div>
        )
      })}
    </div>
  )
}

// ════════════════ PAYMENT DONUT ════════════════
function PaymentDonut({ k }: { k: any }) {
  const cash   = +k.cash_total || 0
  const card   = +k.card_total || 0
  const mobile = +k.mobile_total || 0
  const total  = cash + card + mobile || 1
  const items  = [
    { label:'Espèces', val:cash,   pct:Math.round(cash/total*100),   color:'var(--gold-l)' },
    { label:'Carte',   val:card,   pct:Math.round(card/total*100),   color:'var(--blue)'   },
    { label:'Mobile',  val:mobile, pct:Math.round(mobile/total*100), color:'var(--green)'  },
  ].filter(i => i.val > 0)

  let offset = 25
  const radius = 40, cx = 60, cy = 60, circ = 2 * Math.PI * radius

  return (
    <div className={s.donutWrap}>
      <svg viewBox="0 0 120 120" className={s.donut}>
        <circle cx={cx} cy={cy} r={radius} fill="none" stroke="var(--div)" strokeWidth="16"/>
        {items.map((it, i) => {
          const dash = (it.pct / 100) * circ
          const el = (
            <circle key={i} cx={cx} cy={cy} r={radius} fill="none"
              stroke={it.color} strokeWidth="16"
              strokeDasharray={`${dash} ${circ - dash}`}
              strokeDashoffset={-offset * circ / 100}
              style={{transition:'stroke-dasharray .5s ease'}}
              transform={`rotate(-90 ${cx} ${cy})`}
            />
          )
          offset += it.pct
          return el
        })}
        <text x={cx} y={cy-6} textAnchor="middle" fontSize="11" fill="var(--muted)">Total</text>
        <text x={cx} y={cy+10} textAnchor="middle" fontSize="13" fontWeight="700" fill="var(--txt)">{f(total)} DT</text>
      </svg>
      <div className={s.donutLegend}>
        {items.map((it,i) => (
          <div key={i} className={s.donutItem}>
            <div className={s.donutDot} style={{background:it.color}}/>
            <span className={s.donutLabel}>{it.label}</span>
            <span className={s.donutVal}>{f(it.val)} DT</span>
            <span style={{fontSize:10,color:'var(--muted)'}}>{it.pct}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ════════════════ TOP PRODUCTS ════════════════
// ════════════════ CATEGORY BREAKDOWN ════════════════
function CategoryBreakdown({ items }: { items: any[] }) {
  if (!items || items.length === 0) return <div style={{textAlign:'center',color:'var(--muted)',padding:'20px'}}>Aucune donnée</div>

  // Group items by category (guess from emoji)
  const cats: Record<string, { qty: number, revenue: number }> = {}
  items.forEach((it: any) => {
    const cat = itemCategory(it.name) || 'Autre'
    if (!cats[cat]) cats[cat] = { qty: 0, revenue: 0 }
    cats[cat].qty += it.qty || 0
    cats[cat].revenue += it.revenue || 0
  })

  const sorted = Object.entries(cats).sort((a, b) => b[1].revenue - a[1].revenue)
  const totalRev = sorted.reduce((s, [, v]) => s + v.revenue, 0) || 1
  const colors = ['var(--gold-l)', 'var(--green)', 'var(--blue)', 'var(--orange)', 'var(--red)', '#9B6FD4', '#E8A84C']

  return (
    <div style={{ display:'flex', gap:'20px', flexWrap:'wrap', alignItems:'center' }}>
      <div style={{ display:'flex', flexDirection:'column', gap:'8px', flex:1, minWidth:'200px' }}>
        {sorted.map(([cat, data], i) => {
          const pct = Math.round(data.revenue / totalRev * 100)
          return (
            <div key={i} style={{ display:'flex', alignItems:'center', gap:'10px' }}>
              <div style={{ width:'10px', height:'10px', borderRadius:'50%', background:colors[i % colors.length], flexShrink:0 }}/>
              <span style={{ flex:1, fontSize:'12px' }}>{cat}</span>
              <span style={{ fontSize:'12px', fontWeight:'700', color:colors[i % colors.length] }}>{pct}%</span>
              <span style={{ fontSize:'11px', color:'var(--muted)', width:'70px', textAlign:'right' }}>{Number(data.revenue).toFixed(3)} DT</span>
            </div>
          )
        })}
      </div>
      <div style={{ width:'120px', height:'120px', position:'relative', flexShrink:0 }}>
        <svg viewBox="0 0 120 120" style={{ width:'100%', height:'100%' }}>
          <circle cx="60" cy="60" r="40" fill="none" stroke="var(--div)" strokeWidth="20"/>
          {(() => {
            let offset = 25
            return sorted.map(([, data], i) => {
              const pct = data.revenue / totalRev
              const circ = 2 * Math.PI * 40
              const dash = pct * circ
              const el = <circle key={i} cx="60" cy="60" r="40" fill="none" stroke={colors[i % colors.length]} strokeWidth="20" strokeDasharray={`${dash} ${circ - dash}`} strokeDashoffset={(-offset / 100) * circ} style={{ transition:'all .5s' }}/>
              offset += pct * 100
              return el
            })
          })()}
        </svg>
      </div>
    </div>
  )
}

function TopProducts({ items, filter, onFilter }: { items: any[], filter: string, onFilter:(f:string)=>void }) {
  const cats = useMemo(() => ['Tous', ...Array.from(new Set(items.map((it:any) => itemCategory(it.name)).filter(Boolean)))], [items])
  const filtered = filter === 'Tous' ? items : items.filter((it:any) => it.name.startsWith(filter + ' '))
  const max = filtered[0]?.qty || 1

  return (
    <>
      <div className={s.filters}>
        {cats.map(c => (
          <button key={c} className={`${s.filterBtn} ${filter===c?s.filterBtnActive:''}`} onClick={()=>onFilter(c)}>
            {CAT_EMOJI[c] || ''} {c}
          </button>
        ))}
      </div>
      <div className={s.chartBox}>
        {filtered.length === 0
          ? <div className={s.empty}><div className={s.emptyIcon}>📊</div><div className={s.emptyText}>Aucune vente</div></div>
          : <div className={s.topList}>
              {filtered.slice(0,15).map((it:any, i:number) => (
                <div key={i} className={s.topItem}>
                  <div className={`${s.topRank} ${i===0?s.topRank1:i===1?s.topRank2:i===2?s.topRank3:s.topRankN}`}>
                    {i < 3 ? ['🥇','🥈','🥉'][i] : i+1}
                  </div>
                  <div className={s.topEmoji}>{itemEmoji(it.name)}</div>
                  <div className={s.topName}>{it.name}</div>
                  <div className={s.topBarWrap}>
                    <div className={s.topBar} style={{width:`${Math.round(it.qty/max*100)}%`}}/>
                  </div>
                  <div className={s.topQty}>{it.qty} <span style={{fontSize:10,color:'var(--muted)',fontWeight:400}}>fois</span></div>
                </div>
              ))}
            </div>
        }
      </div>
    </>
  )
}

// ════════════════ ORDER DETAIL MODAL ════════════════
function OrderDetail({ order, onClose }: { order: any, onClose: ()=>void }) {
  const items: any[] = order.items || []
  const typeMap: any = { place:'🏠 Sur place', take:'🥡 Emporter', del:'🛵 Livraison' }
  const payMap:  any = { cash:'💵 Espèces', card:'💳 Carte', mob:'📱 Mobile' }
  return (
    <div onClick={onClose} style={{position:'fixed',inset:0,background:'rgba(0,0,0,.7)',zIndex:999,display:'flex',alignItems:'center',justifyContent:'center',backdropFilter:'blur(4px)',padding:20}}>
      <div onClick={e=>e.stopPropagation()} style={{background:'var(--panel)',border:'1px solid var(--div)',borderRadius:16,padding:28,width:'100%',maxWidth:480,maxHeight:'85vh',overflowY:'auto',boxShadow:'0 24px 60px rgba(0,0,0,.5)'}}>
        {/* Header */}
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20}}>
          <div>
            <div style={{fontSize:28,fontWeight:800,color:'var(--gold-l)'}}>#{String(order.num).padStart(3,'0')}</div>
            <div style={{fontSize:12,color:'var(--muted)',marginTop:2}}>{order.sale_time} · {order.cashier}</div>
          </div>
          <button onClick={onClose} style={{background:'var(--card)',border:'1px solid var(--div)',borderRadius:8,padding:'6px 14px',color:'var(--muted)',fontSize:13,cursor:'pointer'}}>✕ Fermer</button>
        </div>
        {/* Info */}
        <div style={{display:'flex',gap:8,marginBottom:16,flexWrap:'wrap'}}>
          <span style={{padding:'4px 12px',borderRadius:20,fontSize:12,fontWeight:600,background:'var(--blue-dim)',color:'var(--blue)'}}>{typeMap[order.order_type]||order.order_type}</span>
          <span style={{padding:'4px 12px',borderRadius:20,fontSize:12,fontWeight:600,background:'var(--gold-dim)',color:'var(--gold-l)'}}>{payMap[order.pay_method]||order.pay_method}</span>
          {order.disc_pct > 0 && <span style={{padding:'4px 12px',borderRadius:20,fontSize:12,fontWeight:600,background:'var(--red-dim)',color:'var(--red)'}}>Remise -{order.disc_pct}%</span>}
        </div>
        {order.cli_name && <div style={{padding:'8px 12px',background:'var(--card)',borderRadius:8,fontSize:13,marginBottom:12}}>👤 {order.cli_name}{order.cli_tel ? ` · 📞 ${order.cli_tel}` : ''}</div>}
        {/* Items */}
        <div style={{fontSize:11,color:'var(--muted)',textTransform:'uppercase',letterSpacing:1,fontWeight:600,marginBottom:8}}>Articles</div>
        <div style={{display:'flex',flexDirection:'column',gap:2,marginBottom:16}}>
          {items.length === 0 ? <div style={{color:'var(--muted)',fontSize:13,padding:'12px 0'}}>Détails non disponibles</div> :
            items.map((it:any, i:number) => (
              <div key={i} style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',padding:'10px 12px',background:'var(--card)',borderRadius:8}}>
                <div>
                  <div style={{fontSize:13,fontWeight:600}}>{itemEmoji(it.name||'')} {it.qty}× {it.name}</div>
                  {it.variant && <div style={{fontSize:11,color:'var(--muted)',marginTop:2}}>Taille: {it.variant}</div>}
                  {it.note && <div style={{fontSize:11,color:'var(--orange)',marginTop:2}}>📝 {it.note}</div>}
                </div>
                <div style={{fontSize:13,fontWeight:700,color:'var(--gold-l)',flexShrink:0,marginLeft:12}}>{f(it.p * it.qty)} DT</div>
              </div>
            ))
          }
        </div>
        {/* Total */}
        <div style={{borderTop:'1px solid var(--div)',paddingTop:12}}>
          <div style={{display:'flex',justifyContent:'space-between',fontSize:20,fontWeight:800}}>
            <span>TOTAL</span>
            <span style={{color:'var(--gold-l)'}}>{f(order.grand)} DT</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// ════════════════ ORDERS TABLE ════════════════
function OrdersTable({ orders, search, onSearch }: { orders: any[], search: string, onSearch:(s:string)=>void }) {
  const [selected, setSelected] = useState<any>(null)
  const filtered = orders.filter((r:any) =>
    !search || r.cashier?.toLowerCase().includes(search.toLowerCase()) ||
    String(r.num).includes(search)
  )
  const typeMap: any = { place:'🏠 Place', take:'🥡 Emporter', del:'🛵 Livraison' }
  const payMap:  any = { cash:'💵 Espèces', card:'💳 Carte', mob:'📱 Mobile' }
  const typeCls: any = { place:s.bPlace, take:s.bTake, del:s.bDel }
  const payCls:  any = { cash:s.bCash, card:s.bCard, mob:s.bMob }

  return (
    <>
      {selected && <OrderDetail order={selected} onClose={()=>setSelected(null)}/>}
      <div className={s.filters}>
        <input className={s.filterSearch} placeholder="🔍 Rechercher par #, caissier..."
          value={search} onChange={e=>onSearch(e.target.value)}/>
        <span style={{fontSize:12,color:'var(--muted)'}}>{filtered.length} commandes</span>
      </div>
      <div className={s.tableWrap}>
        <div className={s.tableScroll}>
          {filtered.length === 0
            ? <div className={s.empty}><div className={s.emptyIcon}>🧾</div><div className={s.emptyText}>Aucune commande</div></div>
            : <table className={s.table}>
                <thead><tr>
                  <th>#</th><th>Heure</th><th>Type</th><th>Articles</th><th>Total</th><th>Paiement</th><th>Caissier</th>
                </tr></thead>
                <tbody>
                  {filtered.map((r:any, i:number) => (
                    <tr key={i} onClick={()=>setSelected(r)} style={{cursor:'pointer'}}>
                      <td className={s.num}>#{String(r.num).padStart(3,'0')}</td>
                      <td className={s.muted}>{r.sale_time}</td>
                      <td><span className={`${s.badge} ${typeCls[r.order_type]||s.bPlace}`}>{typeMap[r.order_type]||r.order_type}</span></td>
                      <td>{r.item_count} art.{r.disc_pct>0?<span style={{color:'var(--red)',fontSize:11}}> -{r.disc_pct}%</span>:null}</td>
                      <td className={s.bold}>{f(r.grand)} DT</td>
                      <td><span className={`${s.badge} ${payCls[r.pay_method]||s.bCash}`}>{payMap[r.pay_method]||r.pay_method}</span></td>
                      <td className={s.muted}>{r.cashier}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
          }
        </div>
      </div>
    </>
  )
}

// ════════════════ ORDER ROW (clickable) ════════════════
function OrderRow({ sale }: { sale: any }) {
  const [open, setOpen] = useState(false)
  const items = sale.items || []

  return (
    <div style={{ borderBottom:'1px solid var(--div)' }}>
      <div onClick={() => setOpen(!open)} style={{ display:'flex', alignItems:'center', gap:'8px', padding:'8px 0', fontSize:'12px', cursor:'pointer' }}>
        <span style={{ fontWeight:'700', color:'var(--gold-l)', fontFamily:'monospace', width:'40px' }}>#{String(sale.num).padStart(3,'0')}</span>
        <span style={{ color:'var(--muted)', width:'45px' }}>{sale.sale_time}</span>
        <span style={{ flex:1 }}>{sale.item_count} art. {sale.cli_name ? '· '+sale.cli_name : ''}</span>
        <span style={{ fontWeight:'700' }}>{f(sale.grand)} DT</span>
        <span style={{ fontSize:'10px', padding:'2px 6px', borderRadius:'10px', background: sale.pay_method==='cash'?'var(--gold-dim)':sale.pay_method==='card'?'rgba(74,144,217,.1)':'rgba(61,184,122,.1)', color: sale.pay_method==='cash'?'var(--gold-l)':sale.pay_method==='card'?'var(--blue)':'var(--green)' }}>
          {sale.pay_method==='cash'?'💵':sale.pay_method==='card'?'💳':'📱'}
        </span>
        <span style={{ fontSize:'10px', color:'var(--muted)' }}>{open?'▲':'▼'}</span>
      </div>
      {open && (
        <div style={{ padding:'8px 0 12px 48px', fontSize:'11px' }} onClick={e => e.stopPropagation()}>
          {items.length > 0 ? (
            <div style={{ background:'var(--card)', borderRadius:'8px', padding:'10px', marginBottom:'6px' }}>
              {items.map((it: any, idx: number) => (
                <div key={idx} style={{ display:'flex', justifyContent:'space-between', padding:'3px 0', borderBottom: idx < items.length-1 ? '1px solid var(--div)' : 'none' }}>
                  <span>{it.qty || 1}x {it.name}</span>
                  <span style={{ color:'var(--gold-l)', fontWeight:'600' }}>{f((it.price||0) * (it.qty||1))} DT</span>
                </div>
              ))}
            </div>
          ) : <div style={{ color:'var(--muted)', marginBottom:'6px' }}>Détail articles non disponible</div>}
          <div style={{ display:'flex', gap:'16px', color:'var(--muted)', flexWrap:'wrap' }}>
            <span>🕐 {sale.sale_time}</span>
            <span>👤 {sale.cashier || '—'}</span>
            {sale.cli_name && <span>📋 {sale.cli_name}</span>}
            {sale.disc_pct > 0 && <span>🏷️ -{sale.disc_pct}%</span>}
            <span>💰 {sale.pay_method==='cash'?'Espèces':sale.pay_method==='card'?'Carte':'Mobile'}</span>
          </div>
        </div>
      )}
    </div>
  )
}

// ════════════════ SESSIONS TABLE ════════════════
function SessionsSection({ sessions, recent }: { sessions: any[], recent?: any[] }) {
  const [expanded, setExpanded] = useState<number|null>(null)

  if (!sessions || sessions.length === 0) return (
    <div className={s.empty}><div className={s.emptyIcon}>🔒</div><div className={s.emptyText}>Aucune clôture enregistrée</div></div>
  )

  function getSessionOrders(session: any) {
    if (!recent || !recent.length) return []
    // Simply show all sales for this date that match this cashier
    // Since a session can span multiple days, just filter by cashier name
    const cashier = session.cashier || ''
    if (cashier) {
      return recent.filter((sale: any) => sale.cashier === cashier)
    }
    // If no cashier info, show all sales for the date
    return recent
  }

  return (
    <div className={s.sessionGrid}>
      {sessions.map((r:any, i:number) => {
        const ecart    = r.ecart != null ? parseFloat(r.ecart) : null
        const ecartOk  = ecart === null || ecart >= 0
        const cardCls  = ecart === null ? s.sessionCardNeutral : ecartOk ? s.sessionCardOk : s.sessionCardWarn
        const isExpanded = expanded === i
        const orders = isExpanded ? getSessionOrders(r) : []
        return (
          <div key={i} className={`${s.sessionCard} ${cardCls}`} onClick={() => setExpanded(isExpanded ? null : i)} style={{ cursor:'pointer' }}>
            <div className={s.sessionCashier}>👤 {r.cashier || 'Caissier'}</div>
            <div className={s.sessionDate}>{r.day} · Ouverture: {r.opened_at ? new Date(r.opened_at).toLocaleTimeString('fr-TN') : '—'} · Clôture: {r.closed_at ? new Date(r.closed_at).toLocaleTimeString('fr-TN') : '—'}</div>
            <div className={s.sessionRow}><span>💰 Fond initial</span><span>{f(r.fond_initial)} DT</span></div>
            <div className={s.sessionRow}><span>🧾 Ventes totales</span><span className={s.bold}>{f(r.total_sales)} DT</span></div>
            <div className={s.sessionRow}><span>💵 Espèces</span><span>{f(r.cash_sales)} DT</span></div>
            <div className={s.sessionRow}><span>💳 Carte/Mobile</span><span>{f(+r.card_sales + +r.mobile_sales)} DT</span></div>
            <div className={s.sessionRow}><span>📊 Commandes</span><span>{r.orders_count}</span></div>
            {r.theorique != null && <div className={s.sessionRow}><span>💼 Théorique</span><span style={{color:'var(--gold-l)',fontWeight:700}}>{f(r.theorique)} DT</span></div>}
            {r.montant_compte != null && <div className={s.sessionRow}><span>🧮 Compté</span><span>{f(r.montant_compte)} DT</span></div>}
            {ecart !== null && (
              <div className={`${s.ecartBig} ${ecartOk ? s.ecartBigOk : s.ecartBigWarn}`}>
                Écart {ecartOk ? '+' : ''}{f(ecart)} DT {ecart===0?'✅':ecartOk?'⬆':'⚠'}
              </div>
            )}
            <div style={{ fontSize:'11px', color:'var(--muted)', textAlign:'center', marginTop:'8px' }}>{isExpanded ? '▲ Fermer détails' : '▼ Voir les commandes'}</div>
            {isExpanded && (
              <div style={{ marginTop:'12px', borderTop:'1px solid var(--div)', paddingTop:'12px' }} onClick={e => e.stopPropagation()}>
                <div style={{ fontSize:'12px', fontWeight:'700', marginBottom:'8px', color:'var(--gold-l)' }}>📋 Commandes de cette session ({orders.length})</div>
                {orders.length === 0 ? (
                  <div style={{ fontSize:'12px', color:'var(--muted)', textAlign:'center', padding:'10px' }}>Aucune commande trouvée pour cette session</div>
                ) : (
                  <div style={{ maxHeight:'300px', overflowY:'auto' }}>
                    {orders.map((sale: any, j: number) => (
                      <OrderRow key={j} sale={sale} />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ════════════════ DASHBOARD ════════════════
function Dashboard({ apiKey, restInfo, onLogout }: { apiKey:string; restInfo:any; onLogout:()=>void }) {
  const [date,       setDate]       = useState(today())
  const [data,       setData]       = useState<any>(null)
  const [loading,    setLoading]    = useState(false)
  const [online,     setOnline]     = useState(true)
  const [syncMsg,    setSyncMsg]    = useState('')
  const [activeTab,  setActiveTab]  = useState('overview')
  const [catFilter,  setCatFilter]  = useState('Tous')
  const [orderSearch,setOrderSearch]= useState('')
  const { theme, toggle }           = useTheme()

  const load = useCallback(async (d: string) => {
    setLoading(true); setSyncMsg('Actualisation...')
    try {
      const res  = await fetch(`${API}/api/dashboard?date=${d}&key=${apiKey}`)
      if (res.status === 401 || res.status === 403) { onLogout(); return }
      const json = await res.json()
      if (!json.ok) { setSyncMsg('Erreur: ' + json.error); setLoading(false); return }
      setData(json); setOnline(true)
      setSyncMsg(`↻ ${new Date().toLocaleTimeString('fr-TN')}`)
    } catch { setOnline(false); setSyncMsg('Hors ligne') }
    setLoading(false)
  }, [apiKey, onLogout])

  useEffect(() => { load(date) }, [date, load])
  useEffect(() => { const id = setInterval(() => load(date), 30000); return () => clearInterval(id) }, [date, load])

  // ── Live notifications ──
  const [prevOrders, setPrevOrders] = useState(0)
  const [notif, setNotif] = useState('')
  useEffect(() => {
    if (!data?.kpis) return
    const curr = data.kpis.total_orders || 0
    if (prevOrders > 0 && curr > prevOrders) {
      const newSales = curr - prevOrders
      setNotif(`🔔 +${newSales} nouvelle${newSales>1?'s':''} vente${newSales>1?'s':''}!`)
      setTimeout(() => setNotif(''), 4000)
    }
    setPrevOrders(curr)
  }, [data?.kpis?.total_orders])

  // ── Export PDF ──
  function exportPDF() {
    if (!data) return
    const k = data.kpis
    const dateStr = new Date(date + 'T12:00').toLocaleDateString('fr-TN', { weekday:'long', day:'numeric', month:'long', year:'numeric' })
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Rapport ${restInfo.name} — ${date}</title>
    <style>body{font-family:Arial,sans-serif;padding:30px;font-size:13px;color:#222}h1{font-size:20px;margin-bottom:4px}h2{font-size:14px;margin-top:20px;border-bottom:1px solid #ddd;padding-bottom:4px}.sub{color:#666;font-size:12px;margin-bottom:20px}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:20px}.kpi{background:#f8f6f2;border-radius:8px;padding:14px;text-align:center}.kpi-val{font-size:22px;font-weight:700}.kpi-lbl{font-size:11px;color:#666;margin-top:4px}table{width:100%;border-collapse:collapse;margin-top:8px}th,td{text-align:left;padding:6px 10px;border-bottom:1px solid #eee;font-size:12px}th{background:#f5f3ef;font-weight:600}.footer{margin-top:30px;text-align:center;font-size:10px;color:#999}</style></head><body>
    <h1>⚡ ${restInfo.name}</h1>
    <div class="sub">${dateStr} · Rapport généré le ${new Date().toLocaleDateString('fr-TN')} à ${new Date().toLocaleTimeString('fr-TN')}</div>
    <div class="grid">
      <div class="kpi"><div class="kpi-val">${Number(k.total_revenue||0).toFixed(3)} DT</div><div class="kpi-lbl">Chiffre d'affaires</div></div>
      <div class="kpi"><div class="kpi-val">${k.total_orders||0}</div><div class="kpi-lbl">Commandes</div></div>
      <div class="kpi"><div class="kpi-val">${Number(k.avg_ticket||0).toFixed(3)} DT</div><div class="kpi-lbl">Ticket moyen</div></div>
      <div class="kpi"><div class="kpi-val">${Number(k.cash_total||0).toFixed(3)} DT</div><div class="kpi-lbl">Espèces</div></div>
      <div class="kpi"><div class="kpi-val">${Number(k.card_total||0).toFixed(3)} DT</div><div class="kpi-lbl">Carte</div></div>
      <div class="kpi"><div class="kpi-val">${Number(k.mobile_total||0).toFixed(3)} DT</div><div class="kpi-lbl">Mobile</div></div>
    </div>
    <h2>🏆 Top produits</h2>
    <table><tr><th>#</th><th>Article</th><th>Quantité</th><th>Revenu</th></tr>
    ${(data.topItems||[]).map((it:any,i:number)=>`<tr><td>${i+1}</td><td>${it.name}</td><td>${it.qty}</td><td>${Number(it.revenue||0).toFixed(3)} DT</td></tr>`).join('')}
    </table>
    <h2>🧾 Commandes</h2>
    <table><tr><th>#</th><th>Heure</th><th>Articles</th><th>Total</th><th>Paiement</th></tr>
    ${(data.recent||[]).slice(0,30).map((s:any)=>`<tr><td>#${String(s.num).padStart(3,'0')}</td><td>${s.sale_time||''}</td><td>${s.item_count}</td><td>${Number(s.grand||0).toFixed(3)} DT</td><td>${s.pay_method==='cash'?'Espèces':s.pay_method==='card'?'Carte':'Mobile'}</td></tr>`).join('')}
    </table>
    <div class="footer">by servio.tn ⚡ — Rapport auto-généré</div>
    </body></html>`
    const w = window.open('', '_blank')
    if (w) { w.document.write(html); w.document.close(); setTimeout(() => w.print(), 500) }
  }

  const tabs = [
    { id:'overview',  label:'📊 Vue d\'ensemble' },
    { id:'products',  label:'🏆 Produits'         },
    { id:'orders',    label:'🧾 Commandes'         },
    { id:'sessions',  label:'🔒 Caisses'           },
  ]

  const k = data?.kpis
  const dateLabel = new Date(date + 'T12:00').toLocaleDateString('fr-TN', {
    weekday:'long', day:'numeric', month:'long', year:'numeric'
  })

  return (
    <div className={s.appWrap}>
      {/* Header */}
      <header className={s.hdr}>
        <div className={s.hdrBrand}>
          <div className={s.hdrLogo}>⚡</div>
          <div><div className={s.hdrName}>SERVIO OS</div><div className={s.hdrCity}>{restInfo.name} · {restInfo.city}</div></div>
        </div>
        <div className={s.hdrRight}>
          <button className={`${s.filterBtn} ${date===today()?s.filterBtnActive:''}`} onClick={()=>setDate(today())}>Aujourd'hui</button>
          <button className={s.filterBtn} onClick={()=>{const d=new Date();d.setDate(d.getDate()-1);setDate(d.toISOString().split('T')[0])}}>Hier</button>
          <input type="date" className={s.datePick} value={date} max={today()} onChange={e=>setDate(e.target.value)}/>
          <button className={s.btnIcon} onClick={()=>load(date)} title="Actualiser">↻</button>
          <button className={s.btnIcon} onClick={exportPDF} title="Exporter PDF">📄</button>
          <button className={s.btnIcon} onClick={toggle} title="Thème">{theme==='dark'?'☀️':'🌙'}</button>
          <button className={s.btnLogout} onClick={onLogout}><span>Déconnecter</span></button>
        </div>
      </header>

      {/* Nav Tabs */}
      <div className={s.navTabs}>
        {tabs.map(t => (
          <div key={t.id} className={`${s.navTab} ${activeTab===t.id?s.navTabActive:''}`} onClick={()=>setActiveTab(t.id)}>
            {t.label}
          </div>
        ))}
      </div>

      {/* Status bar */}
      <div className={s.statusBar}>
        <div className={s.statusLeft}>
          <div className={`${s.dot} ${loading?s.dotOrange:online?s.dotGreen:s.dotRed}`}/>
          <span>{loading ? 'Actualisation...' : syncMsg}</span>
          <span style={{marginLeft:8,fontSize:11,color:'var(--green)'}}>● LIVE (30s)</span>
        </div>
        <span style={{fontSize:12,color:'var(--muted)'}}>{dateLabel}</span>
      </div>

      {/* Notification toast */}
      {notif && <div style={{position:'fixed',top:70,right:20,background:'var(--panel)',border:'1px solid var(--green)',borderRadius:10,padding:'12px 20px',fontSize:13,fontWeight:600,color:'var(--green)',zIndex:999,boxShadow:'0 8px 24px rgba(0,0,0,.3)',animation:'slideUp .3s ease'}}>{notif}</div>}

      {/* Content */}
      <div className={s.content}>
        {!data && !loading && <div className={s.empty}><div className={s.emptyIcon}>📊</div><div className={s.emptyText}>Aucune donnée</div></div>}
        {loading && !data && <div className={s.loading}><div className={s.spinner}/> Chargement...</div>}

        {data && <>
          {/* ── OVERVIEW ── */}
          {activeTab === 'overview' && <>
            <div className={s.section}>
              <KpiCards k={k}/>
            </div>
            <div className={s.section} style={{display:'grid',gridTemplateColumns:'1fr',gap:14}}>
              <div className={s.chartBox}>
                <div className={s.chartTitle}>📈 Ventes 7 derniers jours <span className={s.chartSubtitle}>(DT)</span></div>
                <BarChart weekly={data.weekly} selectedDate={date}/>
              </div>
              <div className={s.chartBox}>
                <div className={s.chartTitle}>💳 Répartition paiements</div>
                <PaymentDonut k={k}/>
              </div>
            </div>
            {/* Category breakdown */}
            <div className={s.section}>
              <div className={s.chartBox}>
                <div className={s.chartTitle}>📂 Ventes par catégorie</div>
                <CategoryBreakdown items={data.topItems}/>
              </div>
            </div>
            <div className={s.section}>
              <div className={s.sectionHdr}>
                <div className={s.sectionTitle}><span>🏆</span> Top 5 articles du jour</div>
                <button className={s.btnIcon} style={{fontSize:12}} onClick={()=>setActiveTab('products')}>Voir tout →</button>
              </div>
              <div className={s.chartBox}>
                {data.topItems.length === 0
                  ? <div className={s.empty}><div className={s.emptyText}>Aucune vente ce jour</div></div>
                  : <div className={s.topList}>
                      {data.topItems.slice(0,5).map((it:any, i:number) => (
                        <div key={i} className={s.topItem}>
                          <div className={`${s.topRank} ${i===0?s.topRank1:i===1?s.topRank2:i===2?s.topRank3:s.topRankN}`}>
                            {i < 3 ? ['🥇','🥈','🥉'][i] : i+1}
                          </div>
                          <div className={s.topEmoji}>{itemEmoji(it.name)}</div>
                          <div className={s.topName}>{it.name}</div>
                          <div className={s.topBarWrap}><div className={s.topBar} style={{width:`${Math.round(it.qty/(data.topItems[0]?.qty||1)*100)}%`}}/></div>
                          <div className={s.topQty}>{it.qty} <span style={{fontSize:10,color:'var(--muted)',fontWeight:400}}>fois</span></div>
                        </div>
                      ))}
                    </div>
                }
              </div>
            </div>
          </>}

          {/* ── PRODUCTS ── */}
          {activeTab === 'products' && <>
            <div className={s.section}>
              <div className={s.sectionHdr}><div className={s.sectionTitle}><span>🏆</span> Articles vendus</div></div>
              <TopProducts items={data.topItems} filter={catFilter} onFilter={setCatFilter}/>
            </div>
          </>}

          {/* ── ORDERS ── */}
          {activeTab === 'orders' && <>
            <div className={s.section}>
              <div className={s.sectionHdr}>
                <div className={s.sectionTitle}><span>🧾</span> Commandes du jour</div>
                <div className={s.summaryRow} style={{padding:'8px 16px',marginBottom:0}}>
                  <div className={s.summaryItem}><div className={s.summaryVal}>{data.recent.length}</div><div className={s.summaryLbl}>total</div></div>
                  <div className={s.summaryItem}><div className={s.summaryVal}>{f(k.total_revenue)}</div><div className={s.summaryLbl}>DT</div></div>
                </div>
              </div>
              <OrdersTable orders={data.recent} search={orderSearch} onSearch={setOrderSearch}/>
            </div>
          </>}

          {/* ── SESSIONS ── */}
          {activeTab === 'sessions' && <>
            {/* Cashier performance */}
            {data.byCashier && data.byCashier.length > 0 && (
              <div className={s.section}>
                <div className={s.sectionHdr}><div className={s.sectionTitle}><span>👤</span> Performance par serveur/caissier</div></div>
                <div className={s.chartBox}>
                  <div style={{ display:'flex', flexDirection:'column', gap:'0' }}>
                    {data.byCashier.map((c: any, i: number) => {
                      const maxRev = data.byCashier[0]?.revenue || 1
                      const pct = Math.round((c.revenue / maxRev) * 100)
                      return (
                        <div key={i} style={{ display:'flex', alignItems:'center', gap:'12px', padding:'12px 0', borderBottom:'1px solid var(--div)' }}>
                          <div style={{ width:'28px', height:'28px', borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'12px', fontWeight:'700', background: i===0?'linear-gradient(135deg,#FFD700,#FFA500)':i===1?'linear-gradient(135deg,#C0C0C0,#A0A0A0)':i===2?'linear-gradient(135deg,#CD7F32,#A0522D)':'var(--card)', color: i<3?'#000':'var(--muted)', border: i>=3?'1px solid var(--div)':'none' }}>
                            {i < 3 ? ['🥇','🥈','🥉'][i] : i+1}
                          </div>
                          <div style={{ flex:1, minWidth:0 }}>
                            <div style={{ fontWeight:'600', fontSize:'13px' }}>{c.cashier}</div>
                            <div style={{ fontSize:'11px', color:'var(--muted)', marginTop:'2px' }}>{c.orders} commandes · Ticket moy: {Number(c.avg_ticket||0).toFixed(3)} DT</div>
                          </div>
                          <div style={{ width:'120px', height:'6px', background:'var(--div)', borderRadius:'3px', overflow:'hidden', flexShrink:0 }}>
                            <div style={{ height:'100%', width:`${pct}%`, background:'linear-gradient(90deg,var(--gold),var(--gold-l))', borderRadius:'3px', transition:'width .5s' }}/>
                          </div>
                          <div style={{ fontWeight:'700', fontSize:'14px', color:'var(--gold-l)', minWidth:'80px', textAlign:'right' }}>{Number(c.revenue||0).toFixed(3)} DT</div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            )}
            <div className={s.section}>
              <div className={s.sectionHdr}><div className={s.sectionTitle}><span>🔒</span> Historique des clôtures de caisse</div></div>
              <SessionsSection sessions={data.sessions} recent={data.recent}/>
            </div>
          </>}
        </>}
      </div>
    </div>
  )
}

// ════════════════ ROOT ════════════════
export default function Home() {
  const [apiKey,   setApiKey]   = useState<string|null>(null)
  const [restInfo, setRestInfo] = useState<any>(null)

  useEffect(() => {
    const k = localStorage.getItem('d_api_key')
    const r = localStorage.getItem('d_rest_info')
    if (k && r) { setApiKey(k); setRestInfo(JSON.parse(r)) }
    // Apply saved theme on load
    const t = localStorage.getItem('d_theme') || 'dark'
    document.documentElement.setAttribute('data-theme', t)
  }, [])

  function logout() {
    localStorage.removeItem('d_api_key')
    localStorage.removeItem('d_rest_info')
    setApiKey(null); setRestInfo(null)
  }

  if (!apiKey) {
    return <Login onLogin={d => {
      setApiKey(d.api_key)
      setRestInfo({ name: d.name, city: d.city })
    }} />
  }

  return <Dashboard apiKey={apiKey} restInfo={restInfo} onLogout={logout} />
}
