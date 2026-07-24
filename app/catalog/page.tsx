'use client'
import { useState, useEffect, useMemo } from 'react'

const API = process.env.NEXT_PUBLIC_API_URL || ''

type Product = {
  item_id: string
  name: string
  emoji: string
  price: number
  category: string
  cost: number
  sell_price: number
  quantity: number
  tracked: boolean
  low_threshold: number
  barcode: string
}

const num = (v: any) => (v === '' || v === null || v === undefined ? 0 : Math.max(0, parseFloat(String(v)) || 0))

export default function CatalogPage() {
  const [apiKey, setApiKey] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState('')
  const [restName, setRestName] = useState('')
  const [products, setProducts] = useState<Product[]>([])
  const [dirty, setDirty] = useState<Record<string, boolean>>({})
  const [savingId, setSavingId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [cat, setCat] = useState('Tous')

  useEffect(() => {
    const k = localStorage.getItem('d_api_key')
    if (!k) { setLoading(false); return }
    setApiKey(k)
    load(k)
  }, [])

  async function load(k: string) {
    setLoading(true); setMsg('')
    try {
      const res = await fetch(`${API}/api/me/catalog?key=${encodeURIComponent(k)}`)
      const d = await res.json()
      if (d.ok) {
        setRestName(d.name || '')
        setProducts((d.products || []).map((p: any) => ({
          ...p,
          cost: num(p.cost), sell_price: num(p.sell_price),
          quantity: parseInt(String(p.quantity)) || 0,
          low_threshold: parseInt(String(p.low_threshold)) || 0,
          tracked: p.tracked !== false,
        })))
        setDirty({})
      } else { setMsg(d.error || 'Erreur de chargement') }
    } catch { setMsg('Impossible de contacter le serveur.') }
    setLoading(false)
  }

  function edit(id: string, field: keyof Product, value: any) {
    setProducts(ps => ps.map(p => p.item_id === id ? { ...p, [field]: value } : p))
    setDirty(d => ({ ...d, [id]: true }))
  }

  async function saveRow(p: Product) {
    if (!apiKey) return
    setSavingId(p.item_id); setMsg('')
    try {
      const res = await fetch(`${API}/api/me/catalog`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: apiKey,
          item_id: p.item_id,
          item_name: p.name,
          item_emoji: p.emoji,
          cost: num(p.cost),
          sell_price: num(p.sell_price),
          quantity: parseInt(String(p.quantity)) || 0,
          category: p.category,
          barcode: p.barcode,
          tracked: !!p.tracked,
          low_threshold: parseInt(String(p.low_threshold)) || 0,
        }),
      })
      const d = await res.json()
      if (d.ok) {
        setDirty(dd => { const n = { ...dd }; delete n[p.item_id]; return n })
        setMsg(`✓ "${p.name}" enregistré. Les nouveaux coûts s'appliquent aux ventes FUTURES uniquement.`)
      } else { setMsg('Erreur: ' + (d.error || '')) }
    } catch { setMsg('Erreur réseau.') }
    setSavingId(null)
  }

  const categories = useMemo(() => {
    const set = new Set<string>()
    products.forEach(p => { if (p.category) set.add(p.category) })
    return ['Tous', ...Array.from(set).sort()]
  }, [products])

  const filtered = useMemo(() => {
    let out = products
    if (cat !== 'Tous') out = out.filter(p => p.category === cat)
    if (search) {
      const q = search.toLowerCase()
      out = out.filter(p => p.name.toLowerCase().includes(q) || (p.barcode || '').toLowerCase().includes(q))
    }
    return out
  }, [products, cat, search])

  // Cost coverage summary (how many products have a cost set)
  const withCost = products.filter(p => p.cost > 0).length
  const coverage = products.length ? Math.round(withCost / products.length * 100) : 0

  if (loading) return <div style={S.wrap}><div style={S.box}>Chargement…</div></div>

  if (!apiKey) return (
    <div style={S.wrap}>
      <div style={{ ...S.box, textAlign: 'center', maxWidth: 420 }}>
        <div style={{ fontSize: 34 }}>🔒</div>
        <h1 style={S.brand}>Connexion requise</h1>
        <p style={{ color: '#7A6E5F', fontSize: 13, marginBottom: 16 }}>Connectez-vous pour gérer vos produits et coûts.</p>
        <a href="/dashboard" style={{ ...S.btn, display: 'block', textDecoration: 'none' }}>Se connecter →</a>
      </div>
    </div>
  )

  return (
    <div style={S.wrap}>
      <div style={{ ...S.box, maxWidth: 1100 }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, flexWrap: 'wrap', gap: 8 }}>
          <h1 style={S.brand}>📦 Produits &amp; Coûts</h1>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <a href="/dashboard" style={{ color: '#E8A84C', fontSize: 13, textDecoration: 'none' }}>← Tableau de bord</a>
            <button style={S.btnGhost} onClick={() => apiKey && load(apiKey)}>↻ Recharger</button>
          </div>
        </div>
        <p style={{ color: '#7A6E5F', fontSize: 13, margin: '0 0 14px' }}>
          {restName ? restName + ' — ' : ''}Renseignez le prix d'achat (coût) de chaque produit pour suivre votre bénéfice réel.
        </p>

        {/* Info banner — the golden rule */}
        <div style={S.info}>
          💡 Modifier un coût n'affecte que les <b>ventes futures</b>. Les journées passées restent verrouillées
          (chaque vente conserve le coût figé au moment de la vente). Un produit sans coût est compté à 100% de marge
          et signalé dans la couverture.
        </div>

        {/* Coverage stat */}
        <div style={S.statRow}>
          <div style={S.stat}>
            <div style={S.statVal}>{products.length}</div>
            <div style={S.statLbl}>Produits</div>
          </div>
          <div style={S.stat}>
            <div style={{ ...S.statVal, color: coverage >= 80 ? '#3DB87A' : coverage >= 40 ? '#E8A84C' : '#E05252' }}>{coverage}%</div>
            <div style={S.statLbl}>Couverture coût</div>
          </div>
          <div style={S.stat}>
            <div style={S.statVal}>{withCost}</div>
            <div style={S.statLbl}>Avec coût</div>
          </div>
          <div style={S.stat}>
            <div style={{ ...S.statVal, color: '#E05252' }}>{products.length - withCost}</div>
            <div style={S.statLbl}>Sans coût</div>
          </div>
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', margin: '16px 0 10px' }}>
          <input style={{ ...S.inp, maxWidth: 280 }} placeholder="🔍 Rechercher un produit / code-barres…" value={search} onChange={e => setSearch(e.target.value)} />
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {categories.map(c => (
              <button key={c} onClick={() => setCat(c)} style={{ ...S.chip, ...(cat === c ? S.chipOn : {}) }}>{c}</button>
            ))}
          </div>
          <span style={{ fontSize: 12, color: '#7A6E5F', marginLeft: 'auto' }}>{filtered.length} produit{filtered.length !== 1 ? 's' : ''}</span>
        </div>

        {msg && <div style={S.note}>{msg}</div>}

        {/* Table */}
        <div style={S.tableWrap}>
          <table style={S.table}>
            <thead>
              <tr>
                <th style={S.th}>Produit</th>
                <th style={S.th}>Catégorie</th>
                <th style={{ ...S.th, textAlign: 'right' }}>Prix vente</th>
                <th style={{ ...S.th, textAlign: 'right' }}>Coût (achat)</th>
                <th style={{ ...S.th, textAlign: 'right' }}>Marge</th>
                <th style={{ ...S.th, textAlign: 'right' }}>Qté</th>
                <th style={{ ...S.th, textAlign: 'center' }}>Suivi</th>
                <th style={{ ...S.th, textAlign: 'right' }}>Seuil bas</th>
                <th style={S.th}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={9} style={{ textAlign: 'center', color: '#7A6E5F', padding: 30 }}>Aucun produit</td></tr>
              ) : filtered.map(p => {
                const margin = num(p.sell_price) - num(p.cost)
                const marginPct = num(p.sell_price) > 0 ? Math.round(margin / num(p.sell_price) * 100) : 0
                const noCost = num(p.cost) <= 0
                return (
                  <tr key={p.item_id} style={dirty[p.item_id] ? S.trDirty : undefined}>
                    <td style={S.td}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 18 }}>{p.emoji || '📦'}</span>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 13 }}>{p.name || <span style={{ color: '#7A6E5F' }}>(sans nom)</span>}</div>
                          {noCost && <div style={{ fontSize: 10, color: '#E05252' }}>⚠ coût non défini</div>}
                        </div>
                      </div>
                    </td>
                    <td style={S.td}>
                      <input style={{ ...S.cell, width: 120 }} value={p.category} onChange={e => edit(p.item_id, 'category', e.target.value)} placeholder="—" />
                    </td>
                    <td style={{ ...S.td, textAlign: 'right' }}>
                      <input type="number" step="0.001" min="0" style={{ ...S.cellNum }} value={p.sell_price} onChange={e => edit(p.item_id, 'sell_price', e.target.value)} />
                    </td>
                    <td style={{ ...S.td, textAlign: 'right' }}>
                      <input type="number" step="0.001" min="0" style={{ ...S.cellNum, borderColor: noCost ? 'rgba(224,82,82,.4)' : '#231C12' }} value={p.cost} onChange={e => edit(p.item_id, 'cost', e.target.value)} />
                    </td>
                    <td style={{ ...S.td, textAlign: 'right', fontWeight: 700, color: margin > 0 ? '#3DB87A' : '#7A6E5F', whiteSpace: 'nowrap' }}>
                      {num(p.sell_price) > 0 ? `${margin.toFixed(3)} (${marginPct}%)` : '—'}
                    </td>
                    <td style={{ ...S.td, textAlign: 'right' }}>
                      <input type="number" step="1" min="0" style={{ ...S.cellNum, width: 70 }} value={p.quantity} onChange={e => edit(p.item_id, 'quantity', e.target.value)} />
                    </td>
                    <td style={{ ...S.td, textAlign: 'center' }}>
                      <button onClick={() => edit(p.item_id, 'tracked', !p.tracked)} title="Suivi de stock" style={{ ...S.toggle, ...(p.tracked ? S.toggleOn : {}) }}>
                        {p.tracked ? '✅' : '⬜'}
                      </button>
                    </td>
                    <td style={{ ...S.td, textAlign: 'right' }}>
                      <input type="number" step="1" min="0" disabled={!p.tracked} style={{ ...S.cellNum, width: 70, opacity: p.tracked ? 1 : .4 }} value={p.low_threshold} onChange={e => edit(p.item_id, 'low_threshold', e.target.value)} />
                    </td>
                    <td style={{ ...S.td, textAlign: 'right' }}>
                      <button
                        onClick={() => saveRow(p)}
                        disabled={!dirty[p.item_id] || savingId === p.item_id}
                        style={{ ...S.saveBtn, opacity: (!dirty[p.item_id] || savingId === p.item_id) ? .4 : 1 }}
                      >
                        {savingId === p.item_id ? '…' : 'Enregistrer'}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <p style={{ fontSize: 11, color: '#7A6E5F', textAlign: 'center', marginTop: 14 }}>
          Clé de licence : <span style={{ fontFamily: 'monospace', color: '#E8A84C' }}>{apiKey}</span>
        </p>
      </div>
    </div>
  )
}

