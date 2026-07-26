'use client'
// ═══════════════════════════════════════════════════════════════════
// /fournisseurs — who you buy from, what you owe them.
//
// Mirror of /credits but in the other direction: client credit tracks what
// THEY owe YOU, supplier credit tracks what YOU owe THEM.
//
// The page answers three questions:
//   1. Who do I owe money to, and how much?
//   2. What did I buy from this supplier, when, and at what price?
//   3. What payments have I made, and what's left?
// ═══════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useState } from 'react'
import {
  Shell, LoginGate, NotReady, Loading, Empty, useApiKey, apiGet, apiPost,
  f3, dt, daysSince,
} from '../ui/Shell'

type Supplier = {
  id: number; name: string; phone: string; category: string
  notes: string; balance: number; archived: boolean
  created_at: string; updated_at: string
}
type Delivery = {
  id: number; source: 'stock' | 'ingredient'; item_id: string
  item_name: string | null; item_emoji: string | null
  delta: number; unit_cost: number | null; payment_method: string | null
  reason: string | null; actor: string | null; client_ts: string
  line_total: number
}
type Payment = {
  id: number; amount: number; method: string; reference: string
  notes: string; actor: string; client_ts: string
}

export default function FournisseursPage() {
  const { key, checked } = useApiKey()
  const [loading, setLoading] = useState(true)
  const [ready, setReady] = useState(true)
  const [msg, setMsg] = useState('')
  const [restName, setRestName] = useState('')
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [totals, setTotals] = useState<any>(null)
  const [search, setSearch] = useState('')
  const [showArchived, setShowArchived] = useState(false)

  // Fiche state
  const [sel, setSel] = useState<Supplier | null>(null)
  const [ficheDel, setFicheDel] = useState<Delivery[]>([])
  const [fichePay, setFichePay] = useState<Payment[]>([])
  const [ficheBusy, setFicheBusy] = useState(false)

  // Forms
  const [showAdd, setShowAdd] = useState(false)
  const [showPay, setShowPay] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (key) load(key)
    else if (checked) setLoading(false)
  }, [key, checked])

  async function load(k: string) {
    setLoading(true); setMsg('')
    const d = await apiGet('/api/me/suppliers', k)
    if (d.ok) {
      setReady(d.ready !== false)
      setRestName(d.name || '')
      setSuppliers(d.suppliers || [])
      setTotals(d.totals || null)
    } else setMsg(d.error || 'Erreur de chargement')
    setLoading(false)
  }

  async function openFiche(s: Supplier) {
    setSel(s); setFicheDel([]); setFichePay([]); setFicheBusy(true)
    if (!key) return
    const d = await apiPost('/api/me/suppliers', { key, action: 'getDeliveries', supplier_id: s.id, limit: 500 })
    setFicheBusy(false)
    if (d.ok) { setFicheDel(d.deliveries || []); setFichePay(d.payments || []) }
  }

  async function saveSupplier(data: any) {
    if (!key) return
    setSaving(true); setMsg('')
    const d = await apiPost('/api/me/suppliers', { key, action: 'saveSupplier', ...data })
    setSaving(false)
    if (d.ok) { setShowAdd(false); await load(key); setMsg('✓ Fournisseur enregistré') }
    else setMsg(d.error || 'Erreur')
  }

  async function recordPayment(data: any) {
    if (!key || !sel) return
    setSaving(true); setMsg('')
    const d = await apiPost('/api/me/suppliers', { key, action: 'recordPayment', supplier_id: sel.id, ...data })
    setSaving(false)
    if (d.ok) {
      setShowPay(false)
      // Refresh the fiche and the list
      await load(key)
      // Update local sel balance
      setSel(prev => prev ? { ...prev, balance: d.balance ?? prev.balance } : prev)
      await openFiche({ ...sel, balance: d.balance ?? sel.balance })
      setMsg('✓ Paiement enregistré')
    } else setMsg(d.error || 'Erreur')
  }

  const filtered = useMemo(() => {
    let out = suppliers.filter(s => (showArchived ? true : !s.archived))
    if (search) {
      const q = search.toLowerCase()
      out = out.filter(s => s.name.toLowerCase().includes(q) || (s.category || '').toLowerCase().includes(q))
    }
    return out
  }, [suppliers, search, showArchived])

  if (!checked || loading) return <Shell active="/fournisseurs" title="Fournisseurs" restName={restName}><Loading /></Shell>
  if (!key) return <LoginGate />
  if (!ready) return (
    <Shell active="/fournisseurs" title="Fournisseurs" restName={restName}>
      <NotReady sql="migration-suppliers.sql" />
    </Shell>
  )

  return (
    <Shell
      active="/fournisseurs"
      title="Fournisseurs"
      subtitle="Qui vous approvisionne, ce que vous devez"
      restName={restName}
      badges={{ '/fournisseurs': totals?.nb_with_debt ?? 0 }}
      actions={
        <>
          <button className="btn" onClick={() => key && load(key)}>↻</button>
          <button className="btn btnPrimary" onClick={() => setShowAdd(true)}>+ Fournisseur</button>
        </>
      }
    >
      {msg && <div className="notice nDanger"><span className="noticeIcon">✕</span><div>{msg}</div></div>}

      <div className="statGrid mb20">
        <div className="stat">
          <div className="statLabel">Total dettes</div>
          <div className="statValue num" style={{ color: (totals?.total_dette ?? 0) > 0 ? 'var(--danger)' : 'var(--ok)' }}>
            {f3(totals?.total_dette)} DT
          </div>
        </div>
        <div className="stat">
          <div className="statLabel">Fournisseurs à payer</div>
          <div className="statValue num">{totals?.nb_with_debt ?? 0}</div>
          <div className="statHint">sur {totals?.nb_suppliers ?? 0} fournisseurs</div>
        </div>
      </div>

      <div className="toolbar">
        <input
          className="input" style={{ maxWidth: 280 }}
          placeholder="Rechercher…" value={search} onChange={e => setSearch(e.target.value)}
        />
        <label className="row t12 cMuted" style={{ cursor: 'pointer' }}>
          <input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} />
          Archivés
        </label>
        <span className="spacer t12 cMuted">{filtered.length} fournisseur{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      <div className="card">
        <div className="tableWrap">
          <table className="t">
            <thead>
              <tr>
                <th>Fournisseur</th>
                <th>Catégorie</th>
                <th className="tr">Vous devez</th>
                <th>Dernier achat</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={5}>
                  <Empty icon="box" text="Aucun fournisseur. Ajoutez-en un quand vous recevez une livraison." />
                </td></tr>
              ) : filtered.map(s => (
                <tr key={s.id} style={s.archived ? { opacity: .55 } : undefined}>
                  <td>
                    <div className="strong">{s.name}</div>
                    <div className="t11 cFaint">{s.phone || '—'}</div>
                  </td>
                  <td data-label="Catégorie" className="t12 cMuted">{s.category || '—'}</td>
                  <td data-label="Vous devez" className="tr num nowrap bold" style={{ color: s.balance > 0 ? 'var(--danger)' : 'var(--ok)' }}>
                    {s.balance > 0 ? f3(s.balance) + ' DT' : '0'}
                  </td>
                  <td data-label="Dernier achat" className="t12 cMuted">{dt(s.updated_at)}</td>
                  <td className="tr actionCell">
                    <button className="btn btnSm" onClick={() => openFiche(s)}>Fiche</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Add/Edit Supplier Modal ── */}
      {showAdd && (
        <div className="overlay" onClick={() => setShowAdd(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modalHead">
              <div className="modalTitle">Nouveau fournisseur</div>
              <button className="btn btnGhost btnSm spacer" onClick={() => setShowAdd(false)}>✕</button>
            </div>
            <SupplierForm saving={saving} onSave={saveSupplier} onCancel={() => setShowAdd(false)} />
          </div>
        </div>
      )}

      {/* ── Supplier Fiche ── */}
      {sel && (
        <div className="overlay" onClick={() => setSel(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 600 }}>
            <div className="modalHead">
              <div>
                <div className="modalTitle">{sel.name}</div>
                <div className="t12 cMuted">{sel.phone || '—'} · {sel.category || 'Autre'}</div>
              </div>
              <button className="btn btnGhost btnSm spacer" onClick={() => setSel(null)}>✕</button>
            </div>
            <div className="modalBody">
              {/* Balance + pay button */}
              <div className="statGrid mb20">
                <div className="stat">
                  <div className="statLabel">Vous devez</div>
                  <div className="statValue num" style={{ color: sel.balance > 0 ? 'var(--danger)' : 'var(--ok)', fontSize: 22 }}>
                    {f3(sel.balance)} DT
                  </div>
                </div>
                <div className="stat">
                  <div className="statLabel">Livraisons</div>
                  <div className="statValue num">{ficheDel.length}</div>
                </div>
                <div className="stat">
                  <div className="statLabel">Paiements</div>
                  <div className="statValue num">{fichePay.length}</div>
                </div>
              </div>

              {sel.balance > 0 && (
                <button className="btn btnPrimary mb20" style={{ width: '100%' }} onClick={() => setShowPay(true)}>
                  Payer ce fournisseur
                </button>
              )}

              {ficheBusy ? (
                <div className="col" style={{ gap: 8 }}>
                  <div className="skel" style={{ height: 40 }} /><div className="skel" style={{ height: 40 }} />
                </div>
              ) : (
                <>
                  {/* Deliveries */}
                  <div className="cardTitle">Livraisons reçues</div>
                  {ficheDel.length === 0 ? (
                    <Empty icon="box" text="Aucune livraison enregistrée pour ce fournisseur." />
                  ) : (
                    <table className="t">
                      <thead><tr>
                        <th>Date</th><th>Produit</th><th className="tr">Qté</th>
                        <th className="tr">Prix</th><th className="tr">Total</th><th>Paiement</th>
                      </tr></thead>
                      <tbody>
                        {ficheDel.map(d => (
                          <tr key={d.source + d.id}>
                            <td className="t12 cMuted nowrap">{dt(d.client_ts)}</td>
                            <td data-label="Produit">
                              <span>{d.item_emoji || ''} {d.item_name || d.item_id}</span>
                              <div className="t11 cFaint">{d.source === 'ingredient' ? 'ingrédient' : 'produit'}</div>
                            </td>
                            <td data-label="Qté" className="tr num nowrap">{Math.abs(d.delta)}</td>
                            <td data-label="Prix" className="tr num nowrap t12 cMuted">
                              {d.unit_cost ? f3(d.unit_cost) + ' /u' : '—'}
                            </td>
                            <td data-label="Total" className="tr num nowrap bold">{f3(d.line_total)} DT</td>
                            <td data-label="Paiement" className="t12">
                              <span className={'badge ' + (d.payment_method === 'credit' ? 'bDanger' : 'bOk')}>
                                {d.payment_method === 'credit' ? 'Crédit' : 'Comptant'}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}

                  {/* Payments */}
                  <div className="cardTitle" style={{ marginTop: 20 }}>Paiements effectués</div>
                  {fichePay.length === 0 ? (
                    <Empty icon="check" text="Aucun paiement enregistré." />
                  ) : (
                    <table className="t">
                      <thead><tr>
                        <th>Date</th><th className="tr">Montant</th>
                        <th>Méthode</th><th>Référence</th><th>Par</th>
                      </tr></thead>
                      <tbody>
                        {fichePay.map(p => (
                          <tr key={p.id}>
                            <td className="t12 cMuted nowrap">{dt(p.client_ts)}</td>
                            <td data-label="Montant" className="tr num nowrap bold cOk">{f3(p.amount)} DT</td>
                            <td data-label="Méthode" className="t12">{p.method || 'espèces'}</td>
                            <td data-label="Référence" className="t12 cMuted">{p.reference || '—'}</td>
                            <td data-label="Par" className="t12 cMuted">{p.actor || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </>
              )}

              {sel.notes && (
                <div className="t12 cMuted" style={{ marginTop: 16, padding: '8px 12px', background: 'var(--surface-3)', borderRadius: 'var(--r-sm)' }}>
                  {sel.notes}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Payment Modal ── */}
      {showPay && sel && (
        <div className="overlay" onClick={() => setShowPay(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 420 }}>
            <div className="modalHead">
              <div className="modalTitle">Payer {sel.name}</div>
              <button className="btn btnGhost btnSm spacer" onClick={() => setShowPay(false)}>✕</button>
            </div>
            <PaymentForm
              balance={sel.balance} saving={saving}
              onSave={recordPayment} onCancel={() => setShowPay(false)}
            />
          </div>
        </div>
      )}
    </Shell>
  )
}

// ─────────────────────────────────────────────────────────────
function SupplierForm({ saving, onSave, onCancel }: {
  saving: boolean; onSave: (d: any) => void; onCancel: () => void
}) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [category, setCategory] = useState('')
  const [notes, setNotes] = useState('')

  return (
    <div className="modalBody col" style={{ gap: 14 }}>
      <div className="field">
        <label className="label">Nom *</label>
        <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="Fournisseur X" autoFocus />
      </div>
      <div className="row" style={{ gap: 10 }}>
        <div className="field grow">
          <label className="label">Téléphone</label>
          <input className="input" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+216 XX XXX XXX" />
        </div>
        <div className="field grow">
          <label className="label">Catégorie</label>
          <input className="input" value={category} onChange={e => setCategory(e.target.value)} placeholder="Viande, Boissons, Emballage…" />
        </div>
      </div>
      <div className="field">
        <label className="label">Notes</label>
        <textarea className="input" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Horaires, conditions…" style={{ height: 60, resize: 'vertical' }} />
      </div>
      <div className="modalFoot">
        <button className="btn" onClick={onCancel}>Annuler</button>
        <button className="btn btnPrimary" disabled={!name.trim() || saving} onClick={() => onSave({ name, phone, category, notes })}>
          {saving ? '…' : 'Enregistrer'}
        </button>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
function PaymentForm({ balance, saving, onSave, onCancel }: {
  balance: number; saving: boolean; onSave: (d: any) => void; onCancel: () => void
}) {
  const [amount, setAmount] = useState(String(balance > 0 ? balance : ''))
  const [method, setMethod] = useState('espèces')
  const [reference, setReference] = useState('')
  const [notes, setNotes] = useState('')

  const a = parseFloat(amount) || 0
  const valid = a > 0

  return (
    <div className="modalBody col" style={{ gap: 14 }}>
      <div className="t12 cMuted mb14">
        Dette actuelle : <span className="bold cDanger">{f3(balance)} DT</span>
      </div>
      <div className="field">
        <label className="label">Montant à payer *</label>
        <input className="input" type="number" step="0.001" min="0" value={amount}
          onChange={e => setAmount(e.target.value)} autoFocus
          onKeyDown={e => { if (e.key === 'Enter' && valid && !saving) onSave({ amount: a, method, reference, notes }) }}
        />
        <span className="help">
          {a > 0 && a < balance
            ? `Paiement partiel — reste ${f3(balance - a)} DT après`
            : a >= balance ? 'Règle toute la dette' : ''}
        </span>
      </div>
      <div className="field">
        <label className="label">Méthode</label>
        <div className="toolbar">
          {['espèces', 'virement', 'chèque'].map(m => (
            <button key={m} className="chip" data-on={method === m} onClick={() => setMethod(m)}>{m}</button>
          ))}
        </div>
      </div>
      <div className="field">
        <label className="label">Référence (optionnel)</label>
        <input className="input" value={reference} onChange={e => setReference(e.target.value)} placeholder="N° chèque, réf virement…" />
      </div>
      <div className="modalFoot">
        <button className="btn" onClick={onCancel}>Annuler</button>
        <button className="btn btnPrimary" disabled={!valid || saving} onClick={() => onSave({ amount: a, method, reference, notes })}>
          {saving ? '…' : `Payer ${f3(a)} DT`}
        </button>
      </div>
    </div>
  )
}
