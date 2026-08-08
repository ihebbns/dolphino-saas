'use client'
// ═══════════════════════════════════════════════════════════════════
// /kiosk/[slug] — the walk-up, self-order touchscreen (servio.tn/kiosk/<slug>).
//
// Meant to run full-screen on a device mounted at the restaurant's door/
// counter (a spare Windows box + touchscreen, or a tablet in a kiosk-mode
// browser), not on a customer's own phone — that's what /moi/[slug] is for.
// Big touch targets, no page chrome, no owner-dashboard nav.
//
// Payment stays at the counter — same as /moi, this never touches money.
// An order submitted here lands as a 'pending' row exactly like a phone
// order does (same /api/public/[slug]/order, same POS "🌐 Commandes" queue),
// so staff still taps Accepter once and the customer pays when they order
// or pick up. No new payment hardware/integration required for v1.
//
// Between customers: after a successful order, or after a period of no
// touches while mid-flow, the screen resets itself back to the idle/attract
// screen and the cart is cleared — nothing carries over to the next person.
// ═══════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useRef, useState } from 'react'

type Variant = { label: string; price: number }
type MenuItem = { id: string; name: string; e: string; price: number; variants: Variant[] | null }
type CartLine = { id: string; name: string; e: string; price: number; variantLabel: string; qty: number }

const ORDER_TYPES = [
  { id: 'sur_place', label: '🏠 Sur place' },
  { id: 'emporter', label: '🥡 À emporter' },
]

const IDLE_RESET_MS = 90_000   // no touch while mid-order → back to attract screen
const CONFIRM_RESET_MS = 15_000 // success screen auto-dismisses

