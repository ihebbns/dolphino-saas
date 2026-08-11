'use client'
import { useState, useEffect, useCallback, useMemo } from 'react'
import s from '../dashboard.module.css'
import { TabBar } from '../ui/TabBar'
import { useTheme } from '../ui/useTheme'

const API = process.env.NEXT_PUBLIC_API_URL || 'https://servio.tn'
const f   = (n: any) => Number(n || 0).toFixed(3)
const fmt = (n: any) => Number(n || 0).toLocaleString('fr-TN', { minimumFractionDigits: 3 })
const today = () => {
  const d = new Date()
  if (d.getHours() < 5) d.setDate(d.getDate() - 1)
  return d.toISOString().split('T')[0]
}

// ── Theme ──────────────────────────────────────────────
// The private copy that used to live here is gone: it wrote the same key but was
// a second definition of the default, and only this page's stylesheet had a dark
// palette. Both now come from ui/useTheme + ui/theme.css.

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
    { icon:'📒', val: fmt(k.credit_total),    unit:'DT', lbl:'À crédit',          color:'kpiCardBlue'   },
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
  const credit = +k.credit_total || 0
  const total  = cash + card + mobile + credit || 1
  const items  = [
    { label:'Espèces', val:cash,   pct:Math.round(cash/total*100),   color:'var(--gold-l)' },
    { label:'Carte',   val:card,   pct:Math.round(card/total*100),   color:'var(--blue)'   },
    { label:'Mobile',  val:mobile, pct:Math.round(mobile/total*100), color:'var(--green)'  },
    { label:'À crédit',val:credit, pct:Math.round(credit/total*100), color:'var(--orange)' },
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

function TopProducts({ products, filter, onFilter }: { products: any[], filter: string, onFilter:(f:string)=>void }) {
  // Sort mode requested by the owner: by units sold, or by profitability.
  const [sortBy, setSortBy] = useState<'qty'|'margin'>('qty')

  const cats = useMemo(
    () => ['Tous', ...Array.from(new Set(products.map((it:any) => itemCategory(it.name)).filter(Boolean)))],
    [products]
  )

  const filtered = useMemo(() => {
    const base = filter === 'Tous' ? products : products.filter((it:any) => it.name.startsWith(filter + ' '))
    const arr = [...base]
    if (sortBy === 'margin') {
      arr.sort((a:any, b:any) => {
        // Products with unknown cost can't be ranked by margin — sink them to the bottom.
        if (!!a.costKnown !== !!b.costKnown) return a.costKnown ? -1 : 1
        return ((b.marginPct||0) - (a.marginPct||0)) || ((b.profit||0) - (a.profit||0))
      })
    } else {
      arr.sort((a:any, b:any) => ((b.qty||0) - (a.qty||0)) || ((b.revenue||0) - (a.revenue||0)))
    }
    return arr
  }, [products, filter, sortBy])

  const display = filtered.slice(0, 15)
  // Bar metric follows the active sort; unknown-cost margin counts as 0 so it never fakes a full bar.
  const metric = (it:any) => sortBy === 'margin' ? (it.costKnown ? (it.marginPct||0) : 0) : (it.qty||0)
  const max = Math.max(1, ...display.map(metric))

  return (
    <>
      <div className={s.filters}>
        {cats.map(c => (
          <button key={c} className={`${s.filterBtn} ${filter===c?s.filterBtnActive:''}`} onClick={()=>onFilter(c)}>
            {CAT_EMOJI[c] || ''} {c}
          </button>
        ))}
        <div className={s.sortToggle}>
          <button className={`${s.filterBtn} ${sortBy==='qty'?s.filterBtnActive:''}`} onClick={()=>setSortBy('qty')}>🔥 Plus vendus</button>
          <button className={`${s.filterBtn} ${sortBy==='margin'?s.filterBtnActive:''}`} onClick={()=>setSortBy('margin')}>💰 Plus rentables</button>
        </div>
      </div>
      <div className={s.chartBox}>
        {display.length === 0
          ? <div className={s.empty}><div className={s.emptyIcon}>📊</div><div className={s.emptyText}>Aucune vente</div></div>
          : <div className={s.topList}>
              {display.map((it:any, i:number) => {
                const barPct = Math.max(0, Math.min(100, Math.round(metric(it) / max * 100)))
                return (
                  <div key={i} className={s.topItem}>
                    <div className={`${s.topRank} ${i===0?s.topRank1:i===1?s.topRank2:i===2?s.topRank3:s.topRankN}`}>
                      {i < 3 ? ['🥇','🥈','🥉'][i] : i+1}
                    </div>
                    <div className={s.topEmoji}>{itemEmoji(it.name)}</div>
                    <div className={s.topName}>{it.name}</div>
                    <div className={s.topBarWrap}>
                      <div className={s.topBar} style={{width:`${barPct}%`}}/>
                    </div>
                    <div className={s.topMetrics}>
                      <div className={s.topQty}>{it.qty} <span style={{fontSize:10,color:'var(--muted)',fontWeight:400}}>fois</span></div>
                      <div className={s.topMargin}>
                        {it.costKnown
                          ? <>{(it.marginPct||0).toFixed(0)}% · <span style={{color:(it.profit||0)>=0?'var(--green)':'var(--red)'}}>{f(it.profit)} DT</span></>
                          : <>— · <span style={{color:'var(--muted)'}}>≤ {f(it.profit)} DT</span></>}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
        }
      </div>
    </>
  )
}

// ════════════════ ORDER DETAIL MODAL ════════════════
function OrderDetail({ order, onClose }: { order: any, onClose: ()=>void }) {
  const items: any[] = order.items || []
  const typeMap: any = { place:'🏠 Sur place', take:'🥡 Emporter', del:'🛵 Livraison', table:'🍽️ Table' }
  const payMap:  any = { cash:'💵 Espèces', card:'💳 Carte', mob:'📱 Mobile', credit:'📒 Crédit' }
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
        {order.voided && (
          <div style={{padding:'10px 12px',background:'var(--red-dim)',border:'1px solid rgba(224,82,82,.3)',borderRadius:8,fontSize:12,marginBottom:12,color:'var(--red)'}}>
            🗑️ <strong>Vente annulée</strong>{order.void_by ? ` par ${order.void_by}` : ''}{order.voided_at ? ` · ${new Date(order.voided_at).toLocaleString('fr-TN')}` : ''}
            {order.void_reason && <div style={{marginTop:4,color:'var(--muted)'}}>Motif : {order.void_reason}</div>}
          </div>
        )}
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
  // Every sale stays traceable here regardless of status — the filter decides
  // what's SHOWN, never what's fetched. Default 'active' matches what staff
  // expect to see first; 'Annulées'/'Toutes' are one click away for tracing.
  const [voidFilter, setVoidFilter] = useState<'active' | 'voided' | 'all'>('active')
  const voidCount = orders.filter((r: any) => r.voided).length
  // Simple on purpose — the owner doesn't think in "kiosk vs moi vs QR", just
  // "did this come from a customer's phone/screen, or did staff type it in".
  // The specific channel still shows as a badge per row for anyone who wants it.
  const [sourceFilter, setSourceFilter] = useState<'all' | 'online' | 'caisse'>('all')
  const onlineCount = orders.filter((r: any) => r.source && r.source !== 'caisse').length
  const filtered = orders
    .filter((r: any) => voidFilter === 'all' ? true : voidFilter === 'voided' ? r.voided : !r.voided)
    .filter((r: any) => sourceFilter === 'all' ? true : sourceFilter === 'online' ? (r.source && r.source !== 'caisse') : (!r.source || r.source === 'caisse'))
    .filter((r:any) =>
      !search || r.cashier?.toLowerCase().includes(search.toLowerCase()) ||
      String(r.num).includes(search)
    )
  // 'table' is a real order_type in the universal build; 'credit' is a real
  // pay_method once the credit module is on. Both must be labelled or the row
  // falls back to showing the raw database value.
  const typeMap: any = { place:'🏠 Place', take:'🥡 Emporter', del:'🛵 Livraison', table:'🍽️ Table' }
  const payMap:  any = { cash:'💵 Espèces', card:'💳 Carte', mob:'📱 Mobile', credit:'📒 Crédit' }
  const typeCls: any = { place:s.bPlace, take:s.bTake, del:s.bDel, table:s.bPlace }
  const payCls:  any = { cash:s.bCash, card:s.bCard, mob:s.bMob, credit:s.bCredit }
  const sourceMap: any = { kiosk: '🖥️ Kiosque', moi: '🌐 En ligne' }

  return (
    <>
      {selected && <OrderDetail order={selected} onClose={()=>setSelected(null)}/>}
      <div className={s.filters}>
        <input className={s.filterSearch} placeholder="🔍 Rechercher par #, caissier..."
          value={search} onChange={e=>onSearch(e.target.value)}/>
        <select value={voidFilter} onChange={e=>setVoidFilter(e.target.value as any)}
          style={{padding:'8px 10px',borderRadius:8,border:'1px solid var(--div)',background:'var(--card)',color:'var(--txt)',fontSize:12}}>
          <option value="active">Actives</option>
          <option value="voided">🗑️ Annulées{voidCount ? ` (${voidCount})` : ''}</option>
          <option value="all">Toutes</option>
        </select>
        <select value={sourceFilter} onChange={e=>setSourceFilter(e.target.value as any)}
          style={{padding:'8px 10px',borderRadius:8,border:'1px solid var(--div)',background:'var(--card)',color:'var(--txt)',fontSize:12}}>
          <option value="all">Toutes provenances</option>
          <option value="online">📱 Depuis le téléphone{onlineCount ? ` (${onlineCount})` : ''}</option>
          <option value="caisse">🏪 Caisse</option>
        </select>
        <span style={{fontSize:12,color:'var(--muted)'}}>{filtered.length} commandes</span>
      </div>
      <div className={s.tableWrap}>
        <div className={s.tableScroll}>
          {filtered.length === 0
            ? <div className={s.empty}><div className={s.emptyIcon}>🧾</div><div className={s.emptyText}>Aucune commande</div></div>
            : <table className={s.table}>
                <thead><tr>
                  <th>#</th><th>Heure</th><th>Type</th><th>Articles</th><th>Total</th><th>Paiement</th><th>Caissier</th><th>Provenance</th><th>Statut</th>
                </tr></thead>
                <tbody>
                  {filtered.map((r:any, i:number) => (
                    <tr key={i} onClick={()=>setSelected(r)}
                      style={{cursor:'pointer', opacity: r.voided ? 0.6 : 1, background: r.voided ? 'var(--red-dim)' : undefined}}>
                      <td className={s.num} style={r.voided ? {textDecoration:'line-through'} : undefined}>#{String(r.num).padStart(3,'0')}</td>
                      <td className={s.muted}>{r.sale_time}</td>
                      <td><span className={`${s.badge} ${typeCls[r.order_type]||s.bPlace}`}>{typeMap[r.order_type]||r.order_type}</span></td>
                      <td>{r.item_count} art.{r.disc_pct>0?<span style={{color:'var(--red)',fontSize:11}}> -{r.disc_pct}%</span>:null}</td>
                      <td className={s.bold} style={r.voided ? {textDecoration:'line-through'} : undefined}>{f(r.grand)} DT</td>
                      <td><span className={`${s.badge} ${payCls[r.pay_method]||s.bCash}`}>{payMap[r.pay_method]||r.pay_method}</span></td>
                      <td className={s.muted}>{r.cashier}</td>
                      <td>{r.source && r.source !== 'caisse'
                        ? <span style={{fontSize:11,color:'var(--blue)'}}>{sourceMap[r.source] || r.source}</span>
                        : <span style={{fontSize:11,color:'var(--muted)'}}>🏪 Caisse</span>}
                      </td>
                      <td>{r.voided
                        ? <span style={{padding:'3px 9px',borderRadius:12,fontSize:11,fontWeight:700,background:'var(--red-dim)',color:'var(--red)',border:'1px solid rgba(224,82,82,.3)'}}>🗑️ Annulée</span>
                        : <span style={{fontSize:11,color:'var(--green)'}}>✓ Active</span>}
                      </td>
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
                  <span style={{ color:'var(--gold-l)', fontWeight:'600' }}>{f((it.price || it.p || 0) * (it.qty||1))} DT</span>
                </div>
              ))}
            </div>
          ) : <div style={{ color:'var(--muted)', marginBottom:'6px' }}>Détail articles non disponible</div>}
          <div style={{ display:'flex', gap:'16px', color:'var(--muted)', flexWrap:'wrap', fontSize:'11px' }}>
            <span>🕐 {sale.sale_time}</span>
            <span>👤 {sale.cashier || '—'}</span>
            {sale.cli_name && <span>📋 {sale.cli_name}</span>}
            {sale.disc_pct > 0 && <span>🏷️ -{sale.disc_pct}%</span>}
            <span>💰 {sale.pay_method==='cash'?'Espèces':sale.pay_method==='card'?'Carte':'Mobile'}</span>
          </div>
          {sale.pay_method === 'cash' && (sale.received || sale.monnaie) && (
            <div style={{ display:'flex', gap:'16px', color:'var(--muted)', fontSize:'11px', marginTop:'4px' }}>
              <span>💵 Reçu: <b style={{color:'var(--txt)'}}>{f(sale.received || sale.grand)} DT</b></span>
              {sale.monnaie > 0 && <span>💱 Monnaie: <b style={{color:'var(--green)'}}>{f(sale.monnaie)} DT</b></span>}
            </div>
          )}
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

    // Professional approach: filter by session_id (direct link, exact match)
    const sid = session.session_id || ''
    if (sid) {
      // A session_id is authoritative — return exactly its orders (may be empty)
      return recent.filter((sale: any) => (sale.session_id || '') === sid)
    }

    // Fallback for old data without session_id: filter by cashier + limit to orders_count
    const cashier = session.cashier || ''
    const count = session.orders_count || 0
    let filtered = cashier ? recent.filter((sale: any) => sale.cashier === cashier) : recent

    if (count > 0 && count < filtered.length) {
      return filtered.slice(0, count)
    }

    return filtered
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
            {/* Cash movements (ajouts/retraits) */}
            {r.cash_movements && Array.isArray(r.cash_movements) && r.cash_movements.length > 0 && (
              <div style={{ margin:'8px 0', padding:'8px', background:'var(--card)', borderRadius:'8px', border:'1px solid var(--div)' }}>
                <div style={{ fontSize:'10px', color:'var(--muted)', fontWeight:'600', marginBottom:'6px', textTransform:'uppercase', letterSpacing:'1px' }}>Mouvements de caisse</div>
                {r.cash_movements.map((m: any, mi: number) => (
                  <div key={mi} style={{ display:'flex', justifyContent:'space-between', padding:'4px 0', borderBottom: mi < r.cash_movements.length-1 ? '1px solid var(--div)' : 'none', fontSize:'12px' }}>
                    <span style={{ color: m.type==='out' ? 'var(--red)' : 'var(--green)', fontWeight: m.type==='out' ? 800 : 600 }}>
                      {m.type==='in' ? '➕' : '➖'} {m.type==='in' ? 'Ajout' : 'Retrait'} {m.reason ? `(${m.reason})` : ''}
                    </span>
                    <span style={{ fontWeight:700, color: m.type==='out' ? 'var(--red)' : 'var(--green)' }}>
                      {m.type==='in' ? '+' : '−'}{f(m.amount)} DT
                    </span>
                  </div>
                ))}
              </div>
            )}
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

// ════════════════ TABLES SECTION (table-service clients) ════════════════
// Reads /api/me/tables — the SAME cross-till sync a table-service POS
// already pushes to (see pos_tables/table_audit_log, migration-pos-tables.sql)
// so this needs no new backend, just a web view of data that already exists.
// Polls independently of the date-scoped `data` above — table state is
// "right now," not a historical report.
const TBL_STATUS_LABEL: Record<string, string> = { free: 'Libre', open: 'Ouvert', sent: 'Envoyé en cuisine', bill: 'Addition imprimée' }
const TBL_STATUS_COLOR: Record<string, string> = { free: 'var(--muted)', open: '#F5A623', sent: '#4ADE80', bill: '#F59E0B' }
const TBL_ACTION_LABEL: Record<string, string> = {
  open: '🟡 Ouverture', item_add: '➕ Article ajouté', item_remove: '➖ Article retiré',
  sent_kitchen: '🍳 Envoyé en cuisine', bill_printed: '📄 Addition imprimée',
  paid: '💰 Paiement', closed: '🔒 Table libérée', table_created: '🆕 Table créée',
  ready: '🔔 Commande prête', served: '✓ Servie / Récupérée',
}

function tblItemsTotal(items: any[]): number {
  return (items || []).reduce((a, it) => a + (Number(it.p) || 0) * (Number(it.qty) || 0), 0)
}

// "Since when" a table's been open, formatted like the POS's own tblElapsed()
// — "42min" / "1h15". Same urgency-color idea as the kitchen tickets already
// use, just tuned for a table's own timescale (a dine-in table naturally
// stays open far longer than a kitchen ticket): green under 45min is a
// normal meal in progress, orange 45–90min is worth a glance, red past 90min
// is what actually surfaces as an alert below — a table that long usually
// means forgotten to close, not still eating.
const TBL_ALERT_MINUTES = 90
const TBL_WARN_MINUTES = 45
function tblElapsedMinutes(at: number | null): number {
  if (!at) return 0
  return Math.max(0, Math.floor((Date.now() - at) / 60000))
}
function tblElapsedLabel(mins: number): string {
  const h = Math.floor(mins / 60), m = mins % 60
  return h > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${m}min`
}
function tblElapsedColor(mins: number): string {
  return mins >= TBL_ALERT_MINUTES ? 'var(--red)' : mins >= TBL_WARN_MINUTES ? '#F5A623' : 'var(--muted)'
}

function TablesSection({ tables, audit }: { tables: any[]; audit: any[] }) {
  const [selected, setSelected] = useState<string | null>(null)

  if (!tables.length) return <div className={s.empty}><div className={s.emptyIcon}>🪑</div><div className={s.emptyText}>Aucune table configurée</div></div>

  const bySection = new Map<string, any[]>()
  for (const t of tables) {
    const key = t.sec || '—'
    if (!bySection.has(key)) bySection.set(key, [])
    bySection.get(key)!.push(t)
  }
  const activeCount = tables.filter(t => t.status !== 'free').length
  const totalDT = tables.reduce((a, t) => a + (t.status !== 'free' ? tblItemsTotal(t.items) * (1 - (t.disc || 0) / 100) : 0), 0)
  const alertTables = tables.filter(t => t.status !== 'free' && tblElapsedMinutes(t.at) >= TBL_ALERT_MINUTES)

  const selectedTable = selected ? tables.find(t => t.id === selected) : null
  const selectedAudit = selected
    ? audit.filter(e => e.tableId === selected).sort((a, b) => b.at - a.at)
    : []

  if (selectedTable) {
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
          <div style={{ fontSize: '15px', fontWeight: 800 }}>🪑 Table {selectedTable.num} — {selectedTable.sec}</div>
          <button className={s.filterBtn} onClick={() => setSelected(null)}>← Toutes les tables</button>
        </div>
        <div style={{ fontSize: '11px', color: 'var(--muted)', marginBottom: '14px' }}>
          Historique complet — ouverture, articles ajoutés, cuisine, addition, paiement, fermeture.
        </div>
        {selectedAudit.length === 0 ? (
          <div className={s.empty}><div className={s.emptyIcon}>📋</div><div className={s.emptyText}>Aucune activité enregistrée</div></div>
        ) : (
          <div style={{ maxHeight: '480px', overflowY: 'auto' }}>
            {selectedAudit.map((e, i) => (
              <div key={e.uid || i} style={{ padding: '10px 0', borderBottom: '1px solid var(--div)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', fontSize: '13px' }}>
                  <span style={{ fontWeight: 700 }}>{TBL_ACTION_LABEL[e.action] || e.action}</span>
                  <span style={{ color: 'var(--muted)', whiteSpace: 'nowrap' }}>{new Date(e.at).toLocaleString('fr-TN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                {e.detail && <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '2px' }}>{e.detail}</div>}
                {e.actor && <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '2px' }}>👤 {e.actor}</div>}
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div>
      <div style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '14px' }}>
        {activeCount} table{activeCount !== 1 ? 's' : ''} active{activeCount !== 1 ? 's' : ''} · {f(totalDT)} DT en cours · mis à jour toutes les 15s
      </div>
      {/* Anomaly alert — a table open this long usually means forgotten to
          close (customer left without the table being freed, a payment step
          skipped, etc.), not a genuinely 90min+ meal. Click straight into it. */}
      {alertTables.length > 0 && (
        <div style={{ marginBottom: '14px', padding: '10px 14px', borderRadius: '10px', background: 'rgba(224,82,82,.1)', border: '1px solid rgba(224,82,82,.3)' }}>
          <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--red)', marginBottom: '4px' }}>
            ⚠️ {alertTables.length} table{alertTables.length > 1 ? 's' : ''} ouverte{alertTables.length > 1 ? 's' : ''} depuis plus de {TBL_ALERT_MINUTES} min — à vérifier
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {alertTables.map(t => (
              <span key={t.id} onClick={() => setSelected(t.id)}
                style={{ fontSize: '11px', fontWeight: 700, color: 'var(--red)', cursor: 'pointer', textDecoration: 'underline' }}>
                Table {t.num} ({t.sec}) — {tblElapsedLabel(tblElapsedMinutes(t.at))}
              </span>
            ))}
          </div>
        </div>
      )}
      {[...bySection.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([sec, tables]) => (
        <div key={sec} style={{ marginBottom: '18px' }}>
          <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: '8px' }}>{sec}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '10px' }}>
            {tables.sort((a, b) => a.num - b.num).map(t => {
              const occ = t.status !== 'free'
              const total = occ ? tblItemsTotal(t.items) * (1 - (t.disc || 0) / 100) : 0
              const mins = occ ? tblElapsedMinutes(t.at) : 0
              const isAlert = occ && mins >= TBL_ALERT_MINUTES
              return (
                <div key={t.id} onClick={() => setSelected(t.id)}
                  style={{ padding: '12px', borderRadius: '10px', cursor: 'pointer', background: 'var(--bg2)', border: `1.5px solid ${isAlert ? 'var(--red)' : occ ? TBL_STATUS_COLOR[t.status] : 'var(--div)'}` }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                    <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: occ ? TBL_STATUS_COLOR[t.status] : 'var(--div)', flexShrink: 0 }} />
                    <span style={{ fontSize: '13px', fontWeight: 700 }}>Table {t.num}</span>
                    {isAlert && <span style={{ fontSize: '11px' }}>⚠️</span>}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--muted)' }}>{TBL_STATUS_LABEL[t.status] || t.status}</div>
                  {occ && <div style={{ fontSize: '11px', fontWeight: 700, color: tblElapsedColor(mins), marginTop: '2px' }}>🕐 {tblElapsedLabel(mins)}</div>}
                  {occ && <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--gold-l)', marginTop: '4px' }}>{f(total)} DT</div>}
                  {t.by && <div style={{ fontSize: '10px', color: 'var(--muted)', marginTop: '2px' }}>👤 {t.by}</div>}
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

// ════════════════ STOCK SECTION (Retail) ════════════════
function StockSection({ stock }: { stock: any[] }) {
  const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState('Tous')

  // Group by category
  const categories = useMemo(() => {
    const cats = new Set<string>()
    stock.forEach((it: any) => { if (it.category) cats.add(it.category) })
    return ['Tous', ...Array.from(cats).sort()]
  }, [stock])

  // Filter
  const filtered = useMemo(() => {
    let items = stock
    if (catFilter !== 'Tous') items = items.filter((it: any) => it.category === catFilter)
    if (search) {
      const q = search.toLowerCase()
      items = items.filter((it: any) =>
        it.item_name?.toLowerCase().includes(q) ||
        it.barcode?.includes(q)
      )
    }
    return items
  }, [stock, catFilter, search])

  // Stats
  const totalProducts = stock.length
  const totalValue = stock.reduce((sum: number, it: any) => sum + (+(it.sell_price || 0) * +(it.quantity || 0)), 0)
  const totalCost = stock.reduce((sum: number, it: any) => sum + (+(it.cost || 0) * +(it.quantity || 0)), 0)
  const lowStock = stock.filter((it: any) => (it.quantity || 0) <= 5 && (it.quantity || 0) > 0)
  const outOfStock = stock.filter((it: any) => (it.quantity || 0) <= 0)
  const lastSync = stock.length > 0 && stock[0].updated_at
    ? new Date(stock[0].updated_at).toLocaleString('fr-TN')
    : '—'

  return (
    <>
      {/* KPIs */}
      <div className={s.section}>
        <div className={s.kpiGrid}>
          <div className={`${s.kpiCard} ${s.kpiCardBlue}`}>
            <div className={s.kpiIcon}>📦</div>
            <div className={s.kpiVal}>{totalProducts}</div>
            <div className={s.kpiLbl}>Produits</div>
          </div>
          <div className={`${s.kpiCard} ${s.kpiCardGold}`}>
            <div className={s.kpiIcon}>💰</div>
            <div className={s.kpiVal}>{fmt(totalValue)}<span> DT</span></div>
            <div className={s.kpiLbl}>Valeur stock (vente)</div>
          </div>
          <div className={`${s.kpiCard} ${s.kpiCardGreen}`}>
            <div className={s.kpiIcon}>📈</div>
            <div className={s.kpiVal}>{fmt(totalValue - totalCost)}<span> DT</span></div>
            <div className={s.kpiLbl}>Marge potentielle</div>
          </div>
          <div className={`${s.kpiCard} ${s.kpiCardOrange}`}>
            <div className={s.kpiIcon}>⚠️</div>
            <div className={s.kpiVal}>{lowStock.length}</div>
            <div className={s.kpiLbl}>Stock bas (≤5)</div>
          </div>
          <div className={`${s.kpiCard} ${(s as any).kpiCardRed || s.kpiCardOrange}`} style={{borderColor:'rgba(224,82,82,.3)'}}>
            <div className={s.kpiIcon}>🚫</div>
            <div className={s.kpiVal} style={{color:'var(--red)'}}>{outOfStock.length}</div>
            <div className={s.kpiLbl}>Rupture de stock</div>
          </div>
          <div className={`${s.kpiCard} ${s.kpiCardBlue}`}>
            <div className={s.kpiIcon}>🔄</div>
            <div className={s.kpiVal} style={{fontSize:14}}>{lastSync}</div>
            <div className={s.kpiLbl}>Dernière synchro</div>
          </div>
        </div>
      </div>

      {/* Alerts */}
      {(outOfStock.length > 0 || lowStock.length > 0) && (
        <div className={s.section}>
          <div className={s.sectionHdr}><div className={s.sectionTitle}><span>🚨</span> Alertes Stock</div></div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(160px,1fr))', gap:'8px' }}>
            {outOfStock.map((it: any, i: number) => (
              <div key={'out'+i} style={{ background:'var(--panel)', border:'2px solid rgba(224,82,82,.4)', borderRadius:'var(--radius,9px)', padding:'12px', textAlign:'center' }}>
                <div style={{ fontSize:'24px', marginBottom:'4px' }}>{it.item_emoji || '📦'}</div>
                <div style={{ fontSize:'11px', fontWeight:'600', marginBottom:'2px', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{it.item_name}</div>
                <div style={{ fontSize:'9px', color:'var(--muted)', marginBottom:'4px' }}>{it.category}</div>
                <div style={{ fontSize:'18px', fontWeight:'800', color:'var(--red)' }}>RUPTURE</div>
              </div>
            ))}
            {lowStock.map((it: any, i: number) => (
              <div key={'low'+i} style={{ background:'var(--panel)', border:'2px solid rgba(232,136,42,.4)', borderRadius:'var(--radius,9px)', padding:'12px', textAlign:'center' }}>
                <div style={{ fontSize:'24px', marginBottom:'4px' }}>{it.item_emoji || '📦'}</div>
                <div style={{ fontSize:'11px', fontWeight:'600', marginBottom:'2px', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{it.item_name}</div>
                <div style={{ fontSize:'9px', color:'var(--muted)', marginBottom:'4px' }}>{it.category}</div>
                <div style={{ fontSize:'18px', fontWeight:'800', color:'var(--orange)' }}>{it.quantity}</div>
                <div style={{ fontSize:'9px', color:'var(--muted)' }}>restant</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Full inventory table */}
      <div className={s.section}>
        <div className={s.sectionHdr}><div className={s.sectionTitle}><span>📋</span> Inventaire complet</div></div>
        <div className={s.filters} style={{marginBottom:12}}>
          <input className={s.filterSearch} placeholder="🔍 Rechercher par nom ou code-barres..."
            value={search} onChange={e=>setSearch(e.target.value)} style={{maxWidth:300}}/>
          {categories.map(c => (
            <button key={c} className={`${s.filterBtn} ${catFilter===c?s.filterBtnActive:''}`} onClick={()=>setCatFilter(c)}>
              {c}
            </button>
          ))}
          <span style={{fontSize:12,color:'var(--muted)',marginLeft:'auto'}}>{filtered.length} produit{filtered.length!==1?'s':''}</span>
        </div>
        <div className={s.tableWrap}>
          <div className={s.tableScroll}>
            {filtered.length === 0
              ? <div className={s.empty}><div className={s.emptyIcon}>📦</div><div className={s.emptyText}>Aucun produit trouvé</div></div>
              : <table className={s.table}>
                  <thead><tr>
                    <th></th><th>Produit</th><th>Catégorie</th><th>Code-barres</th><th>Prix vente</th><th>Prix achat</th><th>Marge</th><th>Stock</th>
                  </tr></thead>
                  <tbody>
                    {filtered.map((it: any, i: number) => {
                      const qty = +(it.quantity || 0)
                      const price = +(it.sell_price || 0)
                      const cost = +(it.cost || 0)
                      const margin = price - cost
                      const qtyColor = qty <= 0 ? 'var(--red)' : qty <= 5 ? 'var(--orange)' : 'var(--green)'
                      return (
                        <tr key={i}>
                          <td style={{fontSize:18,textAlign:'center',width:30}}>{it.item_emoji || '📦'}</td>
                          <td style={{fontWeight:600,fontSize:13}}>{it.item_name}</td>
                          <td className={s.muted} style={{fontSize:11}}>{it.category || '—'}</td>
                          <td style={{fontFamily:'monospace',fontSize:11,color:'var(--muted)'}}>{it.barcode || '—'}</td>
                          <td className={s.bold} style={{color:'var(--gold-l)'}}>{price > 0 ? f(price)+' DT' : '—'}</td>
                          <td style={{fontSize:12,color:'var(--muted)'}}>{cost > 0 ? f(cost)+' DT' : '—'}</td>
                          <td style={{fontSize:12,fontWeight:600,color: margin > 0 ? 'var(--green)' : 'var(--muted)'}}>{margin > 0 ? f(margin)+' DT' : '—'}</td>
                          <td style={{fontWeight:800,fontSize:14,color:qtyColor}}>{qty <= 0 ? 'RUPTURE' : qty}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
            }
          </div>
        </div>
      </div>
    </>
  )
}

// ════════════════ RENTABILITÉ / BÉNÉFICE ════════════════
function ProfitSection({ data }: { data: any }) {
  const p        = data.profit || { revenue:0, cogs:0, netProfit:0, marginPct:0, coveragePct:0 }
  const products: any[] = data.productProfit || []
  const trend:    any[] = data.profitTrend || []
  const val      = data.stockValuation || { totalValue:0, lowStock:[] }
  const [showAll, setShowAll] = useState(false)

  const shown = showAll ? products : products.slice(0, 12)
  const trendMax = Math.max(1, ...trend.map((t:any) => Math.max(+t.revenue||0, +t.netProfit||0)))
  const coverageIncomplete = (p.coveragePct || 0) < 99.5 && (p.revenue || 0) > 0

  const cards = [
    { icon:'💰', val: fmt(p.revenue),  unit:'DT', lbl:"Chiffre d'affaires",    color:'kpiCardGold'   },
    { icon:'📦', val: fmt(p.cogs),     unit:'DT', lbl:'Coût matières',          color:'kpiCardOrange' },
    { icon:'📈', val: fmt(p.netProfit),unit:'DT', lbl:'Bénéfice net',           color: (p.netProfit>=0?'kpiCardGreen':'kpiCardRed') },
    { icon:'🎯', val: (p.marginPct||0).toFixed(1), unit:'%', lbl:'Marge nette', color:'kpiCardBlue'   },
    { icon:'🛡️', val: (p.coveragePct||0).toFixed(0), unit:'%', lbl:'Couverture coût', color:'kpiCardPurple' },
  ]

  return (
    <>
      {/* Header + link to catalog */}
      <div className={s.section}>
        <div className={s.sectionHdr}>
          <div className={s.sectionTitle}><span>💵</span> Rentabilité du jour</div>
          <a href="/catalog" style={{ textDecoration:'none' }}>
            <button className={s.btnIcon} style={{ fontSize:12 }}>🛠️ Gérer les produits &amp; coûts →</button>
          </a>
        </div>

        <div className={s.kpiGrid}>
          {cards.map((c,i) => (
            <div key={i} className={`${s.kpiCard} ${(s as any)[c.color] || s.kpiCardGold}`}>
              <div className={s.kpiIcon}>{c.icon}</div>
              <div className={s.kpiVal}>{c.val}{c.unit && <span> {c.unit}</span>}</div>
              <div className={s.kpiLbl}>{c.lbl}</div>
            </div>
          ))}
        </div>

        {coverageIncomplete && (
          <div style={{ marginTop:12, padding:'10px 14px', borderRadius:10, fontSize:12.5, lineHeight:1.5,
                        background:'rgba(232,136,42,.08)', border:'1px solid rgba(232,136,42,.3)', color:'var(--orange)' }}>
            ⚠️ Couverture coût {Math.round(p.coveragePct)}% : certaines ventes n'ont pas de coût enregistré.
            Le bénéfice affiché est un <b>maximum</b> (le coût manquant est compté comme 0).
            Renseignez les coûts dans <a href="/catalog" style={{ color:'var(--gold-l)' }}>Produits &amp; Coûts</a> pour un chiffre exact sur les ventes futures.
          </div>
        )}
      </div>

      {/* Trend: revenue vs net profit (7 days) */}
      <div className={s.section}>
        <div className={s.chartBox}>
          <div className={s.chartTitle}>
            📊 Bénéfice vs Chiffre d'affaires <span className={s.chartSubtitle}>(7 derniers jours)</span>
          </div>
          <div style={{ display:'flex', gap:16, marginBottom:12, fontSize:11, color:'var(--muted)' }}>
            <span style={{ display:'flex', alignItems:'center', gap:6 }}><span style={{ width:10, height:10, borderRadius:2, background:'var(--gold-l)' }}/> CA</span>
            <span style={{ display:'flex', alignItems:'center', gap:6 }}><span style={{ width:10, height:10, borderRadius:2, background:'var(--green)' }}/> Bénéfice net</span>
          </div>
          <div className={s.barChart}>
            {trend.map((t:any, i:number) => {
              const d   = new Date(t.day + 'T12:00')
              const lbl = d.toLocaleDateString('fr-TN', { weekday:'short', day:'numeric' })
              const revH = Math.round((+t.revenue||0) / trendMax * 100)
              const proH = Math.round(Math.max(0, +t.netProfit||0) / trendMax * 100)
              return (
                <div key={i} className={s.barCol} title={`${t.day} · CA ${f(t.revenue)} DT · Bénéfice ${f(t.netProfit)} DT`}>
                  <div className={s.barVal}>{(+t.netProfit) !== 0 ? f(t.netProfit) : ''}</div>
                  <div className={s.barWrap} style={{ gap:3 }}>
                    <div style={{ flex:1, height:`${Math.max(revH,3)}%`, background:'linear-gradient(180deg,var(--gold-l),var(--gold))', borderRadius:'6px 6px 0 0', minHeight:3 }}/>
                    <div style={{ flex:1, height:`${Math.max(proH,2)}%`, background:(+t.netProfit>=0?'var(--green)':'var(--red)'), borderRadius:'6px 6px 0 0', minHeight:2 }}/>
                  </div>
                  <div className={s.barLbl}>{lbl}</div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Per-product profitability */}
      <div className={s.section}>
        <div className={s.sectionHdr}>
          <div className={s.sectionTitle}><span>🏆</span> Rentabilité par produit</div>
          {products.length > 12 && (
            <button className={s.btnIcon} style={{ fontSize:12 }} onClick={()=>setShowAll(v=>!v)}>
              {showAll ? 'Réduire' : `Voir tout (${products.length})`}
            </button>
          )}
        </div>
        <div className={s.tableWrap}>
          <div className={s.tableScroll}>
            {products.length === 0
              ? <div className={s.empty}><div className={s.emptyIcon}>💵</div><div className={s.emptyText}>Aucune vente ce jour</div></div>
              : <table className={s.table}>
                  <thead><tr>
                    <th>Produit</th><th>Qté</th><th>CA</th><th>Coût</th><th>Bénéfice</th><th>Marge</th><th>Statut</th>
                  </tr></thead>
                  <tbody>
                    {shown.map((pr:any, i:number) => (
                      <tr key={i}>
                        <td style={{ fontWeight:600, fontSize:13 }}>{itemEmoji(pr.name)} {pr.name}</td>
                        <td className={s.muted}>{pr.qty}</td>
                        <td>{f(pr.revenue)} DT</td>
                        <td className={s.muted}>{pr.costKnown ? f(pr.cost)+' DT' : '—'}</td>
                        <td className={s.bold} style={{ color: pr.profit>=0 ? 'var(--green)' : 'var(--red)', whiteSpace:'nowrap' }}>
                          {pr.costKnown ? '' : '≤ '}{f(pr.profit)} DT
                        </td>
                        <td style={{ color: pr.marginPct>=0 ? 'var(--txt)' : 'var(--red)' }}>{(pr.marginPct||0).toFixed(0)}%</td>
                        <td>
                          {pr.costKnown
                            ? <span className={`${s.badge} ${s.badgeActive}`}>coût OK</span>
                            : <span className={`${s.badge} ${s.badgeSuspended}`}>coût inconnu</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
            }
          </div>
        </div>
      </div>

      {/* Stock valuation + low stock */}
      <div className={s.section}>
        <div className={s.sectionHdr}><div className={s.sectionTitle}><span>🏷️</span> Valorisation du stock</div></div>
        <div className={s.kpiGrid}>
          <div className={`${s.kpiCard} ${s.kpiCardGold}`}>
            <div className={s.kpiIcon}>💼</div>
            <div className={s.kpiVal}>{fmt(val.totalValue)}<span> DT</span></div>
            <div className={s.kpiLbl}>Valeur du stock (au coût)</div>
          </div>
          <div className={`${s.kpiCard} ${s.kpiCardOrange}`}>
            <div className={s.kpiIcon}>⚠️</div>
            <div className={s.kpiVal} style={{ color: (val.lowStock?.length||0) > 0 ? 'var(--orange)' : 'var(--txt)' }}>{val.lowStock?.length || 0}</div>
            <div className={s.kpiLbl}>Produits en stock bas</div>
          </div>
        </div>
        {val.lowStock && val.lowStock.length > 0 && (
          <div style={{ marginTop:14 }}>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(150px,1fr))', gap:8 }}>
              {val.lowStock.map((it:any, i:number) => (
                <div key={i} style={{ background:'var(--panel)', border:'1px solid var(--div)', borderLeft:`3px solid ${it.quantity<=0?'var(--red)':'var(--orange)'}`, borderRadius:'var(--radius,9px)', padding:'12px', textAlign:'center' }}>
                  <div style={{ fontSize:22, marginBottom:4 }}>{it.item_emoji || '📦'}</div>
                  <div style={{ fontSize:12, fontWeight:600, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{it.item_name}</div>
                  <div style={{ fontSize:10, color:'var(--muted)', marginBottom:4 }}>{it.category || '—'}</div>
                  <div style={{ fontSize:18, fontWeight:800, color: it.quantity<=0 ? 'var(--red)' : 'var(--orange)' }}>
                    {it.quantity<=0 ? 'RUPTURE' : it.quantity}
                  </div>
                  <div style={{ fontSize:9, color:'var(--muted)' }}>seuil: {it.low_threshold}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
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
      // no-store: this is a live/polled dashboard (30s auto-refresh + manual
      // "Actualiser") — the browser's default heuristic HTTP caching can
      // otherwise serve a stale response for this exact URL+key+date for a
      // while, which silently defeats both the poll and the refresh button.
      const res  = await fetch(`${API}/api/dashboard?date=${d}&key=${apiKey}`, { cache: 'no-store' })
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

  // ── Live table state (table-service clients only) ──────────────────────
  // Independent of the date-scoped `data` above — table state is "right
  // now," not a historical report for a chosen day. Reads the same
  // pos_tables/table_audit_log a table-service POS already cross-till syncs
  // to (see /api/me/tables) — no new backend, just a web view of data that
  // already exists. tablesData stays null (not []) until the first
  // response lands, so the tab doesn't flash into existence and back out.
  const [tablesData, setTablesData] = useState<{ tables: any[]; audit: any[] } | null>(null)
  const loadTables = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/me/tables?key=${apiKey}`, { cache: 'no-store' })
      const d = await res.json()
      if (d.ok) setTablesData({ tables: d.tables || [], audit: d.audit || [] })
    } catch {}
  }, [apiKey])
  useEffect(() => {
    loadTables()
    const id = setInterval(loadTables, 15000) // same cadence the POS's own pullTableSync uses
    return () => clearInterval(id)
  }, [loadTables])

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
    { id:'profit',    label:'💵 Rentabilité'      },
    { id:'products',  label:'🏆 Produits'         },
    { id:'orders',    label:'🧾 Commandes'         },
    { id:'sessions',  label:'🔒 Caisses'           },
    ...(data?.stock && data.stock.length > 0 && data.stock[0]?.category ? [{ id:'stock', label:'📦 Stock' }] : []),
    // Only for table-service clients — tablesData stays null until the
    // first poll answers, and empty ([]) for a client with no tables
    // configured at all, so this tab simply never appears for e.g. La Coupole.
    ...(tablesData && tablesData.tables.length > 0 ? [{ id:'tables', label:'🪑 Tables' }] : []),
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
          <a href="/catalog" className={s.btnIcon} title="Produits & Coûts" style={{ textDecoration:'none' }}>📦</a>
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
            {/* Only the next few actions belong on the home screen. The full
                stock table is available one tap away; showing every zero makes
                the dashboard feel broken before stock has been configured. */}
            {data.stockValuation?.lowStock?.length > 0 && (
              <div className={s.section}>
                <div className={s.sectionHdr}>
                  <div className={s.sectionTitle}><span>📦</span> À réapprovisionner</div>
                  <a href="/stock" className={s.btnIcon} style={{ fontSize:12, textDecoration:'none' }}>Voir le stock →</a>
                </div>
                <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(140px,1fr))', gap:'8px' }}>
                  {data.stockValuation.lowStock.slice(0, 6).map((item: any, i: number) => (
                    <div key={i} style={{ background:'var(--panel)', border:'1px solid var(--div)', borderRadius:'var(--radius)', padding:'14px', textAlign:'center', position:'relative', overflow:'hidden' }}>
                      {item.quantity <= item.low_threshold && <div style={{ position:'absolute', top:0, left:0, right:0, height:'3px', background:'var(--red)' }}/>} 
                      <div style={{ fontSize:'24px', marginBottom:'4px' }}>{item.item_emoji || '🥤'}</div>
                      <div style={{ fontSize:'12px', fontWeight:'600', marginBottom:'4px' }}>{item.item_name}</div>
                      <div style={{ fontSize:'20px', fontWeight:'800', color:'var(--red)' }}>{item.quantity}</div>
                      <div style={{ fontSize:'10px', color:'var(--muted)' }}>seuil {item.low_threshold}</div>
                    </div>
                  ))}
                </div>
                {data.stockValuation.lowStock.length > 6 && <div style={{ marginTop:10, fontSize:12, color:'var(--muted)' }}>+ {data.stockValuation.lowStock.length - 6} autre(s) article(s) à vérifier dans Stock.</div>}
              </div>
            )}
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

          {/* ── RENTABILITÉ ── */}
          {activeTab === 'profit' && <ProfitSection data={data}/>}

          {/* ── PRODUCTS ── */}
          {activeTab === 'products' && <>
            <div className={s.section}>
              <div className={s.sectionHdr}><div className={s.sectionTitle}><span>🏆</span> Articles vendus</div></div>
              <TopProducts products={data.productProfit || []} filter={catFilter} onFilter={setCatFilter}/>
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

          {/* ── STOCK (Retail) ── */}
          {activeTab === 'stock' && data.stock && <>
            <StockSection stock={data.stock} />
          </>}

          {activeTab === 'tables' && tablesData && <>
            <div className={s.section}>
              <div className={s.sectionHdr}><div className={s.sectionTitle}><span>🪑</span> Tables — temps réel</div></div>
              <TablesSection tables={tablesData.tables} audit={tablesData.audit} />
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
    // Theme is applied by the boot script in app/layout.tsx, before first paint.
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

  return (
    <>
      {/* Content clears the fixed bottom bar so the last row is never trapped. */}
      <div style={{ paddingBottom: 'calc(74px + env(safe-area-inset-bottom, 0px))' }}>
        <Dashboard apiKey={apiKey} restInfo={restInfo} onLogout={logout} />
      </div>
      <TabBar active="/dashboard" />
    </>
  )
}

// The black top navbar that used to live here is gone. It scrolled sideways on a
// phone and hid half its items, and it was duplicated inline because theme.css
// sets a light body background that fought this page's dark CSS module.
// ui/TabBar.tsx solves both: one navigation definition, styled inline so it sits
// happily on dark or light, fixed to the bottom where a thumb reaches it.
