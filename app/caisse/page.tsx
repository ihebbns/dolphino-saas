'use client'
// ═══════════════════════════════════════════════════════════════════
// /caisse — clôtures de caisse.
//
// One question: does the money in the drawer match what the till says should be
// there? Everything on this page serves that, and nothing else is here.
//
// It replaces a tab buried on the dashboard that was scoped to a single day. A
// single day cannot show a pattern, and a pattern is the whole point — a cashier
// 2 DT short every evening looks like rounding on Tuesday and like a habit over
// a fortnight. So the default window is a week and the per-cashier roll-up sits
// next to the list.
//
// Read-only. A closure is what the cashier recorded at the counter; the back
// office reviews it and never rewrites it.
// ═══════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useState } from 'react'
import {
  Shell, LoginGate, NotReady, Loading, Empty, useApiKey, apiGet,
  f3, dt, BarList,
} from '../ui/Shell'

type Movement = { type: 'in' | 'out'; amount: number; reason?: string }
type Session = {
  id: number; session_id: string | null; day: string; cashier: string | null
  opened_at: string | null; closed_at: string | null
  fond_initial: number; total_sales: number; orders_count: number
  cash_sales: number; card_sales: number; mobile_sales: number
  montant_compte: number | null; theorique: number | null; ecart: number | null
  cash_movements: Movement[] | null
}
type ByCashier = {
  cashier: string; nb_sessions: number; total_sales: number
  ecart_net: number; ecart_abs: number; nb_manquants: number
}

const RANGES = [
  { label: "Aujourd'hui", days: 1 },
  { label: '7 jours', days: 7 },
  { label: '30 jours', days: 30 },
  { label: '90 jours', days: 90 },
]

/** A gap under 1 DT is counting noise, not a finding. Flagging it trains the
 *  owner to ignore the colour, which is worse than not colouring at all. */
const TOLERANCE = 1

function ecartTone(e: number | null): 'ok' | 'warn' | 'danger' | 'flat' {
  if (e == null) return 'flat'
  if (Math.abs(e) < TOLERANCE) return 'ok'
  return e < 0 ? 'danger' : 'warn'
}

function hhmm(s: string | null) {
  if (!s) return '—'
  const d = new Date(s)
  return isNaN(d.getTime()) ? '—' : d.toLocaleTimeString('fr-TN', { hour: '2-digit', minute: '2-digit' })
}

