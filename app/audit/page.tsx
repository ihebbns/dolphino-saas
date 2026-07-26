'use client'
// ═══════════════════════════════════════════════════════════════════
// /audit — cash drawer trail.
//
// An unexplained drawer opening is a primary theft signal, which is why
// professional systems report it as an exception rather than burying it in a log.
// The till records every drawer DECISION through one choke point — including the
// times it deliberately did NOT open — and ships them here.
//
// This is web-only on purpose: the till's manager PIN is routinely shared with
// cashiers, so whoever opens the drawer must not be able to check whether it was
// noticed.
// ═══════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useState } from 'react'
import { Shell, LoginGate, NotReady, Loading, Empty, useApiKey, apiGet, f3, dt, Icon } from '../ui/Shell'

type Event = {
  id: number; reason: string; amount: number | null; note: string
  opened: boolean; actor: string; is_manager: boolean
  session_id: string; terminal_id: string; client_ts: string
}
type ByActor = {
  actor: string; total: number; manual_opens: number; retraits: number
  total_retire: number; total_ajoute: number; refus_ouverture: number
}

const REASON = {
  cash_sale:      { label: 'Vente espèces',   cls: 'bNeutral', icon: '💵' },
  pay_in:         { label: 'Ajout de fond',   cls: 'bOk',      icon: '➕' },
  pay_out:        { label: 'Retrait',         cls: 'bDanger',  icon: '➖' },
  credit_payment: { label: 'Règlement dette', cls: 'bInfo',    icon: '📒' },
  no_sale:        { label: 'Ouverture manuelle', cls: 'bWarn', icon: '🔓' },
} as const

const RANGES = [
  { label: "Aujourd'hui", days: 1 },
  { label: '7 jours', days: 7 },
  { label: '30 jours', days: 30 },
  { label: '90 jours', days: 90 },
]

