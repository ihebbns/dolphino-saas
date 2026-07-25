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
import { Shell, LoginGate, NotReady, Loading, Empty, useApiKey, apiGet, apiPost, f3, num } from '../ui/Shell'

type Ing = {
  ing_key: string; name: string; category: string
  stock_unit: string; recipe_unit: string; conversion_factor: number
  cost_per_stock_unit: number; cost_per_recipe_unit: number
  quantity: number; low_threshold: number
  tracked: boolean; archived: boolean
  stock_value: number; is_low: boolean; used_in_recipes: number
}
type Product = { item_id: string; name: string; category: string; emoji: string; price: number }
type Recipe = {
  item_id: string; item_name: string; cost_mode: 'auto' | 'manual'
  cost_override: number | null; enabled: boolean; yield_qty: number
  cost_computed: number; cost_effective: number
  nb_lines: number; lines_missing_cost: number
  lines: { ing_key: string; qty: number }[]
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
  const [tab, setTab] = useState<'ing' | 'rec'>('ing')

  const [ings, setIngs] = useState<Ing[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [totals, setTotals] = useState<any>(null)

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
    } else setMsg(d.error || 'Erreur de chargement')
    setLoading(false)
  }

  async function save(action: string, payload: any) {
    if (!key) return
    setSaving(true); setMsg('')
    const d = await apiPost('/api/me/ingredients', { key, action, ...payload })
    setSaving(false)
    if (d.ok) { setEditIng(null); setEditRec(null); await load(key) }
    else setMsg(d.error || 'Erreur')
    return d.ok
  }

  const visibleIngs = useMemo(() => {
    let out = ings.filter(i => (showArchived ? true : !i.archived))
    if (search) {
      const q = search.toLowerCase()
      out = out.filter(i => i.name.toLowerCase().includes(q) || (i.category || '').toLowerCase().includes(q))
    }
    return out
  }, [ings, search, showArchived])

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
          {tab === 'ing' && (
            <button className="btn btnPrimary" onClick={() => setEditIng({ ...BLANK })}>+ Ingrédient</button>
          )}
        </>
      }
    >
      {!ready && <NotReady sql="migration-ingredients.sql" />}
      {msg && <div className="notice nDanger"><span className="noticeIcon">✕</span><div>{msg}</div></div>}

      <div className="notice nInfo" hidden>
        <span className="noticeIcon">💡</span>
        <div>
          <div className="noticeTitle">Les recettes sont facultatives</div>
          Un produit sans recette garde son coût saisi à la main et ne déduit aucun ingrédient.
          Vous pouvez n&apos;en créer que pour vos best-sellers. Un Coca ne demande pas de recette
          (1 bouteille = 1 bouteille) ; une pizza, oui.
        </div>
      </div>

      {ready && (
        <div className="statGrid mb20">
          <div className="stat">
            <div className="statLabel">Ingrédients</div>
            <div className="statValue num">{totals?.nb_ingredients ?? 0}</div>
          </div>
          <div className="stat">
            <div className="statLabel">Valeur du stock</div>
            <div className="statValue num">{f3(totals?.stock_value)} DT</div>
            <div className="statHint">quantité × prix d&apos;achat</div>
          </div>
          <div className="stat">
            <div className="statLabel">Stock bas</div>
            <div className="statValue num" style={{ color: lowCount ? 'var(--danger)' : 'var(--ok)' }}>{lowCount}</div>
            <div className="statHint">{lowCount ? 'à réapprovisionner' : 'tout est au-dessus du seuil'}</div>
          </div>
          <div className="stat">
            <div className="statLabel">Sans prix d&apos;achat</div>
            <div className="statValue num" style={{ color: (totals?.nb_sans_cout ?? 0) ? 'var(--warn)' : 'var(--ok)' }}>
              {totals?.nb_sans_cout ?? 0}
            </div>
            <div className="statHint">fausse le coût des recettes</div>
          </div>
          <div className="stat">
            <div className="statLabel">Recettes</div>
            <div className="statValue num">{recipes.length}<span className="t13 cFaint"> / {products.length}</span></div>
            <div className="statHint">produits avec fiche technique</div>
          </div>
        </div>
      )}

      <div className="toolbar">
        <button className="chip" data-on={tab === 'ing'} onClick={() => setTab('ing')}>🥣 Ingrédients</button>
        <button className="chip" data-on={tab === 'rec'} onClick={() => setTab('rec')}>📋 Recettes</button>
        <input
          className="input" style={{ maxWidth: 280, marginLeft: 8 }}
          placeholder="🔍 Rechercher…" value={search} onChange={e => setSearch(e.target.value)}
        />
        {tab === 'ing' && (
          <label className="row t12 cMuted" style={{ cursor: 'pointer' }}>
            <input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} />
            Afficher les archivés
          </label>
        )}
      </div>

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
                  <th className="tr">En stock</th>
                  <th className="tr">Seuil</th>
                  <th className="tr">Valeur</th>
                  <th className="tc">Recettes</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visibleIngs.length === 0 ? (
                  <tr><td colSpan={9}><Empty icon="🥣" text="Aucun ingrédient. Commencez par ceux qui coûtent le plus cher." /></td></tr>
                ) : visibleIngs.map(i => (
                  <tr key={i.ing_key} style={i.archived ? { opacity: .5 } : undefined}>
                    <td>
                      <div className="strong">{i.name}</div>
                      <div className="t11 cFaint">{i.category || '—'}{i.archived ? ' · archivé' : ''}</div>
                    </td>
                    <td className="t12 cMuted nowrap">
                      1 {i.stock_unit} = {i.conversion_factor} {i.recipe_unit}
                    </td>
                    <td className="tr num nowrap">
                      {i.cost_per_stock_unit > 0
                        ? <>{f3(i.cost_per_stock_unit)} <span className="t11 cFaint">/ {i.stock_unit}</span></>
                        : <span className="badge bWarn">à définir</span>}
                    </td>
                    <td className="tr num t12 cMuted nowrap">
                      {i.cost_per_recipe_unit > 0 ? `${i.cost_per_recipe_unit.toFixed(5)} / ${i.recipe_unit}` : '—'}
                    </td>
                    <td className="tr num nowrap">
                      <span className={i.is_low ? 'cDanger bold' : ''}>{f3(i.quantity)}</span>
                      <span className="t11 cFaint"> {i.stock_unit}</span>
                    </td>
                    <td className="tr num t12 cMuted">{i.tracked ? f3(i.low_threshold) : '—'}</td>
                    <td className="tr num nowrap">{f3(i.stock_value)} DT</td>
                    <td className="tc">
                      {i.used_in_recipes > 0
                        ? <span className="badge bInfo">{i.used_in_recipes}</span>
                        : <span className="t12 cFaint">—</span>}
                    </td>
                    <td className="tr nowrap">
                      <button className="btn btnSm" onClick={() => setEditIng(i)}>Modifier</button>
                      {!i.archived && (
                        <button
                          className="btn btnSm btnDanger" style={{ marginLeft: 6 }}
                          onClick={() => {
                            if (i.used_in_recipes > 0) { setMsg(`"${i.name}" est utilisé dans ${i.used_in_recipes} recette(s) — retirez-le d'abord.`); return }
                            if (confirm(`Archiver "${i.name}" ?`)) save('deleteIngredient', { ing_key: i.ing_key })
                          }}
                        >Archiver</button>
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
                  <th />
                </tr>
              </thead>
              <tbody>
                {visibleProducts.length === 0 ? (
                  <tr><td colSpan={6}><Empty icon="📋" text="Aucun produit. Le menu vient de la caisse." /></td></tr>
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
                      <td>
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
                      <td className="tr num nowrap">
                        {p.price > 0 ? <>{f3(p.price)} <span className="owned">caisse</span></> : '—'}
                      </td>
                      <td className="tr num nowrap">
                        {r ? f3(cost) : <span className="t12 cFaint">—</span>}
                      </td>
                      <td className="tr num nowrap">
                        {r && p.price > 0
                          ? <span style={{ color: marge > 0 ? 'var(--ok)' : 'var(--danger)', fontWeight: 650 }}>
                              {f3(marge)} <span className="t11">({margePct}%)</span>
                            </span>
                          : <span className="t12 cFaint">—</span>}
                      </td>
                      <td className="tr nowrap">
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

      {editIng && (
        <IngredientModal
          value={editIng} saving={saving}
          onClose={() => setEditIng(null)}
          onSave={v => save('saveIngredient', v)}
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
function IngredientModal({ value, saving, onClose, onSave }: any) {
  const [v, setV] = useState<any>({ ...value })
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
              <label className="label">En stock ({v.stock_unit || 'unité'})</label>
              <input
                className="input inputNum" type="number" step="0.001" min="0"
                value={v.quantity ?? ''} onChange={e => set('quantity', e.target.value)}
              />
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
