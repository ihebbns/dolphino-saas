'use client'
// ═══════════════════════════════════════════════════════════════════
// /catalog — Produits & coûts
//
// ONE JOB: the purchase cost of each product, which is the only field on this
// screen the web owns. Everything else is shown read-only and labelled, because
// mixing editable and caisse-owned fields on one screen is what made the old
// page feel arbitrary.
//
//   price     → owned by the caisse ("Gérer le menu"), read-only here
//   category  → part of the menu, owned by the caisse
//   quantity  → moves only through a traced movement, managed on /stock
//   cost      → OWNED HERE
//   tracked / seuil → configuration, owned here
//
// The licence key is deliberately not displayed. It is a credential the operator
// has no reason to read, and showing it invites screenshots.
// ═══════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useState } from 'react'
import { Shell, LoginGate, Loading, Empty, useApiKey, apiGet, apiPost, f3, num } from '../ui/Shell'

type TrackMode = 'stock' | 'recipe' | 'none'

type Product = {
  item_id: string; name: string; emoji: string
  price: number; category: string
  cost: number; sell_price: number
  quantity: number; tracked: boolean; low_threshold: number
  barcode: string
  /** How this product is inventoried. Exactly one way — see MODES below. */
  track_mode: TrackMode
  /** Whether a recipe exists, so the UI can warn when 'recipe' is chosen
   *  without one (nothing would be deducted at all). */
  has_recipe?: boolean
}

/**
 * The choice, in the owner's words rather than the schema's.
 *
 * It is one OR the other on purpose. A product used to be able to carry both a
 * counted quantity AND a recipe, and a single sale deducted both — so /stock said
 * "20 en stock" while /ingredients said "encore possible 5" for the same item,
 * and nothing on screen said which to believe.
 */
const MODES: { id: TrackMode; label: string; hint: string }[] = [
  { id: 'stock',  label: 'À l’unité',    hint: 'Compté par pièce : un Coca, une bouteille d’eau. La vente retire 1 du stock.' },
  { id: 'recipe', label: 'Par recette',  hint: 'Fabriqué : une citronnade prend 200 ml d’une bouteille d’1 L. La vente retire les ingrédients.' },
  { id: 'none',   label: 'Non suivi',    hint: 'Rien n’est décompté. Pour un café, un service.' },
]

// A product present in the caisse menu has a caisse-owned price.
const isMenuOwned = (p: Product) => num(p.price) > 0
const effPrice = (p: Product) => (isMenuOwned(p) ? num(p.price) : num(p.sell_price))

