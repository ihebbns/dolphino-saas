'use client'
import { useState, useEffect, useCallback } from 'react'
import s from './dashboard.module.css'

const API = process.env.NEXT_PUBLIC_API_URL || 'https://dolphino-saas.vercel.app'
const f   = (n: any) => Number(n).toFixed(3)
const today = () => new Date().toISOString().split('T')[0]

// ════════════════ LOGIN ════════════════
function Login({ onLogin }: { onLogin: (d: any) => void }) {
  const [email,   setEmail]   = useState('')
  const [pass,    setPass]    = useState('')
  const [err,     setErr]     = useState('')
  const [loading, setLoading] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr(''); setLoading(true)
    try {
      const res  = await fetch(`${API}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: pass }),
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
      <form className={s.loginBox} onSubmit={submit}>
        <div className={s.loginLogo}>🐬</div>
        <div className={s.loginBrand}>DOLPHINO</div>
        <div className={s.loginSub}>Dashboard Propriétaire</div>
        <div className={s.formGroup}>
          <label>Email</label>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)}
            placeholder="votre@email.com" required autoComplete="email" />
        </div>
        <div className={s.formGroup}>
          <label>Mot de passe</label>
          <input type="password" value={pass} onChange={e => setPass(e.target.value)}
            placeholder="••••••••" required />
        </div>
        {err && <div className={s.loginErr}>{err}</div>}
        <button className={s.btnLogin} disabled={loading} type="submit">
          {loading ? 'Connexion...' : 'Se connecter'}
        </button>
      </form>
    </div>
  )
}

// ════════════════ DASHBOARD ════════════════
function Dashboard({ apiKey, restInfo, onLogout }: {
  apiKey: string; restInfo: any; onLogout: () => void
}) {
  const [date,    setDate]    = useState(today())
  const [data,    setData]    = useState<any>(null)
  const [syncMsg, setSyncMsg] = useState('Chargement...')
  const [online,  setOnline]  = useState(true)

  const load = useCallback(async (d: string) => {
    setSyncMsg('Actualisation...')
    try {
      const res = await fetch(`${API}/api/dashboard?date=${d}&key=${apiKey}`)
      if (res.status === 401 || res.status === 403) { onLogout(); return }
      const json = await res.json()
      if (!json.ok) { setSyncMsg('Erreur: ' + json.error); return }
      setData(json); setOnline(true)
      setSyncMsg(`Mis à jour: ${new Date().toLocaleTimeString('fr-TN')}`)
    } catch { setOnline(false); setSyncMsg('Hors ligne') }
  }, [apiKey, onLogout])

  useEffect(() => { load(date) }, [date, load])
  useEffect(() => {
    const id = setInterval(() => load(date), 120000)
    return () => clearInterval(id)
  }, [date, load])

  const k = data?.kpis

  return (
    <div>
      {/* Header */}
      <header className={s.hdr}>
        <div className={s.hdrBrand}>
          <div className={s.hdrLogo}>D</div>
          <div>
            <div className={s.hdrName}>{restInfo.name}</div>
            <div className={s.hdrCity}>{restInfo.city}</div>
          </div>
        </div>
        <div className={s.hdrRight}>
          <input type="date" className={s.datePick} value={date}
            max={today()} onChange={e => setDate(e.target.value)} />
          <button className={s.btnRefresh} onClick={() => load(date)}>↻</button>
          <button className={s.btnLogout}  onClick={onLogout}>Déconnecter</button>
        </div>
      </header>

      {/* Sync bar */}
      <div className={s.syncBar}>
        <div className={`${s.syncDot} ${online ? s.green : s.red}`} />
        <span>{syncMsg}</span>
      </div>

      {/* Content */}
      <div className={s.content}>
        {!data
          ? <div className={s.loading}>⏳ Chargement...</div>
          : <>
            {/* Date title */}
            <div className={s.sectionTitle}>
              📊 {new Date(date + 'T12:00').toLocaleDateString('fr-TN', {
                weekday:'long', day:'numeric', month:'long', year:'numeric'
              })}
            </div>

            {/* KPIs */}
            <div className={s.kpiGrid}>
              <div className={s.kpi}>
                <div className={s.kpiVal}>{f(k.total_revenue)} <span>DT</span></div>
                <div className={s.kpiLbl}>Total encaissé</div>
              </div>
              <div className={`${s.kpi} ${s.green}`}>
                <div className={s.kpiVal}>{k.total_orders}</div>
                <div className={s.kpiLbl}>Commandes</div>
              </div>
              <div className={s.kpi}>
                <div className={s.kpiVal}>{f(k.avg_ticket)} <span>DT</span></div>
                <div className={s.kpiLbl}>Ticket moyen</div>
              </div>
              <div className={`${s.kpi} ${s.orange}`}>
                <div className={s.kpiVal}>{f(k.cash_total)} <span>DT</span></div>
                <div className={s.kpiLbl}>Espèces</div>
              </div>
              <div className={`${s.kpi} ${s.blue}`}>
                <div className={s.kpiVal}>{f(+k.card_total + +k.mobile_total)} <span>DT</span></div>
                <div className={s.kpiLbl}>Carte / Mobile</div>
              </div>
              <div className={s.kpi}>
                <div className={s.kpiVal}>{k.sur_place}</div>
                <div className={s.kpiLbl}>Sur place</div>
                <div className={s.kpiSub}>{k.emporter} emporter · {k.livraison} livraison</div>
              </div>
            </div>

            {/* Weekly bar chart */}
            <div className={s.sectionTitle}>📈 7 derniers jours</div>
            <div className={s.chartBox}>
              <div className={s.chartTitle}>Ventes (DT)</div>
              <div className={s.barChart}>
                {(() => {
                  const max = Math.max(...data.weekly.map((r: any) => +r.revenue), 1)
                  return data.weekly.map((r: any, i: number) => {
                    const d   = new Date(r.day + 'T12:00')
                    const lbl = d.toLocaleDateString('fr-TN', { weekday:'short', day:'numeric' })
                    const pct = Math.round(+r.revenue / max * 100)
                    return (
                      <div key={i} className={s.barCol}>
                        <div className={s.barVal}>{f(r.revenue)}</div>
                        <div className={s.barWrap}>
                          <div className={s.bar} style={{ height: `${Math.max(pct,3)}%` }} />
                        </div>
                        <div className={s.barLbl}>{lbl}</div>
                      </div>
                    )
                  })
                })()}
              </div>
            </div>

            {/* Top items */}
            <div className={s.sectionTitle}>🏆 Articles les plus vendus</div>
            <div className={s.chartBox}>
              {data.topItems.length === 0
                ? <div className={s.noData}>Aucune vente ce jour</div>
                : (() => {
                    const max = data.topItems[0]?.qty || 1
                    return data.topItems.map((it: any, i: number) => (
                      <div key={i} className={s.topItem}>
                        <div className={s.topName}>{it.name}</div>
                        <div className={s.topBarWrap}>
                          <div className={s.topBar} style={{ width:`${Math.round(it.qty/max*100)}%` }} />
                        </div>
                        <div className={s.topQty}>{it.qty}</div>
                      </div>
                    ))
                  })()
              }
            </div>

            {/* Sales table */}
            <div className={s.sectionTitle}>🧾 Commandes du jour</div>
            <div className={s.tableWrap}>
              {data.recent.length === 0
                ? <div className={s.noData}>Aucune commande ce jour</div>
                : <table className={s.table}>
                    <thead><tr>
                      <th>#</th><th>Heure</th><th>Type</th>
                      <th>Articles</th><th>Total</th><th>Paiement</th>
                    </tr></thead>
                    <tbody>
                      {data.recent.map((r: any, i: number) => (
                        <tr key={i}>
                          <td className={s.num}>#{String(r.num).padStart(3,'0')}</td>
                          <td className={s.muted}>{r.sale_time}</td>
                          <td><span className={`${s.badge} ${(s as any)['b_'+r.order_type]}`}>
                            {({place:'🏠 Place',take:'🥡 Emporter',del:'🛵 Livraison'} as any)[r.order_type]}
                          </span></td>
                          <td>{r.item_count} art.{r.disc_pct>0?` -${r.disc_pct}%`:''}</td>
                          <td className={s.bold}>{f(r.grand)} DT</td>
                          <td><span className={`${s.badge} ${(s as any)['b_'+r.pay_method]}`}>
                            {({cash:'💵 Espèces',card:'💳 Carte',mob:'📱 Mobile'} as any)[r.pay_method]}
                          </span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
              }
            </div>

            {/* Sessions / Closures history */}
            {data.sessions && data.sessions.length > 0 && <>
              <div className={s.sectionTitle}>🔒 Historique des clôtures</div>
              <div className={s.tableWrap} style={{marginBottom:'40px'}}>
                <table className={s.table}>
                  <thead><tr>
                    <th>Date</th><th>Caissier</th><th>Ventes</th>
                    <th>Espèces</th><th>Fond initial</th><th>Théorique</th><th>Compté</th><th>Écart</th>
                  </tr></thead>
                  <tbody>
                    {data.sessions.map((r: any, i: number) => {
                      const ecart = parseFloat(r.ecart)
                      const ecartOk = ecart >= 0
                      return (
                        <tr key={i}>
                          <td className={s.muted}>{r.day}</td>
                          <td>{r.cashier}</td>
                          <td className={s.bold}>{f(r.total_sales)} DT</td>
                          <td>{f(r.cash_sales)} DT</td>
                          <td>{f(r.fond_initial)} DT</td>
                          <td style={{color:'var(--gold-l)',fontWeight:700}}>{f(r.theorique)} DT</td>
                          <td>{r.montant_compte != null ? f(r.montant_compte)+' DT' : '—'}</td>
                          <td style={{fontWeight:700, color: r.ecart == null ? 'var(--muted)' : ecartOk ? 'var(--green)' : 'var(--red)'}}>
                            {r.ecart != null ? (ecartOk?'+':'')+f(r.ecart)+' DT' : '—'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </>}
          </>
        }
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
  }, [])

  function logout() {
    localStorage.clear()
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
