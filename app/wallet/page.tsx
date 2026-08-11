'use client'
// ═══════════════════════════════════════════════════════════════════
// /wallet — CARTE DE FIDÉLITÉ (solde prépayé client)
//
// Unlike /credits, this page can WRITE — the owner asked to create cards and
// recharge them from the dashboard, not only at the counter. Two actions do
// that: 'createClient' (new card, balance 0) and 'webTopup' (+30% bonus,
// computed server-side so the browser can never set its own bonus rate).
// SPEND still only ever happens at the till — there is no "spend" button
// here on purpose, since only a real sale should draw the balance down.
//
// A card (or recharge) created here reaches the till on its next
// pullCloudWallets() poll (see La_Coupole's client) — same pull-then-merge
// pattern pullCloudCosts() already uses, not a second competing source of
// truth. The till still owns and pushes its own topups/spends exactly as
// before; this page is an ADDITIONAL way in, not a replacement.
// ═══════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useState } from 'react'
import { Shell, LoginGate, NotReady, Loading, Empty, useApiKey, useModules, apiGet, apiPost, f3, dt, daysSince } from '../ui/Shell'

type Client = {
  client_key: string; name: string; phone: string
  balance: number; balance_derived: number; drift: number
  nb_topups: number; nb_spends: number
  total_recharge: number; total_depense: number
  last_movement_at: string | null; archived: boolean
}
type Movement = {
  id: number; client_key: string; name: string; kind: string
  delta: number; pay_method: string; items_summary: string
  sale_num: number | null; reason: string; actor: string; client_ts: string
}

const KIND_LABEL: Record<string, string> = {
  topup: '📥 Rechargement', spend: '🛒 Dépensé', adjust: '✏️ Correction', bonus: '🎁 Récompense',
}
const KIND_BADGE: Record<string, string> = {
  topup: 'bOk', spend: 'bNeutral', adjust: 'bNeutral', bonus: 'bBrand',
}

