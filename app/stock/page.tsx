'use client'
// ═══════════════════════════════════════════════════════════════════
// /stock — stock levels, low-stock alerts, and the movement trail.
//
// Nothing here overwrites a quantity. Every change is a MOVEMENT with a type, a
// reason and an author, appended to a ledger:
//   sale     sold at the till          (negative)
//   receive  livraison                  (positive)
//   waste    casse / perte / offert     (negative)
//   adjust   correction, reason forced  (signed)
//   count    inventaire physique        (absolute, resets the checkpoint)
//
// Quantity is derived as "latest count + deltas recorded since". That is what
// makes an écart provable and stops two tills clobbering each other.
// ═══════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useState } from 'react'
import {
  Shell, LoginGate, NotReady, Loading, Empty, useApiKey, apiGet, apiPost,
  f3, qtyTrim, qtyDelta, dt, num, Icon, useModules,
} from '../ui/Shell'

type Variance = {
  item_id: string; item_name: string; item_emoji: string; category: string
  cost: number; theorique: number
  dernier_compte: number; last_count_at: string | null
  vendu_depuis: number; recu_depuis: number; perte_depuis: number; ajuste_depuis: number
}
type Movement = {
  id: number; item_id: string; item_name: string; item_emoji: string
  kind: string; delta: number | null; count_value: number | null
  expected_value: number | null; reason: string; actor: string; source: string
  terminal_id: string; sale_num: number | null; client_ts: string
}
type Ecart = {
  item_id: string; item_name: string; item_emoji: string
  compte: number; theorique: number; ecart: number; ecart_valeur: number
  reason: string; actor: string; source: string; client_ts: string
}

const KIND = {
  sale:    { label: 'Vente',      cls: 'bNeutral', icon: '🛒' },
  receive: { label: 'Livraison',  cls: 'bOk',      icon: '📥' },
  waste:   { label: 'Perte',      cls: 'bDanger',  icon: '🗑️' },
  adjust:  { label: 'Correction', cls: 'bWarn',    icon: '✏️' },
  count:   { label: 'Inventaire', cls: 'bInfo',    icon: '📋' },
  return:  { label: 'Retour',     cls: 'bOk',      icon: '↩️' },
} as const

