'use client'
// ═══════════════════════════════════════════════════════════════════
// /ingredients — what you BUY, and the recipes that consume it.
//
// Two tabs because these are two different jobs:
//   Ingrédients  the things you purchase, in purchase units, with a price
//   Recettes     which ingredients each product consumes
//
// Recipes are OPTIONAL. A product without one keeps its manual cost and
// deducts nothing — you can cost your five biggest sellers and ignore the rest.
// ═══════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useState } from 'react'
import {
  Shell, LoginGate, NotReady, Loading, Empty, useApiKey, apiGet, apiPost, f3, num,
  qtyTrim, qtyDelta, LevelMeter, BarList, DaysCover, dt,
} from '../ui/Shell'

type Ing = {
  ing_key: string; name: string; category: string
  stock_unit: string; recipe_unit: string; conversion_factor: number
  cost_per_stock_unit: number; cost_per_recipe_unit: number
  quantity: number; low_threshold: number
  tracked: boolean; archived: boolean
  stock_value: number; is_low: boolean; used_in_recipes: number
}
type Product = { item_id: string; name: string; category: string; emoji: string; price: number }
/** 30-day rollup per ingredient, from the movement ledger. */
type Usage = {
  ing_key: string
  consumed_30d: number; wasted_30d: number; received_30d: number; spent_30d: number
  last_receive_at: string | null
  /** Days the ledger actually covers — dividing by a flat 30 would lie early on. */
  days_span: number
}
type Movement = {
  id: number; ing_key: string; name: string | null; stock_unit: string | null
  kind: 'consume' | 'receive' | 'waste' | 'adjust' | 'count'
  delta: number | null; count_value: number | null; unit_cost: number | null
  reason: string | null; actor: string | null; source: string | null
  sale_num: number | null; client_ts: string
}

/** An ingredient plus the two figures that turn its quantity into a decision. */
type IngView = Ing & {
  /** Stock units consumed per day, from real history. Null when unknown. */
  rate: number | null
  /** How many days the current quantity lasts at that rate. Null when unknown. */
  daysLeft: number | null
  usage: Usage | null
}

const MOVE_LABEL: Record<Movement['kind'], string> = {
  consume: 'Vente',
  receive: 'Livraison',
  waste: 'Perte',
  adjust: 'Correction',
  count: 'Comptage',
}
type Recipe = {
  item_id: string; item_name: string; cost_mode: 'auto' | 'manual'
  cost_override: number | null; enabled: boolean; yield_qty: number
  cost_computed: number; cost_effective: number
  nb_lines: number; lines_missing_cost: number
  lines: { ing_key: string; qty: number }[]
  /** Portions still producible from current ingredient stock. Null when no
   *  tracked ingredient constrains the product. */
  buildable: number | null
  /** The ingredient that runs out first — what to buy to unblock this product. */
  limited_by: { ing_key: string; name: string; available: number; need: number; unit: string } | null
  /** A recipe line points at a missing ingredient, so the figure is incomplete. */
  buildable_unknown: boolean
}

const BLANK: Partial<Ing> = {
  name: '', category: '', stock_unit: 'kg', recipe_unit: 'g',
  conversion_factor: 1000, cost_per_stock_unit: 0, quantity: 0,
  low_threshold: 0, tracked: true,
}

// Common purchase→recipe unit pairs, so nobody has to work out the factor.
const PRESETS = [
  { label: 'kg → g',        stock_unit: 'kg',     recipe_unit: 'g',     conversion_factor: 1000 },
  { label: 'L → ml',        stock_unit: 'L',      recipe_unit: 'ml',    conversion_factor: 1000 },
  { label: 'pièce → pièce', stock_unit: 'pièce',  recipe_unit: 'pièce', conversion_factor: 1 },
  { label: 'paquet de 50',  stock_unit: 'paquet', recipe_unit: 'pièce', conversion_factor: 50 },
  { label: 'sac de 25 kg',  stock_unit: 'sac',    recipe_unit: 'g',     conversion_factor: 25000 },
]