export default function CatalogPage() {
  const { key, checked } = useApiKey()
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState('')
  const [restName, setRestName] = useState('')
  const [products, setProducts] = useState<Product[]>([])
  const [dirty, setDirty] = useState<Record<string, boolean>>({})
  const [savingId, setSavingId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [cat, setCat] = useState('Tous')
  const [onlyMissing, setOnlyMissing] = useState(false)

  useEffect(() => {
    if (key) load(key)
    else if (checked) setLoading(false)
  }, [key, checked])

  async function load(k: string) {
    setLoading(true); setMsg('')
    const d = await apiGet('/api/me/catalog', k)
    if (d.ok) {
      setRestName(d.name || '')
      setProducts((d.products || []).map((p: any) => ({
        ...p,
        cost: num(p.cost), sell_price: num(p.sell_price), price: num(p.price),
        quantity: parseInt(String(p.quantity)) || 0,
        low_threshold: parseInt(String(p.low_threshold)) || 0,
        tracked: p.tracked !== false,
        // A product with no stock row and no explicit mode is inferred the same
        // way the server infers it: a recipe is a deliberate statement of intent.
        track_mode: (['stock', 'recipe', 'none'].includes(String(p.track_mode))
          ? p.track_mode
          : (p.has_recipe ? 'recipe' : 'stock')) as TrackMode,
        has_recipe: !!p.has_recipe,
      })))
      setDirty({})
    } else setMsg(d.error || 'Erreur de chargement')
    setLoading(false)
  }

  function edit(id: string, field: keyof Product, value: any) {
    setProducts(ps => ps.map(p => (p.item_id === id ? { ...p, [field]: value } : p)))
    setDirty(d => ({ ...d, [id]: true }))
  }

  /** Switching a product TO "à l'unité" must never leave it "jamais compté" —
   *  ask for the real quantity right now and record it as the first physical
   *  count, the same guard the POS's "Gérer le menu" applies. Saved directly
   *  (track_mode, then the count) rather than through the deferred saveRow()
   *  flow: a count posted before track_mode='stock' is actually persisted
   *  server-side gets silently skipped (see /api/stock's skippedCounts), so
   *  the order here has to be real writes, not local state + "save later". */
  async function activateStockMode(p: Product) {
    if (!key) return
    const input = window.prompt(`Quantité actuelle de "${p.name}" ?\nCe nombre devient le premier inventaire.`, '0')
    if (input === null) return
    const n = parseInt(input, 10)
    if (!Number.isFinite(n) || n < 0) { setMsg('Quantité invalide'); return }
    const modeRes = await apiPost('/api/stock', {
      key, mode: 'track_mode', actor: 'web',
      items: [{ item_id: p.item_id, item_name: p.name, item_emoji: p.emoji, track_mode: 'stock' }],
    })
    if (!modeRes.ok) { setMsg(modeRes.error || 'Erreur'); return }
    const countRes = await apiPost('/api/stock', {
      key, mode: 'count', actor: 'web', reason: 'Inventaire initial (activation du suivi)',
      items: [{ item_id: p.item_id, item_name: p.name, item_emoji: p.emoji, quantity: n, ts: new Date().toISOString() }],
    })
    setMsg(countRes.ok
      ? `✓ Suivi activé — "${p.name}" : ${n} en stock`
      : (countRes.error || 'Erreur lors de l\'inventaire initial'))
    await load(key)
  }

  async function saveRow(p: Product) {
    if (!key) return
    setSavingId(p.item_id); setMsg('')
    // Only web-owned fields are sent. `quantity` is intentionally absent: it can
    // only change through a traced movement, never a silent form save.
    const d = await apiPost('/api/me/catalog', {
      key,
      item_id: p.item_id,
      item_name: p.name,
      item_emoji: p.emoji,
      cost: num(p.cost),
      ...(isMenuOwned(p) ? {} : { sell_price: num(p.sell_price) }),
      category: p.category,
      barcode: p.barcode,
      // Derived from the mode, never set independently. `tracked` and the mode
      // were two switches that could contradict each other — recipes on while
      // nothing counts them. One choice now drives both.
      tracked: p.track_mode === 'stock',
      low_threshold: parseInt(String(p.low_threshold)) || 0,
      track_mode: p.track_mode,
    })
    setSavingId(null)
    if (d.ok) {
      setDirty(dd => { const n = { ...dd }; delete n[p.item_id]; return n })
      // Report the migration gap rather than letting the mode look saved when the
      // column does not exist yet.
      if (d.warning) setMsg(`⚠ ${d.warning}`)
      else setMsg(`✓ "${p.name}" enregistré. Les nouveaux coûts s'appliquent aux ventes futures.`)
    } else setMsg(d.error || 'Erreur')
  }

  async function saveAll() {
    const pending = products.filter(p => dirty[p.item_id])
    for (const p of pending) await saveRow(p)
  }

  const categories = useMemo(() => {
    const s = new Set<string>()
    products.forEach(p => { if (p.category) s.add(p.category) })
    return ['Tous', ...Array.from(s).sort()]
  }, [products])

  const filtered = useMemo(() => {
    let out = products
    if (cat !== 'Tous') out = out.filter(p => p.category === cat)
    if (onlyMissing) out = out.filter(p => num(p.cost) <= 0)
    if (search) {
      const q = search.toLowerCase()
      out = out.filter(p => p.name.toLowerCase().includes(q) || (p.barcode || '').toLowerCase().includes(q))
    }
    return out
  }, [products, cat, search, onlyMissing])

  const withCost = products.filter(p => num(p.cost) > 0).length
  const coverage = products.length ? Math.round((withCost / products.length) * 100) : 0
  const dirtyCount = Object.keys(dirty).length

  // Products sold below their own cost — the finding worth acting on.
  const losing = products.filter(p => num(p.cost) > 0 && effPrice(p) > 0 && num(p.cost) >= effPrice(p))

  if (!checked || loading) {
    return <Shell active="/catalog" title="Produits & coûts" restName={restName}><Loading /></Shell>
  }
  if (!key) return <LoginGate />

  return (
    <Shell
      active="/catalog"
      title="Produits & coûts"
      subtitle="Renseignez le prix d'achat pour connaître votre marge réelle"
      restName={restName}
      badges={{ '/catalog': products.length - withCost }}
      actions={
        <>
          <button className="btn" onClick={() => key && load(key)}>↻ Recharger</button>
          <button className="btn btnPrimary" disabled={!dirtyCount} onClick={saveAll}>
            {dirtyCount ? `Enregistrer (${dirtyCount})` : 'Enregistrer'}
          </button>
        </>
      }
    >
      <div className="notice nInfo" hidden>
        <span className="noticeIcon">💡</span>
        <div>
          <div className="noticeTitle">Ce que vous gérez ici : le coût d&apos;achat</div>
          Le <b>prix de vente</b> et les <b>catégories</b> se gèrent dans la caisse et remontent
          automatiquement <span className="owned">caisse</span>. Les <b>quantités</b> se gèrent
          sur <a href="/stock" style={{ color: 'var(--info)' }}>Stock</a>, où chaque mouvement est
          tracé. Modifier un coût n&apos;affecte que les <b>ventes futures</b> : chaque vente
          conserve le coût figé au moment où elle a eu lieu.
        </div>
      </div>

      {msg && (
        <div className={'notice ' + (msg.startsWith('✓') ? 'nOk' : 'nDanger')}>
          <span className="noticeIcon">{msg.startsWith('✓') ? '✓' : '✕'}</span>
          <div>{msg}</div>
        </div>
      )}

      <div className="statGrid mb20">
        <div className="stat">
          <div className="statLabel">Produits</div>
          <div className="statValue num">{products.length}</div>
        </div>
        <div className="stat">
          <div className="statLabel">Couverture coût</div>
          <div className="statValue num" style={{ color: coverage >= 80 ? 'var(--ok)' : coverage >= 40 ? 'var(--warn)' : 'var(--danger)' }}>
            {coverage}%
          </div>
          <div className="meter mt8">
            <div className="meterFill" style={{ width: coverage + '%', background: coverage >= 80 ? 'var(--ok)' : coverage >= 40 ? 'var(--brand-fill)' : 'var(--danger)' }} />
          </div>
        </div>
        <div className="stat">
          <div className="statLabel">Sans coût</div>
          <div className="statValue num" style={{ color: products.length - withCost ? 'var(--danger)' : 'var(--ok)' }}>
            {products.length - withCost}
          </div>
          <div className="statHint">comptés à 100% de marge</div>
        </div>
        <div className="stat">
          <div className="statLabel">Vendus à perte</div>
          <div className="statValue num" style={{ color: losing.length ? 'var(--danger)' : 'var(--ok)' }}>
            {losing.length}
          </div>
          <div className="statHint">coût ≥ prix de vente</div>
        </div>
      </div>

      {losing.length > 0 && (
        <div className="notice nDanger">
          <span className="noticeIcon">⚠</span>
          <div>
            <div className="noticeTitle">{losing.length} produit(s) vendus à perte</div>
            {losing.slice(0, 6).map(p => (
              <div key={p.item_id}>
                • {p.name} — coût {f3(p.cost)} DT, vendu {f3(effPrice(p))} DT
              </div>
            ))}
            {losing.length > 6 && <div className="cMuted">…et {losing.length - 6} autre(s)</div>}
          </div>
        </div>
      )}

      <div className="toolbar">
        <input
          className="input" style={{ maxWidth: 260 }}
          placeholder="🔍 Produit ou code-barres…"
          value={search} onChange={e => setSearch(e.target.value)}
        />
        <div className="row wrap" style={{ gap: 6 }}>
          {categories.map(c => (
            <button key={c} className="chip" data-on={cat === c} onClick={() => setCat(c)}>{c}</button>
          ))}
        </div>
        <button className="chip spacer" data-on={onlyMissing} onClick={() => setOnlyMissing(!onlyMissing)}>
          ⚠ Sans coût
        </button>
        <span className="t12 cMuted">{filtered.length} produit{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      <div className="card">
        <div className="tableWrap">
          <table className="t">
            <thead>
              <tr>
                <th>Produit</th>
                <th>Catégorie</th>
                <th className="tr">Prix de vente</th>
                <th className="tr" style={{ width: 130 }}>Coût d&apos;achat</th>
                <th className="tr">Marge</th>
                <th style={{ width: 210 }}>Suivi du stock</th>
                <th className="tr">Reste</th>
                <th className="tr" style={{ width: 90 }}>Seuil</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={9}><Empty icon="🏷️" text="Aucun produit. Le menu vient de la caisse." /></td></tr>
              ) : filtered.map(p => {
                const price = effPrice(p)
                const margin = price - num(p.cost)
                const marginPct = price > 0 ? Math.round((margin / price) * 100) : 0
                const noCost = num(p.cost) <= 0
                const isDirty = !!dirty[p.item_id]
                return (
                  <tr key={p.item_id} style={isDirty ? { background: 'var(--brand-soft)' } : undefined}>
                    <td>
                      <div className="row">
                        <span style={{ fontSize: 17 }}>{p.emoji || '📦'}</span>
                        <div style={{ minWidth: 0 }}>
                          <div className="strong">{p.name || <span className="cFaint">(sans nom)</span>}</div>
                          {p.barcode && <div className="t11 cFaint">{p.barcode}</div>}
                        </div>
                      </div>
                    </td>
                    <td data-label="Catégorie" className="t13 cMuted nowrap">
                      {p.category || '—'}<span className="owned">caisse</span>
                    </td>
                    <td data-label="Prix de vente" className="tr num nowrap">
                      {isMenuOwned(p) ? (
                        <span className="strong" title="Prix géré dans la caisse">
                          {f3(p.price)}<span className="owned">caisse</span>
                        </span>
                      ) : (
                        <input
                          className="input inputNum inputSm" style={{ width: 100 }}
                          type="number" step="0.001" min="0" value={p.sell_price}
                          onChange={e => edit(p.item_id, 'sell_price', e.target.value)}
                        />
                      )}
                    </td>
                    <td data-label="Coût d'achat" className="tr">
                      <input
                        className="input inputNum inputSm"
                        style={{ width: 110, borderColor: noCost ? 'var(--danger-line)' : undefined }}
                        type="number" step="0.001" min="0" value={p.cost}
                        placeholder="0.000"
                        onChange={e => edit(p.item_id, 'cost', e.target.value)}
                      />
                    </td>
                    <td data-label="Marge" className="tr num nowrap">
                      {price > 0 && !noCost ? (
                        <span style={{ color: margin > 0 ? 'var(--ok)' : 'var(--danger)', fontWeight: 650 }}>
                          {f3(margin)} <span className="t11">({marginPct}%)</span>
                        </span>
                      ) : <span className="cFaint">—</span>}
                    </td>
                    {/* The single choice. Three chips rather than a dropdown so
                        the alternatives — and the fact that they are exclusive —
                        are visible without opening anything. */}
                    <td data-label="Suivi du stock">
                      <div className="row wrap" style={{ gap: 4 }}>
                        {MODES.map(m => (
                          <button
                            key={m.id}
                            className="chip chipSm"
                            data-on={p.track_mode === m.id}
                            title={m.hint}
                            onClick={() => (m.id === 'stock' && p.track_mode !== 'stock')
                              ? activateStockMode(p)
                              : edit(p.item_id, 'track_mode', m.id)}
                          >{m.label}</button>
                        ))}
                      </div>
                      {/* Choosing "par recette" without a recipe deducts nothing
                          at all. Silence here would look like working stock. */}
                      {p.track_mode === 'recipe' && !p.has_recipe && (
                        <div className="t11 cWarn" style={{ marginTop: 4 }}>
                          Aucune recette : rien ne sera décompté.{' '}
                          <a href="/ingredients" style={{ color: 'inherit', textDecoration: 'underline' }}>
                            Créer la recette
                          </a>
                        </div>
                      )}
                    </td>
                    {/* Only one of these figures can be true for a given product,
                        so only one is shown. Printing a unit count next to a
                        recipe product is what made the two pages disagree. */}
                    <td data-label="Reste" className="tr num nowrap">
                      {p.track_mode === 'stock' ? (
                        <a href="/stock" title="Les quantités se gèrent sur Stock, avec traçabilité"
                           style={{ color: p.quantity <= p.low_threshold ? 'var(--danger)' : 'var(--text-2)', textDecoration: 'none' }}>
                          {p.quantity}
                          <span className="owned">stock</span>
                        </a>
                      ) : p.track_mode === 'recipe' ? (
                        <a href="/ingredients" title="Calculé depuis les ingrédients disponibles"
                           style={{ color: 'var(--text-2)', textDecoration: 'none' }}>
                          voir ingrédients
                        </a>
                      ) : (
                        <span className="cFaint">—</span>
                      )}
                    </td>
                    <td data-label="Seuil" className="tr">
                      {p.track_mode === 'stock' ? (
                        <input
                          className="input inputNum inputSm" style={{ width: 74 }}
                          type="number" step="1" min="0" value={p.low_threshold}
                          onChange={e => edit(p.item_id, 'low_threshold', e.target.value)}
                        />
                      ) : (
                        <span className="cFaint t12">—</span>
                      )}
                    </td>
                    <td className="tr">
                      <button
                        className="btn btnSm btnPrimary"
                        disabled={!isDirty || savingId === p.item_id}
                        onClick={() => saveRow(p)}
                      >{savingId === p.item_id ? '…' : 'OK'}</button>
                    </td>
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