const S: Record<string, React.CSSProperties> = {
  wrap: { minHeight: '100vh', background: 'radial-gradient(circle at 30% 20%,rgba(245,158,11,.08),transparent 55%),#0A0704', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 20, fontFamily: 'system-ui,sans-serif', color: '#F0E8D8' },
  box: { background: '#0F0C08', border: '1px solid #231C12', borderRadius: 16, padding: 28, width: '100%', maxWidth: 1100, boxShadow: '0 24px 60px rgba(0,0,0,.5)' },
  brand: { fontSize: 22, fontWeight: 800, color: '#E8A84C', margin: 0 },
  info: { background: 'rgba(200,145,58,.06)', border: '1px solid rgba(200,145,58,.3)', borderRadius: 10, padding: '12px 14px', fontSize: 12.5, lineHeight: 1.5, color: '#E8C99A', marginBottom: 16 },
  statRow: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: 10 },
  stat: { background: '#161210', border: '1px solid #231C12', borderRadius: 10, padding: '12px 14px', textAlign: 'center' },
  statVal: { fontSize: 22, fontWeight: 800, color: '#F0E8D8' },
  statLbl: { fontSize: 11, color: '#7A6E5F', marginTop: 2, textTransform: 'uppercase', letterSpacing: '.5px' },
  inp: { background: '#161210', border: '1px solid #231C12', borderRadius: 7, padding: '9px 12px', color: '#F0E8D8', fontSize: 13, outline: 'none', width: '100%' },
  chip: { padding: '6px 12px', background: '#161210', border: '1px solid #231C12', borderRadius: 20, color: '#7A6E5F', fontSize: 12, fontWeight: 600, cursor: 'pointer' },
  chipOn: { borderColor: 'rgba(200,145,58,.5)', background: 'rgba(200,145,58,.1)', color: '#E8A84C' },
  tableWrap: { border: '1px solid #231C12', borderRadius: 12, overflow: 'auto', marginTop: 6 },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: { textAlign: 'left', color: '#7A6E5F', fontWeight: 600, padding: '11px 12px', borderBottom: '1px solid #231C12', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.5px', background: '#161210', whiteSpace: 'nowrap', position: 'sticky', top: 0 },
  td: { padding: '9px 12px', borderBottom: '1px solid #1A140D', verticalAlign: 'middle' },
  trDirty: { background: 'rgba(200,145,58,.05)' },
  cell: { background: '#161210', border: '1px solid #231C12', borderRadius: 6, padding: '7px 9px', color: '#F0E8D8', fontSize: 13, outline: 'none' },
  cellNum: { background: '#161210', border: '1px solid #231C12', borderRadius: 6, padding: '7px 9px', color: '#F0E8D8', fontSize: 13, outline: 'none', width: 90, textAlign: 'right' },
  toggle: { background: 'transparent', border: 'none', fontSize: 16, cursor: 'pointer', padding: 2 },
  toggleOn: {},
  saveBtn: { padding: '7px 14px', border: 'none', borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: 'pointer', background: 'linear-gradient(135deg,#C8913A,#E8A84C)', color: '#080604', whiteSpace: 'nowrap' },
  btn: { width: '100%', padding: 14, border: 'none', borderRadius: 8, fontSize: 15, fontWeight: 700, cursor: 'pointer', background: 'linear-gradient(135deg,#C8913A,#E8A84C)', color: '#080604', marginTop: 16 },
  btnGhost: { padding: '7px 12px', border: '1px solid #231C12', borderRadius: 7, background: '#161210', color: '#7A6E5F', fontSize: 12, fontWeight: 600, cursor: 'pointer' },
  note: { background: '#161210', border: '1px solid #231C12', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: '#F0E8D8', margin: '12px 0' },
}
