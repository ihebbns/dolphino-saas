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
// /api/public/[slug]/wallet) — no password, no OTP in this pass. Cash
// orders never touch money here (paid at pickup/delivery, same as before).
// Paying WITH wallet balance (payMethod:'wallet') is the one path that
// does move money, and it's gated on a PIN re-verified server-side on
// every submit — see /api/public/[slug]/order's header for why that's
// required (a bare phone number must never be enough to spend anything).
// ═══════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useState } from 'react'

type Variant = { label: string; price: number }
type MenuItem = { id: string; name: string; e: string; price: number; variants: Variant[] | null; available?: boolean }
type MenuCat = { icon: string; items: MenuItem[] }
type CartLine = { id: string; name: string; e: string; price: number; variantLabel: string; qty: number }

const ORDER_TYPES = [
  { id: 'sur_place', label: '🏠 Sur place' },
  { id: 'emporter', label: '🥡 À emporter' },
  { id: 'livraison', label: '🛵 Livraison' },
]

// Web Push wants the VAPID key as a raw Uint8Array, not the base64url string
// it's distributed as — standard boilerplate conversion, not project-specific.
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const arr = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i)
  return arr
}

export default function PublicOrderPage({ params }: { params: { slug: string } }) {
  const slug = params.slug
  const [loading, setLoading] = useState(true)
  const [info, setInfo] = useState<any>(null)
  const [loadError, setLoadError] = useState('')
  const [tab, setTab] = useState<'order' | 'account'>('order')
  const [cat, setCat] = useState<string | null>(null)

  // Defaults light (most phone browsers/QR-code opens land in a bright
  // context), remembered per-customer-per-restaurant since it's their own
  // device, not shared like the kiosk's.
  const [theme, setTheme] = useState<'dark' | 'light'>('light')
  useEffect(() => {
    try { const saved = localStorage.getItem('servio_moi_theme_' + slug); if (saved === 'light' || saved === 'dark') setTheme(saved) } catch {}
  }, [slug])
  function toggleTheme() {
    setTheme(t => {
      const next = t === 'dark' ? 'light' : 'dark'
      try { localStorage.setItem('servio_moi_theme_' + slug, next) } catch {}
      return next
    })
  }

  const [cart, setCart] = useState<CartLine[]>([])
  const [picking, setPicking] = useState<MenuItem | null>(null)

  const [phone, setPhone] = useState('')
  const [name, setName] = useState('')
  const [orderType, setOrderType] = useState('emporter')

  // Table QR ordering: a table's printed QR code encodes ?table=N&sec=SEC.
  // Read directly from window.location rather than next/navigation's
  // useSearchParams — this page already does all its data fetching from
  // client-side effects, and reading the URL directly here avoids pulling in
  // a Suspense boundary just for two query params. Table orders are always
  // dine-in, so the type selector becomes moot once a table is present (the
  // server enforces this too — see /api/public/[slug]/order).
  const [tableNum, setTableNum] = useState<number | null>(null)
  const [tableSec, setTableSec] = useState('')
  useEffect(() => {
    try {
      const sp = new URLSearchParams(window.location.search)
      const t = parseInt(sp.get('table') || '')
      if (Number.isFinite(t) && t > 0) { setTableNum(t); setOrderType('sur_place') }
      setTableSec(sp.get('sec') || '')
    } catch {}
  }, [])
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [confirmed, setConfirmed] = useState<any>(null)
  const [msg, setMsg] = useState('')

  // Pay with wallet balance instead of cash-on-pickup — only offered when
  // the restaurant has BOTH wallet and PIN protection on (walletPayEnabled,
  // see /api/public/[slug]/menu): spending real balance off a bare phone
  // number with no PIN would reopen exactly the gap the PIN system closed.
  const [payMethod, setPayMethod] = useState<'cash' | 'wallet'>('cash')
  const [orderPin, setOrderPin] = useState('')

  const [accountPhone, setAccountPhone] = useState('')
  const [account, setAccount] = useState<any>(null)
  const [accountLoading, setAccountLoading] = useState(false)
  const [pinInput, setPinInput] = useState('')
  const [pinConfirm, setPinConfirm] = useState('')
  const [pinError, setPinError] = useState('')

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
    if (item.available === false) return // defense in depth — the tile itself is already non-interactive
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
    // A table order's identity is the table itself — the customer is sitting
    // right there, staff can just look over. Forcing a phone number here is
    // friction with no purpose (nobody's calling them) and is exactly the
    // kind of thing that makes a "scan and order" flow feel like a chore
    // instead of instant. Pickup/delivery still need both — that customer
    // has to actually be reached.
    const isTableOrder = tableNum != null
    const effectiveName = name.trim() || (isTableOrder ? `Table ${tableNum}` : '')
    const payingWithWallet = payMethod === 'wallet'
    // Wallet-pay needs a phone regardless of order type (it identifies WHICH
    // wallet to charge) — cash orders keep the existing table-order exemption.
    if ((!isTableOrder || payingWithWallet) && (!name.trim() || !phone.trim())) { setMsg('Nom et téléphone requis'); return }
    if (payingWithWallet && !/^\d{4}$/.test(orderPin)) { setMsg('Code PIN à 4 chiffres requis pour payer par fidélité'); return }
    if (!cart.length) { setMsg('Panier vide'); return }
    setSubmitting(true); setMsg('')
    try { localStorage.setItem('servio_moi_phone_' + slug, phone.trim()); localStorage.setItem('servio_moi_name_' + slug, name.trim()) } catch {}
    try {
      const res = await fetch(`/api/public/${slug}/order`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: phone.trim(), name: effectiveName, orderType, note: note.trim(),
          items: cart.map(l => ({ id: l.id, variantLabel: l.variantLabel, qty: l.qty })),
          tableNum, tableSec,
          payMethod, pin: payingWithWallet ? orderPin : undefined,
        }),
      })
      const data = await res.json()
      if (data.ok) { setConfirmed(data); setCart([]); setOrderPin('') }
      else setMsg(data.error || 'Erreur')
    } catch { setMsg('Impossible de contacter le serveur') }
    setSubmitting(false)
  }

  // Live status tracking once an order's been submitted — polls until the
  // order reaches a terminal-for-the-customer state (ready, or rejected).
  // Kiosk doesn't need this (customer is standing in the restaurant); a
  // phone order can be made from anywhere, so this is the one place the
  // gap "did they even see the rejection" actually gets closed.
  const [orderStatus, setOrderStatus] = useState<any>(null)
  useEffect(() => {
    if (!confirmed?.order_id) { setOrderStatus(null); return }
    let stopped = false
    let iv: ReturnType<typeof setInterval>
    async function poll() {
      try {
        const res = await fetch(`/api/public/${slug}/order-status?order_id=${confirmed.order_id}`)
        const d = await res.json()
        if (stopped || !d.ok) return
        setOrderStatus(d)
        // Reached a terminal-for-the-customer state — stop the interval outright.
        if (d.ready || d.status === 'rejected') clearInterval(iv)
      } catch {}
    }
    poll()
    iv = setInterval(poll, 6000)
    return () => { stopped = true; clearInterval(iv) }
  }, [confirmed?.order_id, slug])

  // Free, no-account notification path (see lib/webpush.ts / SETUP-WHATSAPP.md
  // for the paid WhatsApp alternative) — only works while this browser is
  // reachable (tab open, or the page installed to the home screen), which is
  // why the live poll above stays the guaranteed path either way. Triggered
  // by an explicit tap, never automatically — a permission prompt fired on
  // page load is exactly what gets a browser to start auto-denying prompts.
  const [pushState, setPushState] = useState<'idle' | 'asking' | 'granted' | 'denied' | 'unsupported'>('idle')
  async function enablePushNotifications() {
    if (!confirmed?.order_id) return
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || typeof Notification === 'undefined') {
      setPushState('unsupported'); return
    }
    setPushState('asking')
    try {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') { setPushState('denied'); return }
      const reg = await navigator.serviceWorker.register('/sw.js')
      await navigator.serviceWorker.ready
      const vapidKey = process.env.NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY
      if (!vapidKey) { setPushState('unsupported'); return }
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey),
      })
      await fetch(`/api/public/${slug}/push-subscribe`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_id: confirmed.order_id, subscription: sub.toJSON() }),
      })
      setPushState('granted')
    } catch { setPushState('denied') }
  }

  async function lookupAccount() {
    if (!accountPhone.trim()) return
    setAccountLoading(true)
    setPinInput(''); setPinConfirm(''); setPinError('')
    try { localStorage.setItem('servio_moi_phone_' + slug, accountPhone.trim()) } catch {}
    try {
      const res = await fetch(`/api/public/${slug}/wallet?phone=${encodeURIComponent(accountPhone.trim())}`)
      setAccount(await res.json())
    } catch { setAccount({ ok: false }) }
    setAccountLoading(false)
  }

  // Same lookup, now carrying the PIN — used both to CREATE a PIN (first-ever
  // lookup for that phone) and to VERIFY one on every lookup after. The
  // server tells us which case it was via needsPinSetup/pinRequired on the
  // PRIOR response; this function doesn't need to know which — it just
  // resubmits phone+pin and trusts whatever comes back.
  async function submitPin() {
    if (!/^\d{4}$/.test(pinInput)) { setPinError('Le code doit contenir 4 chiffres'); return }
    if (account?.needsPinSetup && pinInput !== pinConfirm) { setPinError('Les deux codes ne correspondent pas'); return }
    setPinError('')
    setAccountLoading(true)
    try {
      const res = await fetch(`/api/public/${slug}/wallet?phone=${encodeURIComponent(accountPhone.trim())}&pin=${encodeURIComponent(pinInput)}`)
      const data = await res.json()
      setAccount(data)
      if (data.found && !data.needsPinSetup && !data.pinRequired && !data.locked) { setPinInput(''); setPinConfirm('') }
    } catch { setAccount({ ok: false }) }
    setAccountLoading(false)
  }

  if (loading) return <div className="moiWrap moiCenter" data-theme={theme}><style>{MOI_CSS}</style><div className="moiSpinner" /></div>
  if (loadError || !info) return <div className="moiWrap moiCenter" data-theme={theme}><style>{MOI_CSS}</style><div className="moiErr">{loadError || 'Erreur'}</div></div>

  return (
    <div className="moiWrap" data-theme={theme}>
      <style>{MOI_CSS}</style>

      <header className="moiHead">
        <div className="moiLogo">{info.logo}</div>
        <div style={{ flex: 1 }}>
          <div className="moiName">{info.name}</div>
          {info.tagline && <div className="moiTagline">{info.tagline}</div>}
        </div>
        <button className="moiThemeBtn" onClick={toggleTheme}>{theme === 'dark' ? '☀️' : '🌙'}</button>
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
          ) : account.locked ? (
            <div className="moiCard">
              <div className="moiCardTitle">🔒 Compte temporairement bloqué</div>
              <div className="moiHint">Trop de codes incorrects. Réessayez après {new Date(account.lockedUntil).toLocaleTimeString('fr-TN', { hour: '2-digit', minute: '2-digit' })}.</div>
              <button className="moiBtn" style={{ marginTop: 10 }} onClick={() => { setAccount(null); setPinInput(''); setPinConfirm('') }}>← Changer de numéro</button>
            </div>
          ) : account.needsPinSetup ? (
            <div className="moiCard">
              <div className="moiCardTitle">🔐 Créez un code PIN</div>
              <div className="moiHint" style={{ marginBottom: 10 }}>Protégez votre solde avec un code à 4 chiffres — à saisir à chaque consultation.</div>
              <input className="moiInput" type="tel" inputMode="numeric" maxLength={4} placeholder="Code à 4 chiffres" value={pinInput} onChange={e => setPinInput(e.target.value.replace(/\D/g, '').slice(0, 4))} />
              <input className="moiInput" type="tel" inputMode="numeric" maxLength={4} placeholder="Confirmez le code" value={pinConfirm} onChange={e => setPinConfirm(e.target.value.replace(/\D/g, '').slice(0, 4))} style={{ marginTop: 8 }} />
              {pinError && <div className="moiHint" style={{ color: '#e05252', marginTop: 6 }}>{pinError}</div>}
              <button className="moiBtn moiBtnPrimary" style={{ marginTop: 10 }} onClick={submitPin} disabled={accountLoading}>{accountLoading ? '…' : 'Créer le code'}</button>
            </div>
          ) : account.pinRequired ? (
            <div className="moiCard">
              <div className="moiCardTitle">🔐 Code PIN</div>
              <input className="moiInput" type="tel" inputMode="numeric" maxLength={4} placeholder="Votre code à 4 chiffres" value={pinInput} onChange={e => setPinInput(e.target.value.replace(/\D/g, '').slice(0, 4))} />
              {account.error && <div className="moiHint" style={{ color: '#e05252', marginTop: 6 }}>{account.error}{account.attemptsLeft != null ? ` (${account.attemptsLeft} essai${account.attemptsLeft > 1 ? 's' : ''} restant${account.attemptsLeft > 1 ? 's' : ''})` : ''}</div>}
              <button className="moiBtn moiBtnPrimary" style={{ marginTop: 10 }} onClick={submitPin} disabled={accountLoading}>{accountLoading ? '…' : 'Valider'}</button>
              <button className="moiBtn" style={{ marginTop: 8 }} onClick={() => { setAccount(null); setPinInput(''); setPinConfirm('') }}>← Changer de numéro</button>
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
              {orderStatus?.status === 'rejected' ? (
                <>
                  <div style={{ fontSize: 40, marginBottom: 10 }}>❌</div>
                  <div className="moiCardTitle">Commande refusée</div>
                  <div className="moiHint">Contactez le commerce pour plus d&apos;informations.</div>
                </>
              ) : orderStatus?.ready ? (
                <>
                  <div style={{ fontSize: 40, marginBottom: 10 }}>🍽️</div>
                  <div className="moiCardTitle">Commande prête !</div>
                  <div className="moiHint">Passez la récupérer{orderStatus.order_type === 'sur_place' ? '' : ' au comptoir'}.</div>
                </>
              ) : orderStatus?.status === 'accepted' ? (
                <>
                  <div style={{ fontSize: 40, marginBottom: 10 }}>👨‍🍳</div>
                  <div className="moiCardTitle">En préparation</div>
                  <div className="moiHint">Le commerce prépare votre commande.</div>
                </>
              ) : (
                <>
                  <div style={{ fontSize: 40, marginBottom: 10 }}>⏳</div>
                  <div className="moiCardTitle">Commande envoyée !</div>
                  <div className="moiHint">Le commerce va la confirmer sous peu.</div>
                </>
              )}
              {confirmed.droppedOutOfStock && (
                <div className="moiErr" style={{ marginTop: 10 }}>⚠️ Indisponible, retiré de la commande : {confirmed.droppedOutOfStock.join(', ')}</div>
              )}
              <div className="moiBalance" style={{ marginTop: 10 }}>{confirmed.total.toFixed(3)} {currency}</div>
              {confirmed.paid ? (
                <div className="moiRewardOk">✓ Payée par fidélité</div>
              ) : (
                <div className="moiHint">À régler {tableNum != null ? 'à table' : 'à la réception'}</div>
              )}

              {!orderStatus?.ready && orderStatus?.status !== 'rejected' && (
                pushState === 'granted' ? (
                  <div className="moiHint" style={{ marginTop: 12 }}>🔔 Vous serez notifié ici</div>
                ) : pushState === 'denied' ? (
                  <div className="moiHint" style={{ marginTop: 12 }}>Notifications refusées — gardez cette page ouverte pour suivre votre commande.</div>
                ) : pushState === 'unsupported' ? null : (
                  <button className="moiBtn" style={{ marginTop: 12 }} onClick={enablePushNotifications} disabled={pushState === 'asking'}>
                    {pushState === 'asking' ? '…' : '🔔 Me notifier quand c\'est prêt'}
                  </button>
                )
              )}
              <button className="moiBtn moiBtnPrimary" style={{ marginTop: 10 }} onClick={() => setConfirmed(null)}>Nouvelle commande</button>
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
                {cat && info.menu[cat].items.map((it: MenuItem) => {
                  const out = it.available === false
                  return (
                    <div key={it.id} className={'moiItem' + (out ? ' out' : '')} onClick={() => !out && (it.variants ? setPicking(it) : addToCart(it, null))}>
                      {out && <div className="moiItemOutBadge">Rupture</div>}
                      <div className="moiItemEmoji">{it.e}</div>
                      <div className="moiItemName">{it.name}</div>
                      <div className="moiItemPrice">
                        {it.variants ? `${Math.min(...it.variants.map(v => v.price)).toFixed(3)}+` : it.price.toFixed(3)} {currency}
                      </div>
                      {!out && <div className="moiItemAdd">+</div>}
                    </div>
                  )
                })}
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

                  {tableNum != null ? (
                    <div className="moiHint" style={{ textAlign: 'center', margin: '8px 0', fontWeight: 700 }}>
                      🍽️ Commande pour la Table {tableNum}{tableSec ? ` — ${tableSec}` : ''}
                    </div>
                  ) : (
                    <div className="moiOrderTypeRow">
                      {ORDER_TYPES.map(t => (
                        <button key={t.id} className={'moiCatChip' + (orderType === t.id ? ' on' : '')} onClick={() => setOrderType(t.id)}>{t.label}</button>
                      ))}
                    </div>
                  )}
                  <input className="moiInput" placeholder={tableNum != null ? 'Votre nom (optionnel)' : 'Votre nom'} value={name} onChange={e => setName(e.target.value)} />
                  {tableNum == null && (
                    <input className="moiInput" type="tel" placeholder="Votre téléphone" value={phone} onChange={e => setPhone(e.target.value)} />
                  )}

                  {/* Wallet-pay only makes sense for a single itemized total
                      addressed to one person — a table's bill is shared,
                      split, tipped, so "these items were already paid
                      separately" has nowhere clean to go without double-
                      charging whoever settles the table later. Pickup/
                      delivery only. */}
                  {info?.walletPayEnabled && tableNum == null && (
                    <div className="moiOrderTypeRow">
                      <button className={'moiCatChip' + (payMethod === 'cash' ? ' on' : '')} onClick={() => setPayMethod('cash')}>💵 Espèces</button>
                      <button className={'moiCatChip' + (payMethod === 'wallet' ? ' on' : '')} onClick={() => setPayMethod('wallet')}>💳 Fidélité</button>
                    </div>
                  )}
                  {payMethod === 'wallet' && tableNum == null && (
                    <input className="moiInput" type="tel" inputMode="numeric" maxLength={4} placeholder="Code PIN fidélité" value={orderPin} onChange={e => setOrderPin(e.target.value.replace(/\D/g, '').slice(0, 4))} />
                  )}

                  <input className="moiInput" placeholder="Note (optionnel)" value={note} onChange={e => setNote(e.target.value)} />
                  {msg && <div className="moiErr">{msg}</div>}
                  <button className="moiBtn moiBtnPrimary" onClick={submitOrder} disabled={submitting}>
                    {submitting ? '…' : payMethod === 'wallet' ? `💳 Payer par fidélité — ${total.toFixed(3)} ${currency}` : `✓ Commander — ${total.toFixed(3)} ${currency}`}
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
.moiWrap[data-theme="light"]{
  --m-bg:#F6F7F9; --m-bg2:#FFFFFF; --m-bg3:#FAFBFC; --m-text:#14181F; --m-muted:#6B7280; --m-muted2:#9AA3AF;
  --m-border:#E3E6EA; --m-border2:#F1F3F5; --m-accent:#B45309; --m-tab-on-bg:#FEF3C7; --m-tab-on-border:#FCD34D;
  --m-shadow:0 -8px 24px rgba(0,0,0,.06); --m-err:#B42318; --m-ok:#067647; --m-minus:#4B5563;
}
.moiWrap[data-theme="dark"]{
  --m-bg:#0F1115; --m-bg2:#171A23; --m-bg3:#1B1E28; --m-text:#FFFFFF; --m-muted:#9AA3AF; --m-muted2:#6B7280;
  --m-border:#262B36; --m-border2:#1E212B; --m-accent:#F5A623; --m-tab-on-bg:rgba(245,166,35,.15); --m-tab-on-border:#F5A623;
  --m-shadow:0 -8px 24px rgba(0,0,0,.3); --m-err:#F87171; --m-ok:#4ADE80; --m-minus:#9AA3AF;
}
.moiWrap{min-height:100vh;background:var(--m-bg);color:var(--m-text);font-family:-apple-system,'Segoe UI',system-ui,Roboto,sans-serif;padding-bottom:24px;}
.moiCenter{display:flex;align-items:center;justify-content:center;}
.moiSpinner{width:32px;height:32px;border:3px solid var(--m-border);border-top-color:var(--m-accent);border-radius:50%;animation:moiSpin .8s linear infinite;}
@keyframes moiSpin{to{transform:rotate(360deg);}}
.moiHead{display:flex;align-items:center;gap:12px;padding:20px 16px 14px;background:var(--m-bg2);border-bottom:1px solid var(--m-border);position:sticky;top:0;z-index:10;}
.moiLogo{font-size:32px;}
.moiName{font-size:17px;font-weight:800;}
.moiTagline{font-size:12px;color:var(--m-muted);}
.moiThemeBtn{width:38px;height:38px;border-radius:50%;border:1px solid var(--m-border);background:var(--m-bg3);font-size:16px;display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;}
.moiTabs{display:flex;gap:8px;padding:12px 16px 0;}
.moiTab{flex:1;padding:10px;border-radius:10px;border:1px solid var(--m-border);background:var(--m-bg2);font-size:13px;font-weight:700;color:var(--m-muted);cursor:pointer;}
.moiTab.on{background:var(--m-tab-on-bg);border-color:var(--m-tab-on-border);color:var(--m-accent);}
.moiBody{padding:14px 0;}
.moiCard{background:var(--m-bg2);border:1px solid var(--m-border);border-radius:14px;padding:16px;margin:0 16px 14px;}
.moiCardTitle{font-size:14px;font-weight:800;margin-bottom:10px;}
.moiHint{font-size:12px;color:var(--m-muted);}
.moiInput{width:100%;padding:12px 14px;border:1px solid var(--m-border);border-radius:10px;font-size:14px;margin-bottom:10px;box-sizing:border-box;background:var(--m-bg3);color:var(--m-text);}
.moiBtn{width:100%;padding:13px;border-radius:10px;border:1px solid var(--m-border);background:var(--m-bg2);font-size:14px;font-weight:700;cursor:pointer;color:var(--m-text);}
.moiBtnPrimary{background:linear-gradient(135deg,#D97706,#F59E0B);color:#fff;border:none;}
.moiBtn:disabled{opacity:.6;}
.moiErr{color:var(--m-err);font-size:13px;margin-bottom:10px;}
.moiBalanceCard{text-align:center;}
.moiBalance{font-size:30px;font-weight:800;color:var(--m-ok);margin:6px 0;}
.moiRewardOk{color:var(--m-ok);font-size:13px;font-weight:700;margin-top:6px;}
.moiMoveRow{display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--m-border2);}
.moiMoveKind{font-size:13px;font-weight:600;}
.moiPlus{color:var(--m-ok);font-weight:800;}
.moiMinus{color:var(--m-minus);font-weight:800;}
.moiCatRow{display:flex;gap:8px;overflow-x:auto;padding:0 16px 12px;-webkit-overflow-scrolling:touch;}
.moiCatChip{flex:0 0 auto;padding:9px 14px;border-radius:20px;border:1px solid var(--m-border);background:var(--m-bg2);font-size:13px;font-weight:700;color:var(--m-muted);white-space:nowrap;cursor:pointer;}
.moiCatChip.on{background:var(--m-accent);border-color:var(--m-accent);color:#fff;}
.moiGrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;padding:0 16px;}
.moiItem{background:var(--m-bg2);border:1px solid var(--m-border);border-radius:14px;padding:14px 10px;text-align:center;position:relative;cursor:pointer;aspect-ratio:1/1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;}
.moiItemEmoji{font-size:32px;}
.moiItemName{font-size:12px;font-weight:700;line-height:1.25;}
.moiItemPrice{font-size:13px;font-weight:800;color:var(--m-accent);}
.moiItemAdd{position:absolute;top:8px;right:8px;width:24px;height:24px;border-radius:50%;background:#F59E0B;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:14px;}
.moiItem.out{opacity:.5;filter:grayscale(.5);}
.moiItemOutBadge{position:absolute;top:6px;right:6px;background:var(--m-err);color:#fff;font-size:9px;font-weight:800;padding:2px 7px;border-radius:20px;}
.moiCart{background:var(--m-bg2);border-top:2px solid var(--m-border);border-radius:18px 18px 0 0;margin-top:16px;padding:16px;position:sticky;bottom:0;box-shadow:var(--m-shadow);}
.moiCartRow{display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--m-border2);font-size:13px;}
.moiQty{display:flex;align-items:center;gap:8px;}
.moiQty button{width:26px;height:26px;border-radius:50%;border:1px solid var(--m-border);background:var(--m-bg3);color:var(--m-text);font-weight:800;cursor:pointer;}
.moiTotalRow{display:flex;justify-content:space-between;font-weight:800;font-size:15px;padding:10px 0;}
.moiOrderTypeRow{display:flex;gap:8px;margin-bottom:10px;overflow-x:auto;}
.moiOverlay{position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:flex-end;z-index:100;}
.moiSheet{background:var(--m-bg2);border-radius:18px 18px 0 0;padding:18px;width:100%;max-width:480px;margin:0 auto;}
.moiVariantBtn{display:flex;justify-content:space-between;margin-bottom:8px;}
.moiConfirm{text-align:center;}
.moiFooter{text-align:center;color:var(--m-muted2);font-size:11px;padding:20px 0 6px;}
`
