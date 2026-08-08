'use client'
// ═══════════════════════════════════════════════════════════════════
// /kiosk/[slug] — the walk-up, self-order touchscreen (servio.tn/kiosk/<slug>).
//
// Meant to run full-screen on a device mounted at the restaurant's door/
// counter (a spare Windows box + touchscreen, or a tablet in a kiosk-mode
// browser), not on a customer's own phone — that's what /moi/[slug] is for.
// Big touch targets, no page chrome, no owner-dashboard nav. Visually this
// is deliberately closer to a commercial self-order kiosk (McDonald's/
// Burger King style) than to the phone-page's compact card list — bigger
// imagery-forward product tiles, a step indicator, more presence overall,
// since it's viewed standing up from arm's length, not held in a hand.
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
  { id: 'sur_place', label: 'Sur place', icon: '🍽️' },
  { id: 'emporter', label: 'À emporter', icon: '🥡' },
]

const STEPS = [
  { id: 'menu', label: 'Menu' },
  { id: 'cart', label: 'Détails' },
  { id: 'confirm', label: 'Confirmation' },
]

const IDLE_RESET_MS = 90_000   // no touch while mid-order → back to attract screen
const CONFIRM_RESET_MS = 15_000 // success screen auto-dismisses

export default function KioskPage({ params }: { params: { slug: string } }) {
  const slug = params.slug
  const [loading, setLoading] = useState(true)
  const [info, setInfo] = useState<any>(null)
  const [loadError, setLoadError] = useState('')

  // Defaults dark (matches the till, easier on the eyes for an always-on
  // display) but the person mounting the kiosk gets the final say — this is
  // one physical screen, not a per-visitor preference, so it's remembered
  // per-device via localStorage rather than reset every session.
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')
  useEffect(() => {
    try { const saved = localStorage.getItem('servio_kiosk_theme_' + slug); if (saved === 'light' || saved === 'dark') setTheme(saved) } catch {}
  }, [slug])
  function toggleTheme() {
    setTheme(t => {
      const next = t === 'dark' ? 'light' : 'dark'
      try { localStorage.setItem('servio_kiosk_theme_' + slug, next) } catch {}
      return next
    })
  }

  const [stage, setStage] = useState<'idle' | 'menu' | 'cart' | 'confirm'>('idle')
  const [cat, setCat] = useState<string | null>(null)
  const [cartList, setCartList] = useState<CartLine[]>([])
  const [picking, setPicking] = useState<MenuItem | null>(null)
  const [justAdded, setJustAdded] = useState<string | null>(null)

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
    setJustAdded(item.id)
    setTimeout(() => setJustAdded(cur => (cur === item.id ? null : cur)), 500)
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

  if (loading) return <div className="kioWrap kioCenter" data-theme={theme}><style>{KIOSK_CSS}</style><div className="kioSpinner" /></div>
  if (loadError || !info) return <div className="kioWrap kioCenter" data-theme={theme}><style>{KIOSK_CSS}</style><div className="kioErr">⚠️ {loadError || 'Erreur'}</div></div>

  const stepIndex = STEPS.findIndex(s => s.id === stage)

  return (
    <div className="kioWrap" data-theme={theme} onClick={bumpIdleTimer} onTouchStart={bumpIdleTimer}>
      <style>{KIOSK_CSS}</style>

      {stage === 'idle' && (
        <div className="kioIdle" onClick={() => info.onlineOrdersEnabled && setStage('menu')}>
          <button className="kioThemeBtn" onClick={e => { e.stopPropagation(); toggleTheme() }}>{theme === 'dark' ? '☀️' : '🌙'}</button>
          <div className="kioOrb kioOrb1" /><div className="kioOrb kioOrb2" /><div className="kioOrb kioOrb3" />
          <div className="kioIdleBadge">
            <div className="kioIdleLogo">{info.logo}</div>
          </div>
          <div className="kioIdleName">{info.name}</div>
          {info.tagline && <div className="kioIdleTag">{info.tagline}</div>}
          {!info.onlineOrdersEnabled ? (
            <div className="kioHint" style={{ marginTop: 24, fontSize: 20 }}>Commande à l&apos;écran indisponible pour le moment</div>
          ) : (
            <>
              <button className="kioIdleBtn"><span className="kioIdleBtnShine" />👆 Touchez pour commander</button>
              <div className="kioIdleFoot">Menu complet · Paiement à la caisse</div>
            </>
          )}
        </div>
      )}

      {stage !== 'idle' && (
        <>
          <header className="kioHead">
            <div className="kioHeadTop">
              <div className="kioLogo">{info.logo}</div>
              <div className="kioName">{info.name}</div>
              <button className="kioThemeBtn kioThemeBtnInline" onClick={toggleTheme}>{theme === 'dark' ? '☀️' : '🌙'}</button>
              <button className="kioAnnuler" onClick={resetToIdle}>✕ Annuler</button>
            </div>
            <div className="kioSteps">
              {STEPS.map((s, i) => (
                <div key={s.id} className={'kioStep' + (i === stepIndex ? ' on' : '') + (i < stepIndex ? ' done' : '')}>
                  <span className="kioStepDot">{i < stepIndex ? '✓' : i + 1}</span>
                  <span className="kioStepLabel">{s.label}</span>
                  {i < STEPS.length - 1 && <span className="kioStepLine" />}
                </div>
              ))}
            </div>
          </header>

          {stage === 'menu' && (
            <div className="kioBody">
              <div className="kioCatRow">
                {Object.keys(info.menu).map(c => (
                  <button key={c} className={'kioCatChip' + (cat === c ? ' on' : '')} onClick={() => setCat(c)}>
                    <span className="kioCatIcon">{info.menu[c].icon}</span>{c}
                  </button>
                ))}
              </div>
              <div className="kioGrid">
                {cat && info.menu[cat].items.map((it: MenuItem) => (
                  <div key={it.id} className={'kioItem' + (justAdded === it.id ? ' bump' : '')} onClick={() => it.variants ? setPicking(it) : addToCart(it, null)}>
                    <div className="kioItemPlate"><span className="kioItemEmoji">{it.e}</span></div>
                    <div className="kioItemName">{it.name}</div>
                    <div className="kioItemFoot">
                      <span className="kioItemPrice">{it.variants ? `dès ${Math.min(...it.variants.map(v => v.price)).toFixed(3)}` : it.price.toFixed(3)} {currency}</span>
                      <span className="kioItemAdd">+</span>
                    </div>
                  </div>
                ))}
              </div>
              {cartList.length > 0 && (
                <div className="kioCartBar" onClick={() => setStage('cart')}>
                  <span className="kioCartBarCount">{itemCount}</span>
                  <span className="kioCartBarLabel">article{itemCount > 1 ? 's' : ''} · {total.toFixed(3)} {currency}</span>
                  <span className="kioCartBarGo">Voir mon panier →</span>
                </div>
              )}
            </div>
          )}

          {stage === 'cart' && (
            <div className="kioBody kioCartBody">
              <div className="kioCardTitle">Votre commande</div>
              <div className="kioCartList">
                {cartList.map((l, i) => (
                  <div key={i} className="kioCartRow">
                    <div className="kioCartRowEmoji">{l.e}</div>
                    <div style={{ flex: 1 }}>
                      <div className="kioCartRowName">{l.name}{l.variantLabel ? ` · ${l.variantLabel}` : ''}</div>
                      <div className="kioHint">{l.price.toFixed(3)} {currency}</div>
                    </div>
                    <div className="kioQty">
                      <button onClick={() => changeQty(i, -1)}>−</button>
                      <span>{l.qty}</span>
                      <button onClick={() => changeQty(i, 1)}>+</button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="kioTotalRow"><span>Total</span><span>{total.toFixed(3)} {currency}</span></div>

              <div className="kioSectionLabel">Type de commande</div>
              <div className="kioOrderTypeRow">
                {ORDER_TYPES.map(t => (
                  <button key={t.id} className={'kioTypeTile' + (orderType === t.id ? ' on' : '')} onClick={() => setOrderType(t.id)}>
                    <span className="kioTypeIcon">{t.icon}</span>{t.label}
                  </button>
                ))}
              </div>

              <div className="kioSectionLabel">Vos informations</div>
              <input className="kioInput" placeholder="👤  Votre prénom (pour appeler la commande)" value={name} onChange={e => setName(e.target.value)} />
              {info.walletEnabled && (
                <input className="kioInput" type="tel" placeholder="📱  Téléphone (optionnel — points fidélité)" value={phone} onChange={e => setPhone(e.target.value)} />
              )}
              <input className="kioInput" placeholder="📝  Note (optionnel)" value={note} onChange={e => setNote(e.target.value)} />
              {msg && <div className="kioErr">{msg}</div>}
              <div className="kioPayHint"><span className="kioPayIcon">💰</span> Réglez à la caisse — espèces ou carte</div>
              <button className="kioBtnPrimary" onClick={submitOrder} disabled={submitting}>
                {submitting ? '…' : `✓ Envoyer ma commande — ${total.toFixed(3)} ${currency}`}
              </button>
              <button className="kioBtn" onClick={() => setStage('menu')}>← Ajouter d&apos;autres articles</button>
            </div>
          )}

          {stage === 'confirm' && confirmed && (
            <div className="kioBody kioConfirm">
              <div className="kioConfirmRing"><div className="kioConfirmCheck">✓</div></div>
              <div className="kioConfirmTitle">Commande envoyée !</div>
              <div className="kioHint" style={{ fontSize: 18 }}>{name}, votre commande arrive en cuisine.</div>
              <div className="kioConfirmCard">
                <div className="kioConfirmCardLabel">Total à régler</div>
                <div className="kioConfirmTotal">{confirmed.total.toFixed(3)} {currency}</div>
                <div className="kioPayHint" style={{ margin: '10px 0 0' }}><span className="kioPayIcon">💰</span> Réglez à la caisse</div>
              </div>
              <button className="kioBtnPrimary" style={{ marginTop: 28, maxWidth: 420 }} onClick={resetToIdle}>Terminé</button>
            </div>
          )}
        </>
      )}

      {picking && (
        <div className="kioOverlay" onClick={() => setPicking(null)}>
          <div className="kioSheet" onClick={e => e.stopPropagation()}>
            <div className="kioSheetHandle" />
            <div className="kioSheetHead">
              <div className="kioItemPlate kioSheetPlate"><span className="kioItemEmoji">{picking.e}</span></div>
              <div className="kioCardTitle" style={{ marginBottom: 0 }}>{picking.name}</div>
            </div>
            <div className="kioSectionLabel">Choisissez une taille</div>
            {picking.variants!.map(v => (
              <button key={v.label} className="kioBtn kioVariantBtn" onClick={() => addToCart(picking, v)}>
                <span>{v.label}</span><span className="kioVariantPrice">{v.price.toFixed(3)} {currency}</span>
              </button>
            ))}
            <button className="kioBtn kioBtnGhost" onClick={() => setPicking(null)}>Annuler</button>
          </div>
        </div>
      )}
    </div>
  )
}

const KIOSK_CSS = `
* { -webkit-tap-highlight-color: transparent; user-select: none; box-sizing: border-box; }

.kioWrap[data-theme="dark"]{
  --k-bg:#0B0D12; --k-bg2:#12141C; --k-bg3:#151821; --k-bg4:#1B1E28; --k-item-grad:linear-gradient(160deg,#171A23,#12141C);
  --k-text:#FFFFFF; --k-text2:#D1D5DB; --k-muted:#9AA3AF; --k-muted2:#6B7280; --k-muted3:#565B68;
  --k-border:#23262F; --k-border2:#33384A; --k-border3:#262B36; --k-border4:#2A2E38; --k-border5:#1E212B;
  --k-idle-radial:radial-gradient(circle at 50% 15%,#1C1610 0%,#0B0D12 55%),#0B0D12;
  --k-shadow-strong:0 4px 20px rgba(0,0,0,.25); --k-tag:#B8BCC6;
}
.kioWrap[data-theme="light"]{
  --k-bg:#F7F5F0; --k-bg2:#FFFFFF; --k-bg3:#F0EDE5; --k-bg4:#E8E4D8; --k-item-grad:linear-gradient(160deg,#FFFFFF,#F5F2EA);
  --k-text:#1A1208; --k-text2:#3A3226; --k-muted:#7A6E5F; --k-muted2:#8A7A6A; --k-muted3:#9C9285;
  --k-border:#E3DDD0; --k-border2:#D5CDBC; --k-border3:#E3DDD0; --k-border4:#DDD5C5; --k-border5:#EAE4D8;
  --k-idle-radial:radial-gradient(circle at 50% 15%,#FFF8EA 0%,#F7F5F0 55%),#F7F5F0;
  --k-shadow-strong:0 4px 20px rgba(0,0,0,.06); --k-tag:#6B5F4F;
}

.kioWrap{position:fixed;inset:0;background:var(--k-bg);color:var(--k-text);font-family:-apple-system,'Segoe UI',system-ui,Roboto,sans-serif;display:flex;flex-direction:column;overflow:hidden;}
.kioCenter{align-items:center;justify-content:center;}
.kioSpinner{width:48px;height:48px;border:4px solid var(--k-border);border-top-color:#F5A623;border-radius:50%;animation:kioSpin .8s linear infinite;}
@keyframes kioSpin{to{transform:rotate(360deg);}}
.kioErr{color:#F87171;font-size:20px;}

.kioThemeBtn{position:absolute;top:20px;right:20px;width:44px;height:44px;border-radius:50%;border:1px solid var(--k-border2);background:var(--k-bg2);font-size:18px;display:flex;align-items:center;justify-content:center;cursor:pointer;z-index:5;}
.kioThemeBtnInline{position:static;width:40px;height:40px;flex-shrink:0;}

/* ── Idle / attract screen ── */
.kioIdle{position:relative;flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;overflow:hidden;
  background:var(--k-idle-radial);cursor:pointer;}
.kioOrb{position:absolute;border-radius:50%;filter:blur(60px);opacity:.35;animation:kioFloat 9s ease-in-out infinite;}
.kioOrb1{width:340px;height:340px;background:#F5A623;top:-8%;left:-10%;animation-delay:0s;}
.kioOrb2{width:280px;height:280px;background:#D97706;bottom:-12%;right:-8%;animation-delay:2.4s;}
.kioOrb3{width:200px;height:200px;background:#FBBF24;top:35%;right:20%;animation-delay:4.8s;}
@keyframes kioFloat{0%,100%{transform:translateY(0) scale(1);}50%{transform:translateY(-24px) scale(1.06);}}
.kioIdleBadge{position:relative;width:180px;height:180px;border-radius:50%;display:flex;align-items:center;justify-content:center;
  background:linear-gradient(160deg,rgba(245,166,35,.10),rgba(245,166,35,.02));border:1px solid var(--k-border2);
  box-shadow:0 20px 60px rgba(0,0,0,.18), inset 0 1px 0 rgba(255,255,255,.08);margin-bottom:8px;}
.kioIdleLogo{font-size:96px;filter:drop-shadow(0 8px 24px rgba(0,0,0,.25));}
.kioIdleName{position:relative;font-size:46px;font-weight:900;letter-spacing:.5px;text-shadow:0 4px 20px rgba(0,0,0,.15);}
.kioIdleTag{position:relative;font-size:16px;color:var(--k-tag);font-weight:600;}
.kioIdleBtn{position:relative;overflow:hidden;margin-top:32px;padding:28px 58px;border-radius:60px;border:none;
  background:linear-gradient(135deg,#D97706,#F5A623);color:#fff;font-size:27px;font-weight:800;
  box-shadow:0 16px 48px rgba(245,166,35,.4), inset 0 1px 0 rgba(255,255,255,.25);animation:kioPulse 2.2s ease-in-out infinite;}
.kioIdleBtnShine{position:absolute;top:0;left:-60%;width:40%;height:100%;background:linear-gradient(115deg,transparent,rgba(255,255,255,.35),transparent);animation:kioShine 3s ease-in-out infinite;}
@keyframes kioShine{0%{left:-60%;}50%,100%{left:130%;}}
@keyframes kioPulse{0%,100%{transform:scale(1);}50%{transform:scale(1.035);}}
.kioIdleFoot{position:relative;margin-top:18px;font-size:13px;color:var(--k-muted2);font-weight:600;letter-spacing:.3px;}
.kioHint{color:var(--k-muted);}

/* ── Header + step indicator ── */
.kioHead{background:var(--k-bg2);border-bottom:1px solid var(--k-border);box-shadow:var(--k-shadow-strong);}
.kioHeadTop{display:flex;align-items:center;gap:14px;padding:18px 24px 10px;}
.kioLogo{font-size:30px;}
.kioName{font-size:21px;font-weight:800;flex:1;}
.kioAnnuler{padding:11px 20px;border-radius:12px;border:1px solid var(--k-border2);background:var(--k-bg4);color:var(--k-text2);font-size:15px;font-weight:700;}
.kioSteps{display:flex;align-items:center;justify-content:center;gap:2px;padding:2px 24px 16px;}
.kioStep{display:flex;align-items:center;gap:8px;color:var(--k-muted3);font-size:13px;font-weight:700;}
.kioStepDot{width:24px;height:24px;border-radius:50%;background:var(--k-bg4);border:1px solid var(--k-border2);display:flex;align-items:center;justify-content:center;font-size:12px;color:var(--k-muted2);flex-shrink:0;}
.kioStep.on .kioStepDot{background:linear-gradient(135deg,#D97706,#F5A623);border-color:transparent;color:#1A1200;}
.kioStep.on .kioStepLabel{color:#F5A623;}
.kioStep.done .kioStepDot{background:#1F3A2A;border-color:#2E5B3E;color:#4ADE80;}
.kioStep.done .kioStepLabel{color:var(--k-muted);}
.kioStepLine{width:36px;height:1px;background:var(--k-border4);margin:0 6px;}

.kioBody{flex:1;overflow-y:auto;padding:22px 24px 110px;}
.kioSectionLabel{font-size:12px;font-weight:800;letter-spacing:.6px;text-transform:uppercase;color:var(--k-muted2);margin:18px 0 10px;}

/* ── Category rail ── */
.kioCatRow{display:flex;gap:10px;overflow-x:auto;padding-bottom:18px;-webkit-overflow-scrolling:touch;}
.kioCatChip{flex:0 0 auto;display:flex;align-items:center;gap:8px;padding:12px 20px 12px 12px;border-radius:26px;border:1px solid var(--k-border3);
  background:var(--k-bg3);font-size:16px;font-weight:700;color:var(--k-text2);white-space:nowrap;transition:transform .12s;}
.kioCatChip:active{transform:scale(.96);}
.kioCatIcon{width:30px;height:30px;border-radius:50%;background:var(--k-bg4);display:flex;align-items:center;justify-content:center;font-size:16px;}
.kioCatChip.on{background:linear-gradient(135deg,#D97706,#F5A623);border-color:transparent;color:#1A1200;box-shadow:0 6px 20px rgba(245,166,35,.3);}
.kioCatChip.on .kioCatIcon{background:rgba(255,255,255,.25);}

/* ── Product grid ── */
.kioGrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:16px;}
.kioItem{position:relative;background:var(--k-item-grad);border:1px solid var(--k-border);border-radius:22px;padding:18px 14px 16px;
  text-align:center;display:flex;flex-direction:column;align-items:center;gap:10px;transition:transform .15s, box-shadow .15s;}
.kioItem:active{transform:scale(.96);}
.kioItem.bump{animation:kioBump .4s ease;}
@keyframes kioBump{0%{transform:scale(1);}30%{transform:scale(1.06);box-shadow:0 0 0 3px rgba(245,166,35,.5);}100%{transform:scale(1);}}
.kioItemPlate{width:88px;height:88px;border-radius:50%;display:flex;align-items:center;justify-content:center;
  background:radial-gradient(circle at 35% 30%,rgba(245,166,35,.22),rgba(245,166,35,.04) 70%);border:1px solid rgba(245,166,35,.15);}
.kioItemEmoji{font-size:44px;filter:drop-shadow(0 4px 10px rgba(0,0,0,.2));}
.kioItemName{font-size:15px;font-weight:700;line-height:1.3;min-height:38px;display:flex;align-items:center;}
.kioItemFoot{display:flex;align-items:center;justify-content:space-between;width:100%;margin-top:auto;}
.kioItemPrice{font-size:15px;font-weight:800;color:#F5A623;}
.kioItemAdd{width:30px;height:30px;border-radius:50%;background:linear-gradient(135deg,#D97706,#F5A623);color:#1A1200;font-weight:900;font-size:17px;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 14px rgba(245,166,35,.35);}

/* ── Sticky cart bar ── */
.kioCartBar{position:fixed;left:16px;right:16px;bottom:16px;display:flex;align-items:center;gap:14px;padding:16px 20px;border-radius:20px;
  background:linear-gradient(135deg,#D97706,#F5A623);color:#1A1200;box-shadow:0 16px 40px rgba(245,166,35,.4);}
.kioCartBarCount{width:32px;height:32px;border-radius:50%;background:rgba(26,18,0,.18);display:flex;align-items:center;justify-content:center;font-weight:900;font-size:15px;flex-shrink:0;}
.kioCartBarLabel{flex:1;font-weight:800;font-size:16px;}
.kioCartBarGo{font-weight:800;font-size:15px;}

/* ── Cart / detail step ── */
.kioCartBody{max-width:640px;margin:0 auto;width:100%;}
.kioCardTitle{font-size:21px;font-weight:800;margin-bottom:6px;}
.kioCartList{background:var(--k-bg2);border:1px solid var(--k-border);border-radius:18px;padding:4px 16px;}
.kioCartRow{display:flex;align-items:center;gap:12px;padding:14px 0;border-bottom:1px solid var(--k-border5);font-size:16px;}
.kioCartRow:last-child{border-bottom:none;}
.kioCartRowEmoji{width:40px;height:40px;border-radius:12px;background:var(--k-bg4);display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0;}
.kioCartRowName{font-weight:700;}
.kioQty{display:flex;align-items:center;gap:12px;}
.kioQty button{width:38px;height:38px;border-radius:50%;border:1px solid var(--k-border2);background:var(--k-bg4);color:var(--k-text);font-weight:800;font-size:18px;}
.kioQty span{font-size:16px;font-weight:800;min-width:18px;text-align:center;}
.kioTotalRow{display:flex;justify-content:space-between;align-items:center;font-weight:800;font-size:21px;padding:16px 4px;margin-top:4px;}
.kioOrderTypeRow{display:flex;gap:12px;}
.kioTypeTile{flex:1;display:flex;flex-direction:column;align-items:center;gap:8px;padding:18px 10px;border-radius:16px;border:1px solid var(--k-border3);background:var(--k-bg3);color:var(--k-text2);font-size:14px;font-weight:700;}
.kioTypeIcon{font-size:26px;}
.kioTypeTile.on{background:linear-gradient(160deg,rgba(245,166,35,.16),rgba(245,166,35,.05));border-color:#F5A623;color:#F5A623;}
.kioInput{width:100%;padding:17px 18px;border:1px solid var(--k-border3);border-radius:14px;font-size:17px;margin-bottom:12px;background:var(--k-bg3);color:var(--k-text);}
.kioInput::placeholder{color:var(--k-muted2);}
.kioPayHint{display:flex;align-items:center;justify-content:center;gap:8px;text-align:center;color:#B8770D;font-size:15px;font-weight:700;
  background:rgba(251,191,36,.12);border:1px solid rgba(251,191,36,.3);border-radius:12px;padding:12px;margin:8px 0 16px;}
.kioWrap[data-theme="dark"] .kioPayHint{color:#FBBF24;}
.kioPayIcon{font-size:17px;}
.kioBtnPrimary{width:100%;padding:21px;border-radius:16px;border:none;background:linear-gradient(135deg,#D97706,#F5A623);color:#fff;font-size:19px;font-weight:800;margin-bottom:12px;box-shadow:0 10px 28px rgba(245,166,35,.3);}
.kioBtnPrimary:disabled{opacity:.6;box-shadow:none;}
.kioBtn{width:100%;padding:17px;border-radius:14px;border:1px solid var(--k-border3);background:var(--k-bg3);color:var(--k-text2);font-size:16px;font-weight:700;margin-bottom:10px;}
.kioBtnGhost{background:transparent;}
.kioErr{color:#F87171;font-size:15px;margin-bottom:10px;text-align:center;}

/* ── Confirmation ── */
.kioConfirm{display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;min-height:56vh;}
.kioConfirmRing{width:110px;height:110px;border-radius:50%;background:radial-gradient(circle,rgba(74,222,128,.18),transparent 70%);
  border:2px solid #2E5B3E;display:flex;align-items:center;justify-content:center;margin-bottom:18px;animation:kioRingIn .5s ease;}
@keyframes kioRingIn{0%{transform:scale(.5);opacity:0;}100%{transform:scale(1);opacity:1;}}
.kioConfirmCheck{width:76px;height:76px;border-radius:50%;background:linear-gradient(135deg,#22C55E,#4ADE80);color:#08240F;font-size:38px;font-weight:900;display:flex;align-items:center;justify-content:center;}
.kioConfirmTitle{font-size:28px;font-weight:900;margin-bottom:8px;}
.kioConfirmCard{margin-top:22px;padding:22px 32px;border-radius:20px;background:var(--k-bg2);border:1px solid var(--k-border);min-width:260px;}
.kioConfirmCardLabel{font-size:12px;font-weight:800;letter-spacing:.6px;text-transform:uppercase;color:var(--k-muted2);margin-bottom:6px;}
.kioConfirmTotal{font-size:34px;font-weight:900;color:#F5A623;}

/* ── Variant picker sheet ── */
.kioOverlay{position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:flex-end;z-index:100;}
.kioSheet{background:var(--k-bg2);border:1px solid var(--k-border);border-bottom:none;border-radius:26px 26px 0 0;padding:12px 24px 24px;width:100%;max-width:560px;margin:0 auto;}
.kioSheetHandle{width:44px;height:4px;border-radius:2px;background:var(--k-border2);margin:0 auto 16px;}
.kioSheetHead{display:flex;align-items:center;gap:14px;margin-bottom:6px;}
.kioSheetPlate{width:56px;height:56px;flex-shrink:0;}
.kioSheetPlate .kioItemEmoji{font-size:28px;}
.kioVariantBtn{display:flex;justify-content:space-between;font-size:17px;}
.kioVariantPrice{color:#F5A623;font-weight:800;}
`
