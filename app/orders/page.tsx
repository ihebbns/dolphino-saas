'use client'
// ═══════════════════════════════════════════════════════════════════
// /orders — manager-facing audit trail for online orders (PWA + kiosk).
//
// Read-only on purpose: accept/reject/mark-paid all happen at the till,
// never here — this page exists so the owner can see, after the fact, who
// did what. Reuses the exact same GET the POS polls (/api/me/online-orders)
// rather than a second endpoint, so there is one source of truth for what
// "recent" means.
// ═══════════════════════════════════════════════════════════════════
import { useEffect, useState } from 'react'
import { Shell, LoginGate, Loading, Empty, useApiKey, useModules, apiGet, f3, dt } from '../ui/Shell'

type Order = {
  id: number; client_name: string; client_phone: string; order_type: string
  items_json: { name: string; qty: number; variant?: string }[]
  total: number; note: string
  status: 'accepted' | 'rejected'
  responded_by: string; responded_at: string
  paid: boolean; paid_by: string; paid_at: string | null
  created_at: string
}

const TYPE_LABEL: Record<string, string> = { sur_place: '🏠 Sur place', emporter: '🥡 Emporter', livraison: '🛵 Livraison' }

export default function OrdersPage() {
  const { key, checked } = useApiKey()
  const mods = useModules(key)
  const [loading, setLoading] = useState(true)
  const [restName, setRestName] = useState('')
  const [orders, setOrders] = useState<Order[]>([])
  const [pendingCount, setPendingCount] = useState(0)
  const [msg, setMsg] = useState('')
  // The whole point of checking this page from home is "did something get
  // stuck at the till" — a flat chronological list buries that under
  // everything else. unpaidOnly filters straight to it; the banner below
  // makes the count impossible to miss even before filtering.
  const [unpaidOnly, setUnpaidOnly] = useState(false)

  useEffect(() => {
    if (key) load(key)
    else if (checked) setLoading(false)
  }, [key, checked])

  async function load(k: string) {
    setLoading(true); setMsg('')
    const d = await apiGet('/api/me/online-orders', k)
    if (d.ok) {
      setOrders(d.recent || [])
      setPendingCount((d.pending || []).length)
    } else setMsg(d.error || 'Erreur de chargement')
    setLoading(false)
  }

  if (!checked || loading) return <Shell active="/orders" title="Commandes"><Loading /></Shell>
  if (!key) return <LoginGate />

  // Presentation only — same non-destructive contract as every other module
  // toggle here. Only shown once useModules() has actually answered, so this
  // page never flashes "désactivé" for a fraction of a second on load.
  if (mods.loaded && !mods.on('onlineOrders')) {
    return (
      <Shell active="/orders" title="Commandes">
        <div className="notice nWarn">
          <span className="noticeIcon">🌐</span>
          <div>
            <div className="noticeTitle">Module Commandes en ligne désactivé</div>
            L&apos;historique reste intact et réapparaît dès la réactivation. Contactez Servio pour l&apos;activer.
          </div>
        </div>
      </Shell>
    )
  }

  const unpaid = orders.filter(o => o.status === 'accepted' && !o.paid)
  const visibleOrders = unpaidOnly ? unpaid : orders

  return (
    <Shell active="/orders" title="Commandes en ligne" subtitle="Historique PWA + borne — qui a accepté, qui a encaissé" restName={restName}>
      {msg && <div className="notice nWarn"><div className="noticeTitle">{msg}</div></div>}

      {pendingCount > 0 && (
        <div className="notice nInfo" style={{ marginBottom: 14 }}>
          <div className="noticeTitle">{pendingCount} commande{pendingCount > 1 ? 's' : ''} en attente à la caisse</div>
          Accepter ou refuser se fait uniquement sur la caisse (bouton 🌐 Commandes) — cette page est juste l&apos;historique.
        </div>
      )}

      {/* The actual "is something stuck at the till" signal — an order
          accepted a while ago that never got encaissée. Clicking it filters
          straight to the list below instead of just being a static count. */}
      {unpaid.length > 0 && (
        <div
          className="notice nWarn"
          style={{ marginBottom: 14, cursor: 'pointer' }}
          onClick={() => setUnpaidOnly(true)}
          role="button"
        >
          <div className="noticeTitle">🧾 {unpaid.length} commande{unpaid.length > 1 ? 's' : ''} acceptée{unpaid.length > 1 ? 's' : ''} non encaissée{unpaid.length > 1 ? 's' : ''}</div>
          Voir lesquelles ↓
        </div>
      )}

      {orders.length > 0 && (
        <div className="row" style={{ gap: 8, marginBottom: 14 }}>
          <button className="chip" data-on={!unpaidOnly} onClick={() => setUnpaidOnly(false)}>Toutes ({orders.length})</button>
          <button className="chip" data-on={unpaidOnly} onClick={() => setUnpaidOnly(true)}>Non encaissées ({unpaid.length})</button>
        </div>
      )}

      {visibleOrders.length === 0 ? (
        <Empty icon="receipt" text={unpaidOnly ? 'Aucune commande non encaissée en ce moment.' : 'Aucune commande en ligne pour le moment.'} />
      ) : (
        <div className="col" style={{ gap: 10 }}>
          {visibleOrders.map(o => (
            <div key={o.id} className="card">
              <div className="cardPad">
                <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
                  <div className="row" style={{ gap: 8 }}>
                    <span className="strong">{o.client_name}</span>
                    <span className={'badge ' + (o.status === 'accepted' ? 'bOk' : 'bDanger')}>
                      {o.status === 'accepted' ? '✓ Acceptée' : '✕ Refusée'}
                    </span>
                    {o.status === 'accepted' && (
                      <span className={'badge ' + (o.paid ? 'bOk' : 'bDanger')}>
                        {o.paid ? '💰 Payée' : '🧾 Non payée'}
                      </span>
                    )}
                  </div>
                  <span className="strong">{f3(o.total)} DT</span>
                </div>

                <div className="t12 cMuted" style={{ marginBottom: 8 }}>
                  {TYPE_LABEL[o.order_type] || o.order_type} · {o.client_phone || 'pas de téléphone'} · {dt(o.created_at)}
                </div>

                <div className="t13" style={{ marginBottom: 8 }}>
                  {(o.items_json || []).map((it, i) => (
                    <span key={i}>
                      {i > 0 ? ', ' : ''}{it.qty}× {it.name}{it.variant ? ` (${it.variant})` : ''}
                    </span>
                  ))}
                </div>
                {o.note && <div className="t12 cMuted" style={{ marginBottom: 8 }}>📝 {o.note}</div>}

                <div className="t11 cFaint" style={{ borderTop: '1px solid var(--line)', paddingTop: 8 }}>
                  {o.status === 'accepted' ? 'Acceptée' : 'Refusée'} par <strong>{o.responded_by || '—'}</strong> · {dt(o.responded_at)}
                  {o.paid && (
                    <> · Encaissée par <strong>{o.paid_by || '—'}</strong> · {dt(o.paid_at)}</>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Shell>
  )
}
