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
  f3, qtyTrim, qtyDelta, dt, num, Icon, LevelMeter, useModules,
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

/** One ingredient row from /api/me/ingredients. Shared between the dedicated
 *  /ingredients page and the combined /stock view. */
type IngRow = {
  ing_key: string; name: string; category: string
  stock_unit: string; recipe_unit: string; conversion_factor: number
  cost_per_stock_unit: number; quantity: number; low_threshold: number
  tracked: boolean; archived: boolean; stock_value: number
  is_low: boolean; used_in_recipes: number
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
  const [tab, setTab] = useState<'levels' | 'recipe' | 'ingredients' | 'moves' | 'ecarts'>('levels')

  const [variance, setVariance] = useState<Variance[]>([])
  const [movements, setMovements] = useState<Movement[]>([])
  const [ecarts, setEcarts] = useState<Ecart[]>([])
  const [totals, setTotals] = useState<any>(null)
  const [thresholds, setThresholds] = useState<Record<string, { low: number; tracked: boolean; mode: string }>>({})
  /** Products counted by the unit. Recipe-built ones are managed on /ingredients. */
  const [unitTracked, setUnitTracked] = useState<Set<string>>(new Set())
  /** Recipe products loaded from catalog (track_mode='recipe'). */
  type RecipeProduct = { item_id: string; name: string; emoji: string; category: string; has_recipe: boolean }
  const [recipeProducts, setRecipeProducts] = useState<RecipeProduct[]>([])
  /** can_make: how many portions of each recipe product can be made right now. */
  const [canMake, setCanMake] = useState<Record<string, number>>({})

  const [search, setSearch] = useState('')
  const [onlyLow, setOnlyLow] = useState(false)
  const [category, setCategory] = useState<string | null>(null)
  const [move, setMove] = useState<{ item: Variance; kind: string } | null>(null)
  const [saving, setSaving] = useState(false)
  /** Suppliers for the receive modal dropdown. Loaded once. */
  const [suppliers, setSuppliers] = useState<{ id: number; name: string }[]>([])
  /** Ingredients for the ingredient sub-tab. */
  const [ings, setIngs] = useState<IngRow[]>([])
  const [ingReady, setIngReady] = useState(false)
  const [moveIng, setMoveIng] = useState<IngRow | null>(null)
  const [savingIng, setSavingIng] = useState(false)
  // Stock editing at the till. Unlocked by default, because a client who bought
  // only the EXE never opens this page and must stay fully operational.
  const [posLocked, setPosLocked] = useState(false)
  const [lockBusy, setLockBusy] = useState(false)
  // Whether this establishment uses stock at all. Read from the server config,
  // not changeable from this page — only admin toggles modules.
  const [stockOn, setStockOn] = useState(true)
  const [stockBusy, setStockBusy] = useState(false)
  // Rupture (86 / out-of-stock) state per item_id. True = en rupture.
  // Loaded from is_available on the stock rows returned by GET /api/stock.
  const [rupture, setRupture] = useState<Record<string, boolean>>({})
  const [ruptureBusy, setRuptureBusy] = useState<Record<string, boolean>>({})
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
      const t: Record<string, { low: number; tracked: boolean; mode: string }> = {}
      // Products counted by the unit. Anything built from a recipe belongs on
      // /ingredients — the server refuses counts and deliveries on it, so
      // offering those actions here would be a button that returns an error.
      const unit = new Set<string>()
      const rp: RecipeProduct[] = []
      for (const p of cat.products || []) {
        const mode = String(p.track_mode || 'stock')
        t[p.item_id] = { low: parseInt(String(p.low_threshold)) || 0, tracked: p.tracked !== false, mode }
        if (mode === 'stock') unit.add(String(p.item_id))
        if (mode === 'recipe') rp.push({
          item_id: p.item_id,
          name: p.name || p.item_id,
          emoji: p.emoji || '🍽️',
          category: p.category || '',
          has_recipe: !!p.has_recipe,
        })
      }
      setThresholds(t)
      setUnitTracked(unit)
      setRecipeProducts(rp)
    }
    // Load suppliers for the receive modal
    try {
      const sup = await apiGet('/api/me/suppliers', k)
      if (sup.ok) setSuppliers((sup.suppliers || []).filter((s: any) => !s.archived).map((s: any) => ({ id: s.id, name: s.name })))
    } catch {}

    // Load ingredients for the combined stock view
    try {
      const ing = await apiGet('/api/me/ingredients', k)
      if (ing.ok && ing.ready !== false) {
        setIngs((ing.ingredients || []).filter((i: any) => !i.archived))
        setIngReady(true)
      }
    } catch {}

    // Load rupture state and can_make from the stock endpoint.
    // The migration may not have run yet — tolerate absence of the fields.
    try {
      const stockRows = await apiGet('/api/stock', k)
      if (stockRows.ok && Array.isArray(stockRows.stock)) {
        const r: Record<string, boolean> = {}
        for (const row of stockRows.stock) {
          if (row && row.item_id != null && row.is_available === false) {
            r[String(row.item_id)] = true
          }
        }
        setRupture(r)
      }
      if (stockRows.ok && stockRows.can_make && typeof stockRows.can_make === 'object') {
        setCanMake(stockRows.can_make as Record<string, number>)
      }
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

  /** Enable/disable the stock module for this establishment. POS polls
   *  /api/stock and caches the answer — no EXE rebuild needed. */
  async function toggleStockModule() {
    if (!key) return
    const next = !stockOn
    setStockBusy(true); setMsg('')
    const d = await apiPost('/api/me/config', { key, stockTracking: next })
    setStockBusy(false)
    if (d.ok) {
      setStockOn(next)
      setMsg(next
        ? '📦 Module stock activé — la prochaine synchro caisse l\'appliquera'
        : '📦 Module stock désactivé — la caisse n\'affichera plus le stock')
    } else setMsg(d.error || 'Erreur')
  }

  /** Mark / unmark a product as out of stock from the web dashboard.
   *  No lock check — availability is always editable, regardless of posStockLocked.
   *  The POS picks up the new state on its next pullCloudCosts poll (30 min max,
   *  or immediately on reconnect). Last-write-wins with safety bias on the server:
   *  a near-simultaneous POS "rupture" beats a web "restore". */
  async function toggleRupture(itemId: string, itemName: string) {
    if (!key) return
    const isOut = !!rupture[itemId]
    setRuptureBusy(b => ({ ...b, [itemId]: true }))
    const d = await apiPost('/api/stock', {
      key,
      mode: 'rupture',
      actor: 'web',
      items: [{ item_id: itemId, state: isOut ? 'in' : 'out', ts: new Date().toISOString() }],
    })
    setRuptureBusy(b => ({ ...b, [itemId]: false }))
    if (d.ok) {
      setRupture(r => {
        const next = { ...r }
        if (isOut) delete next[itemId]
        else next[itemId] = true
        return next
      })
      setMsg(isOut
        ? `✓ ${itemName} remis en vente`
        : `⛔ ${itemName} marqué en rupture — la caisse bloquera la vente`)
    } else {
      setMsg(d.error || 'Erreur lors du changement de disponibilité')
    }
  }

  async function submitMovement(payload: any) {
    if (!key) return
    setSaving(true); setMsg('')
    const d = await apiPost('/api/me/stock-log', { key, ...payload })
    setSaving(false)
    if (d.ok) { setMove(null); await load(key); setMsg('✓ Mouvement enregistré') }
    else setMsg(d.error || 'Erreur')
  }

  async function submitIngMovement(payload: any) {
    if (!key) return
    setSavingIng(true); setMsg('')
    const d = await apiPost('/api/me/ingredients', { key, action: 'moveIngredient', ...payload })
    setSavingIng(false)
    if (d.ok) { setMoveIng(null); await load(key); setMsg('✓ Mouvement ingrédient enregistré') }
    else setMsg(d.error || 'Erreur')
  }

  // A product with no last_count_at has never had a physical inventory —
  // theorique is pure deltas from an assumed zero, so a negative number here
  // means "never counted", not "oversold". Treating it as a real low-stock
  // alert would show the owner a bare negative quantity that looks broken.
  const isNeverCounted = (v: Variance) => !v.last_count_at

  const isLow = (v: Variance) => {
    const t = thresholds[v.item_id]
    if (!t || !t.tracked) return false
    if (isNeverCounted(v)) return false
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
    if (category) out = out.filter(v => (v.category || 'Autre') === category)
    if (search) {
      const q = search.toLowerCase()
      out = out.filter(v => (v.item_name || '').toLowerCase().includes(q) || (v.category || '').toLowerCase().includes(q))
    }
    // Low stock and never-counted first — like a POS category grid, but the
    // thing that needs attention should never be scrolled past.
    return [...out].sort((a, b) => {
      const rank = (v: Variance) => (isLow(v) ? 0 : isNeverCounted(v) ? 1 : 2)
      return rank(a) - rank(b)
    })
  }, [variance, search, onlyLow, category, thresholds, unitTracked])

  /** Categories present among unit-tracked products, for the filter pills. */
  const categories = useMemo(() => {
    const set = new Set<string>()
    variance.filter(v => isUnit(v.item_id)).forEach(v => set.add(v.category || 'Autre'))
    return [...set].sort()
  }, [variance, unitTracked])

  const unitVariance = useMemo(() => variance.filter(v => isUnit(v.item_id)), [variance, unitTracked])
  const lowList = unitVariance.filter(isLow)
  // Tracked products with no baseline count yet — distinct from a real
  // low-stock alert, and calmer: there's nothing wrong, just an action to take.
  const neverCountedList = unitVariance.filter(v => {
    const t = thresholds[v.item_id]
    return !!t?.tracked && isNeverCounted(v)
  })
  // Never-counted products carry a meaningless negative theorique (see
  // isNeverCounted above) — including them here would show a nonsensical
  // negative total stock value for a café that hasn't lost any money.
  const stockValue = unitVariance.reduce((a, v) => a + (isNeverCounted(v) ? 0 : v.theorique * num(v.cost)), 0)
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
            onClick={toggleStockModule}
            disabled={stockBusy}
            style={stockOn ? undefined : { opacity: 0.65 }}
            title={stockOn ? 'Désactiver le module stock sur la caisse' : 'Activer le module stock sur la caisse'}
          >
            {stockBusy ? '…' : <>📦 Module stock {stockOn ? 'ON' : 'OFF'}</>}
          </button>
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
      {!stockOn && (
        <div className="mb14">
          <span className="pill p-warn">
            📦 Module stock désactivé — la caisse n&apos;affiche ni ne décompte le stock
          </span>
        </div>
      )}

      {posLocked && stockOn && (
        <div className="mb14">
          <span className="pill p-warn">
            <Icon name="lock" size={13} />
            Caisse en lecture seule — le stock se gère ici
          </span>
        </div>
      )}

      {/* A long initial list of zeroes is a setup state, not an emergency.
          Make the next decision explicit instead of asking an owner to infer it
          from dozens of red rows. */}
      {unitVariance.length >= 12 && lowList.length >= 12 && (
        <div className="notice nInfo mb14">
          <span className="noticeIcon">✓</span>
          <div>
            <div className="noticeTitle">Configurer le suivi du stock</div>
            Ne suivez que ce que vous comptez réellement : <b>à l&apos;unité</b> pour les boissons,
            <b> par recette</b> pour les plats, ou <b>non suivi</b> pour le reste.{' '}
            <a href="/catalog">Configurer les produits →</a>
          </div>
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

      {unitVariance.length > 0 && (() => {
        const lowN = lowList.length
        const neverN = neverCountedList.length
        const okN = Math.max(0, unitVariance.length - lowN - neverN)
        const total = unitVariance.length
        const pct = (n: number) => (n / total) * 100
        return (
          <div className="stat mb20">
            <div className="statLabel">État du stock — {total} produit(s) suivi(s)</div>
            <div style={{ display: 'flex', height: 14, borderRadius: 7, overflow: 'hidden', margin: '10px 0 8px', background: 'var(--border)' }}>
              {okN > 0 && <div style={{ width: pct(okN) + '%', background: 'var(--ok)' }} title={okN + ' OK'} />}
              {lowN > 0 && <div style={{ width: pct(lowN) + '%', background: 'var(--danger)' }} title={lowN + ' stock bas'} />}
              {neverN > 0 && <div style={{ width: pct(neverN) + '%', background: 'var(--info-line, #93c5fd)' }} title={neverN + ' jamais compté'} />}
            </div>
            <div className="row" style={{ gap: 14, flexWrap: 'wrap', fontSize: 12 }}>
              <span><span style={{ color: 'var(--ok)' }}>●</span> {okN} OK</span>
              <span><span style={{ color: 'var(--danger)' }}>●</span> {lowN} stock bas</span>
              <span><span style={{ color: 'var(--info-line, #93c5fd)' }}>●</span> {neverN} jamais compté</span>
            </div>
          </div>
        )
      })()}

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

      {neverCountedList.length > 0 && (
        <div className="notice nInfo">
          <span className="noticeIcon">🔢</span>
          <div>
            <div className="noticeTitle">{neverCountedList.length} produit(s) jamais compté(s)</div>
            <div className="t12">Rien d&apos;anormal — faites un premier inventaire pour activer les alertes de stock bas sur ces produits.</div>
            {neverCountedList.slice(0, 8).map(v => (
              <div key={v.item_id}>• {v.item_emoji} {v.item_name}</div>
            ))}
            {neverCountedList.length > 8 && <div className="cMuted">…et {neverCountedList.length - 8} autre(s)</div>}
          </div>
        </div>
      )}

      <div className="toolbar">
        <button className="chip" data-on={tab === 'levels'} onClick={() => setTab('levels')}>
          🥤 Stock produits <span className="t11 cMuted">(unité)</span>
        </button>
        <button className="chip" data-on={tab === 'recipe'} onClick={() => setTab('recipe')}>
          🧪 Par recette
          {recipeProducts.filter(p => (canMake[p.item_id] ?? 1) === 0).length > 0 && (
            <span className="badge bDanger" style={{ marginLeft: 6 }}>
              {recipeProducts.filter(p => (canMake[p.item_id] ?? 1) === 0).length}
            </span>
          )}
        </button>
        <button className="chip" data-on={tab === 'ingredients'} onClick={() => setTab('ingredients')}>
          🧀 Stock ingrédients <span className="t11 cMuted">(kg, L…)</span>
          {ingReady && ings.filter(i => i.is_low).length > 0 && (
            <span className="badge bDanger" style={{ marginLeft: 6 }}>{ings.filter(i => i.is_low).length}</span>
          )}
        </button>
        <button className="chip" data-on={tab === 'moves'} onClick={() => setTab('moves')}>Mouvements</button>
        <button className="chip" data-on={tab === 'ecarts'} onClick={() => setTab('ecarts')}>
          Écarts{ecarts.length ? ` (${ecarts.length})` : ''}
        </button>
        <input
          className="input" style={{ maxWidth: 250, marginLeft: 8 }}
          placeholder="🔍 Rechercher…" value={search} onChange={e => setSearch(e.target.value)}
        />
        {tab === 'levels' && (
          <button className="chip spacer" data-on={onlyLow} onClick={() => setOnlyLow(!onlyLow)}>Stock bas seulement</button>
        )}
      </div>

      {tab === 'levels' && categories.length > 1 && (
        <div className="toolbar" style={{ marginTop: -8 }}>
          <button className="chip" data-on={category === null} onClick={() => setCategory(null)}>Toutes catégories</button>
          {categories.map(c => (
            <button key={c} className="chip" data-on={category === c} onClick={() => setCategory(category === c ? null : c)}>{c}</button>
          ))}
        </div>
      )}

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


      {/* ── Par recette ── */}
      {tab === 'recipe' && (
        <div className="card">
          <div className="tableWrap">
            <table className="t">
              <thead>
                <tr>
                  <th>Produit</th>
                  <th>Suivi</th>
                  <th className="tr">Portions faisables</th>
                  <th className="tr">Statut</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {recipeProducts.length === 0 ? (
                  <tr><td colSpan={5}>
                    <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)' }}>
                      Aucun produit en mode &quot;Par recette&quot;.{' '}
                      <a href="/catalog">Configurer sur /catalog →</a>
                    </div>
                  </td></tr>
                ) : recipeProducts
                    .filter(p => !search || p.name.toLowerCase().includes(search.toLowerCase()) || p.category.toLowerCase().includes(search.toLowerCase()))
                    .map(p => {
                      const q     = canMake[p.item_id] ?? null
                      const isOut = !!rupture[p.item_id]
                      const empty = q === 0
                      const low   = q !== null && q > 0 && q <= 3
                      const statusCls = isOut ? 'bDanger' : empty ? 'bDanger' : low ? 'bWarn' : q === null ? 'bNeutral' : 'bOk'
                      const statusTxt = isOut ? '⛔ Rupture' : empty ? '0 faisable' : low ? `⚠ ${q} restant` : q === null ? 'non calculé' : `✓ ${q} possible`
                      return (
                        <tr key={p.item_id} style={isOut ? { background: 'var(--danger-bg, #fff1f1)' } : undefined}>
                          <td>
                            <div className="row" style={{ gap: 8 }}>
                              <span style={{ fontSize: 17 }}>{p.emoji}</span>
                              <div>
                                <div className="strong">{p.name}</div>
                                <div className="t11 cFaint">{p.category || '—'}</div>
                                {isOut && <span className="badge bDanger" style={{ marginTop: 3, display: 'inline-block' }}>⛔ rupture</span>}
                              </div>
                            </div>
                          </td>
                          <td>
                            <div className="row" style={{ gap: 4 }}>
                              <span className="badge bInfo" style={{ fontSize: 11 }}>🧪 Par recette</span>
                              {!p.has_recipe && <span className="badge bWarn" style={{ fontSize: 11 }}>⚠ sans recette</span>}
                            </div>
                          </td>
                          <td className="tr num nowrap">
                            <span style={{ fontSize: 20, fontWeight: 700, color: (empty || isOut) ? 'var(--danger)' : low ? 'var(--warn)' : 'var(--ok)' }}>
                              {q === null ? '—' : q}
                            </span>
                          </td>
                          <td className="tr nowrap">
                            <span className={'badge ' + statusCls} style={{ fontSize: 11 }}>{statusTxt}</span>
                          </td>
                          <td className="tr nowrap actionCell">
                            <button
                              className="btn btnSm"
                              style={isOut
                                ? { background: 'var(--ok)', color: '#fff', borderColor: 'var(--ok)' }
                                : { borderColor: 'var(--danger)', color: 'var(--danger)' }}
                              disabled={!!ruptureBusy[p.item_id]}
                              onClick={() => toggleRupture(p.item_id, p.name)}
                            >
                              {ruptureBusy[p.item_id] ? '...' : isOut ? '✓ Remettre en vente' : '⛔ Rupture'}
                            </button>
                          </td>
                        </tr>
                      )
                    })}
              </tbody>
            </table>
          </div>
          {recipeProducts.length > 0 && (
            <div className="t11 cMuted" style={{ padding: '8px 12px' }}>
              Portions calculees depuis les niveaux d&apos;ingredients actuels.{' '}
              <a href="/ingredients">Voir les ingredients →</a>
            </div>
          )}
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
                  <th>Suivi du stock</th>
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
                  <tr><td colSpan={8}><Empty icon="📦" text="Aucun produit suivi. Définissez une quantité depuis la caisse ou faites un inventaire." /></td></tr>
                ) : filtered.map(v => {
                  const t = thresholds[v.item_id]
                  const low = isLow(v)
                  const neverCounted = isNeverCounted(v)
                  const isRupture = !!rupture[v.item_id]
                  const trackMode = t?.mode || 'stock'
                  const modeLabel  = trackMode === 'recipe' ? 'Par recette' : trackMode === 'none' ? 'Non suivi' : 'À l\'unité'
                  const modeClass  = trackMode === 'recipe' ? 'bInfo' : trackMode === 'none' ? 'bNeutral' : 'bOk'
                  return (
                    <tr key={v.item_id} style={isRupture ? { background: 'var(--danger-bg, #fff1f1)' } : undefined}>
                      <td>
                        <div className="strong">{v.item_name || v.item_id}</div>
                        <div className="t11 cFaint">{v.category || '—'}</div>
                        {isRupture && (
                          <span className="badge bDanger" style={{ marginTop: 3, display: 'inline-block' }}>
                            ⛔ rupture
                          </span>
                        )}
                      </td>
                      {/* Suivi du stock — mirrors /catalog so the two pages agree */}
                      <td data-label="Suivi du stock">
                        <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
                          <span className={'badge ' + modeClass} style={{ fontSize: 11 }}>{modeLabel}</span>
                          {trackMode === 'stock' && (
                            <span
                              className={'badge ' + (neverCounted ? 'bNeutral' : low ? 'bDanger' : 'bOk')}
                              style={{ fontSize: 11 }}
                            >
                              {neverCounted ? 'jamais compté' : low ? 'stock bas' : 'stockOK'}
                            </span>
                          )}
                        </div>
                      </td>
                      <td data-label="En stock" className="tr num nowrap">
                        {neverCounted ? (
                          <span className="cMuted" style={{ fontSize: 13 }}>non compté</span>
                        ) : (
                          <span className={low ? 'bold cDanger' : 'bold'} style={{ fontSize: 15 }}>{qtyTrim(v.theorique)}</span>
                        )}
                        {low && !neverCounted && <span className="badge bDanger" style={{ marginLeft: 6 }}>stock bas</span>}
                      </td>
                      <td data-label="Seuil" className="tr num t13 cMuted">{t?.tracked ? t.low : '—'}</td>
                      <td data-label="Valeur" className="tr num nowrap">{neverCounted ? '—' : f3(v.theorique * num(v.cost)) + ' DT'}</td>
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
                        {/* Rupture toggle — no lock check, always available.
                            Manager can mark something out of stock remotely
                            (e.g. milk delivery didn't arrive). POS picks it up
                            on next pullCloudCosts poll. */}
                        <button
                          className={'btn btnSm' + (isRupture ? ' btnDanger' : '')}
                          style={isRupture ? { background: 'var(--danger)', color: '#fff', borderColor: 'var(--danger)' } : undefined}
                          title={isRupture ? 'Remettre en vente' : 'Marquer en rupture — bloque la vente sur la caisse'}
                          disabled={!!ruptureBusy[v.item_id]}
                          onClick={() => toggleRupture(v.item_id, v.item_name || v.item_id)}
                        >
                          {ruptureBusy[v.item_id] ? '…' : (isRupture ? '✓ Remettre en vente' : '⛔ Rupture')}
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

      {/* ── Ingredient stock ── */}
      {tab === 'ingredients' && (
        !ingReady ? (
          <div className="notice nWarn">
            <span className="noticeIcon">i</span>
            <div>Les ingrédients ne sont pas encore configurés. Allez sur
              {' '}<a href="/ingredients">Recettes</a> pour les ajouter.</div>
          </div>
        ) : (
          <div className="card">
            <div className="tableWrap">
              <table className="t">
                <thead>
                  <tr>
                    <th>Ingrédient</th>
                    <th>Niveau</th>
                    <th className="tr">En stock</th>
                    <th className="tr">Valeur</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {ings.filter(i => !search || i.name.toLowerCase().includes(search.toLowerCase())).length === 0 ? (
                    <tr><td colSpan={5}><Empty icon="flask" text="Aucun ingrédient." /></td></tr>
                  ) : ings
                      .filter(i => !search || i.name.toLowerCase().includes(search.toLowerCase()))
                      .map(i => (
                    <tr key={i.ing_key}>
                      <td>
                        <div className="strong">{i.name}</div>
                        <div className="t11 cFaint">{i.category || '—'}</div>
                      </td>
                      <td data-label="Niveau" style={{ minWidth: 120 }}>
                        <LevelMeter value={i.quantity} threshold={i.low_threshold} unit={i.stock_unit} />
                      </td>
                      <td data-label="En stock" className="tr num nowrap">
                        <span className={i.is_low ? 'bold cDanger' : ''}>{qtyTrim(i.quantity)}</span>
                        <span className="t11 cFaint"> {i.stock_unit}</span>
                      </td>
                      <td data-label="Valeur" className="tr num nowrap">{f3(i.stock_value)} DT</td>
                      <td className="tr actionCell">
                        <button className="btn btnSm btnPrimary" onClick={() => setMoveIng(i)}>Stock</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
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
      {moveIng && (
        <IngredientMovementModal
          ingredient={moveIng} saving={savingIng} suppliers={suppliers}
          onClose={() => setMoveIng(null)} onSubmit={submitIngMovement}
        />
      )}
    </Shell>
  )
}

function IngredientMovementModal({ ingredient, saving, suppliers, onClose, onSubmit }: any) {
  const [kind, setKind] = useState<'receive' | 'waste' | 'count'>('receive')
  const [qty, setQty] = useState('')
  const [unitCost, setUnitCost] = useState(ingredient.cost_per_stock_unit > 0 ? String(ingredient.cost_per_stock_unit) : '')
  const [reason, setReason] = useState('')
  const [supplierId, setSupplierId] = useState<number | null>(null)
  const [paymentMethod, setPaymentMethod] = useState<'comptant' | 'credit'>('comptant')
  const [dueDate, setDueDate] = useState('')
  const q = num(qty)
  const valid = kind === 'count' ? qty !== '' && q >= 0 : q > 0
  const after = kind === 'count' ? q : kind === 'receive' ? num(ingredient.quantity) + q : num(ingredient.quantity) - q

  const submit = () => valid && onSubmit({
    ing_key: ingredient.ing_key, kind, qty: q,
    ...(kind === 'receive' && num(unitCost) > 0 ? { unit_cost: num(unitCost) } : {}),
    ...(reason.trim() ? { reason: reason.trim() } : {}),
    ...(kind === 'receive' && supplierId ? { supplier_id: supplierId } : {}),
    ...(kind === 'receive' ? { payment_method: paymentMethod } : {}),
    ...(kind === 'receive' && paymentMethod === 'credit' ? { due_at: dueDate || null } : {}),
  })

  return <div className="overlay" onClick={onClose}>
    <div className="modal" style={{ maxWidth: 460 }} onClick={e => e.stopPropagation()}>
      <div className="modalHead"><div><div className="modalTitle">🧀 {ingredient.name}</div><div className="t12 cMuted">En stock : <b>{qtyTrim(ingredient.quantity)} {ingredient.stock_unit}</b></div></div><button className="btn btnGhost btnSm spacer" onClick={onClose}>✕</button></div>
      <div className="modalBody col" style={{ gap: 14 }}>
        <div className="row wrap" style={{ gap: 6 }}>
          <button className="chip" data-on={kind === 'receive'} onClick={() => setKind('receive')}>📥 Livraison</button>
          <button className="chip" data-on={kind === 'waste'} onClick={() => setKind('waste')}>🗑️ Perte</button>
          <button className="chip" data-on={kind === 'count'} onClick={() => setKind('count')}>📋 Inventaire</button>
        </div>
        <div className="field"><label className="label">{kind === 'count' ? 'Quantité comptée' : 'Quantité'} ({ingredient.stock_unit})</label><input className="input inputNum" type="number" step="0.001" min="0" autoFocus value={qty} onChange={e => setQty(e.target.value)} /><span className="help">{kind === 'count' ? 'Le comptage fixe le nouveau stock.' : `Stock après : ${qtyTrim(after)} ${ingredient.stock_unit}`}</span></div>
        {kind === 'receive' && <><div className="field"><label className="label">Prix payé par {ingredient.stock_unit} (optionnel)</label><input className="input inputNum" type="number" step="0.001" min="0" value={unitCost} onChange={e => setUnitCost(e.target.value)} /></div><div className="field"><label className="label">Fournisseur</label><select className="input" value={supplierId ?? ''} onChange={e => setSupplierId(e.target.value ? parseInt(e.target.value) : null)}><option value="">Passager (pas de fiche)</option>{suppliers.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div><div className="row" style={{ gap: 6 }}><button className="chip" data-on={paymentMethod === 'comptant'} onClick={() => setPaymentMethod('comptant')}>Comptant</button><button className="chip" data-on={paymentMethod === 'credit'} onClick={() => setPaymentMethod('credit')}>À crédit</button></div>{paymentMethod === 'credit' && <div className="field"><label className="label">Échéance</label><input className="input" type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} min={new Date().toISOString().slice(0,10)} /><span className="help">Par défaut 30 jours si laissé vide</span></div>}</>}
        {kind !== 'receive' && <div className="field"><label className="label">Motif (optionnel)</label><input className="input" value={reason} onChange={e => setReason(e.target.value)} placeholder={kind === 'waste' ? 'Périmé, cassé…' : 'Inventaire'} /></div>}
      </div>
      <div className="modalFoot"><button className="btn" onClick={onClose}>Annuler</button><button className="btn btnPrimary" disabled={!valid || saving} onClick={submit}>{saving ? 'Enregistrement…' : 'Enregistrer'}</button></div>
    </div>
  </div>
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
  const [dueDate, setDueDate] = useState('')

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
              {payMethod === 'credit' && (
                <div className="field">
                  <label className="label">Échéance</label>
                  <input
                    className="input" type="date"
                    value={dueDate} onChange={e => setDueDate(e.target.value)}
                    min={new Date().toISOString().slice(0, 10)}
                  />
                  <span className="help">Par défaut 30 jours si laissé vide</span>
                </div>
              )}
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
              ...(isReceive && payMethod === 'credit' ? { due_at: dueDate || null } : {}),
            })}
          >{saving ? '…' : 'Enregistrer'}</button>
        </div>
      </div>
    </div>
  )
}
