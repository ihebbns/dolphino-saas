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

type Product = {
  item_id: string; name: string; emoji: string
  price: number; category: string
  cost: number; sell_price: number
  quantity: number; tracked: boolean; low_threshold: number
  barcode: string
}

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
      })))
      setDirty({})
    } else setMsg(d.error || 'Erreur de chargement')
    setLoading(false)
  }

  function edit(id: string, field: keyof Product, value: any) {
    setProducts(ps => ps.map(p => (p.item_id === id ? { ...p, [field]: value } : p)))
    setDirty(d => ({ ...d, [id]: true }))
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
      tracked: !!p.tracked,
      low_threshold: parseInt(String(p.low_threshold)) || 0,
    })
    setSavingId(null)
    if (d.ok) {
      setDirty(dd => { const n = { ...dd }; delete n[p.item_id]; return n })
      setMsg(`✓ "${p.name}" enregistré. Les nouveaux coûts s'appliquent aux ventes futures.`)
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
      <div className="notice nInfo">
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
                <th className="tr">Stock</th>
                <th className="tc">Suivi</th>
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
                    <td className="t13 cMuted nowrap">
                      {p.category || '—'}<span className="owned">caisse</span>
                    </td>
                    <td className="tr num nowrap">
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
                    <td className="tr">
                      <input
                        className="input inputNum inputSm"
                        style={{ width: 110, borderColor: noCost ? 'var(--danger-line)' : undefined }}
                        type="number" step="0.001" min="0" value={p.cost}
                        placeholder="0.000"
                        onChange={e => edit(p.item_id, 'cost', e.target.value)}
                      />
                    </td>
                    <td className="tr num nowrap">
                      {price > 0 && !noCost ? (
                        <span style={{ color: margin > 0 ? 'var(--ok)' : 'var(--danger)', fontWeight: 650 }}>
                          {f3(margin)} <span className="t11">({marginPct}%)</span>
                        </span>
                      ) : <span className="cFaint">—</span>}
                    </td>
                    <td className="tr num nowrap">
                      <a href="/stock" title="Les quantités se gèrent sur Stock, avec traçabilité"
                         style={{ color: p.tracked && p.quantity <= p.low_threshold ? 'var(--danger)' : 'var(--text-2)', textDecoration: 'none' }}>
                        {p.quantity}
                        <span className="owned">stock</span>
                      </a>
                    </td>
                    <td className="tc">
                      <button className="switch" data-on={p.tracked} onClick={() => edit(p.item_id, 'tracked', !p.tracked)} />
                    </td>
                    <td className="tr">
                      <input
                        className="input inputNum inputSm" style={{ width: 74 }}
                        type="number" step="1" min="0" value={p.low_threshold}
                        disabled={!p.tracked}
                        onChange={e => edit(p.item_id, 'low_threshold', e.target.value)}
                      />
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