export default function KioskPage({ params }: { params: { slug: string } }) {
  const slug = params.slug
  const [loading, setLoading] = useState(true)
  const [info, setInfo] = useState<any>(null)
  const [loadError, setLoadError] = useState('')

  const [stage, setStage] = useState<'idle' | 'menu' | 'cart' | 'confirm'>('idle')
  const [cat, setCat] = useState<string | null>(null)
  const [cartList, setCartList] = useState<CartLine[]>([])
  const [picking, setPicking] = useState<MenuItem | null>(null)

  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [orderType, setOrderType] = useState('sur_place')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [confirmed, setConfirmed] = useState<any>(null)
  const [msg, setMsg] = useState('')

  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

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
  }, [slug])

  function resetToIdle() {
    setStage('idle'); setCartList([]); setPicking(null)
    setName(''); setPhone(''); setNote(''); setOrderType('sur_place')
    setMsg(''); setConfirmed(null)
  }

  // Mid-order inactivity → assume the customer walked away, clear for the next one.
  function bumpIdleTimer() {
    if (idleTimer.current) clearTimeout(idleTimer.current)
    if (stage === 'menu' || stage === 'cart') {
      idleTimer.current = setTimeout(resetToIdle, IDLE_RESET_MS)
    }
  }
  useEffect(() => { bumpIdleTimer(); return () => { if (idleTimer.current) clearTimeout(idleTimer.current) } }, [stage, cartList, name, phone, note])

  useEffect(() => {
    if (stage === 'confirm') {
      confirmTimer.current = setTimeout(resetToIdle, CONFIRM_RESET_MS)
      return () => { if (confirmTimer.current) clearTimeout(confirmTimer.current) }
    }
  }, [stage])

  function addToCart(item: MenuItem, variant: Variant | null) {
    const price = variant ? variant.price : item.price
    const label = variant ? variant.label : ''
    setCartList(prev => {
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
    setCartList(prev => {
      const next = [...prev]
      next[i] = { ...next[i], qty: next[i].qty + delta }
      return next.filter(l => l.qty > 0)
    })
  }

  const total = useMemo(() => Math.round(cartList.reduce((a, l) => a + l.price * l.qty, 0) * 1000) / 1000, [cartList])
  const itemCount = useMemo(() => cartList.reduce((a, l) => a + l.qty, 0), [cartList])
  const currency = info?.currency || 'DT'

  async function submitOrder() {
    if (!name.trim()) { setMsg('Votre prénom, pour appeler la commande'); return }
    if (!cartList.length) return
    setSubmitting(true); setMsg('')
    try {
      const res = await fetch(`/api/public/${slug}/order`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: phone.trim(), name: name.trim(), orderType, note: note.trim(),
          items: cartList.map(l => ({ id: l.id, variantLabel: l.variantLabel, qty: l.qty })),
        }),
      })
      const data = await res.json()
      if (data.ok) { setConfirmed(data); setStage('confirm') }
      else setMsg(data.error || 'Erreur')
    } catch { setMsg('Impossible de contacter le serveur') }
    setSubmitting(false)
  }

  if (loading) return <div className="kioWrap kioCenter"><div className="kioSpinner" /></div>
  if (loadError || !info) return <div className="kioWrap kioCenter"><div className="kioErr">{loadError || 'Erreur'}</div></div>

  return (
    <div className="kioWrap" onClick={bumpIdleTimer} onTouchStart={bumpIdleTimer}>
      <style>{KIOSK_CSS}</style>

      {stage === 'idle' && (
        <div className="kioIdle" onClick={() => setStage('menu')}>
          <div className="kioIdleLogo">{info.logo}</div>
          <div className="kioIdleName">{info.name}</div>
          {!info.onlineOrdersEnabled ? (
            <div className="kioHint" style={{ marginTop: 20, fontSize: 20 }}>Commande à l'écran indisponible pour le moment</div>
          ) : (
            <button className="kioIdleBtn">👆 Touchez pour commander</button>
          )}
        </div>
      )}

      {stage !== 'idle' && (
        <>
          <header className="kioHead">
            <div className="kioLogo">{info.logo}</div>
            <div className="kioName">{info.name}</div>
            <button className="kioAnnuler" onClick={resetToIdle}>✕ Annuler</button>
          </header>

          {stage === 'menu' && (
            <div className="kioBody">
              <div className="kioCatRow">
                {Object.keys(info.menu).map(c => (
                  <button key={c} className={'kioCatChip' + (cat === c ? ' on' : '')} onClick={() => setCat(c)}>
                    {info.menu[c].icon} {c}
                  </button>
                ))}
              </div>
              <div className="kioGrid">
                {cat && info.menu[cat].items.map((it: MenuItem) => (
                  <div key={it.id} className="kioItem" onClick={() => it.variants ? setPicking(it) : addToCart(it, null)}>
                    <div className="kioItemEmoji">{it.e}</div>
                    <div className="kioItemName">{it.name}</div>
                    <div className="kioItemPrice">
                      {it.variants ? `${Math.min(...it.variants.map(v => v.price)).toFixed(3)}+` : it.price.toFixed(3)} {currency}
                    </div>
                  </div>
                ))}
              </div>
              {cartList.length > 0 && (
                <div className="kioCartBar" onClick={() => setStage('cart')}>
                  <span>{itemCount} article{itemCount > 1 ? 's' : ''}</span>
                  <span>{total.toFixed(3)} {currency}</span>
                  <span>Voir mon panier →</span>
                </div>
              )}
            </div>
          )}

          {stage === 'cart' && (
            <div className="kioBody kioCartBody">
              <div className="kioCardTitle">Votre commande</div>
              {cartList.map((l, i) => (
                <div key={i} className="kioCartRow">
                  <div style={{ flex: 1 }}>
                    <div className="kioCartRowName">{l.e} {l.name}{l.variantLabel ? ` (${l.variantLabel})` : ''}</div>
                    <div className="kioHint">{l.price.toFixed(3)} {currency}</div>
                  </div>
                  <div className="kioQty">
                    <button onClick={() => changeQty(i, -1)}>−</button>
                    <span>{l.qty}</span>
                    <button onClick={() => changeQty(i, 1)}>+</button>
                  </div>
                </div>
              ))}
              <div className="kioTotalRow"><span>Total</span><span>{total.toFixed(3)} {currency}</span></div>

              <div className="kioOrderTypeRow">
                {ORDER_TYPES.map(t => (
                  <button key={t.id} className={'kioCatChip' + (orderType === t.id ? ' on' : '')} onClick={() => setOrderType(t.id)}>{t.label}</button>
                ))}
              </div>
              <input className="kioInput" placeholder="Votre prénom (pour appeler la commande)" value={name} onChange={e => setName(e.target.value)} />
              {info.walletEnabled && (
                <input className="kioInput" type="tel" placeholder="Téléphone (optionnel — points fidélité)" value={phone} onChange={e => setPhone(e.target.value)} />
              )}
              <input className="kioInput" placeholder="Note (optionnel)" value={note} onChange={e => setNote(e.target.value)} />
              {msg && <div className="kioErr">{msg}</div>}
              <div className="kioPayHint">💰 Réglez à la caisse — espèces ou carte</div>
              <button className="kioBtnPrimary" onClick={submitOrder} disabled={submitting}>
                {submitting ? '…' : `✓ Envoyer ma commande — ${total.toFixed(3)} ${currency}`}
              </button>
              <button className="kioBtn" onClick={() => setStage('menu')}>← Ajouter d'autres articles</button>
            </div>
          )}

          {stage === 'confirm' && confirmed && (
            <div className="kioBody kioConfirm">
              <div className="kioConfirmCheck">✅</div>
              <div className="kioConfirmTitle">Commande envoyée !</div>
              <div className="kioHint" style={{ fontSize: 18 }}>{name}, votre commande arrive en cuisine.</div>
              <div className="kioConfirmTotal">{confirmed.total.toFixed(3)} {currency}</div>
              <div className="kioPayHint">💰 Réglez à la caisse</div>
              <button className="kioBtnPrimary" style={{ marginTop: 24 }} onClick={resetToIdle}>Terminé</button>
            </div>
          )}
        </>
      )}

      {picking && (
        <div className="kioOverlay" onClick={() => setPicking(null)}>
          <div className="kioSheet" onClick={e => e.stopPropagation()}>
            <div className="kioCardTitle">{picking.e} {picking.name}</div>
            {picking.variants!.map(v => (
              <button key={v.label} className="kioBtn kioVariantBtn" onClick={() => addToCart(picking, v)}>
                <span>{v.label}</span><span>{v.price.toFixed(3)} {currency}</span>
              </button>
            ))}
            <button className="kioBtn" onClick={() => setPicking(null)}>Annuler</button>
          </div>
        </div>
      )}
    </div>
  )
}

