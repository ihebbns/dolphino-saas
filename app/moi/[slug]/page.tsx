'use client'
// ═══════════════════════════════════════════════════════════════════
// /moi/[slug] — the PUBLIC customer-facing page (servio.tn/moi/<slug>).
//
// Deliberately its own standalone surface, NOT the owner dashboard's Shell —
// a customer has no business seeing "Tableau de bord / Produits / Crédit",
// and the owner's nav would be actively confusing here. Mobile-first: this
// is meant to be opened from a phone via a QR code or a shared link, added
// to the home screen, and used one-handed.
//
// Identification is the phone number alone (see the privacy note in
// /api/public/[slug]/wallet) — no password, no OTP in this pass. Ordering
// itself never touches money (no payment step here), so the blast radius
// of a guessed phone number is limited to "sees someone else's spending",
// not "loses money" — still a real limitation, upgrade path noted there.
// ═══════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useState } from 'react'

type Variant = { label: string; price: number }
type MenuItem = { id: string; name: string; e: string; price: number; variants: Variant[] | null }
type MenuCat = { icon: string; items: MenuItem[] }
type CartLine = { id: string; name: string; e: string; price: number; variantLabel: string; qty: number }

const ORDER_TYPES = [
  { id: 'sur_place', label: '🏠 Sur place' },
  { id: 'emporter', label: '🥡 À emporter' },
  { id: 'livraison', label: '🛵 Livraison' },
]

