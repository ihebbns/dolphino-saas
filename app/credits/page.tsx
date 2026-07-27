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
  // The fiche used to filter the page's shared movement list. That list is the
  // last 200 movements ACROSS ALL clients, so any ardoise whose activity had
  // scrolled past that window showed a truncated history — or "aucun mouvement"
  // for a client who visibly owed money. The fiche now asks the server for that
  // one client's own history.
  const [ficheRows, setFicheRows] = useState<Movement[] | null>(null)
  const [ficheBusy, setFicheBusy] = useState(false)
  /** What the server found missing, and which database it looked in. */
  const [diag, setDiag] = useState<{ missing: string[]; db: { database: string; schema: string } | null }>(
    { missing: [], db: null }
  )

  useEffect(() => {
    if (key) load(key)
    else if (checked) setLoading(false)
  }, [key, checked])

  async function openFiche(c: Client) {
    setSel(c)
    setFicheRows(null)
    if (!key) return
    setFicheBusy(true)
    const d = await apiGet(
      `/api/me/credits?client=${encodeURIComponent(c.client_key)}&limit=1000`, key
    )
    setFicheBusy(false)
    // Fall back to the shared list rather than showing nothing if the call fails.
    setFicheRows(d.ok ? (d.movements || []) : movements.filter(m => m.client_key === c.client_key))
  }

  function closeFiche() {
    setSel(null)
    setFicheRows(null)
  }

  async function deleteFiche(c: Client) {
    if (!key) return
    if (!confirm(`Supprimer définitivement la fiche de ${c.name} ? Cette action est irréversible.`)) return
    setMsg('')
    const d = await apiPost('/api/me/credits', { key, action: 'delete', client_key: c.client_key })
    if (d.ok) {
      setMsg('✓ Fiche supprimée')
      await load(key)
    } else setMsg(d.error || 'Erreur')
  }

  async function load(k: string) {
    setLoading(true); setMsg('')
    const d = await apiGet('/api/me/credits', k)
    if (d.ok) {
      setReady(d.ready !== false)
      setDiag({ missing: d.missing || [], db: d.db || null })
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

  // Until the migration runs nothing is known. Rendering the KPI cards here would
  // print "Total dû 0.000 DT", which reads as "nobody owes you anything" — a
  // claim we cannot make. Show only what is true: the table isn't set up yet.
  if (!ready) {
    return (
      <Shell
        active="/credits"
        title="Créances clients"
        subtitle="Argent qui vous est dû — les ardoises se gèrent à la caisse"
        restName={restName}
        actions={<button className="btn" onClick={() => key && load(key)}>↻ Recharger</button>}
      >
        <NotReady sql="migration-credits.sql" missing={diag.missing} db={diag.db} />
      </Shell>
    )
  }

  return (
    <Shell
      active="/credits"
      title="Créances clients"
      subtitle="Argent qui vous est dû — les ardoises se gèrent à la caisse"
      restName={restName}
      badges={{ '/credits': totals?.nb_debiteurs ?? 0 }}
      actions={<button className="btn" onClick={() => key && load(key)}>↻ Recharger</button>}
    >
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
                      {isStale && <div className="t11 cWarn">{d} jours sans mouvement</div>}
                    </td>
                    {/* actionCell makes this a full-width button row on a phone
                        instead of a cramped strip pinned to the right edge. */}
                    <td className="tr actionCell">
                      {c.archived ? (
                        <button className="btn btnSm" style={{ background: 'var(--red-dim)', border: '1px solid var(--red)', color: 'var(--red)' }} onClick={() => deleteFiche(c)}>Supprimer</button>
                      ) : (
                        <button className="btn btnSm" onClick={() => openFiche(c)}>Fiche</button>
                      )}
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
                  {/* clamp1 instead of an inline nowrap: an inline style beats the
                      mobile media query, so this cell stayed one long unbreakable
                      line and dragged the whole card layout wider than the phone. */}
                  <td data-label="Détail" className="t12 cMuted clamp1">
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
        <div className="overlay" onClick={closeFiche}>
          <div
            className="modal" onClick={e => e.stopPropagation()}
            role="dialog" aria-modal="true" aria-label={`Fiche de ${sel.name}`}
          >
            <div className="modalHead">
              <div className="avatar">{(sel.name || '?').charAt(0).toUpperCase()}</div>
              <div style={{ minWidth: 0 }}>
                <div className="modalTitle">{sel.name}</div>
                <div className="t12 cMuted">{sel.phone || 'pas de téléphone'}</div>
              </div>
              <button className="btn btnGhost btnSm spacer" onClick={closeFiche} aria-label="Fermer">✕</button>
            </div>
            <div className="modalBody">
              {/* The balance leads: it is the amount to ask for. */}
              <div className="statGrid mb20">
                <div className="stat">
                  <div className="statLabel">Doit actuellement</div>
                  <div className="statValue num" style={{ color: sel.balance > 0 ? 'var(--danger)' : 'var(--ok)' }}>
                    {f3(sel.balance)} DT
                  </div>
                  <div className="statHint">
                    {sel.balance > 0 ? 'ardoise ouverte' : 'rien à réclamer'}
                  </div>
                </div>
                <div className="stat">
                  <div className="statLabel">Total pris</div>
                  <div className="statValue num">{f3(sel.total_pris)}</div>
                  <div className="statHint">{sel.nb_credits ?? 0} fois à crédit</div>
                </div>
                <div className="stat">
                  <div className="statLabel">Total réglé</div>
                  <div className="statValue num">{f3(sel.total_regle)}</div>
                  <div className="statHint">{sel.nb_payments ?? 0} règlement(s)</div>
                </div>
                <div className="stat">
                  <div className="statLabel">Dernier mouvement</div>
                  <div className="statValue" style={{ fontSize: 15 }}>{dt(sel.last_movement_at)}</div>
                  <div className="statHint">
                    {(() => {
                      const d = daysSince(sel.last_movement_at)
                      return d == null ? '—'
                        : d >= 30 ? <span className="cWarn">{d} jours sans mouvement</span>
                        : `il y a ${d} jour(s)`
                    })()}
                  </div>
                </div>
              </div>

              {sel.archived && (
                <div className="notice nDanger mb20">
                  <span className="noticeIcon">⚠</span>
                  <div>
                    <div className="noticeTitle">Fiche supprimée à la caisse</div>
                    {sel.balance > 0
                      ? 'Elle a été supprimée alors qu’une dette restait due.'
                      : 'Conservée ici pour l’historique.'}
                  </div>
                </div>
              )}

              <div className="cardTitle">
                Historique complet
                {ficheRows ? <small>{ficheRows.length} mouvement(s)</small> : null}
              </div>

              {ficheBusy ? (
                <div className="col" style={{ gap: 8 }}>
                  <div className="skel" style={{ height: 40 }} />
                  <div className="skel" style={{ height: 40 }} />
                  <div className="skel" style={{ height: 40 }} />
                </div>
              ) : !ficheRows || ficheRows.length === 0 ? (
                <Empty
                  icon="receipt"
                  text="Aucun mouvement reçu pour ce client. Les ardoises remontent depuis la caisse à chaque synchronisation."
                />
              ) : (
                <table className="t">
                  <thead>
                    <tr>
                      <th>Date</th><th>Type</th><th className="tr">Montant</th><th className="tr">Solde après</th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* Running balance, computed backwards from the current one so
                        each line answers "what did he owe after this?" — the
                        question actually asked when a client disputes a total.
                        The server returns newest first, so walking down the list
                        means subtracting the row above. */}
                    {ficheRows.map((m, i) => {
                      const after = ficheRows
                        .slice(0, i)
                        .reduce((bal, r) => bal - r.delta, sel.balance)
                      return (
                        <tr key={m.id}>
                          <td className="t12 cMuted nowrap">{dt(m.client_ts)}</td>
                          <td data-label="Type" className="t12">
                            <span className={'badge ' + (
                              m.kind === 'payment' ? 'bOk' : m.kind === 'credit' ? 'bDanger' : 'bNeutral'
                            )}>
                              {m.kind === 'payment'
                                ? 'Règlement' + (m.pay_method === 'card' ? ' (carte)' : '')
                                : m.kind === 'credit' ? 'À crédit' : 'Correction'}
                            </span>
                            {m.items_summary
                              ? <div className="t11 cFaint">{m.items_summary}</div>
                              : m.reason ? <div className="t11 cFaint">{m.reason}</div>
                              : m.sale_num ? <div className="t11 cFaint">#{String(m.sale_num).padStart(3, '0')}</div>
                              : null}
                            {m.actor ? <div className="t11 cFaint">par {m.actor}</div> : null}
                          </td>
                          <td
                            data-label="Montant" className="tr num nowrap bold"
                            style={{ color: m.delta > 0 ? 'var(--danger)' : 'var(--ok)' }}
                          >
                            {m.delta > 0 ? '+' : '−'}{f3(Math.abs(m.delta))}
                          </td>
                          <td data-label="Solde après" className="tr num nowrap t12 cMuted">
                            {f3(after)}
                          </td>
                        </tr>
                      )
                    })}
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
