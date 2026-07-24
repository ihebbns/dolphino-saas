'use client'
// ═══════════════════════════════════════════════════
// /credits — CRÉANCES CLIENTS (ardoises)
//
// Read-only view of money owed to the owner. The EXE owns credit (an ardoise is
// opened, charged and settled at the counter), so nothing here writes back —
// see ARCHITECTURE.md §2.
//
// Until now this data existed ONLY in one till's localStorage. If that machine
// died the record of who owed money was gone. This page is the reason it is now
// pushed to the cloud.
// ═══════════════════════════════════════════════════
import { useState, useEffect, useMemo } from 'react'

const API = process.env.NEXT_PUBLIC_API_URL || 'https://servio.tn'

type Client = {
  client_key: string
  name: string
  phone: string
  balance: number
  balance_derived: number
  drift: number
  nb_credits: number
  nb_payments: number
  total_pris: number
  total_regle: number
  last_movement_at: string | null
  archived: boolean
}
type Movement = {
  id: number
  client_key: string
  name: string
  kind: string
  delta: number
  pay_method: string
  items_summary: string
  sale_num: number | null
  reason: string
  actor: string
  client_ts: string
}

const f3 = (n: any) => Number(n || 0).toFixed(3)
const dt = (s: string | null) => {
  if (!s) return '—'
  const d = new Date(s)
  return isNaN(d.getTime()) ? '—' : d.toLocaleString('fr-TN', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
}
/** Days since the last movement — the number that tells you who to chase. */
const daysSince = (s: string | null) => {
  if (!s) return null
  const t = new Date(s).getTime()
  if (isNaN(t)) return null
  return Math.floor((Date.now() - t) / 86400000)
}

export default function CreditsPage() {
  const [apiKey, setApiKey] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [ready, setReady] = useState(true)
  const [note, setNote] = useState('')
  const [restName, setRestName] = useState('')
  const [clients, setClients] = useState<Client[]>([])
  const [movements, setMovements] = useState<Movement[]>([])
  const [totals, setTotals] = useState<any>(null)
  const [search, setSearch] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [selected, setSelected] = useState<Client | null>(null)

  useEffect(() => {
    const k = localStorage.getItem('d_api_key')
    if (!k) { setLoading(false); return }
    setApiKey(k); load(k)
  }, [])

  async function load(k: string) {
    setLoading(true); setNote('')
    try {
      const res = await fetch(`${API}/api/me/credits?key=${encodeURIComponent(k)}`)
      const d = await res.json()
      if (d.ok) {
        setReady(d.ready !== false)
        setRestName(d.name || '')
        setClients(d.clients || [])
        setMovements(d.movements || [])
        setTotals(d.totals || null)
        if (d.note) setNote(d.note)
      } else setNote(d.error || 'Erreur de chargement')
    } catch { setNote('Impossible de contacter le serveur.') }
    setLoading(false)
  }

  const filtered = useMemo(() => {
    let out = clients.filter(c => showArchived ? true : !c.archived)
    if (search) {
      const q = search.toLowerCase()
      out = out.filter(c => c.name?.toLowerCase().includes(q) || (c.phone || '').includes(q))
    }
    return out
  }, [clients, search, showArchived])

  // A till whose cached balance disagrees with its own history is worth a look.
  const drifting = clients.filter(c => Math.abs(c.drift || 0) > 0.001)
  // A fiche deleted at the till while money was still owed.
  const archivedOwing = clients.filter(c => c.archived && c.balance > 0)

  if (loading) return <div style={S.wrap}><div style={S.box}>Chargement…</div></div>

  if (!apiKey) return (
    <div style={S.wrap}>
      <div style={{ ...S.box, textAlign: 'center', maxWidth: 420 }}>
        <div style={{ fontSize: 34 }}>🔒</div>
        <h1 style={S.brand}>Connexion requise</h1>
        <p style={{ color: '#7A6E5F', fontSize: 13, marginBottom: 16 }}>Connectez-vous pour voir les créances clients.</p>
        <a href="/dashboard" style={{ ...S.btn, display: 'block', textDecoration: 'none' }}>Se connecter →</a>
      </div>
    </div>
  )

  return (
    <div style={S.wrap}>
      <div style={{ ...S.box, maxWidth: 1100 }}>
        <div style={S.headRow}>
          <h1 style={S.brand}>📒 Créances clients</h1>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <a href="/dashboard" style={S.link}>← Tableau de bord</a>
            <button style={S.btnGhost} onClick={() => apiKey && load(apiKey)}>↻ Recharger</button>
          </div>
        </div>
        <p style={{ color: '#7A6E5F', fontSize: 13, margin: '0 0 14px' }}>
          {restName ? restName + ' — ' : ''}Argent qui vous est dû. Les ardoises se gèrent dans la caisse ; cette page est en lecture seule.
        </p>

        {!ready && (
          <div style={S.warn}>
            ⚠ Tables crédit non initialisées. Exécutez <code style={S.code}>migration-credits.sql</code> dans Neon,
            puis les caisses enverront leurs ardoises automatiquement.
          </div>
        )}
        {note && ready && <div style={S.info}>{note}</div>}

        {/* KPIs */}
        <div style={S.statRow}>
          <div style={S.stat}>
            <div style={{ ...S.statVal, color: '#E05252' }}>{f3(totals?.total_creances)} DT</div>
            <div style={S.statLbl}>Total dû</div>
          </div>
          <div style={S.stat}>
            <div style={S.statVal}>{totals?.nb_debiteurs ?? 0}</div>
            <div style={S.statLbl}>Clients qui doivent</div>
          </div>
          <div style={S.stat}>
            <div style={S.statVal}>{totals?.nb_clients ?? 0}</div>
            <div style={S.statLbl}>Fiches actives</div>
          </div>
          {(totals?.nb_archives_avec_dette ?? 0) > 0 && (
            <div style={{ ...S.stat, borderColor: 'rgba(224,82,82,.4)' }}>
              <div style={{ ...S.statVal, color: '#E05252' }}>{f3(totals?.creances_archivees)} DT</div>
              <div style={S.statLbl}>Supprimées avec dette</div>
            </div>
          )}
        </div>

        {/* Findings the owner should act on */}
        {archivedOwing.length > 0 && (
          <div style={S.alert}>
            <strong>⚠ {archivedOwing.length} fiche(s) supprimée(s) à la caisse alors qu'il restait une dette.</strong>
            <div style={{ fontSize: 12, marginTop: 6, lineHeight: 1.6 }}>
              {archivedOwing.map(c => <div key={c.client_key}>• {c.name} — {f3(c.balance)} DT</div>)}
            </div>
          </div>
        )}
        {drifting.length > 0 && (
          <div style={S.alert}>
            <strong>⚠ {drifting.length} solde(s) incohérent(s).</strong>
            <div style={{ fontSize: 12, marginTop: 6, lineHeight: 1.6 }}>
              Le solde annoncé par la caisse ne correspond pas à son propre historique.
              {drifting.map(c => (
                <div key={c.client_key}>
                  • {c.name} — caisse {f3(c.balance)} DT, historique {f3(c.balance_derived)} DT
                  <span style={{ color: '#E05252', fontWeight: 700 }}> (écart {f3(c.drift)})</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Filters */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', margin: '16px 0 10px' }}>
          <input style={{ ...S.inp, maxWidth: 280 }} placeholder="🔍 Nom ou téléphone…" value={search} onChange={e => setSearch(e.target.value)} />
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#7A6E5F', cursor: 'pointer' }}>
            <input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} />
            Afficher les fiches supprimées
          </label>
          <span style={{ fontSize: 12, color: '#7A6E5F', marginLeft: 'auto' }}>{filtered.length} client{filtered.length !== 1 ? 's' : ''}</span>
        </div>

        {/* Clients */}
        <div style={S.tableWrap}>
          <table style={S.table}>
            <thead>
              <tr>
                <th style={S.th}>Client</th>
                <th style={{ ...S.th, textAlign: 'right' }}>Doit</th>
                <th style={{ ...S.th, textAlign: 'right' }}>Total pris</th>
                <th style={{ ...S.th, textAlign: 'right' }}>Total réglé</th>
                <th style={S.th}>Dernier mouvement</th>
                <th style={S.th}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={6} style={{ textAlign: 'center', color: '#7A6E5F', padding: 30 }}>Aucune ardoise</td></tr>
              ) : filtered.map(c => {
                const d = daysSince(c.last_movement_at)
                const stale = c.balance > 0 && d !== null && d >= 30
                return (
                  <tr key={c.client_key} style={c.archived ? { opacity: .55 } : undefined}>
                    <td style={S.td}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={S.avatar}>{(c.name || '?').charAt(0).toUpperCase()}</div>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 13 }}>
                            {c.name}
                            {c.archived && <span style={S.tag}>SUPPRIMÉE</span>}
                          </div>
                          <div style={{ fontSize: 10, color: '#7A6E5F' }}>{c.phone || '—'}</div>
                        </div>
                      </div>
                    </td>
                    <td style={{ ...S.td, textAlign: 'right', fontWeight: 800, color: c.balance > 0 ? '#E05252' : '#3DB87A', whiteSpace: 'nowrap' }}>
                      {f3(c.balance)} DT
                    </td>
                    <td style={{ ...S.td, textAlign: 'right', color: '#7A6E5F' }}>{f3(c.total_pris)}</td>
                    <td style={{ ...S.td, textAlign: 'right', color: '#7A6E5F' }}>{f3(c.total_regle)}</td>
                    <td style={{ ...S.td, whiteSpace: 'nowrap' }}>
                      {dt(c.last_movement_at)}
                      {stale && <div style={{ fontSize: 10, color: '#E8A84C' }}>⏳ {d} jours sans mouvement</div>}
                    </td>
                    <td style={{ ...S.td, textAlign: 'right' }}>
                      <button style={S.btnGhost} onClick={() => setSelected(c)}>Historique →</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Recent movements across all clients */}
        <div style={{ fontSize: 12, color: '#7A6E5F', fontWeight: 600, margin: '22px 0 8px', textTransform: 'uppercase', letterSpacing: '.5px' }}>
          Derniers mouvements
        </div>
        <div style={S.tableWrap}>
          <table style={S.table}>
            <thead>
              <tr>
                <th style={S.th}>Date</th>
                <th style={S.th}>Client</th>
                <th style={S.th}>Type</th>
                <th style={{ ...S.th, textAlign: 'right' }}>Montant</th>
                <th style={S.th}>Détail</th>
                <th style={S.th}>Par</th>
              </tr>
            </thead>
            <tbody>
              {movements.length === 0 ? (
                <tr><td colSpan={6} style={{ textAlign: 'center', color: '#7A6E5F', padding: 24 }}>Aucun mouvement</td></tr>
              ) : movements.slice(0, 80).map(m => (
                <tr key={m.id}>
                  <td style={{ ...S.td, whiteSpace: 'nowrap', color: '#7A6E5F', fontSize: 12 }}>{dt(m.client_ts)}</td>
                  <td style={S.td}>{m.name || m.client_key}</td>
                  <td style={S.td}>
                    <span style={{ ...S.badge, ...(m.kind === 'payment' ? S.bPay : m.kind === 'credit' ? S.bCredit : S.bAdj) }}>
                      {m.kind === 'payment' ? '💵 Règlement' : m.kind === 'credit' ? '📒 À crédit' : '✏️ Correction'}
                      {m.kind === 'payment' && m.pay_method === 'card' ? ' (carte)' : ''}
                    </span>
                  </td>
                  <td style={{ ...S.td, textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap', color: m.delta > 0 ? '#E05252' : '#3DB87A' }}>
                    {m.delta > 0 ? '+' : '−'}{f3(Math.abs(m.delta))} DT
                  </td>
                  <td style={{ ...S.td, fontSize: 11, color: '#7A6E5F', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {m.items_summary || m.reason || (m.sale_num ? '#' + String(m.sale_num).padStart(3, '0') : '—')}
                  </td>
                  <td style={{ ...S.td, fontSize: 11, color: '#7A6E5F' }}>{m.actor || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p style={{ fontSize: 11, color: '#7A6E5F', textAlign: 'center', marginTop: 16 }}>
          Les ardoises se créent et se règlent dans la caisse. Cette page reflète ce que les caisses ont envoyé.
        </p>
      </div>

      {/* Per-client history */}
      {selected && (
        <div onClick={() => setSelected(null)} style={S.overlay}>
          <div onClick={e => e.stopPropagation()} style={S.modal}>
            <div style={S.headRow}>
              <div>
                <div style={{ fontSize: 20, fontWeight: 800, color: '#E8A84C' }}>{selected.name}</div>
                <div style={{ fontSize: 12, color: '#7A6E5F' }}>{selected.phone || '—'}</div>
              </div>
              <button style={S.btnGhost} onClick={() => setSelected(null)}>✕ Fermer</button>
            </div>
            <div style={{ ...S.statRow, marginTop: 14 }}>
              <div style={S.stat}>
                <div style={{ ...S.statVal, color: selected.balance > 0 ? '#E05252' : '#3DB87A' }}>{f3(selected.balance)} DT</div>
                <div style={S.statLbl}>Solde</div>
              </div>
              <div style={S.stat}><div style={S.statVal}>{f3(selected.total_pris)}</div><div style={S.statLbl}>Total pris</div></div>
              <div style={S.stat}><div style={S.statVal}>{f3(selected.total_regle)}</div><div style={S.statLbl}>Total réglé</div></div>
            </div>
            <div style={{ maxHeight: 320, overflowY: 'auto', marginTop: 14 }}>
              {movements.filter(m => m.client_key === selected.client_key).length === 0 ? (
                <div style={{ textAlign: 'center', color: '#7A6E5F', padding: 20, fontSize: 13 }}>
                  Aucun mouvement reçu pour ce client.
                </div>
              ) : movements.filter(m => m.client_key === selected.client_key).map(m => (
                <div key={m.id} style={S.movRow}>
                  <span style={{ color: '#7A6E5F', fontSize: 11, width: 110 }}>{dt(m.client_ts)}</span>
                  <span style={{ flex: 1, fontSize: 11 }}>
                    {m.kind === 'payment' ? '💵 Règlement' : m.kind === 'credit' ? '📒 À crédit' : '✏️ Correction'}
                    {m.items_summary ? <span style={{ color: '#7A6E5F' }}> — {m.items_summary}</span> : null}
                  </span>
                  <span style={{ fontWeight: 700, color: m.delta > 0 ? '#E05252' : '#3DB87A', whiteSpace: 'nowrap' }}>
                    {m.delta > 0 ? '+' : '−'}{f3(Math.abs(m.delta))}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const S: Record<string, React.CSSProperties> = {
  wrap: { minHeight: '100vh', background: 'radial-gradient(circle at 30% 20%,rgba(245,158,11,.08),transparent 55%),#0A0704', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 20, fontFamily: 'system-ui,sans-serif', color: '#F0E8D8' },
  box: { background: '#0F0C08', border: '1px solid #231C12', borderRadius: 16, padding: 28, width: '100%', maxWidth: 1100, boxShadow: '0 24px 60px rgba(0,0,0,.5)' },
  headRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, flexWrap: 'wrap', gap: 8 },
  brand: { fontSize: 22, fontWeight: 800, color: '#E8A84C', margin: 0 },
  link: { color: '#E8A84C', fontSize: 13, textDecoration: 'none' },
  info: { background: '#161210', border: '1px solid #231C12', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: '#F0E8D8', margin: '12px 0' },
  warn: { background: 'rgba(232,168,76,.08)', border: '1px solid rgba(232,168,76,.4)', borderRadius: 10, padding: '12px 14px', fontSize: 12.5, lineHeight: 1.6, color: '#E8C99A', marginBottom: 14 },
  alert: { background: 'rgba(224,82,82,.08)', border: '1px solid rgba(224,82,82,.4)', borderRadius: 10, padding: '12px 14px', fontSize: 13, color: '#F0E8D8', marginTop: 12 },
  code: { background: '#231C12', padding: '1px 6px', borderRadius: 4, fontFamily: 'monospace', fontSize: 12 },
  statRow: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 10, marginTop: 12 },
  stat: { background: '#161210', border: '1px solid #231C12', borderRadius: 10, padding: '12px 14px', textAlign: 'center' },
  statVal: { fontSize: 20, fontWeight: 800, color: '#F0E8D8' },
  statLbl: { fontSize: 11, color: '#7A6E5F', marginTop: 2, textTransform: 'uppercase', letterSpacing: '.5px' },
  inp: { background: '#161210', border: '1px solid #231C12', borderRadius: 7, padding: '9px 12px', color: '#F0E8D8', fontSize: 13, outline: 'none', width: '100%' },
  tableWrap: { border: '1px solid #231C12', borderRadius: 12, overflow: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: { textAlign: 'left', color: '#7A6E5F', fontWeight: 600, padding: '11px 12px', borderBottom: '1px solid #231C12', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.5px', background: '#161210', whiteSpace: 'nowrap', position: 'sticky', top: 0 },
  td: { padding: '9px 12px', borderBottom: '1px solid #1A140D', verticalAlign: 'middle' },
  avatar: { width: 32, height: 32, borderRadius: '50%', background: 'rgba(245,158,11,.15)', color: '#E8A84C', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 13, flexShrink: 0 },
  tag: { fontSize: 9, color: '#E05252', marginLeft: 6, letterSpacing: '.5px', fontWeight: 700 },
  badge: { display: 'inline-block', padding: '3px 9px', borderRadius: 20, fontSize: 10.5, fontWeight: 600, whiteSpace: 'nowrap' },
  bCredit: { background: 'rgba(224,82,82,.12)', color: '#E05252' },
  bPay: { background: 'rgba(61,184,122,.12)', color: '#3DB87A' },
  bAdj: { background: 'rgba(122,110,95,.15)', color: '#7A6E5F' },
  btn: { width: '100%', padding: 14, border: 'none', borderRadius: 8, fontSize: 15, fontWeight: 700, cursor: 'pointer', background: 'linear-gradient(135deg,#C8913A,#E8A84C)', color: '#080604', marginTop: 16 },
  btnGhost: { padding: '7px 12px', border: '1px solid #231C12', borderRadius: 7, background: '#161210', color: '#7A6E5F', fontSize: 12, fontWeight: 600, cursor: 'pointer' },
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(4px)', padding: 20 },
  modal: { background: '#0F0C08', border: '1px solid #231C12', borderRadius: 16, padding: 24, width: '100%', maxWidth: 560, maxHeight: '85vh', overflowY: 'auto', boxShadow: '0 24px 60px rgba(0,0,0,.6)' },
  movRow: { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid #1A140D' },
}