export default function IngredientsPage() {
  const { key, checked } = useApiKey()
  const [loading, setLoading] = useState(true)
  const [ready, setReady] = useState(true)
  const [msg, setMsg] = useState('')
  const [restName, setRestName] = useState('')
  // Opens on the buy list: "what do I need to order" is the question this page
  // gets asked, and it was previously three clicks and a mental subtraction away.
  const [tab, setTab] = useState<'buy' | 'ing' | 'rec' | 'log'>('buy')
  // Recipes are optional. When the module is off the page stops offering them
  // instead of showing tools nobody will maintain. Defaults to on.
  // Module state is READ from the server config, never changed from here.
  const [ingOn, setIngOn] = useState(true)

  const [ings, setIngs] = useState<Ing[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [totals, setTotals] = useState<any>(null)
  const [usage, setUsage] = useState<Usage[]>([])
  const [movements, setMovements] = useState<Movement[]>([])
  /** Suppliers for the receive modal dropdown. */
  const [suppliers, setSuppliers] = useState<{ id: number; name: string }[]>([])
  /** Quick quantity update, one ingredient at a time. */
  const [moveIng, setMoveIng] = useState<Ing | null>(null)
  /** Archive is a deliberate lifecycle action, so it gets its own reason dialog. */
  const [archiveIng, setArchiveIng] = useState<Ing | null>(null)

  const [search, setSearch] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [editIng, setEditIng] = useState<Partial<Ing> | null>(null)
  const [editRec, setEditRec] = useState<{ product: Product; recipe: Recipe | null } | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (key) load(key)
    else if (checked) setLoading(false)
  }, [key, checked])

  async function load(k: string) {
    setLoading(true); setMsg('')
    const d = await apiGet('/api/me/ingredients', k)
    if (d.ok) {
      setReady(d.ready !== false)
      setRestName(d.name || '')
      setIngs(d.ingredients || [])
      setProducts(d.products || [])
      setRecipes(d.recipes || [])
      setTotals(d.totals || null)
      setUsage(d.usage || [])
      setMovements(d.movements || [])
    } else setMsg(d.error || 'Erreur de chargement')
    // Load suppliers
    try {
      const sup = await apiGet('/api/me/suppliers', k)
      if (sup.ok) setSuppliers((sup.suppliers || []).filter((s: any) => !s.archived).map((s: any) => ({ id: s.id, name: s.name })))
    } catch {}
    setLoading(false)
  }

  async function save(action: string, payload: any) {
    if (!key) return
    setSaving(true); setMsg('')
    const d = await apiPost('/api/me/ingredients', { key, action, ...payload })
    setSaving(false)
    if (d.ok) { setEditIng(null); setEditRec(null); setMoveIng(null); setArchiveIng(null); await load(key) }
    else setMsg(d.error || 'Erreur')
    return d.ok
  }

  const usageByKey = useMemo(() => {
    const m: Record<string, Usage> = {}
    for (const u of usage) m[u.ing_key] = u
    return m
  }, [usage])

  /**
   * Attach a burn rate and days of cover to every ingredient.
   *
   * The rate divides by the number of days the ledger ACTUALLY covers, not by a
   * flat 30. A café that started tracking two days ago would otherwise see its
   * consumption reported at a fifteenth of the truth and order nothing.
   *
   * Waste counts towards the rate: it leaves the building either way, so
   * excluding it would under-order.
   */
  const views: IngView[] = useMemo(() => ings.map(i => {
    const u = usageByKey[i.ing_key] || null
    const out = u ? (u.consumed_30d + u.wasted_30d) : 0
    const span = u ? Math.max(1, u.days_span) : 0
    const rate = u && out > 0 ? out / span : null
    const daysLeft = rate && rate > 0 ? i.quantity / rate : null
    return { ...i, usage: u, rate, daysLeft }
  }), [ings, usageByKey])

  const visibleIngs = useMemo(() => {
    let out = views.filter(i => (showArchived ? true : !i.archived))
    if (search) {
      const q = search.toLowerCase()
      out = out.filter(i => i.name.toLowerCase().includes(q) || (i.category || '').toLowerCase().includes(q))
    }
    return out
  }, [views, search, showArchived])

  /**
   * The buy list. Two independent reasons to appear, because they catch
   * different failures:
   *   • below the manual threshold — the operator's own judgement
   *   • under a week of cover      — measured, and catches an item whose
   *                                 threshold was never set or set too low
   * Sorted by urgency: whatever runs out first is at the top.
   */
  /**
   * Which products a given ingredient currently caps.
   *
   * Declared before `toBuy` because the buy list uses it, and as a hook it must
   * sit above every early return in this component.
   */
  const blockedByIng = useMemo(() => {
    const m: Record<string, { name: string; buildable: number }[]> = {}
    for (const r of recipes) {
      if (!r.enabled || !r.limited_by || r.buildable == null) continue
      ;(m[r.limited_by.ing_key] ||= []).push({ name: r.item_name, buildable: r.buildable })
    }
    for (const k of Object.keys(m)) m[k].sort((a, b) => a.buildable - b.buildable)
    return m
  }, [recipes])

  const toBuy = useMemo(() => {
    const rows = views.filter(i => {
      if (i.archived || !i.tracked) return false
      // A third reason, and the strongest one: this ingredient is what stops a
      // dish being made. That can be true while the quantity is still above its
      // threshold — a recipe needing 2 kg per portion is blocked at 1.9 kg — so
      // the threshold alone would miss it.
      const caps = blockedByIng[i.ing_key] || []
      const blocksSomething = caps.some(c => c.buildable <= 5)
      return i.is_low || (i.daysLeft != null && i.daysLeft <= 7) || blocksSomething
    })
    return rows.sort((a, b) => {
      // Anything blocking a dish outright goes first: it is already costing sales.
      const ba = (blockedByIng[a.ing_key] || []).some(c => c.buildable === 0) ? -1 : 0
      const bb = (blockedByIng[b.ing_key] || []).some(c => c.buildable === 0) ? -1 : 0
      if (ba !== bb) return ba - bb
      const da = a.daysLeft ?? (a.is_low ? 0.5 : 999)
      const db = b.daysLeft ?? (b.is_low ? 0.5 : 999)
      return da - db
    })
  }, [views, blockedByIng])

  const recByItem = useMemo(() => {
    const m: Record<string, Recipe> = {}
    for (const r of recipes) m[r.item_id] = r
    return m
  }, [recipes])

  const visibleProducts = useMemo(() => {
    if (!search) return products
    const q = search.toLowerCase()
    return products.filter(p => p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q))
  }, [products, search])

  if (!checked || loading) return <Shell active="/ingredients" title="Ingrédients & recettes" restName={restName}><Loading /></Shell>
  if (!key) return <LoginGate />

  const lowCount = ings.filter(i => i.is_low).length

  // 30-day money figures. Waste is valued at the purchase price, which is what it
  // actually cost to throw away.
  const spent30 = usage.reduce((a, u) => a + (u.spent_30d || 0), 0)
  const wasted30 = views.reduce(
    (a, i) => a + ((i.usage?.wasted_30d || 0) * (i.cost_per_stock_unit || 0)), 0
  )

  // Products that can no longer be made, and those nearly there. This is the
  // consequence of a shortage, which is more actionable than the shortage itself:
  // "cheese is low" matters because "you cannot make pizza".
  const blocked = recipes.filter(r => r.enabled && r.buildable === 0)
  const nearlyBlocked = recipes.filter(r => r.enabled && r.buildable != null && r.buildable > 0 && r.buildable <= 5)

  return (
    <Shell
      active="/ingredients"
      title="Ingrédients & recettes"
      subtitle="Ce que vous achetez, et ce que chaque produit consomme"
      restName={restName}
      badges={{ '/ingredients': lowCount }}
      actions={
        <>
          <button className="btn" onClick={() => key && load(key)}>↻ Recharger</button>
          {ingOn && (
            <button className="btn btnPrimary" onClick={() => setEditIng({ ...BLANK })}>+ Ingrédient</button>
          )}
        </>
      }
    >
      {!ready && <NotReady sql="migration-ingredients.sql" />}
      {msg && <div className="notice nDanger"><span className="noticeIcon">✕</span><div>{msg}</div></div>}

      {/* Module off: stop offering what will not be maintained. Recipes are
          optional by design — a Coca does not need one — so a café that does not
          want them should not have the tab staring at it. */}
      {!ingOn && (
        <Empty
          icon="flask"
          text="Les ingrédients et recettes sont désactivés pour ce compte. Contactez l'administrateur pour les activer."
        />
      )}

      <div className="notice nInfo" hidden>
        <span className="noticeIcon">💡</span>
        <div>
          <div className="noticeTitle">Les recettes sont facultatives</div>
          Un produit sans recette garde son coût saisi à la main et ne déduit aucun ingrédient.
          Vous pouvez n&apos;en créer que pour vos best-sellers. Un Coca ne demande pas de recette
          (1 bouteille = 1 bouteille) ; une pizza, oui.
        </div>
      </div>

      {/* KPIs ordered by what gets acted on, not by what is easiest to count.
          "À commander" leads because it is the only one that implies a task
          today; the inventory value and the data-quality warnings follow. */}
      {ready && (
        <div className="statGrid mb20">
          <div className="stat">
            <div className="statLabel">À commander</div>
            <div className="statValue num" style={{ color: toBuy.length ? 'var(--danger)' : 'var(--ok)' }}>
              {toBuy.length}
            </div>
            <div className="statHint">
              {toBuy.length
                ? `dont ${toBuy.filter(i => (i.daysLeft ?? 9) <= 2).length} sous 2 jours`
                : 'rien d’urgent'}
            </div>
          </div>
          <div className="stat">
            <div className="statLabel">Valeur du stock</div>
            <div className="statValue num">{f3(totals?.stock_value)} DT</div>
            <div className="statHint">{totals?.nb_ingredients ?? 0} ingrédients</div>
          </div>
          <div className="stat">
            <div className="statLabel">Acheté sur 30 j</div>
            <div className="statValue num">{f3(spent30)} DT</div>
            <div className="statHint">
              {wasted30 > 0
                ? <span className="cWarn">{f3(wasted30)} DT perdus</span>
                : 'aucune perte enregistrée'}
            </div>
          </div>
          <div className="stat">
            <div className="statLabel">Sans prix d&apos;achat</div>
            <div className="statValue num" style={{ color: (totals?.nb_sans_cout ?? 0) ? 'var(--warn)' : 'var(--ok)' }}>
              {totals?.nb_sans_cout ?? 0}
            </div>
            <div className="statHint">fausse le coût des recettes</div>
          </div>
          {/* The consequence, stated as a consequence. An owner acts on "two
              dishes cannot be made" faster than on "an ingredient is low". */}
          <div className="stat">
            <div className="statLabel">Plats bloqués</div>
            <div className="statValue num" style={{ color: blocked.length ? 'var(--danger)' : 'var(--ok)' }}>
              {blocked.length}
            </div>
            <div className="statHint">
              {blocked.length
                ? blocked.slice(0, 2).map(r => r.item_name).join(', ') + (blocked.length > 2 ? '…' : '')
                : nearlyBlocked.length
                  ? `${nearlyBlocked.length} bientôt à court`
                  : 'tout est produisible'}
            </div>
          </div>
          <div className="stat">
            <div className="statLabel">Recettes</div>
            <div className="statValue num">{recipes.length}<span className="t13 cFaint"> / {products.length}</span></div>
            <div className="statHint">produits avec fiche technique</div>
          </div>
        </div>
      )}

      <div className="toolbar">
        <button className="chip" data-on={tab === 'buy'} onClick={() => setTab('buy')}>
          À acheter{toBuy.length ? <span className="badge bDanger" style={{ marginLeft: 6 }}>{toBuy.length}</span> : null}
        </button>
        <button className="chip" data-on={tab === 'ing'} onClick={() => setTab('ing')}>Ingrédients</button>
        <button className="chip" data-on={tab === 'rec'} onClick={() => setTab('rec')}>Recettes</button>
        <button className="chip" data-on={tab === 'log'} onClick={() => setTab('log')}>Mouvements</button>
        {tab !== 'log' && (
          <input
            className="input" style={{ maxWidth: 280, marginLeft: 8 }}
            placeholder="Rechercher…" value={search} onChange={e => setSearch(e.target.value)}
          />
        )}
        {tab === 'ing' && (
          <label className="row t12 cMuted" style={{ cursor: 'pointer' }}>
            <input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} />
            Afficher les archivés
          </label>
        )}
      </div>

      {/* ── À acheter ──────────────────────────────────────────────────
          A list you can shop from: what is running out, how fast it goes, how
          much to order, and one button to record the delivery when it arrives. */}
      {tab === 'buy' && (
        <>
          {toBuy.length === 0 ? (
            <Empty
              icon="check"
              text={
                usage.length === 0
                  ? "Rien à commander d'après les seuils. Les vitesses de consommation apparaîtront dès que des ventes auront été enregistrées."
                  : 'Rien à commander : tout est au-dessus du seuil et couvre plus d’une semaine.'
              }
            />
          ) : (
            <div className="card">
              <div className="tableWrap">
                <table className="t">
                  <thead>
                    <tr>
                      <th>Ingrédient</th>
                      <th>Niveau</th>
                      <th className="tr">Il reste</th>
                      <th className="tr">Par jour</th>
                      <th className="tr">À commander</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {toBuy.map(i => {
                      // Suggest two weeks of cover, or twice the threshold when no
                      // rate is known yet. Rounded up to something orderable — a
                      // supplier does not deliver 3.472 kg.
                      const target = i.rate && i.rate > 0 ? i.rate * 14 : Math.max(i.low_threshold * 2, 1)
                      const suggest = Math.max(0, Math.ceil((target - i.quantity) * 10) / 10)
                      return (
                        <tr key={i.ing_key}>
                          <td>
                            <div className="strong">{i.name}</div>
                            <div className="t11 cFaint">
                              {i.category || '—'}
                              {i.usage?.last_receive_at ? ` · dernière livraison ${dt(i.usage.last_receive_at)}` : ''}
                            </div>
                            {/* Why this one matters: the dishes it is holding up.
                                A shortage with a consequence attached gets bought;
                                a number on a list gets ignored. */}
                            {(blockedByIng[i.ing_key] || []).length > 0 && (
                              <div className="t11" style={{ marginTop: 4 }}>
                                {blockedByIng[i.ing_key].slice(0, 3).map(b => (
                                  <span
                                    key={b.name}
                                    className={'badge ' + (b.buildable === 0 ? 'bDanger' : 'bWarn')}
                                    style={{ marginRight: 4 }}
                                  >
                                    {b.name} : {b.buildable === 0 ? 'épuisé' : b.buildable}
                                  </span>
                                ))}
                                {blockedByIng[i.ing_key].length > 3 && (
                                  <span className="cFaint">+{blockedByIng[i.ing_key].length - 3}</span>
                                )}
                              </div>
                            )}
                          </td>
                          <td data-label="Niveau" style={{ minWidth: 130 }}>
                            <LevelMeter value={i.quantity} threshold={i.low_threshold} unit={i.stock_unit} />
                          </td>
                          <td data-label="Il reste" className="tr nowrap">
                            <DaysCover days={i.daysLeft} />
                          </td>
                          <td data-label="Par jour" className="tr num nowrap t12 cMuted">
                            {i.rate ? `${qtyTrim(i.rate)} ${i.stock_unit}` : '—'}
                          </td>
                          <td data-label="À commander" className="tr num nowrap strong">
                            {suggest > 0 ? `${qtyTrim(suggest)} ${i.stock_unit}` : '—'}
                            {i.cost_per_stock_unit > 0 && suggest > 0 && (
                              <div className="t11 cFaint">≈ {f3(suggest * i.cost_per_stock_unit)} DT</div>
                            )}
                          </td>
                          <td className="tr nowrap">
                            <button className="btn btnSm btnPrimary" onClick={() => setMoveIng(i)}>
                              Reçu
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

          {/* Where the money and the stock actually went, last 30 days. */}
          {usage.length > 0 && (
            <div className="grid2" style={{ marginTop: 14 }}>
              <div className="card">
                <div className="cardPad">
                  <div className="cardTitle">
                    Le plus consommé <small>30 derniers jours</small>
                  </div>
                  <BarList
                    emptyText="Aucune consommation enregistrée."
                    rows={views
                      .filter(i => (usageByKey[i.ing_key]?.consumed_30d ?? 0) > 0)
                      .map(i => {
                        const u = usageByKey[i.ing_key]
                        return {
                          label: i.name,
                          value: u.consumed_30d,
                          display: `${qtyTrim(u.consumed_30d)} ${i.stock_unit}`,
                          sub: u.wasted_30d > 0 ? `dont ${qtyTrim(u.wasted_30d)} ${i.stock_unit} de perte` : undefined,
                          tone: 'info' as const,
                        }
                      })}
                  />
                </div>
              </div>

              <div className="card">
                <div className="cardPad">
                  <div className="cardTitle">
                    Le plus acheté <small>30 derniers jours</small>
                  </div>
                  <BarList
                    emptyText="Aucune livraison enregistrée avec un prix."
                    rows={views
                      .filter(i => (usageByKey[i.ing_key]?.spent_30d ?? 0) > 0)
                      .map(i => {
                        const u = usageByKey[i.ing_key]
                        return {
                          label: i.name,
                          value: u.spent_30d,
                          display: `${f3(u.spent_30d)} DT`,
                          sub: `${qtyTrim(u.received_30d)} ${i.stock_unit} reçus`,
                          tone: 'ok' as const,
                        }
                      })}
                  />
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Mouvements ─────────────────────────────────────────────────
          The audit trail. Quantities are derived from these rows, so this is the
          explanation for every number elsewhere on the page. */}
      {tab === 'log' && (
        <div className="card">
          <div className="tableWrap">
            <table className="t">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Ingrédient</th>
                  <th>Type</th>
                  <th className="tr">Quantité</th>
                  <th>Détail</th>
                  <th>Par</th>
                </tr>
              </thead>
              <tbody>
                {movements.length === 0 ? (
                  <tr><td colSpan={6}>
                    <Empty
                      icon="clipboard"
                      text="Aucun mouvement. Les ventes déduisent les ingrédients dès qu’une recette existe ; les livraisons et pertes se saisissent ici."
                    />
                  </td></tr>
                ) : movements.map(m => (
                  <tr key={m.id}>
                    <td data-label="Date" className="t12 cMuted nowrap">{dt(m.client_ts)}</td>
                    <td data-label="Ingrédient" className="strong">{m.name || m.ing_key}</td>
                    <td data-label="Type">
                      <span className={
                        m.kind === 'receive' ? 'badge bOk' :
                        m.kind === 'waste' ? 'badge bDanger' :
                        m.kind === 'count' ? 'badge bInfo' : 'badge bNeutral'
                      }>{MOVE_LABEL[m.kind]}</span>
                    </td>
                    <td data-label="Quantité" className="tr num nowrap">
                      {m.kind === 'count'
                        ? <>= {qtyTrim(m.count_value)} <span className="t11 cFaint">{m.stock_unit}</span></>
                        : <span className={(m.delta ?? 0) < 0 ? 'cDanger' : 'cOk'}>
                            {qtyDelta(m.delta)} <span className="t11 cFaint">{m.stock_unit}</span>
                          </span>}
                    </td>
                    <td data-label="Détail" className="t12 cMuted">
                      {m.sale_num ? `Ticket #${m.sale_num}` : (m.reason || '—')}
                      {m.unit_cost ? ` · ${f3(m.unit_cost)} DT/${m.stock_unit}` : ''}
                    </td>
                    <td data-label="Par" className="t12 cMuted">{m.actor || m.source || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Ingredients ── */}
      {tab === 'ing' && (
        <div className="card">
          <div className="tableWrap">
            <table className="t">
              <thead>
                <tr>
                  <th>Ingrédient</th>
                  <th>Achat</th>
                  <th className="tr">Prix d&apos;achat</th>
                  <th className="tr">Coût unitaire</th>
                  <th>Niveau</th>
                  <th className="tr">Il reste</th>
                  <th className="tr">Valeur</th>
                  <th className="tc">Recettes</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visibleIngs.length === 0 ? (
                  <tr><td colSpan={9}><Empty icon="flask" text="Aucun ingrédient. Commencez par ceux qui coûtent le plus cher." /></td></tr>
                ) : visibleIngs.map(i => (
                  <tr key={i.ing_key} style={i.archived ? { opacity: .5 } : undefined}>
                    <td>
                      <div className="strong">{i.name}</div>
                      <div className="t11 cFaint">{i.category || '—'}{i.archived ? ' · archivé' : ''}</div>
                    </td>
                    <td data-label="Achat" className="t12 cMuted nowrap">
                      1 {i.stock_unit} = {i.conversion_factor} {i.recipe_unit}
                    </td>
                    <td data-label="Prix d'achat" className="tr num nowrap">
                      {i.cost_per_stock_unit > 0
                        ? <>{f3(i.cost_per_stock_unit)} <span className="t11 cFaint">/ {i.stock_unit}</span></>
                        : <span className="badge bWarn">à définir</span>}
                    </td>
                    <td data-label="Coût unitaire" className="tr num t12 cMuted nowrap">
                      {i.cost_per_recipe_unit > 0 ? `${i.cost_per_recipe_unit.toFixed(5)} / ${i.recipe_unit}` : '—'}
                    </td>
                    {/* Quantity, threshold and judgement in one glyph. The old
                        version printed three separate numbers and left the reader
                        to compare them. */}
                    <td data-label="Niveau" style={{ minWidth: 130 }}>
                      {i.tracked
                        ? <LevelMeter value={i.quantity} threshold={i.low_threshold} unit={i.stock_unit} />
                        : <span className="t12 cFaint">non suivi · {qtyTrim(i.quantity)} {i.stock_unit}</span>}
                    </td>
                    <td data-label="Il reste" className="tr nowrap">
                      <DaysCover days={i.daysLeft} />
                      {i.rate ? <div className="t11 cFaint num">{qtyTrim(i.rate)} {i.stock_unit}/j</div> : null}
                    </td>
                    <td data-label="Valeur" className="tr num nowrap">{f3(i.stock_value)} DT</td>
                    <td data-label="Recettes" className="tc">
                      {i.used_in_recipes > 0
                        ? <span className="badge bInfo">{i.used_in_recipes}</span>
                        : <span className="t12 cFaint">—</span>}
                    </td>
                    <td className="tr nowrap">
                      {!i.archived && (
                        <button className="btn btnSm btnPrimary" style={{ marginRight: 6 }} onClick={() => setMoveIng(i)}>
                          Stock
                        </button>
                      )}
                      <button className="btn btnSm" onClick={() => setEditIng(i)}>Modifier</button>
                      {!i.archived && (
                        <button
                          className="btn btnSm btnDanger" style={{ marginLeft: 6 }}
                          onClick={() => {
                            if (i.used_in_recipes > 0) { setMsg(`"${i.name}" est utilisé dans ${i.used_in_recipes} recette(s) — retirez-le d'abord.`); return }
                            setArchiveIng(i)
                          }}
                        >Archiver</button>
                      )}
                      {i.archived && (
                        <button className="btn btnSm btnPrimary" style={{ marginLeft: 6 }}
                          onClick={() => save('restoreIngredient', { ing_key: i.ing_key, reason: 'Remis en service' })}>
                          Restaurer
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Recipes ── */}
      {tab === 'rec' && (
        <div className="card">
          <div className="tableWrap">
            <table className="t">
              <thead>
                <tr>
                  <th>Produit</th>
                  <th>Recette</th>
                  <th className="tr">Prix de vente</th>
                  <th className="tr">Coût</th>
                  <th className="tr">Marge</th>
                  <th className="tr">Encore possible</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visibleProducts.length === 0 ? (
                  <tr><td colSpan={7}><Empty icon="clipboard" text="Aucun produit. Le menu vient de la caisse." /></td></tr>
                ) : visibleProducts.map(p => {
                  const r = recByItem[p.item_id]
                  const cost = r ? r.cost_effective : 0
                  const marge = p.price - cost
                  const margePct = p.price > 0 ? Math.round((marge / p.price) * 100) : 0
                  return (
                    <tr key={p.item_id}>
                      <td>
                        <div className="row">
                          <span>{p.emoji}</span>
                          <div>
                            <div className="strong">{p.name}</div>
                            <div className="t11 cFaint">{p.category}</div>
                          </div>
                        </div>
                      </td>
                      <td data-label="Recette">
                        {!r ? (
                          <span className="badge bNeutral">aucune — coût manuel</span>
                        ) : (
                          <div className="row wrap" style={{ gap: 6 }}>
                            <span className="badge bInfo">{r.nb_lines} ingrédient{r.nb_lines !== 1 ? 's' : ''}</span>
                            {r.cost_mode === 'manual' && <span className="badge bBrand">coût manuel</span>}
                            {!r.enabled && <span className="badge bNeutral">désactivée</span>}
                            {r.lines_missing_cost > 0 && (
                              <span className="badge bWarn" title="Un ingrédient n'a pas de prix d'achat">
                                {r.lines_missing_cost} sans prix
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                      <td data-label="Prix de vente" className="tr num nowrap">
                        {p.price > 0 ? <>{f3(p.price)} <span className="owned">caisse</span></> : '—'}
                      </td>
                      <td data-label="Coût" className="tr num nowrap">
                        {r ? f3(cost) : <span className="t12 cFaint">—</span>}
                      </td>
                      <td data-label="Marge" className="tr num nowrap">
                        {r && p.price > 0
                          ? <span style={{ color: marge > 0 ? 'var(--ok)' : 'var(--danger)', fontWeight: 650 }}>
                              {f3(marge)} <span className="t11">({margePct}%)</span>
                            </span>
                          : <span className="t12 cFaint">—</span>}
                      </td>
                      {/* The answer to "can I still sell this?" — and, when the
                          answer is no, the name of the thing to go and buy. */}
                      <td data-label="Encore possible" className="tr nowrap">
                        {!r || r.buildable == null ? (
                          <span className="t12 cFaint">—</span>
                        ) : (
                          <>
                            <div
                              className="num bold"
                              style={{
                                fontSize: 15,
                                color: r.buildable === 0 ? 'var(--danger)'
                                  : r.buildable <= 5 ? 'var(--warn)' : 'var(--ok)',
                              }}
                            >
                              {r.buildable === 0 ? 'épuisé' : r.buildable}
                            </div>
                            {r.limited_by && (
                              <div className="t11 cFaint">
                                limité par {r.limited_by.name}
                              </div>
                            )}
                            {r.buildable_unknown && (
                              <div className="t11 cWarn">ingrédient manquant</div>
                            )}
                          </>
                        )}
                      </td>
                      <td className="tr actionCell">
                        <button className="btn btnSm" onClick={() => setEditRec({ product: p, recipe: r || null })}>
                          {r ? 'Modifier' : '+ Recette'}
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

      {moveIng && (
        <MoveModal
          ing={moveIng} saving={saving}
          suppliers={suppliers}
          onClose={() => setMoveIng(null)}
          onSave={v => save('moveIngredient', v)}
        />
      )}
      {editIng && (
        <IngredientModal
          value={editIng} saving={saving}
          onClose={() => setEditIng(null)}
          onSave={v => save('saveIngredient', v)}
        />
      )}
      {archiveIng && (
        <ArchiveIngredientModal
          ingredient={archiveIng} saving={saving}
          onClose={() => setArchiveIng(null)}
          onArchive={reason => save('deleteIngredient', { ing_key: archiveIng.ing_key, reason })}
        />
      )}
      {editRec && (
        <RecipeModal
          product={editRec.product} recipe={editRec.recipe} ings={ings.filter(i => !i.archived)}
          saving={saving}
          onClose={() => setEditRec(null)}
          onSave={v => save('saveRecipe', v)}
          onDelete={() => save('deleteRecipe', { item_id: editRec.product.item_id })}
        />
      )}
    </Shell>
  )
}

// ─────────────────────────────────────────────────────────────
/**
 * Quick stock update — the same three actions as the till, deliberately.
 *
 *   Livraison  +  stock arrived, optionally with the price paid
 *   Perte      −  spoiled, dropped, spilled
 *   Comptage   =  I physically counted, this is the truth
 *
 * Three verbs instead of one editable number, because "set quantity to 4" hides
 * WHY it changed, and the why is what a stock report is for. Each one appends a
 * movement; nothing here overwrites anything.
 *
 * The price field only appears on a delivery, since that is the only case where a
 * price means something — it feeds the weighted average cost used by recipes.
 */
function MoveModal({ ing, saving, suppliers, onClose, onSave }: {
  ing: Ing
  saving: boolean
  suppliers: { id: number; name: string }[]
  onClose: () => void
  onSave: (v: any) => void
}) {
  const [kind, setKind] = useState<'receive' | 'waste' | 'count'>('receive')
  const [qty, setQty] = useState('')
  const [unitCost, setUnitCost] = useState(
    ing.cost_per_stock_unit > 0 ? String(ing.cost_per_stock_unit) : ''
  )
  const [reason, setReason] = useState('')
  const [supplierId, setSupplierId] = useState<number | null>(null)
  const [payMethod, setPayMethod] = useState<'comptant' | 'credit'>('comptant')

  const q = num(qty)
  const valid = kind === 'count' ? qty !== '' && q >= 0 : q > 0

  // Show the resulting quantity before committing. Mental arithmetic at the end
  // of a shift is where counting mistakes come from.
  const after =
    kind === 'receive' ? ing.quantity + q :
    kind === 'waste'   ? ing.quantity - q :
    q

  const submit = () => {
    if (!valid) return
    onSave({
      ing_key: ing.ing_key,
      kind,
      qty: q,
      unit_cost: kind === 'receive' ? num(unitCost) : undefined,
      reason: reason.trim() || undefined,
      supplier_id: kind === 'receive' && supplierId ? supplierId : undefined,
      payment_method: kind === 'receive' ? payMethod : undefined,
    })
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div
        className="modal" style={{ maxWidth: 460 }}
        onClick={e => e.stopPropagation()}
        role="dialog" aria-modal="true" aria-label={`Stock — ${ing.name}`}
      >
        <div className="modalHead">
          <div>
            <div className="modalTitle">{ing.name}</div>
            <div className="t12 cMuted num">
              en stock : {qtyTrim(ing.quantity)} {ing.stock_unit}
            </div>
          </div>
          <button className="btn btnGhost btnSm spacer" onClick={onClose} aria-label="Fermer">✕</button>
        </div>

        <div className="modalBody col" style={{ gap: 14 }}>
          <div className="toolbar mb14">
            <button className="chip" data-on={kind === 'receive'} onClick={() => setKind('receive')}>+ Livraison</button>
            <button className="chip" data-on={kind === 'waste'} onClick={() => setKind('waste')}>− Perte</button>
            <button className="chip" data-on={kind === 'count'} onClick={() => setKind('count')}>= Comptage</button>
          </div>

          <div className="field mb14">
            <label className="label" htmlFor="mqty">
              {kind === 'receive' ? 'Quantité reçue' : kind === 'waste' ? 'Quantité perdue' : 'Quantité comptée'}
              {' '}({ing.stock_unit})
            </label>
            <input
              id="mqty" className="input" type="number" step="any" min="0"
              value={qty} onChange={e => setQty(e.target.value)} autoFocus
              onKeyDown={e => { if (e.key === 'Enter' && valid && !saving) submit() }}
            />
            <span className="help">
              {kind === 'count'
                ? 'Remplace la quantité. L’écart avec le stock théorique est enregistré.'
                : `Nouveau stock : ${qtyTrim(after)} ${ing.stock_unit}`}
            </span>
          </div>

          {kind === 'receive' && (
            <div className="field mb14">
              <label className="label" htmlFor="mcost">Prix payé par {ing.stock_unit} (optionnel)</label>
              <input
                id="mcost" className="input" type="number" step="any" min="0"
                value={unitCost} onChange={e => setUnitCost(e.target.value)}
              />
              <span className="help">
                Alimente le coût moyen pondéré utilisé par les recettes. Laissez vide si le prix n’a pas changé.
              </span>
            </div>
          )}

          {kind === 'receive' && (
            <>
              <div className="field mb14">
                <label className="label">Fournisseur</label>
                <select className="input" value={supplierId ?? ''} onChange={e => {
                  const v = e.target.value
                  setSupplierId(v ? parseInt(v) : null)
                }}>
                  <option value="">Passager (pas de fiche)</option>
                  {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div className="field mb14">
                <label className="label">Paiement</label>
                <div className="row" style={{ gap: 6 }}>
                  <button type="button" className="chip" data-on={payMethod === 'comptant'} onClick={() => setPayMethod('comptant')}>Comptant</button>
                  <button type="button" className="chip" data-on={payMethod === 'credit'} onClick={() => setPayMethod('credit')}>À crédit</button>
                </div>
                <span className="help">
                  {payMethod === 'credit' ? 'Ajouté à la dette du fournisseur.' : 'Payé — pas de dette.'}
                </span>
              </div>
            </>
          )}

          {kind !== 'receive' && (
            <div className="field mb14">
              <label className="label" htmlFor="mreason">Motif (optionnel)</label>
              <input
                id="mreason" className="input" value={reason} onChange={e => setReason(e.target.value)}
                placeholder={kind === 'waste' ? 'périmé, cassé, renversé…' : 'inventaire de fin de mois…'}
              />
            </div>
          )}
        </div>

        <div className="modalFoot">
          <button className="btn" onClick={onClose}>Annuler</button>
          <button className="btn btnPrimary" disabled={!valid || saving} onClick={submit}>
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
function ArchiveIngredientModal({ ingredient, saving, onClose, onArchive }: {
  ingredient: Ing; saving: boolean; onClose: () => void; onArchive: (reason: string) => void
}) {
  const [reason, setReason] = useState('')
  const canArchive = reason.trim().length > 0
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 460 }} onClick={e => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="modalHead">
          <div><div className="modalTitle">Archiver {ingredient.name}</div><div className="t12 cMuted">L&apos;historique, les coûts et les mouvements restent conservés.</div></div>
          <button className="btn btnGhost btnSm spacer" onClick={onClose}>✕</button>
        </div>
        <div className="modalBody col" style={{ gap: 14 }}>
          <div className="notice nInfo" style={{ margin: 0 }}><span className="noticeIcon">i</span><div>L&apos;ingrédient disparaît des achats et des nouvelles recettes. Vous pourrez le restaurer plus tard.</div></div>
          <div className="field">
            <label className="label">Motif <span className="cDanger">*</span></label>
            <input className="input" autoFocus value={reason} onChange={e => setReason(e.target.value)} placeholder="Ex. fournisseur changé, produit arrêté" />
            <span className="help">Le motif sera conservé dans le journal d&apos;audit.</span>
          </div>
        </div>
        <div className="modalFoot">
          <button className="btn" onClick={onClose}>Annuler</button>
          <button className="btn btnDanger" disabled={!canArchive || saving} onClick={() => onArchive(reason.trim())}>
            {saving ? 'Archivage…' : 'Archiver'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
function IngredientModal({ value, saving, onClose, onSave }: any) {
  const [v, setV] = useState<any>({ ...value })
  const isNew = !value.ing_key
  const set = (k: string, x: any) => setV((p: any) => ({ ...p, [k]: x }))
  const unitCost = num(v.conversion_factor) > 0 ? num(v.cost_per_stock_unit) / num(v.conversion_factor) : 0

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modalHead">
          <div className="modalTitle">{value.ing_key ? 'Modifier l\u2019ingrédient' : 'Nouvel ingrédient'}</div>
          <button className="btn btnGhost btnSm spacer" onClick={onClose}>✕</button>
        </div>
        <div className="modalBody col" style={{ gap: 14 }}>
          <div className="row" style={{ gap: 10 }}>
            <div className="field grow">
              <label className="label">Nom</label>
              <input className="input" value={v.name || ''} onChange={e => set('name', e.target.value)} placeholder="Café en grains" />
            </div>
            <div className="field" style={{ width: 150 }}>
              <label className="label">Catégorie</label>
              <input className="input" value={v.category || ''} onChange={e => set('category', e.target.value)} placeholder="Sec" />
            </div>
          </div>

          <div>
            <label className="label mb8" style={{ display: 'block' }}>Unités</label>
            <div className="row wrap mb8" style={{ gap: 6 }}>
              {PRESETS.map(p => (
                <button
                  key={p.label} className="chip"
                  data-on={v.stock_unit === p.stock_unit && v.recipe_unit === p.recipe_unit && Number(v.conversion_factor) === p.conversion_factor}
                  onClick={() => setV((prev: any) => ({ ...prev, ...p }))}
                >{p.label}</button>
              ))}
            </div>
            <div className="row" style={{ gap: 10 }}>
              <div className="field grow">
                <label className="label">J&apos;achète en</label>
                <input className="input" value={v.stock_unit || ''} onChange={e => set('stock_unit', e.target.value)} placeholder="kg" />
              </div>
              <div className="field grow">
                <label className="label">J&apos;utilise en</label>
                <input className="input" value={v.recipe_unit || ''} onChange={e => set('recipe_unit', e.target.value)} placeholder="g" />
              </div>
              <div className="field grow">
                <label className="label">Combien par unité d&apos;achat</label>
                <input
                  className="input inputNum" type="number" step="any" min="0.0001"
                  value={v.conversion_factor ?? ''} onChange={e => set('conversion_factor', e.target.value)}
                />
              </div>
            </div>
            <div className="help mt8">
              1 {v.stock_unit || '?'} = {num(v.conversion_factor) || '?'} {v.recipe_unit || '?'}
            </div>
          </div>

          <div className="row" style={{ gap: 10 }}>
            <div className="field grow">
              <label className="label">Prix d&apos;achat (pour 1 {v.stock_unit || 'unité'})</label>
              <input
                className="input inputNum" type="number" step="0.001" min="0"
                value={v.cost_per_stock_unit ?? ''} onChange={e => set('cost_per_stock_unit', e.target.value)}
              />
              <span className="help">
                {unitCost > 0 ? `= ${unitCost.toFixed(5)} DT / ${v.recipe_unit || 'unité'}` : 'Sans prix, le coût des recettes est faux.'}
              </span>
            </div>
            <div className="field grow">
              <label className="label">{isNew ? 'Stock initial' : 'Stock actuel'} ({v.stock_unit || 'unité'})</label>
              {isNew ? (
                <input
                  className="input inputNum" type="number" step="0.001" min="0"
                  value={v.quantity ?? ''} onChange={e => set('quantity', e.target.value)}
                />
              ) : (
                <>
                  <div className="input inputNum" style={{ background: 'var(--surface-2)' }}>{qtyTrim(v.quantity)} {v.stock_unit}</div>
                  <span className="help">Utilisez le bouton « Stock » pour une livraison, perte ou inventaire traçable.</span>
                </>
              )}
            </div>
          </div>

          <div className="row between">
            <div className="field grow">
              <label className="label">Seuil d&apos;alerte ({v.stock_unit || 'unité'})</label>
              <input
                className="input inputNum" type="number" step="0.001" min="0"
                value={v.low_threshold ?? ''} onChange={e => set('low_threshold', e.target.value)}
                disabled={v.tracked === false}
              />
              <span className="help">Alerte dès que le stock descend à ce niveau.</span>
            </div>
            <div className="col" style={{ gap: 4, alignItems: 'flex-end', paddingTop: 18 }}>
              <span className="label">Suivi</span>
              <button className="switch" data-on={v.tracked !== false} onClick={() => set('tracked', v.tracked === false)} />
            </div>
          </div>
        </div>
        <div className="modalFoot">
          <button className="btn" onClick={onClose}>Annuler</button>
          <button
            className="btn btnPrimary"
            disabled={saving || !String(v.name || '').trim() || !(num(v.conversion_factor) > 0)}
            onClick={() => onSave(v)}
          >{saving ? '…' : 'Enregistrer'}</button>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
function RecipeModal({ product, recipe, ings, saving, onClose, onSave, onDelete }: any) {
  const [lines, setLines] = useState<{ ing_key: string; qty: number | string }[]>(
    recipe?.lines?.length ? recipe.lines.map((l: any) => ({ ...l })) : [{ ing_key: '', qty: '' }]
  )
  const [mode, setMode] = useState<'auto' | 'manual'>(recipe?.cost_mode || 'auto')
  const [override, setOverride] = useState<any>(recipe?.cost_override ?? '')
  const [enabled, setEnabled] = useState<boolean>(recipe?.enabled !== false)
  const [yieldQty, setYieldQty] = useState<any>(recipe?.yield_qty ?? 1)

  const byKey: Record<string, Ing> = useMemo(() => {
    const m: any = {}; for (const i of ings) m[i.ing_key] = i; return m
  }, [ings])

  // Live plate cost, mirroring the recipe_cost view exactly.
  const computed = useMemo(() => {
    const y = num(yieldQty) || 1
    let sum = 0
    for (const l of lines) {
      const i = byKey[l.ing_key]
      if (!i || !(num(l.qty) > 0)) continue
      sum += num(l.qty) * (i.conversion_factor > 0 ? i.cost_per_stock_unit / i.conversion_factor : 0)
    }
    return sum / y
  }, [lines, byKey, yieldQty])

  const effective = mode === 'manual' ? num(override) : computed
  const marge = product.price - effective
  const margePct = product.price > 0 ? Math.round((marge / product.price) * 100) : 0
  const missingPrice = lines.filter(l => l.ing_key && byKey[l.ing_key] && byKey[l.ing_key].cost_per_stock_unit <= 0)

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 660 }} onClick={e => e.stopPropagation()}>
        <div className="modalHead">
          <div>
            <div className="modalTitle">{product.emoji} {product.name}</div>
            <div className="t12 cMuted">
              Prix de vente {f3(product.price)} DT <span className="owned">caisse</span>
            </div>
          </div>
          <button className="btn btnGhost btnSm spacer" onClick={onClose}>✕</button>
        </div>

        <div className="modalBody col" style={{ gap: 16 }}>
          <div className="row" style={{ gap: 10 }}>
            <div className="field" style={{ width: 150 }}>
              <label className="label">Rendement (portions)</label>
              <input className="input inputNum" type="number" step="0.001" min="0.001"
                value={yieldQty} onChange={e => setYieldQty(e.target.value)} />
              <span className="help">Si la recette produit 10 portions, mettez 10.</span>
            </div>
            <div className="col" style={{ gap: 4, paddingTop: 18 }}>
              <span className="label">Recette active</span>
              <button className="switch" data-on={enabled} onClick={() => setEnabled(!enabled)} />
              <span className="help">Désactivée : conservée, sans effet.</span>
            </div>
          </div>

          <div>
            <div className="between mb8">
              <span className="label">Ingrédients consommés</span>
              <button className="btn btnSm" onClick={() => setLines([...lines, { ing_key: '', qty: '' }])}>+ Ligne</button>
            </div>
            {ings.length === 0 && (
              <div className="notice nWarn" style={{ marginBottom: 10 }}>
                <span className="noticeIcon">⚠</span>
                <div>Créez d&apos;abord des ingrédients dans l&apos;onglet Ingrédients.</div>
              </div>
            )}
            <div className="col" style={{ gap: 8 }}>
              {lines.map((l, idx) => {
                const i = byKey[l.ing_key]
                const lineCost = i && num(l.qty) > 0
                  ? num(l.qty) * (i.conversion_factor > 0 ? i.cost_per_stock_unit / i.conversion_factor : 0)
                  : 0
                return (
                  <div className="row" key={idx} style={{ gap: 8 }}>
                    <select
                      className="select grow" value={l.ing_key}
                      onChange={e => { const c = [...lines]; c[idx] = { ...c[idx], ing_key: e.target.value }; setLines(c) }}
                    >
                      <option value="">— choisir —</option>
                      {ings.map((ing: Ing) => (
                        <option key={ing.ing_key} value={ing.ing_key}>{ing.name}</option>
                      ))}
                    </select>
                    <input
                      className="input inputNum" style={{ width: 110 }} type="number" step="any" min="0"
                      placeholder="Qté" value={l.qty}
                      onChange={e => { const c = [...lines]; c[idx] = { ...c[idx], qty: e.target.value }; setLines(c) }}
                    />
                    <span className="t12 cMuted nowrap" style={{ width: 52 }}>{i?.recipe_unit || ''}</span>
                    <span className="t12 num nowrap cMuted" style={{ width: 78, textAlign: 'right' }}>
                      {lineCost > 0 ? f3(lineCost) : ''}
                    </span>
                    <button
                      className="btn btnSm btnGhost"
                      onClick={() => setLines(lines.filter((_, k) => k !== idx))}
                    >✕</button>
                  </div>
                )
              })}
            </div>
            {missingPrice.length > 0 && (
              <div className="notice nWarn mt14">
                <span className="noticeIcon">⚠</span>
                <div>
                  {missingPrice.length} ingrédient(s) sans prix d&apos;achat — le coût calculé est
                  sous-estimé et la marge paraîtra trop belle.
                </div>
              </div>
            )}
          </div>

          <div className="card" style={{ background: 'var(--surface-2)' }}>
            <div className="cardPad col" style={{ gap: 12 }}>
              <div className="row wrap" style={{ gap: 6 }}>
                <span className="label" style={{ marginRight: 6 }}>Coût</span>
                <button className="chip" data-on={mode === 'auto'} onClick={() => setMode('auto')}>🧮 Auto (recette)</button>
                <button className="chip" data-on={mode === 'manual'} onClick={() => setMode('manual')}>✏️ Manuel</button>
              </div>

              {mode === 'manual' ? (
                <div className="field">
                  <label className="label">Coût imposé (DT)</label>
                  <input className="input inputNum" style={{ maxWidth: 160 }} type="number" step="0.001" min="0"
                    value={override} onChange={e => setOverride(e.target.value)} />
                  <span className="help">
                    Calculé par la recette : {f3(computed)} DT. Votre valeur remplace ce chiffre
                    sans modifier le prix d&apos;achat des ingrédients — la recette continue de
                    déduire le stock.
                  </span>
                </div>
              ) : (
                <div className="t13 cMuted">
                  Calculé depuis les ingrédients. Changez le prix d&apos;un ingrédient et tous les
                  produits qui l&apos;utilisent se recalculent.
                </div>
              )}

              <div className="row wrap" style={{ gap: 20 }}>
                <div>
                  <div className="statLabel">Coût / portion</div>
                  <div className="num bold" style={{ fontSize: 19 }}>{f3(effective)} DT</div>
                </div>
                <div>
                  <div className="statLabel">Marge</div>
                  <div className="num bold" style={{ fontSize: 19, color: marge > 0 ? 'var(--ok)' : 'var(--danger)' }}>
                    {f3(marge)} <span className="t13">({margePct}%)</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="modalFoot">
          {recipe && (
            <button className="btn btnDanger" style={{ marginRight: 'auto' }}
              onClick={() => { if (confirm('Supprimer la recette ? Le produit reviendra au coût manuel.')) onDelete() }}
            >Supprimer la recette</button>
          )}
          <button className="btn" onClick={onClose}>Annuler</button>
          <button
            className="btn btnPrimary" disabled={saving}
            onClick={() => onSave({
              item_id: product.item_id, item_name: product.name,
              cost_mode: mode, cost_override: mode === 'manual' ? num(override) : null,
              enabled, yield_qty: num(yieldQty) || 1,
              lines: lines.filter(l => l.ing_key && num(l.qty) > 0).map(l => ({ ing_key: l.ing_key, qty: num(l.qty) })),
            })}
          >{saving ? '…' : 'Enregistrer'}</button>
        </div>
      </div>
    </div>
  )
}
