'use client'
// ═══════════════════════════════════════════════════════════════════
// /credits — CRÉANCES CLIENTS (ardoises)
//
// Read-only. The caisse owns credit: an ardoise is opened, charged and settled
// at the counter. This page exists because that data used to live only in one
// till's localStorage — if the machine died, the record of who owed money was
// gone and it was invisible from the web.
//
// Two panels surface findings rather than raw rows: fiches deleted at the till
// while money was still owed, and balances where a till disagrees with its own
// movement history.
// ═══════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useState } from 'react'
import { Shell, LoginGate, NotReady, Loading, Empty, useApiKey, apiGet, f3, dt, daysSince } from '../ui/Shell'

type Client = {
  client_key: string; name: string; phone: string
  balance: number; balance_derived: number; drift: number
  nb_credits: number; nb_payments: number
  total_pris: number; total_regle: number
  last_movement_at: string | null; archived: boolean
}
type Movement = {
  id: number; client_key: string; name: string; kind: string
  delta: number; pay_method: string; items_summary: string
  sale_num: number | null; reason: string; actor: string; client_ts: string
}

export default function CreditsPage() {
  const { key, checked } = useApiKey()
  const [loading, setLoading] = useState(true)
  const [ready, setReady] = useState(true)
  const [msg, setMsg] = useState('')
  const [restName, setRestName] = useState('')
  const [clients, setClients] = useState<Client[]>([])
  const [movements, setMovements] = useState<Movement[]>([])
  const [totals, setTotals] = useState<any>(null)
  const [search, setSearch] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [sel, setSel] = useState<Client | null>(null)

  useEffect(() => {
    if (key) load(key)
    else if (checked) setLoading(false)
  }, [key, checked])

  async function load(k: string) {
    setLoading(true); setMsg('')
    const d = await apiGet('/api/me/credits', k)
    if (d.ok) {
      setReady(d.ready !== false)
      setRestName(d.name || '')
      setClients(d.clients || [])
      setMovements(d.movements || [])
      setTotals(d.totals || null)
    } else setMsg(d.error || 'Erreur de chargement')
    setLoading(false)
  }

  const filtered = useMemo(() => {
    let out = clients.filter(c => (showArchived ? true : !c.archived))
    if (search) {
      const q = search.toLowerCase()
      out = out.filter(c => (c.name || '').toLowerCase().includes(q) || (c.phone || '').includes(q))
    }
    return out
  }, [clients, search, showArchived])

  const drifting = clients.filter(c => Math.abs(c.drift || 0) > 0.001)
  const archivedOwing = clients.filter(c => c.archived && c.balance > 0)
  const stale = clients.filter(c => !c.archived && c.balance > 0 && (daysSince(c.last_movement_at) ?? 0) >= 30)

  if (!checked || loading) {
    return <Shell active="/credits" title="Créances clients" restName={restName}><Loading /></Shell>
  }
  if (!key) return <LoginGate />

  return (
    <Shell
      active="/credits"
      title="Créances clients"
      subtitle="Argent qui vous est dû — les ardoises se gèrent à la caisse"
      restName={restName}
      badges={{ '/credits': totals?.nb_debiteurs ?? 0 }}
      actions={<button className="btn" onClick={() => key && load(key)}>↻ Recharger</button>}
    >
      {!ready && <NotReady sql="migration-credits.sql" />}
      {msg && <div className="notice nDanger"><span className="noticeIcon">✕</span><div>{msg}</div></div>}

      <div className="statGrid mb20">
        <div className="stat">
          <div className="statLabel">Total dû</div>
          <div className="statValue num" style={{ color: (totals?.total_creances ?? 0) > 0 ? 'var(--danger)' : 'var(--ok)' }}>
            {f3(totals?.total_creances)} DT
          </div>
        </div>
        <div className="stat">
          <div className="statLabel">Clients qui doivent</div>
          <div className="statValue num">{totals?.nb_debiteurs ?? 0}</div>
          <div className="statHint">sur {totals?.nb_clients ?? 0} fiches</div>
        </div>
        <div className="stat">
          <div className="statLabel">Dettes dormantes</div>
          <div className="statValue num" style={{ color: stale.length ? 'var(--warn)' : 'var(--ok)' }}>{stale.length}</div>
          <div className="statHint">30 jours sans mouvement</div>
        </div>
        {(totals?.nb_archives_avec_dette ?? 0) > 0 && (
          <div className="stat" style={{ borderColor: 'var(--danger-line)' }}>
            <div className="statLabel">Supprimées avec dette</div>
            <div className="statValue num cDanger">{f3(totals?.creances_archivees)} DT</div>
            <div className="statHint">{totals.nb_archives_avec_dette} fiche(s)</div>
          </div>
        )}
      </div>

      {archivedOwing.length > 0 && (
        <div className="notice nDanger">
          <span className="noticeIcon">⚠</span>
          <div>
            <div className="noticeTitle">
              {archivedOwing.length} fiche(s) supprimée(s) à la caisse alors qu&apos;une dette restait
            </div>
            {archivedOwing.map(c => (
              <div key={c.client_key}>• {c.name} — {f3(c.balance)} DT</div>
            ))}
          </div>
        </div>
      )}

      {drifting.length > 0 && (
        <div className="notice nWarn">
          <span className="noticeIcon">⚠</span>
          <div>
            <div className="noticeTitle">{drifting.length} solde(s) incohérent(s)</div>
            Le solde annoncé par la caisse ne correspond pas à son propre historique.
            {drifting.map(c => (
              <div key={c.client_key}>
                • {c.name} — caisse {f3(c.balance)}, historique {f3(c.balance_derived)}
                <span className="cDanger strong"> (écart {f3(c.drift)})</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="toolbar">
        <input
          className="input" style={{ maxWidth: 300 }}
          placeholder="🔍 Nom ou téléphone…" value={search} onChange={e => setSearch(e.target.value)}
        />
        <button className="chip" data-on={showArchived} onClick={() => setShowArchived(!showArchived)}>
          Fiches supprimées
        </button>
        <span className="spacer t12 cMuted">{filtered.length} client{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      <div className="card mb20">
        <div className="tableWrap">
          <table className="t">
            <thead>
              <tr>
                <th>Client</th>
                <th className="tr">Doit</th>
                <th className="tr">Total pris</th>
                <th className="tr">Total réglé</th>
                <th>Dernier mouvement</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={6}><Empty icon="📒" text="Aucune ardoise" /></td></tr>
              ) : filtered.map(c => {
                const d = daysSince(c.last_movement_at)
                const isStale = c.balance > 0 && d !== null && d >= 30
                return (
                  <tr key={c.client_key} style={c.archived ? { opacity: .55 } : undefined}>
                    <td>
                      <div className="row">
                        <div className="avatar">{(c.name || '?').charAt(0).toUpperCase()}</div>
                        <div>
                          <div className="strong">
                            {c.name}
                            {c.archived && <span className="badge bDanger" style={{ marginLeft: 6 }}>supprimée</span>}
                          </div>
                          <div className="t11 cFaint">{c.phone || '—'}</div>
                        </div>
                      </div>
                    </td>
                    <td data-label="Doit" className="tr num nowrap bold" style={{ color: c.balance > 0 ? 'var(--danger)' : 'var(--ok)' }}>
                      {f3(c.balance)} DT
                    </td>
                    <td data-label="Total pris" className="tr num cMuted">{f3(c.total_pris)}</td>
                    <td data-label="Total réglé" className="tr num cMuted">{f3(c.total_regle)}</td>
                    <td data-label="Dernier mouvement" className="nowrap">
                      <div className="t13">{dt(c.last_movement_at)}</div>
                      {isStale && <div className="t11 cWarn">⏳ {d} jours sans mouvement</div>}
                    </td>
                    <td className="tr">
                      <button className="btn btnSm" onClick={() => setSel(c)}>Historique →</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="cardHead"><div className="cardTitle">Derniers mouvements</div></div>
        <div className="tableWrap">
          <table className="t">
            <thead>
              <tr>
                <th>Date</th><th>Client</th><th>Type</th>
                <th className="tr">Montant</th><th>Détail</th><th>Par</th>
              </tr>
            </thead>
            <tbody>
              {movements.length === 0 ? (
                <tr><td colSpan={6}><Empty icon="🧾" text="Aucun mouvement reçu" /></td></tr>
              ) : movements.slice(0, 80).map(m => (
                <tr key={m.id}>
                  <td className="t12 cMuted nowrap">{dt(m.client_ts)}</td>
                  <td data-label="Client">{m.name || m.client_key}</td>
                  <td data-label="Type">
                    <span className={'badge ' + (m.kind === 'payment' ? 'bOk' : m.kind === 'credit' ? 'bDanger' : 'bNeutral')}>
                      {m.kind === 'payment'
                        ? '💵 Règlement' + (m.pay_method === 'card' ? ' (carte)' : '')
                        : m.kind === 'credit' ? '📒 À crédit' : '✏️ Correction'}
                    </span>
                  </td>
                  <td data-label="Montant" className="tr num nowrap bold" style={{ color: m.delta > 0 ? 'var(--danger)' : 'var(--ok)' }}>
                    {m.delta > 0 ? '+' : '−'}{f3(Math.abs(m.delta))}
                  </td>
                  <td data-label="Détail" className="t12 cMuted" style={{ maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {m.items_summary || m.reason || (m.sale_num ? '#' + String(m.sale_num).padStart(3, '0') : '—')}
                  </td>
                  <td data-label="Par" className="t12 cMuted">{m.actor || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {sel && (
        <div className="overlay" onClick={() => setSel(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modalHead">
              <div className="avatar">{(sel.name || '?').charAt(0).toUpperCase()}</div>
              <div>
                <div className="modalTitle">{sel.name}</div>
                <div className="t12 cMuted">{sel.phone || '—'}</div>
              </div>
              <button className="btn btnGhost btnSm spacer" onClick={() => setSel(null)}>✕</button>
            </div>
            <div className="modalBody">
              <div className="statGrid mb20">
                <div className="stat">
                  <div className="statLabel">Solde</div>
                  <div className="statValue num" style={{ color: sel.balance > 0 ? 'var(--danger)' : 'var(--ok)' }}>
                    {f3(sel.balance)} DT
                  </div>
                </div>
                <div className="stat">
                  <div className="statLabel">Total pris</div>
                  <div className="statValue num">{f3(sel.total_pris)}</div>
                </div>
                <div className="stat">
                  <div className="statLabel">Total réglé</div>
                  <div className="statValue num">{f3(sel.total_regle)}</div>
                </div>
              </div>
              {movements.filter(m => m.client_key === sel.client_key).length === 0 ? (
                <Empty icon="🧾" text="Aucun mouvement reçu pour ce client" />
              ) : (
                <table className="t">
                  <thead><tr><th>Date</th><th>Type</th><th className="tr">Montant</th></tr></thead>
                  <tbody>
                    {movements.filter(m => m.client_key === sel.client_key).map(m => (
                      <tr key={m.id}>
                        <td className="t12 cMuted nowrap">{dt(m.client_ts)}</td>
                        <td data-label="Type" className="t12">
                          {m.kind === 'payment' ? '💵 Règlement' : m.kind === 'credit' ? '📒 À crédit' : '✏️ Correction'}
                          {m.items_summary ? <span className="cFaint"> — {m.items_summary}</span> : null}
                        </td>
                        <td data-label="Montant" className="tr num nowrap bold" style={{ color: m.delta > 0 ? 'var(--danger)' : 'var(--ok)' }}>
                          {m.delta > 0 ? '+' : '−'}{f3(Math.abs(m.delta))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </Shell>
  )
}