export default function StockPage() {
  const { key, checked } = useApiKey()
  const [loading, setLoading] = useState(true)
  const [ready, setReady] = useState(true)
  const [msg, setMsg] = useState('')
  const [restName, setRestName] = useState('')
  const [tab, setTab] = useState<'levels' | 'ing' | 'moves' | 'ecarts'>('levels')

  const [variance, setVariance] = useState<Variance[]>([])
  const [movements, setMovements] = useState<Movement[]>([])
  const [ecarts, setEcarts] = useState<Ecart[]>([])
  const [totals, setTotals] = useState<any>(null)
  const [thresholds, setThresholds] = useState<Record<string, { low: number; tracked: boolean }>>({})
  /** Products counted by the unit. Recipe-built ones are managed on /ingredients. */
  const [unitTracked, setUnitTracked] = useState<Set<string>>(new Set())

  const [search, setSearch] = useState('')
  const [onlyLow, setOnlyLow] = useState(false)
  const [move, setMove] = useState<{ item: Variance; kind: string } | null>(null)
  const [saving, setSaving] = useState(false)
  /** Suppliers for the receive modal dropdown. Loaded once. */
  const [suppliers, setSuppliers] = useState<{ id: number; name: string }[]>([])
  // Stock editing at the till. Unlocked by default, because a client who bought
  // only the EXE never opens this page and must stay fully operational.
  const [posLocked, setPosLocked] = useState(false)
  const [lockBusy, setLockBusy] = useState(false)
  // Whether this establishment uses stock at all. Read from the server config,
  // not changeable from this page — only admin toggles modules.
  const [stockOn, setStockOn] = useState(true)
  const mods = useModules(key)

  useEffect(() => {
    if (key) load(key)
    else if (checked) setLoading(false)
  }, [key, checked])

  async function load(k: string) {
    setLoading(true); setMsg('')
    // The ledger gives levels + trail; the catalog gives the configured seuil;
    // the config carries whether the till is allowed to edit quantities.
    const [log, cat, cfg] = await Promise.all([
      apiGet('/api/me/stock-log?limit=400', k),
      apiGet('/api/me/catalog', k),
      apiGet('/api/me/config', k),
    ])
    if (cfg.ok) {
      setPosLocked(!!(cfg.config && cfg.config.posStockLocked))
      const m = cfg.modules || (cfg.config && cfg.config.modules) || {}
      setStockOn(!('stockTracking' in m) || !!m.stockTracking)
    }
    if (log.ok) {
      setReady(log.ready !== false)
      setRestName(log.name || '')
      setVariance(log.variance || [])
      setMovements(log.movements || [])
      setEcarts(log.ecarts || [])
      setTotals(log.totals || null)
    } else setMsg(log.error || 'Erreur de chargement')

    if (cat.ok) {
      const t: Record<string, { low: number; tracked: boolean }> = {}
      // Products counted by the unit. Anything built from a recipe belongs on
      // /ingredients — the server refuses counts and deliveries on it, so
      // offering those actions here would be a button that returns an error.
      const unit = new Set<string>()
      for (const p of cat.products || []) {
        t[p.item_id] = { low: parseInt(String(p.low_threshold)) || 0, tracked: p.tracked !== false }
        const mode = String(p.track_mode || 'stock')
        if (mode === 'stock') unit.add(String(p.item_id))
      }
      setThresholds(t)
      setUnitTracked(unit)
    }
    // Load suppliers for the receive modal
    try {
      const sup = await apiGet('/api/me/suppliers', k)
      if (sup.ok) setSuppliers((sup.suppliers || []).filter((s: any) => !s.archived).map((s: any) => ({ id: s.id, name: s.name })))
    } catch {}
    setLoading(false)
  }

  /** Lock/unlock POS stock editing — this is an operational choice the owner
   *  makes, not a module toggle. It belongs here. */
  async function toggleLock() {
    if (!key) return
    const next = !posLocked
    setLockBusy(true); setMsg('')
    const d = await apiPost('/api/me/config', { key, posStockLocked: next })
    setLockBusy(false)
    if (d.ok) {
      setPosLocked(next)
      // The till picks this up on its next poll of /api/stock (a few seconds
      // after start, then every 30 minutes) and caches it, so the rule survives
      // the connection dropping.
      setMsg(next
        ? '🔒 Caisse en lecture seule — la prochaine synchro appliquera la règle'
        : '🔓 La caisse peut à nouveau saisir livraisons, pertes et inventaires')
    } else setMsg(d.error || 'Erreur')
  }

  async function submitMovement(payload: any) {
    if (!key) return
    setSaving(true); setMsg('')
    const d = await apiPost('/api/me/stock-log', { key, ...payload })
    setSaving(false)
    if (d.ok) { setMove(null); await load(key); setMsg('✓ Mouvement enregistré') }
    else setMsg(d.error || 'Erreur')
  }

  const isLow = (v: Variance) => {
    const t = thresholds[v.item_id]
    if (!t || !t.tracked) return false
    return v.theorique <= t.low
  }

  /**
   * This page is about products counted BY THE UNIT.
   *
   * A recipe-built product has no unit count to show: the server refuses counts
   * and deliveries on it, so listing it here would offer buttons that return an
   * error. It may still appear in `variance` because the ledger holds its
   * historical rows from before the mode existed — those stay in the trail, they
   * just stop being presented as a live stock level.
   *
   * The set is only applied once the catalog has loaded; before that, filtering
   * would briefly empty the table.
   */
  const isUnit = (id: string) => unitTracked.size === 0 || unitTracked.has(id)

  const filtered = useMemo(() => {
    let out = variance.filter(v => isUnit(v.item_id))
    if (onlyLow) out = out.filter(isLow)
    if (search) {
      const q = search.toLowerCase()
      out = out.filter(v => (v.item_name || '').toLowerCase().includes(q) || (v.category || '').toLowerCase().includes(q))
    }
    return out
  }, [variance, search, onlyLow, thresholds, unitTracked])

  const unitVariance = useMemo(() => variance.filter(v => isUnit(v.item_id)), [variance, unitTracked])
  const lowList = unitVariance.filter(isLow)
  const stockValue = unitVariance.reduce((a, v) => a + v.theorique * num(v.cost), 0)
  /** Products excluded because they are built from ingredients. */
  const recipeCount = variance.length - unitVariance.length

  if (!checked || loading) {
    return <Shell active="/stock" title="Stock" restName={restName}><Loading /></Shell>
  }
  if (!key) return <LoginGate />

  return (
    <Shell
      active="/stock"
      // Recipes are optional; a café that switched them off should not see the tab.
      hideTabs={mods.on('ingredients') ? [] : ['/ingredients']}
      title="Stock"
      subtitle=""
      restName={restName}
      badges={{ '/stock': lowList.length }}
      actions={
        <>
          <button
            className="btn"
            onClick={toggleLock}
            disabled={lockBusy || !stockOn}
            title={posLocked
              ? 'La caisse ne peut pas modifier les quantités'
              : 'La caisse peut saisir livraisons, pertes et inventaires'}
          >
            {lockBusy
              ? '…'
              : <>
                  <Icon name={posLocked ? 'lock' : 'unlock'} size={15} />
                  {posLocked ? 'Caisse bloquée' : 'Caisse autorisée'}
                </>}
          </button>
          <button className="btn" onClick={() => key && load(key)}>↻ Recharger</button>
        </>
      }
    >
      {!ready && <NotReady sql="migration-stock-movements.sql" />}
      {msg && (
        <div className={'notice ' + (msg.startsWith('✓') ? 'nOk' : 'nDanger')}>
          <span className="noticeIcon">{msg.startsWith('✓') ? '✓' : '✕'}</span><div>{msg}</div>
        </div>
      )}

{/* Was a five-line paragraph explaining the lock. It is a state, not a
          lesson, so it is now a pill: the fact, and nothing else. */}
      {posLocked && (
        <div className="mb14">
          <span className="pill p-warn">
            <Icon name="lock" size={13} />
            Caisse en lecture seule — le stock se gère ici
          </span>
        </div>
      )}

      <div className="statGrid mb20">
        <div className="stat">
          <div className="statLabel">Valeur du stock</div>
          <div className="statValue num">{f3(stockValue)} DT</div>
          <div className="statHint">quantité × coût d&apos;achat</div>
        </div>
        <div className="stat">
          <div className="statLabel">Stock bas</div>
          <div className="statValue num" style={{ color: lowList.length ? 'var(--danger)' : 'var(--ok)' }}>{lowList.length}</div>
          <div className="statHint">au niveau du seuil ou en dessous</div>
        </div>
        <div className="stat">
          <div className="statLabel">Valeur des pertes</div>
          <div className="statValue num" style={{ color: num(totals?.valeur_pertes) ? 'var(--warn)' : undefined }}>
            {f3(totals?.valeur_pertes)} DT
          </div>
          <div className="statHint">{qtyTrim(totals?.unites_pertes)} unités déclarées</div>
        </div>
        <div className="stat">
          <div className="statLabel">Corrections manuelles</div>
          <div className="statValue num">{totals?.nb_ajustements ?? 0}</div>
          <div className="statHint">par {totals?.nb_intervenants ?? 0} personne(s)</div>
        </div>
        <div className="stat">
          <div className="statLabel">Écarts constatés</div>
          <div className="statValue num" style={{ color: ecarts.length ? 'var(--danger)' : 'var(--ok)' }}>{ecarts.length}</div>
          <div className="statHint">inventaires ≠ théorique</div>
        </div>
      </div>

      {lowList.length > 0 && (
        <div className="notice nWarn">
          <span className="noticeIcon">📦</span>
          <div>
            <div className="noticeTitle">{lowList.length} produit(s) à réapprovisionner</div>
            {lowList.slice(0, 8).map(v => (
              <div key={v.item_id}>
                • {v.item_emoji} {v.item_name} — <b>{qtyTrim(v.theorique)}</b> restant
                {thresholds[v.item_id] ? ` (seuil ${thresholds[v.item_id].low})` : ''}
              </div>
            ))}
            {lowList.length > 8 && <div className="cMuted">…et {lowList.length - 8} autre(s)</div>}
          </div>
        </div>
      )}

      <div className="toolbar">
        <button className="chip" data-on={tab === 'levels'} onClick={() => setTab('levels')}>Stock</button>
        <button className="chip" data-on={tab === 'ing'} onClick={() => setTab('ing')}>Ingrédients</button>
        <button className="chip" data-on={tab === 'moves'} onClick={() => setTab('moves')}>🧾 Mouvements</button>
        <button className="chip" data-on={tab === 'ecarts'} onClick={() => setTab('ecarts')}>
          ⚠ Écarts{ecarts.length ? ` (${ecarts.length})` : ''}
        </button>
        <input
          className="input" style={{ maxWidth: 250, marginLeft: 8 }}
          placeholder="🔍 Rechercher…" value={search} onChange={e => setSearch(e.target.value)}
        />
        {tab === 'levels' && (
          <button className="chip spacer" data-on={onlyLow} onClick={() => setOnlyLow(!onlyLow)}>Stock bas seulement</button>
        )}
      </div>

      {/* Products are counted by the unit OR built from ingredients, never both.
          Say where the missing ones went, otherwise this page just looks like it
          lost rows. */}
      {tab === 'levels' && recipeCount > 0 && (
        <div className="notice nInfo mb20">
          <span className="noticeIcon">i</span>
          <div>
            {recipeCount} produit{recipeCount > 1 ? 's' : ''} fabriqué{recipeCount > 1 ? 's' : ''} à
            partir d&apos;ingrédients {recipeCount > 1 ? 'ne sont pas comptés' : 'n’est pas compté'} à
            l&apos;unité ici.{' '}
            <a href="/ingredients">Voir combien on peut encore en faire →</a>
          </div>
        </div>
      )}

      {/* ── Levels ── */}
      {tab === 'levels' && (
        <div className="card">
          <div className="tableWrap">
            <table className="t">
              <thead>
                <tr>
                  <th>Produit</th>
                  <th className="tr">En stock</th>
                  <th className="tr">Seuil</th>
                  <th className="tr">Valeur</th>
                  <th>Depuis le dernier inventaire</th>
                  <th>Dernier inventaire</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={7}><Empty icon="📦" text="Aucun produit suivi. Définissez une quantité depuis la caisse ou faites un inventaire." /></td></tr>
                ) : filtered.map(v => {
                  const t = thresholds[v.item_id]
                  const low = isLow(v)
                  return (
                    <tr key={v.item_id}>
                      <td>
                        <div className="strong">{v.item_name || v.item_id}</div>
                        <div className="t11 cFaint">{v.category || '—'}</div>
                      </td>
                      <td data-label="En stock" className="tr num nowrap">
                        <span className={low ? 'bold cDanger' : 'bold'} style={{ fontSize: 15 }}>{qtyTrim(v.theorique)}</span>
                        {low && <span className="badge bDanger" style={{ marginLeft: 6 }}>stock bas</span>}
                      </td>
                      <td data-label="Seuil" className="tr num t13 cMuted">{t?.tracked ? t.low : '—'}</td>
                      <td data-label="Valeur" className="tr num nowrap">{f3(v.theorique * num(v.cost))} DT</td>
                      <td data-label="Depuis l'inventaire" className="t12 cMuted nowrap">
                        {v.vendu_depuis > 0 && <span>vendu −{qtyTrim(v.vendu_depuis)} </span>}
                        {v.recu_depuis > 0 && <span className="cOk">reçu +{qtyTrim(v.recu_depuis)} </span>}
                        {v.perte_depuis > 0 && <span className="cDanger">perte −{qtyTrim(v.perte_depuis)} </span>}
                        {v.ajuste_depuis !== 0 && <span className="cWarn">corrigé {qtyDelta(v.ajuste_depuis)}</span>}
                        {!v.vendu_depuis && !v.recu_depuis && !v.perte_depuis && !v.ajuste_depuis && '—'}
                      </td>
                      <td data-label="Dernier inventaire" className="t12 cMuted nowrap">
                        {v.last_count_at ? <>{qtyTrim(v.dernier_compte)} le {dt(v.last_count_at)}</> : <span className="cFaint">jamais</span>}
                      </td>
                      <td className="tr nowrap actionCell">
                        <button className="btn btnSm" title="Livraison reçue" onClick={() => setMove({ item: v, kind: 'receive' })}>
                          <Icon name="plus" size={14} /> Réception
                        </button>
                        <button className="btn btnSm" title="Casse, périmé, offert" onClick={() => setMove({ item: v, kind: 'waste' })}>
                          <Icon name="trash" size={14} /> Perte
                        </button>
                        <button className="btn btnSm btnPrimary" onClick={() => setMove({ item: v, kind: 'count' })}>
                          <Icon name="clipboard" size={14} /> Inventaire
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Movement trail ── */}
      {tab === 'moves' && (
        <div className="card">
          <div className="tableWrap">
            <table className="t">
              <thead>
                <tr>
                  <th>Quand</th><th>Produit</th><th>Type</th>
                  <th className="tr">Variation</th><th>Motif</th><th>Par</th><th>Source</th>
                </tr>
              </thead>
              <tbody>
                {movements.length === 0 ? (
                  <tr><td colSpan={7}><Empty icon="🧾" text="Aucun mouvement enregistré." /></td></tr>
                ) : movements
                  .filter(m => !search || (m.item_name || '').toLowerCase().includes(search.toLowerCase()))
                  .map(m => {
                    const k = (KIND as any)[m.kind] || { label: m.kind, cls: 'bNeutral', icon: '•' }
                    const isCount = m.kind === 'count'
                    const ec = isCount && m.expected_value !== null ? num(m.count_value) - num(m.expected_value) : null
                    return (
                      <tr key={m.id}>
                        <td className="t12 cMuted nowrap">{dt(m.client_ts)}</td>
                        <td data-label="Produit" className="nowrap">{m.item_emoji || '📦'} {m.item_name || m.item_id}</td>
                        <td data-label="Type"><span className={'badge ' + k.cls}>{k.icon} {k.label}</span></td>
                        <td data-label="Variation" className="tr num nowrap">
                          {isCount ? (
                            <>
                              <span className="bold">= {qtyTrim(m.count_value)}</span>
                              {ec !== null && Math.abs(ec) > 0.0005 && (
                                <div className="t11" style={{ color: ec < 0 ? 'var(--danger)' : 'var(--warn)' }}>
                                  écart {qtyDelta(ec)}
                                </div>
                              )}
                            </>
                          ) : (
                            <span style={{ color: num(m.delta) < 0 ? 'var(--danger)' : 'var(--ok)', fontWeight: 650 }}>
                              {qtyDelta(m.delta)}
                            </span>
                          )}
                        </td>
                        <td data-label="Motif" className="t12 cMuted">
                          {m.reason || (m.sale_num ? '#' + String(m.sale_num).padStart(3, '0') : '—')}
                        </td>
                        <td data-label="Par" className="t12 nowrap">{m.actor || <span className="cFaint">—</span>}</td>
                        <td data-label="Source">
                          <span className={'badge ' + (m.source === 'web' ? 'bInfo' : 'bNeutral')}>
                            {m.source === 'web' ? '💻 web' : '🖥️ caisse'}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Écarts ── */}
      {tab === 'ecarts' && (
        <div className="card">
          <div className="tableWrap">
            <table className="t">
              <thead>
                <tr>
                  <th>Quand</th><th>Produit</th>
                  <th className="tr">Théorique</th><th className="tr">Compté</th>
                  <th className="tr">Écart</th><th className="tr">Valeur</th>
                  <th>Motif</th><th>Par</th>
                </tr>
              </thead>
              <tbody>
                {ecarts.length === 0 ? (
                  <tr><td colSpan={8}><Empty icon="✓" text="Aucun écart : chaque inventaire correspondait au théorique." /></td></tr>
                ) : ecarts.map((e, i) => (
                  <tr key={i}>
                    <td className="t12 cMuted nowrap">{dt(e.client_ts)}</td>
                    <td data-label="Produit" className="nowrap">{e.item_emoji || '📦'} {e.item_name || e.item_id}</td>
                    <td data-label="Théorique" className="tr num">{qtyTrim(e.theorique)}</td>
                    <td data-label="Compté" className="tr num">{qtyTrim(e.compte)}</td>
                    <td data-label="Écart" className="tr num bold" style={{ color: e.ecart < 0 ? 'var(--danger)' : 'var(--warn)' }}>
                      {qtyDelta(e.ecart)}
                    </td>
                    <td data-label="Valeur" className="tr num nowrap" style={{ color: e.ecart_valeur < 0 ? 'var(--danger)' : undefined }}>
                      {f3(e.ecart_valeur)} DT
                    </td>
                    <td data-label="Motif" className="t12 cMuted">{e.reason || '—'}</td>
                    <td data-label="Par" className="t12 nowrap">{e.actor || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {move && (
        <MovementModal
          item={move.item} kind={move.kind} saving={saving}
          suppliers={suppliers}
          onClose={() => setMove(null)}
          onSubmit={submitMovement}
        />
      )}
    </Shell>
  )
}

// ─────────────────────────────────────────────────────────────
function MovementModal({ item, kind: initialKind, saving, suppliers, onClose, onSubmit }: any) {
  const [kind, setKind] = useState(initialKind)
  const [qty, setQty] = useState<any>('')
  const [reason, setReason] = useState('')
  const [unitCost, setUnitCost] = useState('')
  const [supplierId, setSupplierId] = useState<number | null>(null)
  const [supplierName, setSupplierName] = useState('')
  const [payMethod, setPayMethod] = useState<'comptant' | 'credit'>('comptant')

  const isCount = kind === 'count'
  const isReceive = kind === 'receive'
  const k = (KIND as any)[kind] || KIND.adjust
  const reasonRequired = kind === 'adjust' || kind === 'waste'
  const valid = num(qty) > 0 && (!reasonRequired || reason.trim().length > 0)
  const after = isCount ? num(qty)
    : kind === 'receive' ? num(item.theorique) + num(qty)
    : num(item.theorique) - num(qty)

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modalHead">
          <div>
            <div className="modalTitle">{item.item_emoji || '📦'} {item.item_name}</div>
            <div className="t12 cMuted">En stock : <b>{qtyTrim(item.theorique)}</b></div>
          </div>
          <button className="btn btnGhost btnSm spacer" onClick={onClose}>✕</button>
        </div>

        <div className="modalBody col" style={{ gap: 16 }}>
          <div className="row wrap" style={{ gap: 6 }}>
            {['receive', 'waste', 'adjust', 'count'].map(x => (
              <button key={x} className="chip" data-on={kind === x} onClick={() => setKind(x)}>
                {(KIND as any)[x].icon} {(KIND as any)[x].label}
              </button>
            ))}
          </div>

          <div className="field">
            <label className="label">{isCount ? 'Quantité comptée' : 'Quantité'}</label>
            <input
              className="input inputNum" style={{ maxWidth: 170, fontSize: 17 }}
              type="number" step="0.001" min="0" autoFocus
              value={qty} onChange={e => setQty(e.target.value)}
            />
            <span className="help">
              {isCount
                ? 'Le stock repart de ce chiffre. L\u2019écart avec le théorique est figé et conservé.'
                : `Stock après : ${qtyTrim(after)}`}
            </span>
          </div>

          <div className="field">
            <label className="label">Motif {reasonRequired && <span className="cDanger">*</span>}</label>
            <input
              className="input" value={reason} onChange={e => setReason(e.target.value)}
              placeholder={kind === 'receive' ? 'Livraison fournisseur' : kind === 'waste' ? 'Casse, périmé, offert' : kind === 'count' ? 'Inventaire du soir' : 'Correction'}
            />
            {reasonRequired && <span className="help">Obligatoire : une perte ou une correction sans motif n&apos;est pas traçable.</span>}
          </div>

          {/* ── Supplier + payment (receive only) ──────────────────────── */}
          {isReceive && (
            <>
              <div className="field">
                <label className="label">Prix d&apos;achat unitaire</label>
                <input
                  className="input inputNum" style={{ maxWidth: 170 }}
                  type="number" step="0.001" min="0"
                  value={unitCost} onChange={e => setUnitCost(e.target.value)}
                  placeholder="DT / unité"
                />
                <span className="help">Alimente le coût moyen pondéré. Vide = prix inchangé.</span>
              </div>
              <div className="field">
                <label className="label">Fournisseur</label>
                <select
                  className="input" style={{ maxWidth: 260 }}
                  value={supplierId ?? ''}
                  onChange={e => {
                    const v = e.target.value
                    if (v === '') { setSupplierId(null); setSupplierName('') }
                    else if (v === '__new') { setSupplierId(null); setSupplierName('') }
                    else setSupplierId(parseInt(v))
                  }}
                >
                  <option value="">Passager (pas de fiche)</option>
                  {suppliers.map((s: any) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                  <option value="__new">+ Ajouter un fournisseur…</option>
                </select>
                {supplierId === null && supplierName === '__new' ? null : null}
              </div>
              <div className="field">
                <label className="label">Paiement</label>
                <div className="row" style={{ gap: 6 }}>
                  <button type="button" className="chip" data-on={payMethod === 'comptant'} onClick={() => setPayMethod('comptant')}>
                    Comptant
                  </button>
                  <button type="button" className="chip" data-on={payMethod === 'credit'} onClick={() => setPayMethod('credit')}>
                    À crédit
                  </button>
                </div>
                <span className="help">
                  {payMethod === 'credit'
                    ? 'Le montant sera ajouté à la dette du fournisseur.'
                    : 'Payé immédiatement — aucune dette créée.'}
                </span>
              </div>
            </>
          )}

          {isCount && (
            <div className="notice nInfo" style={{ margin: 0 }}>
              <span className="noticeIcon">ℹ</span>
              <div>
                Théorique actuel <b>{qtyTrim(item.theorique)}</b>.
                {num(qty) > 0 && Math.abs(num(qty) - num(item.theorique)) > 0.0005 && (
                  <> Écart constaté : <b style={{ color: num(qty) < num(item.theorique) ? 'var(--danger)' : 'var(--warn)' }}>
                    {qtyDelta(num(qty) - num(item.theorique))}
                  </b></>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="modalFoot">
          <button className="btn" onClick={onClose}>Annuler</button>
          <button
            className="btn btnPrimary" disabled={!valid || saving}
            onClick={() => onSubmit({
              item_id: item.item_id,
              kind,
              ...(isCount
                ? { count_value: num(qty) }
                : { delta: kind === 'receive' ? num(qty) : -num(qty) }),
              reason: reason.trim() || (KIND as any)[kind].label,
              actor: 'web',
              ts: new Date().toISOString(),
              uid: 'W' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
              // Supplier fields (receive only)
              ...(isReceive && num(unitCost) > 0 ? { unit_cost: num(unitCost) } : {}),
              ...(isReceive && supplierId ? { supplier_id: supplierId } : {}),
              ...(isReceive ? { payment_method: payMethod } : {}),
            })}
          >{saving ? '…' : 'Enregistrer'}</button>
        </div>
      </div>
    </div>
  )
}