export default function AuditPage() {
  const { key, checked } = useApiKey()
  const [loading, setLoading] = useState(true)
  const [ready, setReady] = useState(true)
  const [msg, setMsg] = useState('')
  const [restName, setRestName] = useState('')
  const [days, setDays] = useState(7)
  const [events, setEvents] = useState<Event[]>([])
  const [byActor, setByActor] = useState<ByActor[]>([])
  const [totals, setTotals] = useState<any>(null)
  const [filter, setFilter] = useState<string>('')

  useEffect(() => {
    if (key) load(key, days)
    else if (checked) setLoading(false)
  }, [key, checked, days])

  async function load(k: string, d: number) {
    setLoading(true); setMsg('')
    const r = await apiGet(`/api/me/drawer-log?days=${d}&limit=500`, k)
    if (r.ok) {
      setReady(r.ready !== false)
      setRestName(r.name || '')
      setEvents(r.events || [])
      setByActor(r.byActor || [])
      setTotals(r.totals || null)
    } else setMsg(r.error || 'Erreur de chargement')
    setLoading(false)
  }

  const shown = useMemo(
    () => (filter ? events.filter(e => e.reason === filter) : events),
    [events, filter],
  )

  const manualOpens = events.filter(e => e.reason === 'no_sale')
  const refused = events.filter(e => !e.opened)

  if (!checked || loading) {
    return <Shell active="/audit" title="Tiroir-caisse" restName={restName}><Loading /></Shell>
  }
  if (!key) return <LoginGate />

  return (
    <Shell
      active="/audit"
      title="Tiroir-caisse"
      subtitle="Chaque ouverture du tiroir, avec son motif et son auteur"
      restName={restName}
      badges={{ '/audit': manualOpens.length }}
      actions={
        <>
          {/* Date range. The endpoint already takes a day count, so this is the
              same request with a friendlier control rather than new logic. */}
          <select
            className="select"
            value={days}
            onChange={e => { const d = parseInt(e.target.value); setDays(d); if (key) load(key, d) }}
            aria-label="Période"
          >
            <option value={1}>Aujourd&apos;hui</option>
            <option value={7}>7 jours</option>
            <option value={30}>30 jours</option>
            <option value={90}>90 jours</option>
          </select>
          {/* Print/PDF uses the browser's own dialog, where "Save as PDF" is the
              standard destination. The print stylesheet already drops the
              navigation and buttons and forces tables back, so the output is a
              clean document rather than a screenshot of an app. */}
          <button className="btn" onClick={() => window.print()} title="Imprimer ou enregistrer en PDF">
            <Icon name="print" size={15} /> PDF
          </button>
          <button className="btn" onClick={() => key && load(key, days)}>↻ Recharger</button>
        </>
      }
    >
      {/* Only appears on paper: a printed page needs to say what it covers. */}
      <div className="printOnly printHead">
        <div className="printTitle">Journal du tiroir-caisse — {restName || 'Servio'}</div>
        <div className="printSub">
          Période : {days === 1 ? "aujourd'hui" : `${days} derniers jours`}
          {' · '}Édité le {new Date().toLocaleString('fr-TN')}
        </div>
      </div>
      {!ready && <NotReady sql="migration-drawer-log.sql" />}
      {msg && <div className="notice nDanger"><span className="noticeIcon">✕</span><div>{msg}</div></div>}

      <div className="notice nInfo" hidden>
        <span className="noticeIcon">🔒</span>
        <div>
          <div className="noticeTitle">Visible uniquement ici</div>
          Ce journal n&apos;est jamais affiché dans la caisse. La personne qui ouvre le tiroir ne
          peut donc pas vérifier si son geste a été remarqué. Le tiroir ne s&apos;ouvre que lorsque
          de l&apos;argent liquide bouge réellement : une vente par carte ou à crédit ne l&apos;ouvre pas.
        </div>
      </div>

      <div className="statGrid mb20">
        <div className="stat">
          <div className="statLabel">Ouvertures manuelles</div>
          <div className="statValue num" style={{ color: manualOpens.length ? 'var(--warn)' : 'var(--ok)' }}>
            {totals?.manual_opens ?? 0}
          </div>
          <div className="statHint">sans vente — à justifier</div>
        </div>
        <div className="stat">
          <div className="statLabel">Total retiré</div>
          <div className="statValue num" style={{ color: 'var(--danger)' }}>{f3(totals?.total_retire)} DT</div>
        </div>
        <div className="stat">
          <div className="statLabel">Total ajouté</div>
          <div className="statValue num" style={{ color: 'var(--ok)' }}>{f3(totals?.total_ajoute)} DT</div>
        </div>
        <div className="stat">
          <div className="statLabel">Événements</div>
          <div className="statValue num">{totals?.total_events ?? 0}</div>
          <div className="statHint">{totals?.nb_intervenants ?? 0} intervenant(s)</div>
        </div>
        <div className="stat">
          <div className="statLabel">Ouvertures refusées</div>
          <div className="statValue num" style={{ color: refused.length ? 'var(--warn)' : undefined }}>
            {totals?.refus_ouverture ?? 0}
          </div>
          <div className="statHint">réglage caisse désactivé</div>
        </div>
      </div>

      {manualOpens.length > 0 && (
        <div className="notice nWarn">
          <span className="noticeIcon">🔓</span>
          <div>
            <div className="noticeTitle">{manualOpens.length} ouverture(s) manuelle(s)</div>
            Une ouverture sans vente est le signal de perte le plus courant. Vérifiez que le motif
            correspond à ce qui s&apos;est réellement passé.
            {manualOpens.slice(0, 5).map(e => (
              <div key={e.id}>• {dt(e.client_ts)} — {e.actor || 'inconnu'} : {e.note || 'aucun motif'}</div>
            ))}
          </div>
        </div>
      )}

      {refused.length > 0 && (
        <div className="notice nWarn">
          <span className="noticeIcon">⚠</span>
          <div>
            <div className="noticeTitle">{refused.length} ouverture(s) empêchée(s) par le réglage de la caisse</div>
            De l&apos;argent a bougé sans que le tiroir s&apos;ouvre. Une caisse réglée pour ne pas
            s&apos;ouvrir sur les ventes en espèces mérite une vérification.
          </div>
        </div>
      )}

      {/* Who handles cash outside of sales */}
      {byActor.length > 0 && (
        <div className="card mb20">
          <div className="cardHead"><div className="cardTitle">Par personne</div></div>
          <div className="tableWrap">
            <table className="t">
              <thead>
                <tr>
                  <th>Personne</th>
                  <th className="tr">Ouvertures manuelles</th>
                  <th className="tr">Retraits</th>
                  <th className="tr">Total retiré</th>
                  <th className="tr">Total ajouté</th>
                  <th className="tr">Événements</th>
                </tr>
              </thead>
              <tbody>
                {byActor.map(a => (
                  <tr key={a.actor || '?'}>
                    <td>
                      <div className="row">
                        <div className="avatar">{(a.actor || '?').charAt(0).toUpperCase()}</div>
                        <span className="strong">{a.actor || <span className="cFaint">inconnu</span>}</span>
                      </div>
                    </td>
                    <td data-label="Ouvertures manuelles" className="tr num">
                      {a.manual_opens > 0
                        ? <span className="badge bWarn">{a.manual_opens}</span>
                        : <span className="cFaint">0</span>}
                    </td>
                    <td data-label="Retraits" className="tr num">{a.retraits}</td>
                    <td data-label="Total retiré" className="tr num nowrap" style={{ color: a.total_retire ? 'var(--danger)' : undefined }}>
                      {f3(a.total_retire)} DT
                    </td>
                    <td data-label="Total ajouté" className="tr num nowrap" style={{ color: a.total_ajoute ? 'var(--ok)' : undefined }}>
                      {f3(a.total_ajoute)} DT
                    </td>
                    <td data-label="Événements" className="tr num cMuted">{a.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="toolbar">
        {RANGES.map(r => (
          <button key={r.days} className="chip" data-on={days === r.days} onClick={() => setDays(r.days)}>{r.label}</button>
        ))}
        <span style={{ width: 12 }} />
        <button className="chip" data-on={!filter} onClick={() => setFilter('')}>Tout</button>
        {Object.entries(REASON).map(([k, v]) => (
          <button key={k} className="chip" data-on={filter === k} onClick={() => setFilter(k)}>{v.icon} {v.label}</button>
        ))}
        <span className="t12 cMuted spacer">{shown.length} événement{shown.length !== 1 ? 's' : ''}</span>
      </div>

      <div className="card">
        <div className="tableWrap">
          <table className="t">
            <thead>
              <tr>
                <th>Quand</th><th>Motif</th><th className="tr">Montant</th>
                <th>Détail</th><th>Par</th><th className="tc">Tiroir</th><th>Caisse</th>
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 ? (
                <tr><td colSpan={7}><Empty icon="🔓" text="Aucun événement sur cette période." /></td></tr>
              ) : shown.map(e => {
                const r = (REASON as any)[e.reason] || { label: e.reason, cls: 'bNeutral', icon: '•' }
                return (
                  <tr key={e.id}>
                    <td className="t12 cMuted nowrap">{dt(e.client_ts)}</td>
                    <td data-label="Motif"><span className={'badge ' + r.cls}>{r.icon} {r.label}</span></td>
                    <td data-label="Montant" className="tr num nowrap">{e.amount !== null ? f3(e.amount) + ' DT' : <span className="cFaint">—</span>}</td>
                    <td data-label="Détail" className="t12 cMuted">{e.note || '—'}</td>
                    <td data-label="Par" className="t12 nowrap">
                      {e.actor || <span className="cFaint">—</span>}
                      {e.is_manager && <span className="owned">mgr</span>}
                    </td>
                    <td data-label="Tiroir" className="tc">
                      {e.opened
                        ? <span className="badge bOk">ouvert</span>
                        : <span className="badge bWarn">refusé</span>}
                    </td>
                    <td data-label="Caisse" className="t11 cFaint nowrap">{e.terminal_id || '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </Shell>
  )
}