export default function WalletPage() {
  const { key, checked } = useApiKey()
  const mods = useModules(key)
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
  const [ficheRows, setFicheRows] = useState<Movement[] | null>(null)
  const [ficheBusy, setFicheBusy] = useState(false)
  const [diag, setDiag] = useState<{ missing: string[]; db: { database: string; schema: string } | null }>(
    { missing: [], db: null }
  )
  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState('')
  const [newPhone, setNewPhone] = useState('')
  const [creating, setCreating] = useState(false)
  const [recharge, setRecharge] = useState<Client | null>(null)
  const [rechargeAmount, setRechargeAmount] = useState('')
  const [recharging, setRecharging] = useState(false)

  useEffect(() => {
    if (key) load(key)
    else if (checked) setLoading(false)
  }, [key, checked])

  async function openFiche(c: Client) {
    setSel(c)
    setFicheRows(null)
    if (!key) return
    setFicheBusy(true)
    const d = await apiGet(`/api/me/wallet?client=${encodeURIComponent(c.client_key)}&limit=1000`, key)
    setFicheBusy(false)
    setFicheRows(d.ok ? (d.movements || []) : movements.filter(m => m.client_key === c.client_key))
  }

  function closeFiche() {
    setSel(null)
    setFicheRows(null)
  }

  async function load(k: string) {
    setLoading(true); setMsg('')
    const d = await apiGet('/api/me/wallet', k)
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

  async function createClient() {
    if (!key || !newName.trim()) return
    setCreating(true); setMsg('')
    const d = await apiPost('/api/me/wallet', { key, action: 'createClient', name: newName.trim(), phone: newPhone.trim() })
    setCreating(false)
    if (d.ok) {
      setMsg('✓ Carte créée pour ' + newName.trim())
      setShowCreate(false); setNewName(''); setNewPhone('')
      await load(key)
    } else setMsg(d.error || 'Erreur')
  }

  async function confirmRecharge() {
    if (!key || !recharge) return
    const amount = parseFloat(rechargeAmount)
    if (!(amount > 0)) { setMsg('Montant invalide'); return }
    setRecharging(true); setMsg('')
    const d = await apiPost('/api/me/wallet', { key, action: 'webTopup', client_key: recharge.client_key, amount, actor: 'web' })
    setRecharging(false)
    if (d.ok) {
      setMsg(`✓ ${f3(amount)} DT → ${f3(d.credited)} DT crédités sur la carte de ${recharge.name}`)
      setRecharge(null); setRechargeAmount('')
      await load(key)
    } else setMsg(d.error || 'Erreur')
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
  const stale = clients.filter(c => !c.archived && c.balance > 0 && (daysSince(c.last_movement_at) ?? 0) >= 30)

  if (!checked || loading) {
    return <Shell active="/wallet" title="Fidélité" restName={restName}><Loading /></Shell>
  }
  if (!key) return <LoginGate />

  // Presentation only — the module toggle never deletes anything. The wallets
  // and wallet_movements tables (and this establishment's own history) stay
  // exactly as they are; turning this back on shows everything again, right
  // where it was left. Only shown once useModules() has actually answered, so
  // this page never flashes "désactivé" for a fraction of a second on load.
  if (mods.loaded && !mods.on('wallet')) {
    return (
      <Shell active="/wallet" title="Fidélité" restName={restName}>
        <div className="notice nWarn">
          <span className="noticeIcon">💳</span>
          <div>
            <div className="noticeTitle">Module Fidélité désactivé</div>
            Aucune donnée n&apos;est perdue — les soldes et l&apos;historique restent intacts et
            réapparaissent dès la réactivation. Contactez Servio pour l&apos;activer.
          </div>
        </div>
      </Shell>
    )
  }

  if (!ready) {
    return (
      <Shell
        active="/wallet"
        title="Fidélité"
        subtitle="Solde prépayé client — les recharges se font à la caisse"
        restName={restName}
        actions={<button className="btn" onClick={() => key && load(key)}>↻ Recharger</button>}
      >
        <NotReady sql="migration-wallet.sql" missing={diag.missing} db={diag.db} />
      </Shell>
    )
  }

  return (
    <Shell
      active="/wallet"
      title="Fidélité"
      subtitle="Solde prépayé client — les recharges se font à la caisse (bonus 30% à chaque rechargement)"
      restName={restName}
      badges={{ '/wallet': totals?.nb_avec_solde ?? 0 }}
      actions={
        <>
          <button className="btn" onClick={() => key && load(key)}>↻ Recharger</button>
          <button className="btn btnPrimary" onClick={() => setShowCreate(true)}>+ Nouvelle carte</button>
        </>
      }
    >
      {msg && <div className="notice nDanger"><span className="noticeIcon">✕</span><div>{msg}</div></div>}

      <div className="statGrid mb20">
        <div className="stat">
          <div className="statLabel">Solde total en circulation</div>
          <div className="statValue num" style={{ color: 'var(--ok)' }}>
            {f3(totals?.total_solde)} DT
          </div>
          <div className="statHint">ce que vous devrez livrer en produits</div>
        </div>
        <div className="stat">
          <div className="statLabel">Clients avec solde</div>
          <div className="statValue num">{totals?.nb_avec_solde ?? 0}</div>
          <div className="statHint">sur {totals?.nb_clients ?? 0} fiches</div>
        </div>
        <div className="stat">
          <div className="statLabel">Soldes dormants</div>
          <div className="statValue num" style={{ color: stale.length ? 'var(--warn)' : 'var(--ok)' }}>{stale.length}</div>
          <div className="statHint">30 jours sans mouvement</div>
        </div>
      </div>

      {drifting.length > 0 && (
        <div className="notice nWarn">
          <span className="noticeIcon">⚠</span>
          <div>
            <div className="noticeTitle">
              {drifting.length} solde(s) où la caisse et son propre historique ne concordent pas
            </div>
            {drifting.slice(0, 5).map(c => (
              <div key={c.client_key}>• {c.name} — caisse: {f3(c.balance)}, historique: {f3(c.balance_derived)}</div>
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
                <th className="tr">Solde</th>
                <th className="tr">Total rechargé</th>
                <th className="tr">Total dépensé</th>
                <th>Dernier mouvement</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={6}><Empty icon="💳" text="Aucune carte de fidélité" /></td></tr>
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
                    <td data-label="Solde" className="tr num nowrap bold" style={{ color: c.balance > 0 ? 'var(--ok)' : 'var(--faint)' }}>
                      {f3(c.balance)} DT
                    </td>
                    <td data-label="Total rechargé" className="tr num cMuted">{f3(c.total_recharge)}</td>
                    <td data-label="Total dépensé" className="tr num cMuted">{f3(c.total_depense)}</td>
                    <td data-label="Dernier mouvement" className="nowrap">
                      <div className="t13">{dt(c.last_movement_at)}</div>
                      {isStale && <div className="t11 cWarn">{d} jours sans mouvement</div>}
                    </td>
                    <td className="tr actionCell">
                      {c.archived ? (
                        <span className="t11 cFaint">supprimée à la caisse</span>
                      ) : (
                        <>
                          <button className="btn btnSm" onClick={() => { setRecharge(c); setRechargeAmount('') }}>📥 Recharger</button>
                          <button className="btn btnSm" onClick={() => openFiche(c)}>Fiche</button>
                        </>
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
                    <span className={'badge ' + (KIND_BADGE[m.kind] || 'bNeutral')}>
                      {(KIND_LABEL[m.kind] || m.kind) + (m.kind === 'topup' && m.pay_method === 'card' ? ' (carte)' : '')}
                    </span>
                  </td>
                  <td data-label="Montant" className="tr num nowrap bold" style={{ color: m.delta > 0 ? 'var(--ok)' : 'var(--text-2)' }}>
                    {m.delta > 0 ? '+' : '−'}{f3(Math.abs(m.delta))}
                  </td>
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
              <div className="statGrid mb20">
                <div className="stat">
                  <div className="statLabel">Solde actuel</div>
                  <div className="statValue num" style={{ color: sel.balance > 0 ? 'var(--ok)' : 'var(--faint)' }}>
                    {f3(sel.balance)} DT
                  </div>
                  <div className="statHint">
                    {sel.balance > 0 ? 'utilisable en caisse' : 'rien à dépenser'}
                  </div>
                </div>
                <div className="stat">
                  <div className="statLabel">Total rechargé</div>
                  <div className="statValue num">{f3(sel.total_recharge)}</div>
                  <div className="statHint">{sel.nb_topups ?? 0} rechargement(s)</div>
                </div>
                <div className="stat">
                  <div className="statLabel">Total dépensé</div>
                  <div className="statValue num">{f3(sel.total_depense)}</div>
                  <div className="statHint">{sel.nb_spends ?? 0} achat(s) réglé(s) au solde</div>
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
                      ? 'Elle a été supprimée alors qu’un solde restait dessus.'
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
                  text="Aucun mouvement reçu pour ce client. Les soldes remontent depuis la caisse à chaque synchronisation."
                />
              ) : (
                <table className="t">
                  <thead>
                    <tr>
                      <th>Date</th><th>Type</th><th className="tr">Montant</th><th className="tr">Solde après</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ficheRows.map((m, i) => {
                      const after = ficheRows
                        .slice(0, i)
                        .reduce((bal, r) => bal - r.delta, sel.balance)
                      return (
                        <tr key={m.id}>
                          <td className="t12 cMuted nowrap">{dt(m.client_ts)}</td>
                          <td data-label="Type" className="t12">
                            <span className={'badge ' + (KIND_BADGE[m.kind] || 'bNeutral')}>
                              {KIND_LABEL[m.kind] || m.kind}
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
                            style={{ color: m.delta > 0 ? 'var(--ok)' : 'var(--text-2)' }}
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

      {showCreate && (
        <div className="overlay" onClick={() => !creating && setShowCreate(false)}>
          <div className="modal" style={{ maxWidth: 400 }} onClick={e => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="modalHead">
              <div className="modalTitle">💳 Nouvelle carte</div>
              <button className="btn btnGhost btnSm spacer" onClick={() => setShowCreate(false)} aria-label="Fermer">✕</button>
            </div>
            <div className="modalBody col" style={{ gap: 12 }}>
              <div className="field">
                <label className="label">Nom du client</label>
                <input className="input" value={newName} onChange={e => setNewName(e.target.value)} placeholder="Amira Ben Salah" autoFocus />
              </div>
              <div className="field">
                <label className="label">Téléphone (optionnel)</label>
                <input className="input" value={newPhone} onChange={e => setNewPhone(e.target.value)} placeholder="55 123 456" />
              </div>
              <div className="t11 cFaint">Le solde démarre à 0 DT — rechargez-la ensuite depuis la liste.</div>
            </div>
            <div className="modalFoot">
              <button className="btn" onClick={() => setShowCreate(false)} disabled={creating}>Annuler</button>
              <button className="btn btnPrimary" onClick={createClient} disabled={creating || !newName.trim()}>
                {creating ? '…' : '✓ Créer la carte'}
              </button>
            </div>
          </div>
        </div>
      )}

      {recharge && (
        <div className="overlay" onClick={() => !recharging && setRecharge(null)}>
          <div className="modal" style={{ maxWidth: 400 }} onClick={e => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="modalHead">
              <div>
                <div className="modalTitle">📥 Recharger — {recharge.name}</div>
                <div className="t12 cMuted">Solde actuel : {f3(recharge.balance)} DT</div>
              </div>
              <button className="btn btnGhost btnSm spacer" onClick={() => setRecharge(null)} aria-label="Fermer">✕</button>
            </div>
            <div className="modalBody col" style={{ gap: 12 }}>
              <div className="field">
                <label className="label">Montant reçu du client (DT)</label>
                <input
                  className="input inputNum" type="number" step="0.5" min="0" autoFocus
                  value={rechargeAmount} onChange={e => setRechargeAmount(e.target.value)} placeholder="0.000"
                />
              </div>
              {(() => {
                const amt = parseFloat(rechargeAmount)
                const credited = amt > 0 ? Math.round(amt * 1.3 * 1000) / 1000 : 0
                return (
                  <div className="t12" style={{ color: 'var(--brand)', fontWeight: 650 }}>
                    Sera crédité : {f3(credited)} DT (bonus +30%)
                  </div>
                )
              })()}
            </div>
            <div className="modalFoot">
              <button className="btn" onClick={() => setRecharge(null)} disabled={recharging}>Annuler</button>
              <button className="btn btnPrimary" onClick={confirmRecharge} disabled={recharging || !(parseFloat(rechargeAmount) > 0)}>
                {recharging ? '…' : '✓ Créditer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Shell>
  )
}