export default function CaissePage() {
  const { key, checked } = useApiKey()
  const [loading, setLoading] = useState(true)
  const [ready, setReady] = useState(true)
  const [msg, setMsg] = useState('')
  const [restName, setRestName] = useState('')
  const [days, setDays] = useState(7)

  const [sessions, setSessions] = useState<Session[]>([])
  const [byCashier, setByCashier] = useState<ByCashier[]>([])
  const [totals, setTotals] = useState<any>(null)
  const [sel, setSel] = useState<Session | null>(null)

  useEffect(() => {
    if (key) load(key, days)
    else if (checked) setLoading(false)
  }, [key, checked, days])

  async function load(k: string, d: number) {
    setLoading(true); setMsg('')
    const r = await apiGet(`/api/me/sessions?days=${d}`, k)
    if (r.ok) {
      setReady(r.ready !== false)
      setRestName(r.name || '')
      setSessions(r.sessions || [])
      setByCashier(r.byCashier || [])
      setTotals(r.totals || null)
    } else setMsg(r.error || 'Erreur de chargement')
    setLoading(false)
  }

  /** Closures whose gap is worth a conversation. */
  const flagged = useMemo(
    () => sessions.filter(s => s.ecart != null && Math.abs(s.ecart) >= TOLERANCE),
    [sessions]
  )

  if (!checked || loading) {
    return <Shell active="/caisse" title="Caisse" restName={restName}><Loading /></Shell>
  }
  if (!key) return <LoginGate />

  const ecartNet = totals?.ecart_net ?? 0

  return (
    <Shell
      active="/caisse"
      title="Caisse"
      subtitle="Clôtures : ce que la caisse annonce, ce qui a été compté"
      restName={restName}
      badges={{ '/caisse': flagged.length }}
      actions={<button className="btn" onClick={() => key && load(key, days)}>↻ Recharger</button>}
    >
      {!ready && <NotReady sql="migration-sessions.sql" />}
      {msg && <div className="notice nDanger"><span className="noticeIcon">✕</span><div>{msg}</div></div>}

      <div className="toolbar">
        {RANGES.map(r => (
          <button key={r.days} className="chip" data-on={days === r.days} onClick={() => setDays(r.days)}>
            {r.label}
          </button>
        ))}
        <span className="spacer t12 cMuted">
          {sessions.length} clôture{sessions.length !== 1 ? 's' : ''}
        </span>
      </div>

      <div className="statGrid mb20">
        {/* Net first, because it is the figure an owner asks for — but the
            absolute total sits under it, since a net near zero can hide one
            cashier short and another over by the same amount. */}
        <div className="stat">
          <div className="statLabel">Écart net</div>
          <div
            className="statValue num"
            style={{ color: Math.abs(ecartNet) < TOLERANCE ? 'var(--ok)' : ecartNet < 0 ? 'var(--danger)' : 'var(--warn)' }}
          >
            {ecartNet > 0 ? '+' : ''}{f3(ecartNet)} DT
          </div>
          <div className="statHint">
            {(totals?.ecart_abs ?? 0) > Math.abs(ecartNet)
              ? `${f3(totals?.ecart_abs)} DT d’écarts cumulés`
              : 'manquants et excédents confondus'}
          </div>
        </div>
        <div className="stat">
          <div className="statLabel">Clôtures à vérifier</div>
          <div className="statValue num" style={{ color: flagged.length ? 'var(--danger)' : 'var(--ok)' }}>
            {flagged.length}
          </div>
          <div className="statHint">écart de 1 DT ou plus</div>
        </div>
        <div className="stat">
          <div className="statLabel">Ventes encaissées</div>
          <div className="statValue num">{f3(totals?.total_sales)} DT</div>
          <div className="statHint">{totals?.nb_sessions ?? 0} session(s)</div>
        </div>
        <div className="stat">
          <div className="statLabel">Sessions non clôturées</div>
          <div className="statValue num" style={{ color: (totals?.nb_ouvertes ?? 0) ? 'var(--warn)' : 'var(--ok)' }}>
            {totals?.nb_ouvertes ?? 0}
          </div>
          <div className="statHint">ouvertes sans comptage</div>
        </div>
      </div>

      {/* ── The list. One row per closure, tap for the full fiche. ── */}
      <div className="card mb20">
        <div className="tableWrap">
          <table className="t">
            <thead>
              <tr>
                <th>Jour</th>
                <th>Caissier</th>
                <th className="tr">Ventes</th>
                <th className="tr">Compté</th>
                <th className="tr">Écart</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {sessions.length === 0 ? (
                <tr><td colSpan={6}>
                  <Empty
                    icon="drawer"
                    text="Aucune clôture sur cette période. Une clôture est enregistrée quand le caissier ferme sa caisse et compte le tiroir."
                  />
                </td></tr>
              ) : sessions.map(s => {
                const tone = ecartTone(s.ecart)
                return (
                  <tr key={s.id}>
                    <td>
                      <div className="strong">{s.day}</div>
                      <div className="t11 cFaint">
                        {hhmm(s.opened_at)} → {s.closed_at ? hhmm(s.closed_at) : 'en cours'}
                      </div>
                    </td>
                    <td data-label="Caissier">{s.cashier || 'Inconnu'}</td>
                    <td data-label="Ventes" className="tr num nowrap">
                      {f3(s.total_sales)}
                      <div className="t11 cFaint">{s.orders_count} cmd</div>
                    </td>
                    <td data-label="Compté" className="tr num nowrap">
                      {s.montant_compte != null ? f3(s.montant_compte) : <span className="t12 cFaint">non compté</span>}
                      {s.theorique != null && <div className="t11 cFaint">théo. {f3(s.theorique)}</div>}
                    </td>
                    <td data-label="Écart" className="tr num nowrap bold">
                      {s.ecart == null ? <span className="t12 cFaint">—</span> : (
                        <span style={{
                          color: tone === 'ok' ? 'var(--ok)' : tone === 'danger' ? 'var(--danger)' : 'var(--warn)',
                        }}>
                          {s.ecart > 0 ? '+' : ''}{f3(s.ecart)}
                        </span>
                      )}
                    </td>
                    <td className="tr actionCell">
                      <button className="btn btnSm" onClick={() => setSel(s)}>Détail</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Per cashier. The reason the window is a range and not a day. ── */}
      {byCashier.length > 0 && (
        <div className="grid2">
          <div className="card">
            <div className="cardPad">
              <div className="cardTitle">
                Écarts par caissier <small>{days} jour{days > 1 ? 's' : ''}</small>
              </div>
              <BarList
                emptyText="Aucun écart enregistré."
                rows={byCashier
                  .filter(c => c.ecart_abs > 0)
                  .map(c => ({
                    label: c.cashier,
                    value: c.ecart_abs,
                    display: `${f3(c.ecart_abs)} DT`,
                    sub: `${c.nb_sessions} session(s)` +
                      (c.nb_manquants ? ` · ${c.nb_manquants} manquant(s)` : ''),
                    tone: c.nb_manquants > 0 ? ('danger' as const) : ('info' as const),
                  }))}
              />
            </div>
          </div>
          <div className="card">
            <div className="cardPad">
              <div className="cardTitle">
                Ventes par caissier <small>{days} jour{days > 1 ? 's' : ''}</small>
              </div>
              <BarList
                emptyText="Aucune vente sur la période."
                rows={byCashier
                  .filter(c => c.total_sales > 0)
                  .map(c => ({
                    label: c.cashier,
                    value: c.total_sales,
                    display: `${f3(c.total_sales)} DT`,
                    sub: `${c.nb_sessions} session(s)`,
                    tone: 'ok' as const,
                  }))}
              />
            </div>
          </div>
        </div>
      )}

      {sel && <SessionFiche s={sel} onClose={() => setSel(null)} />}
    </Shell>
  )
}

// ─────────────────────────────────────────────────────────────
/**
 * The fiche. Laid out as the arithmetic the cashier actually performed, in order,
 * so the écart is not a number to trust but a subtraction the reader can follow:
 *
 *   fond initial + espèces encaissées + ajouts − retraits = théorique
 *   compté − théorique = écart
 */
function SessionFiche({ s, onClose }: { s: Session; onClose: () => void }) {
  const moves = Array.isArray(s.cash_movements) ? s.cash_movements : []
  const ins = moves.filter(m => m.type === 'in').reduce((a, m) => a + Number(m.amount || 0), 0)
  const outs = moves.filter(m => m.type === 'out').reduce((a, m) => a + Number(m.amount || 0), 0)
  const tone = ecartTone(s.ecart)
  const toneVar = tone === 'ok' ? 'var(--ok)' : tone === 'danger' ? 'var(--danger)' : 'var(--warn)'

  const Line = ({ label, value, hint, strong, color }: {
    label: string; value: string; hint?: string; strong?: boolean; color?: string
  }) => (
    <div className="row" style={{ justifyContent: 'space-between', gap: 12, padding: '9px 0', borderBottom: '1px solid var(--line)' }}>
      <div>
        <div className={strong ? 'strong' : 't13'}>{label}</div>
        {hint ? <div className="t11 cFaint">{hint}</div> : null}
      </div>
      <div className="num nowrap" style={{ fontWeight: strong ? 700 : 500, color }}>{value}</div>
    </div>
  )

  return (
    <div className="overlay" onClick={onClose}>
      <div
        className="modal" onClick={e => e.stopPropagation()}
        role="dialog" aria-modal="true" aria-label={`Clôture du ${s.day}`}
      >
        <div className="modalHead">
          <div>
            <div className="modalTitle">{s.cashier || 'Caissier inconnu'}</div>
            <div className="t12 cMuted">
              {s.day} · {hhmm(s.opened_at)} → {s.closed_at ? hhmm(s.closed_at) : 'en cours'}
            </div>
          </div>
          <button className="btn btnGhost btnSm spacer" onClick={onClose} aria-label="Fermer">✕</button>
        </div>

        <div className="modalBody">
          {/* The headline answer, before the detail. */}
          <div
            className="stat mb20"
            style={{ borderColor: toneVar, textAlign: 'center' }}
          >
            <div className="statLabel">Écart de caisse</div>
            <div className="statValue num" style={{ color: toneVar, fontSize: 28 }}>
              {s.ecart == null ? '—' : `${s.ecart > 0 ? '+' : ''}${f3(s.ecart)} DT`}
            </div>
            <div className="statHint">
              {s.ecart == null ? 'tiroir non compté'
                : Math.abs(s.ecart) < TOLERANCE ? 'caisse juste'
                : s.ecart < 0 ? 'il manque de l’argent dans le tiroir'
                : 'il y a plus d’argent que prévu'}
            </div>
          </div>

          <div className="cardTitle">Le calcul</div>
          <Line label="Fond initial" value={`${f3(s.fond_initial)} DT`} hint="au début du service" />
          <Line label="Espèces encaissées" value={`+ ${f3(s.cash_sales)} DT`} />
          {ins > 0 && <Line label="Ajouts au tiroir" value={`+ ${f3(ins)} DT`} />}
          {outs > 0 && <Line label="Retraits du tiroir" value={`− ${f3(outs)} DT`} />}
          <Line
            label="Théorique" strong
            value={s.theorique != null ? `${f3(s.theorique)} DT` : '—'}
            hint="ce que le tiroir devrait contenir"
          />
          <Line
            label="Compté" strong
            value={s.montant_compte != null ? `${f3(s.montant_compte)} DT` : 'non compté'}
            hint="ce que le caissier a compté"
          />
          <Line
            label="Écart" strong color={toneVar}
            value={s.ecart == null ? '—' : `${s.ecart > 0 ? '+' : ''}${f3(s.ecart)} DT`}
          />

          <div className="cardTitle" style={{ marginTop: 20 }}>Encaissements</div>
          <Line label="Espèces" value={`${f3(s.cash_sales)} DT`} />
          <Line label="Carte" value={`${f3(s.card_sales)} DT`} />
          <Line label="Mobile" value={`${f3(s.mobile_sales)} DT`} />
          <Line label="Total des ventes" value={`${f3(s.total_sales)} DT`} strong hint={`${s.orders_count} commande(s)`} />

          <div className="cardTitle" style={{ marginTop: 20 }}>
            Mouvements de tiroir <small>{moves.length}</small>
          </div>
          {moves.length === 0 ? (
            <div className="t12 cMuted" style={{ padding: '8px 0' }}>
              Aucun ajout ni retrait pendant ce service.
            </div>
          ) : moves.map((m, i) => (
            <Line
              key={i}
              label={m.type === 'in' ? 'Ajout de fond' : 'Retrait'}
              hint={m.reason || undefined}
              value={`${m.type === 'in' ? '+' : '−'} ${f3(m.amount)} DT`}
              color={m.type === 'in' ? 'var(--ok)' : 'var(--danger)'}
            />
          ))}

          {s.session_id && (
            <div className="t11 cFaint" style={{ marginTop: 16 }}>
              Session {s.session_id}
              {s.closed_at ? ` · clôturée le ${dt(s.closed_at)}` : ''}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