export default function PublicOrderPage({ params }: { params: { slug: string } }) {
  const slug = params.slug
  const [loading, setLoading] = useState(true)
  const [info, setInfo] = useState<any>(null)
  const [loadError, setLoadError] = useState('')
  const [tab, setTab] = useState<'order' | 'account'>('order')
  const [cat, setCat] = useState<string | null>(null)

  const [cart, setCart] = useState<CartLine[]>([])
  const [picking, setPicking] = useState<MenuItem | null>(null)

  const [phone, setPhone] = useState('')
  const [name, setName] = useState('')
  const [orderType, setOrderType] = useState('emporter')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [confirmed, setConfirmed] = useState<any>(null)
  const [msg, setMsg] = useState('')

  const [accountPhone, setAccountPhone] = useState('')
  const [account, setAccount] = useState<any>(null)
  const [accountLoading, setAccountLoading] = useState(false)

  useEffect(() => {
    fetch(`/api/public/${slug}/menu`)
      .then(r => r.json())
      .then(d => {
        if (d.ok) {
          setInfo(d)
          const firstCat = Object.keys(d.menu || {})[0]
          if (firstCat) setCat(firstCat)
        } else setLoadError(d.error || 'Commerce introuvable')
        setLoading(false)
      })
      .catch(() => { setLoadError('Impossible de contacter le serveur'); setLoading(false) })

    try {
      const savedPhone = localStorage.getItem('servio_moi_phone_' + slug)
      const savedName = localStorage.getItem('servio_moi_name_' + slug)
      if (savedPhone) { setPhone(savedPhone); setAccountPhone(savedPhone) }
      if (savedName) setName(savedName)
    } catch {}
  }, [slug])

  function addToCart(item: MenuItem, variant: Variant | null) {
    const price = variant ? variant.price : item.price
    const label = variant ? variant.label : ''
    setCart(prev => {
      const idx = prev.findIndex(l => l.id === item.id && l.variantLabel === label)
      if (idx >= 0) {
        const next = [...prev]
        next[idx] = { ...next[idx], qty: next[idx].qty + 1 }
        return next
      }
      return [...prev, { id: item.id, name: item.name, e: item.e, price, variantLabel: label, qty: 1 }]
    })
    setPicking(null)
  }

  function changeQty(i: number, delta: number) {
    setCart(prev => {
      const next = [...prev]
      next[i] = { ...next[i], qty: next[i].qty + delta }
      return next.filter(l => l.qty > 0)
    })
  }

  const total = useMemo(() => Math.round(cart.reduce((a, l) => a + l.price * l.qty, 0) * 1000) / 1000, [cart])
  const currency = info?.currency || 'DT'

  async function submitOrder() {
    if (!name.trim() || !phone.trim()) { setMsg('Nom et téléphone requis'); return }
    if (!cart.length) { setMsg('Panier vide'); return }
    setSubmitting(true); setMsg('')
    try { localStorage.setItem('servio_moi_phone_' + slug, phone.trim()); localStorage.setItem('servio_moi_name_' + slug, name.trim()) } catch {}
    try {
      const res = await fetch(`/api/public/${slug}/order`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: phone.trim(), name: name.trim(), orderType, note: note.trim(),
          items: cart.map(l => ({ id: l.id, variantLabel: l.variantLabel, qty: l.qty })),
        }),
      })
      const data = await res.json()
      if (data.ok) { setConfirmed(data); setCart([]) }
      else setMsg(data.error || 'Erreur')
    } catch { setMsg('Impossible de contacter le serveur') }
    setSubmitting(false)
  }

  async function lookupAccount() {
    if (!accountPhone.trim()) return
    setAccountLoading(true)
    try { localStorage.setItem('servio_moi_phone_' + slug, accountPhone.trim()) } catch {}
    try {
      const res = await fetch(`/api/public/${slug}/wallet?phone=${encodeURIComponent(accountPhone.trim())}`)
      setAccount(await res.json())
    } catch { setAccount({ ok: false }) }
    setAccountLoading(false)
  }

  if (loading) return <div className="moiWrap moiCenter"><div className="moiSpinner" /></div>
  if (loadError || !info) return <div className="moiWrap moiCenter"><div className="moiErr">{loadError || 'Erreur'}</div></div>

  return (
    <div className="moiWrap">
      <style>{MOI_CSS}</style>

      <header className="moiHead">
        <div className="moiLogo">{info.logo}</div>
        <div>
          <div className="moiName">{info.name}</div>
          {info.tagline && <div className="moiTagline">{info.tagline}</div>}
        </div>
      </header>

      {info.walletEnabled && (
        <div className="moiTabs">
          <button className={'moiTab' + (tab === 'order' ? ' on' : '')} onClick={() => setTab('order')}>🛒 Commander</button>
          <button className={'moiTab' + (tab === 'account' ? ' on' : '')} onClick={() => setTab('account')}>💳 Mon compte</button>
        </div>
      )}

      {tab === 'account' && info.walletEnabled && (
        <div className="moiBody">
          {!account?.found ? (
            <div className="moiCard">
              <div className="moiCardTitle">Voir mon solde</div>
              <input className="moiInput" type="tel" placeholder="Votre numéro de téléphone" value={accountPhone} onChange={e => setAccountPhone(e.target.value)} />
              <button className="moiBtn moiBtnPrimary" onClick={lookupAccount} disabled={accountLoading}>
                {accountLoading ? '…' : 'Voir'}
              </button>
              {account && !account.found && !account.walletDisabled && <div className="moiHint" style={{ marginTop: 10 }}>Aucune carte trouvée pour ce numéro.</div>}
            </div>
          ) : (
            <>
              <div className="moiCard moiBalanceCard">
                <div className="moiHint">Bonjour {account.name}</div>
                <div className="moiBalance">{account.balance.toFixed(3)} {currency}</div>
                <div className="moiHint">solde disponible</div>
              </div>
              {account.reward && (
                <div className="moiCard">
                  <div className="moiCardTitle">🎁 Récompense du mois</div>
                  <div className="moiHint">{account.reward.current_month_spend.toFixed(3)} {currency} rechargés ce mois-ci</div>
                  {account.reward.current_tier_pct != null && (
                    <div className="moiRewardOk">✓ Vous gagnerez {(account.reward.current_tier_pct * 100).toFixed(0)}% ce mois-ci</div>
                  )}
                  {account.reward.next_tier_min != null && (
                    <div className="moiHint" style={{ marginTop: 6 }}>
                      Encore {account.reward.missing_for_next.toFixed(3)} {currency} pour passer à {(account.reward.next_tier_pct * 100).toFixed(0)}%
                    </div>
                  )}
                </div>
              )}
              <div className="moiCard">
                <div className="moiCardTitle">Historique</div>
                {account.movements.length === 0 ? <div className="moiHint">Aucun mouvement</div> : account.movements.map((m: any, i: number) => (
                  <div key={i} className="moiMoveRow">
                    <div>
                      <div className="moiMoveKind">{m.kind === 'topup' ? '📥 Rechargement' : m.kind === 'spend' ? '🛒 Achat' : m.kind === 'bonus' ? '🎁 Récompense' : 'Correction'}</div>
                      <div className="moiHint">{new Date(m.client_ts).toLocaleDateString('fr-TN')}</div>
                    </div>
                    <div className={m.delta > 0 ? 'moiPlus' : 'moiMinus'}>{m.delta > 0 ? '+' : '−'}{Math.abs(m.delta).toFixed(3)}</div>
                  </div>
                ))}
              </div>
              <button className="moiBtn" style={{ margin: '0 16px 16px' }} onClick={() => { setAccount(null) }}>← Changer de numéro</button>
            </>
          )}
        </div>
      )}

      {tab === 'order' && (
        <div className="moiBody">
          {!info.onlineOrdersEnabled ? (
            <div className="moiCard"><div className="moiHint">Les commandes en ligne ne sont pas disponibles pour le moment — appelez-nous ou passez sur place.</div></div>
          ) : confirmed ? (
            <div className="moiCard moiConfirm">
              <div style={{ fontSize: 40, marginBottom: 10 }}>✅</div>
              <div className="moiCardTitle">Commande envoyée !</div>
              <div className="moiHint">Le commerce va la confirmer sous peu.</div>
              <div className="moiBalance" style={{ marginTop: 10 }}>{confirmed.total.toFixed(3)} {currency}</div>
              <button className="moiBtn moiBtnPrimary" style={{ marginTop: 16 }} onClick={() => setConfirmed(null)}>Nouvelle commande</button>
            </div>
          ) : (
            <>
              <div className="moiCatRow">
                {Object.keys(info.menu).map(c => (
                  <button key={c} className={'moiCatChip' + (cat === c ? ' on' : '')} onClick={() => setCat(c)}>
                    {info.menu[c].icon} {c}
                  </button>
                ))}
              </div>

              <div className="moiGrid">
                {cat && info.menu[cat].items.map((it: MenuItem) => (
                  <div key={it.id} className="moiItem" onClick={() => it.variants ? setPicking(it) : addToCart(it, null)}>
                    <div className="moiItemEmoji">{it.e}</div>
                    <div className="moiItemName">{it.name}</div>
                    <div className="moiItemPrice">
                      {it.variants ? `${Math.min(...it.variants.map(v => v.price)).toFixed(3)}+` : it.price.toFixed(3)} {currency}
                    </div>
                    <div className="moiItemAdd">+</div>
                  </div>
                ))}
              </div>

              {cart.length > 0 && (
                <div className="moiCart">
                  <div className="moiCardTitle">Votre panier</div>
                  {cart.map((l, i) => (
                    <div key={i} className="moiCartRow">
                      <div style={{ flex: 1 }}>
                        <div>{l.e} {l.name}{l.variantLabel ? ` (${l.variantLabel})` : ''}</div>
                        <div className="moiHint">{l.price.toFixed(3)} {currency}</div>
                      </div>
                      <div className="moiQty">
                        <button onClick={() => changeQty(i, -1)}>−</button>
                        <span>{l.qty}</span>
                        <button onClick={() => changeQty(i, 1)}>+</button>
                      </div>
                    </div>
                  ))}
                  <div className="moiTotalRow"><span>Total</span><span>{total.toFixed(3)} {currency}</span></div>

                  <div className="moiOrderTypeRow">
                    {ORDER_TYPES.map(t => (
                      <button key={t.id} className={'moiCatChip' + (orderType === t.id ? ' on' : '')} onClick={() => setOrderType(t.id)}>{t.label}</button>
                    ))}
                  </div>
                  <input className="moiInput" placeholder="Votre nom" value={name} onChange={e => setName(e.target.value)} />
                  <input className="moiInput" type="tel" placeholder="Votre téléphone" value={phone} onChange={e => setPhone(e.target.value)} />
                  <input className="moiInput" placeholder="Note (optionnel)" value={note} onChange={e => setNote(e.target.value)} />
                  {msg && <div className="moiErr">{msg}</div>}
                  <button className="moiBtn moiBtnPrimary" onClick={submitOrder} disabled={submitting}>
                    {submitting ? '…' : `✓ Commander — ${total.toFixed(3)} ${currency}`}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {picking && (
        <div className="moiOverlay" onClick={() => setPicking(null)}>
          <div className="moiSheet" onClick={e => e.stopPropagation()}>
            <div className="moiCardTitle">{picking.e} {picking.name}</div>
            {picking.variants!.map(v => (
              <button key={v.label} className="moiBtn moiVariantBtn" onClick={() => addToCart(picking, v)}>
                <span>{v.label}</span><span>{v.price.toFixed(3)} {currency}</span>
              </button>
            ))}
            <button className="moiBtn" onClick={() => setPicking(null)}>Annuler</button>
          </div>
        </div>
      )}

      <div className="moiFooter">Propulsé par Servio ⚡</div>
    </div>
  )
}

const MOI_CSS = `
.moiWrap{min-height:100vh;background:#F6F7F9;color:#14181F;font-family:-apple-system,'Segoe UI',system-ui,Roboto,sans-serif;padding-bottom:24px;}
.moiCenter{display:flex;align-items:center;justify-content:center;}
.moiSpinner{width:32px;height:32px;border:3px solid #E3E6EA;border-top-color:#B45309;border-radius:50%;animation:moiSpin .8s linear infinite;}
@keyframes moiSpin{to{transform:rotate(360deg);}}
.moiHead{display:flex;align-items:center;gap:12px;padding:20px 16px 14px;background:#fff;border-bottom:1px solid #E3E6EA;position:sticky;top:0;z-index:10;}
.moiLogo{font-size:32px;}
.moiName{font-size:17px;font-weight:800;}
.moiTagline{font-size:12px;color:#6B7280;}
.moiTabs{display:flex;gap:8px;padding:12px 16px 0;}
.moiTab{flex:1;padding:10px;border-radius:10px;border:1px solid #E3E6EA;background:#fff;font-size:13px;font-weight:700;color:#6B7280;cursor:pointer;}
.moiTab.on{background:#FEF3C7;border-color:#FCD34D;color:#B45309;}
.moiBody{padding:14px 0;}
.moiCard{background:#fff;border:1px solid #E3E6EA;border-radius:14px;padding:16px;margin:0 16px 14px;}
.moiCardTitle{font-size:14px;font-weight:800;margin-bottom:10px;}
.moiHint{font-size:12px;color:#6B7280;}
.moiInput{width:100%;padding:12px 14px;border:1px solid #E3E6EA;border-radius:10px;font-size:14px;margin-bottom:10px;box-sizing:border-box;background:#FAFBFC;}
.moiBtn{width:100%;padding:13px;border-radius:10px;border:1px solid #E3E6EA;background:#fff;font-size:14px;font-weight:700;cursor:pointer;color:#14181F;}
.moiBtnPrimary{background:linear-gradient(135deg,#D97706,#F59E0B);color:#fff;border:none;}
.moiBtn:disabled{opacity:.6;}
.moiErr{color:#B42318;font-size:13px;margin-bottom:10px;}
.moiBalanceCard{text-align:center;}
.moiBalance{font-size:30px;font-weight:800;color:#067647;margin:6px 0;}
.moiRewardOk{color:#067647;font-size:13px;font-weight:700;margin-top:6px;}
.moiMoveRow{display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #F1F3F5;}
.moiMoveKind{font-size:13px;font-weight:600;}
.moiPlus{color:#067647;font-weight:800;}
.moiMinus{color:#4B5563;font-weight:800;}
.moiCatRow{display:flex;gap:8px;overflow-x:auto;padding:0 16px 12px;-webkit-overflow-scrolling:touch;}
.moiCatChip{flex:0 0 auto;padding:9px 14px;border-radius:20px;border:1px solid #E3E6EA;background:#fff;font-size:13px;font-weight:700;color:#6B7280;white-space:nowrap;cursor:pointer;}
.moiCatChip.on{background:#B45309;border-color:#B45309;color:#fff;}
.moiGrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;padding:0 16px;}
.moiItem{background:#fff;border:1px solid #E3E6EA;border-radius:14px;padding:14px 10px;text-align:center;position:relative;cursor:pointer;aspect-ratio:1/1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;}
.moiItemEmoji{font-size:32px;}
.moiItemName{font-size:12px;font-weight:700;line-height:1.25;}
.moiItemPrice{font-size:13px;font-weight:800;color:#B45309;}
.moiItemAdd{position:absolute;top:8px;right:8px;width:24px;height:24px;border-radius:50%;background:#F59E0B;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:14px;}
.moiCart{background:#fff;border-top:2px solid #E3E6EA;border-radius:18px 18px 0 0;margin-top:16px;padding:16px;position:sticky;bottom:0;box-shadow:0 -8px 24px rgba(0,0,0,.06);}
.moiCartRow{display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #F1F3F5;font-size:13px;}
.moiQty{display:flex;align-items:center;gap:8px;}
.moiQty button{width:26px;height:26px;border-radius:50%;border:1px solid #E3E6EA;background:#FAFBFC;font-weight:800;cursor:pointer;}
.moiTotalRow{display:flex;justify-content:space-between;font-weight:800;font-size:15px;padding:10px 0;}
.moiOrderTypeRow{display:flex;gap:8px;margin-bottom:10px;overflow-x:auto;}
.moiOverlay{position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:flex-end;z-index:100;}
.moiSheet{background:#fff;border-radius:18px 18px 0 0;padding:18px;width:100%;max-width:480px;margin:0 auto;}
.moiVariantBtn{display:flex;justify-content:space-between;margin-bottom:8px;}
.moiConfirm{text-align:center;}
.moiFooter{text-align:center;color:#9AA3AF;font-size:11px;padding:20px 0 6px;}
`