const KIOSK_CSS = `
* { -webkit-tap-highlight-color: transparent; user-select: none; }
.kioWrap{position:fixed;inset:0;background:#0F1115;color:#fff;font-family:-apple-system,'Segoe UI',system-ui,Roboto,sans-serif;display:flex;flex-direction:column;overflow:hidden;}
.kioCenter{align-items:center;justify-content:center;}
.kioSpinner{width:48px;height:48px;border:4px solid #2A2E38;border-top-color:#F59E0B;border-radius:50%;animation:kioSpin .8s linear infinite;}
@keyframes kioSpin{to{transform:rotate(360deg);}}
.kioErr{color:#F87171;font-size:20px;}

.kioIdle{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;background:radial-gradient(circle at 50% 30%,#1C2029,#0F1115);cursor:pointer;}
.kioIdleLogo{font-size:110px;}
.kioIdleName{font-size:44px;font-weight:900;letter-spacing:.5px;}
.kioIdleBtn{margin-top:30px;padding:26px 54px;border-radius:60px;border:none;background:linear-gradient(135deg,#D97706,#F59E0B);color:#fff;font-size:26px;font-weight:800;box-shadow:0 12px 40px rgba(245,158,11,.35);animation:kioPulse 1.8s ease-in-out infinite;}
@keyframes kioPulse{0%,100%{transform:scale(1);}50%{transform:scale(1.04);}}
.kioHint{color:#9AA3AF;}

.kioHead{display:flex;align-items:center;gap:14px;padding:18px 24px;background:#161922;border-bottom:1px solid #262B36;}
.kioLogo{font-size:32px;}
.kioName{font-size:22px;font-weight:800;flex:1;}
.kioAnnuler{padding:12px 20px;border-radius:12px;border:1px solid #3A3F4C;background:#1E222C;color:#D1D5DB;font-size:16px;font-weight:700;}

.kioBody{flex:1;overflow-y:auto;padding:20px 24px 100px;}
.kioCatRow{display:flex;gap:10px;overflow-x:auto;padding-bottom:16px;-webkit-overflow-scrolling:touch;}
.kioCatChip{flex:0 0 auto;padding:14px 22px;border-radius:24px;border:1px solid #2E3340;background:#1A1D26;font-size:17px;font-weight:700;color:#D1D5DB;white-space:nowrap;}
.kioCatChip.on{background:#F59E0B;border-color:#F59E0B;color:#1A1200;}
.kioGrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:16px;}
.kioItem{background:#1A1D26;border:1px solid #2E3340;border-radius:20px;padding:20px 12px;text-align:center;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;aspect-ratio:1/1;}
.kioItemEmoji{font-size:52px;}
.kioItemName{font-size:16px;font-weight:700;line-height:1.25;}
.kioItemPrice{font-size:18px;font-weight:800;color:#F59E0B;}
.kioCartBar{position:fixed;left:0;right:0;bottom:0;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:22px 28px;background:linear-gradient(135deg,#D97706,#F59E0B);color:#fff;font-size:19px;font-weight:800;}

.kioCartBody{max-width:640px;margin:0 auto;width:100%;}
.kioCardTitle{font-size:22px;font-weight:800;margin-bottom:16px;}
.kioCartRow{display:flex;align-items:center;gap:14px;padding:14px 0;border-bottom:1px solid #262B36;font-size:17px;}
.kioCartRowName{font-weight:600;}
.kioQty{display:flex;align-items:center;gap:14px;}
.kioQty button{width:44px;height:44px;border-radius:50%;border:1px solid #3A3F4C;background:#1E222C;color:#fff;font-weight:800;font-size:20px;}
.kioQty span{font-size:18px;font-weight:700;min-width:20px;text-align:center;}
.kioTotalRow{display:flex;justify-content:space-between;font-weight:800;font-size:22px;padding:18px 0;border-top:2px solid #2E3340;margin-top:6px;}
.kioOrderTypeRow{display:flex;gap:10px;margin:6px 0 16px;}
.kioInput{width:100%;padding:18px 18px;border:1px solid #2E3340;border-radius:14px;font-size:18px;margin-bottom:12px;box-sizing:border-box;background:#1A1D26;color:#fff;}
.kioInput::placeholder{color:#6B7280;}
.kioPayHint{text-align:center;color:#FBBF24;font-size:16px;font-weight:700;margin:10px 0 16px;}
.kioBtnPrimary{width:100%;padding:22px;border-radius:16px;border:none;background:linear-gradient(135deg,#D97706,#F59E0B);color:#fff;font-size:20px;font-weight:800;margin-bottom:12px;}
.kioBtnPrimary:disabled{opacity:.6;}
.kioBtn{width:100%;padding:18px;border-radius:14px;border:1px solid #2E3340;background:#1A1D26;color:#D1D5DB;font-size:17px;font-weight:700;margin-bottom:10px;}
.kioErr{color:#F87171;font-size:15px;margin-bottom:10px;text-align:center;}

.kioConfirm{display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;min-height:60vh;}
.kioConfirmCheck{font-size:80px;margin-bottom:10px;}
.kioConfirmTitle{font-size:30px;font-weight:900;margin-bottom:10px;}
.kioConfirmTotal{font-size:36px;font-weight:900;color:#F59E0B;margin:16px 0 6px;}

.kioOverlay{position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:flex-end;z-index:100;}
.kioSheet{background:#161922;border-radius:24px 24px 0 0;padding:24px;width:100%;max-width:560px;margin:0 auto;}
.kioVariantBtn{display:flex;justify-content:space-between;font-size:18px;}
`
