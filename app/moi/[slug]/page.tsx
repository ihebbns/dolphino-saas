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
import './moi.css'

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
  const [myOrders, setMyOrders] = useState<any[] | null>(null)

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
      if (data.ok) {
        setConfirmed(data); setCart([])
        // Once logged in via the account gate, orderPin IS the session's
        // verified credential (kept alive for my-orders polling below) —
        // clearing it here would silently kill that poll after the very
        // first order. Only a one-off wallet-pay PIN (no account gate)
        // should be wiped after use.
        if (!requiresAccountLogin) setOrderPin('')
      }
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

  const [signupName, setSignupName] = useState('')

  // A phone with no wallet row at all used to be a dead end — a wallet only
  // ever came from staff creating one at the till. Once ordering itself
  // requires an account (requiresAccountLogin below), that dead end would
  // lock a brand-new customer out of ordering entirely. This self-registers
  // one, same starting point (balance 0) a staff-created card would have —
  // see /api/public/[slug]/wallet's `canCreate` branch for the server side.
  async function createAccount() {
    if (!signupName.trim()) { setPinError('Nom requis'); return }
    if (account?.pinRequiredForSignup) {
      if (!/^\d{4}$/.test(pinInput)) { setPinError('Le code doit contenir 4 chiffres'); return }
      if (pinInput !== pinConfirm) { setPinError('Les deux codes ne correspondent pas'); return }
    }
    setPinError('')
    setAccountLoading(true)
    try {
      const qs = new URLSearchParams({ phone: accountPhone.trim(), name: signupName.trim() })
      if (account?.pinRequiredForSignup) qs.set('pin', pinInput)
      const res = await fetch(`/api/public/${slug}/wallet?${qs.toString()}`)
      const data = await res.json()
      setAccount(data)
      if (data.found && !data.needsPinSetup && !data.pinRequired && !data.locked) {
        setPhone(accountPhone.trim())
        if (data.name) setName(data.name)
        if (account?.pinRequiredForSignup) setOrderPin(pinInput)
        setPinInput(''); setPinConfirm(''); setSignupName('')
      }
    } catch { setAccount({ ok: false }) }
    setAccountLoading(false)
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
      if (data.found && !data.needsPinSetup && !data.pinRequired && !data.locked) {
        // Logged in — carry the identity straight into the order form so the
        // customer never re-types it, and the already-verified PIN straight
        // into wallet-pay so it isn't asked twice in the same session.
        setPhone(accountPhone.trim())
        if (data.name) setName(data.name)
        setOrderPin(pinInput)
        setPinInput(''); setPinConfirm('')
      }
    } catch { setAccount({ ok: false }) }
    setAccountLoading(false)
  }

  // The general online-ordering link (no ?table=) requires a logged-in
  // account (phone + PIN) once the restaurant has the wallet module on —
  // ordering there always shows the customer's card and lets them pay by
  // balance or cash, so "who is this" has to be settled before the menu
  // even shows. Table QR / kiosk orders stay guest — the customer is
  // physically there, staff can see who placed it. Restaurants with no
  // wallet module have no card to gate behind, so that link keeps the
  // simple guest name+phone flow (already enforced server-side).
  const requiresAccountLogin = !!info?.walletEnabled && tableNum == null
  const accountReady = !!account?.found && !account?.needsPinSetup && !account?.pinRequired && !account?.locked

  // Live order history for the logged-in account — every order this phone
  // has ever placed at this restaurant, not just the one in this browser
  // tab (that single-order tracker below still exists for the immediate
  // post-checkout screen). Reuses the already-verified PIN so the customer
  // isn't asked for it again just to see their own history.
  useEffect(() => {
    if (!accountReady) { setMyOrders(null); return }
    let stopped = false
    async function poll() {
      try {
        const res = await fetch(`/api/public/${slug}/my-orders?phone=${encodeURIComponent(accountPhone.trim())}&pin=${encodeURIComponent(orderPin)}`)
        const data = await res.json()
        if (!stopped && data.ok) setMyOrders(data.orders)
      } catch {}
    }
    poll()
    const iv = setInterval(poll, 8000)
    return () => { stopped = true; clearInterval(iv) }
  }, [accountReady, accountPhone, orderPin, slug])

  const orderStatusLabel = (o: any) => o.status === 'rejected' ? '❌ Refusée' : o.ready ? '🍽️ Prête' : o.status === 'accepted' ? '👨‍🍳 En préparation' : '⏳ Envoyée'

  const accountPanel = (
    <>
      {!account?.found ? (
        account?.canCreate ? (
          <div className="moiCard">
            <div className="moiCardTitle">✨ Créer votre compte</div>
            <div className="moiHint" style={{ marginBottom: 10 }}>Aucun compte pour ce numéro — créez-en un pour commander{account.pinRequiredForSignup ? ' et le protéger avec un code PIN' : ''}.</div>
            <input className="moiInput" placeholder="Votre nom" value={signupName} onChange={e => setSignupName(e.target.value)} autoFocus />
            {account.pinRequiredForSignup && (
              <>
                <input className="moiInput" type="tel" inputMode="numeric" maxLength={4} placeholder="Créez un code à 4 chiffres" value={pinInput} onChange={e => setPinInput(e.target.value.replace(/\D/g, '').slice(0, 4))} />
                <input className="moiInput" type="tel" inputMode="numeric" maxLength={4} placeholder="Confirmez le code" value={pinConfirm} onChange={e => setPinConfirm(e.target.value.replace(/\D/g, '').slice(0, 4))} />
              </>
            )}
            {pinError && <div className="moiHint" style={{ color: '#e05252', marginTop: 6 }}>{pinError}</div>}
            <button className="moiBtn moiBtnPrimary" style={{ marginTop: 10 }} onClick={createAccount} disabled={accountLoading}>{accountLoading ? '…' : '✓ Créer mon compte'}</button>
            <button className="moiBtn" style={{ marginTop: 8 }} onClick={() => { setAccount(null); setSignupName(''); setPinInput(''); setPinConfirm(''); setPinError('') }}>← Changer de numéro</button>
          </div>
        ) : (
          <div className="moiCard">
            <div className="moiCardTitle">{requiresAccountLogin ? 'Se connecter' : 'Voir mon solde'}</div>
            <input className="moiInput" type="tel" placeholder="Votre numéro de téléphone" value={accountPhone} onChange={e => setAccountPhone(e.target.value)} />
            <button className="moiBtn moiBtnPrimary" onClick={lookupAccount} disabled={accountLoading}>
              {accountLoading ? '…' : 'Continuer'}
            </button>
            {account?.walletDisabled && <div className="moiHint" style={{ marginTop: 10 }}>Compte non disponible pour ce commerce.</div>}
          </div>
        )
      ) : account.locked ? (
        <div className="moiCard">
          <div className="moiCardTitle">🔒 Compte temporairement bloqué</div>
          <div className="moiHint">Trop de codes incorrects. Réessayez après {new Date(account.lockedUntil).toLocaleTimeString('fr-TN', { hour: '2-digit', minute: '2-digit' })}.</div>
          <button className="moiBtn" style={{ marginTop: 10 }} onClick={() => { setAccount(null); setPinInput(''); setPinConfirm('') }}>← Changer de numéro</button>
        </div>
      ) : account.needsPinSetup ? (
        <div className="moiCard">
          <div className="moiCardTitle">🔐 Créez un code PIN</div>
          <div className="moiHint" style={{ marginBottom: 10 }}>Protégez votre compte avec un code à 4 chiffres — à saisir à chaque connexion.</div>
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
          <div className="moiPremiumWrap">
            <div className="moiPremiumCard">
              <div className="moiPremiumTop">
                <span className="moiPremiumChip" />
                <span className="moiPremiumBrand">{info.name}</span>
              </div>
              <div className="moiPremiumBalanceLabel">Solde disponible</div>
              <div className="moiPremiumBalance">{account.balance.toFixed(3)}<span className="moiPremiumCur">{currency}</span></div>
              <div className="moiPremiumBottom">
                <div className="moiPremiumName">{account.name}</div>
                <div className="moiPremiumPhone">•••• {accountPhone.trim().slice(-4)}</div>
              </div>
            </div>
          </div>
          {account.reward?.current_tier_pct != null && (
            <div className="moiPremiumRewardRow">🎁 {(account.reward.current_tier_pct * 100).toFixed(0)}% de récompense sur vos rechargements ce mois-ci</div>
          )}
          {account.reward && (
            <div className="moiCard">
              <div className="moiCardTitle">🎁 Récompense du mois</div>
              <div className="moiHint">{account.reward.current_month_spend.toFixed(3)} {currency} rechargés ce mois-ci</div>
              {account.reward.next_tier_min != null && (
                <div className="moiHint" style={{ marginTop: 6 }}>
                  Encore {account.reward.missing_for_next.toFixed(3)} {currency} pour passer à {(account.reward.next_tier_pct * 100).toFixed(0)}%
                </div>
              )}
            </div>
          )}
          <div className="moiCard">
            <div className="moiCardTitle">🧾 Mes commandes</div>
            {myOrders === null ? (
              <div className="moiHint">Chargement…</div>
            ) : myOrders.length === 0 ? (
              <div className="moiHint">Aucune commande pour le moment</div>
            ) : myOrders.map((o: any) => (
              <div key={o.id} className="moiMoveRow">
                <div>
                  <div className="moiMoveKind">
                    {o.table_num ? `Table ${o.table_num}` : o.order_type === 'livraison' ? '🛵 Livraison' : o.order_type === 'sur_place' ? '🏠 Sur place' : '🥡 À emporter'}
                    {' — '}{(o.items || []).length} article{(o.items || []).length > 1 ? 's' : ''}
                  </div>
                  <div className="moiHint">{new Date(o.created_at).toLocaleString('fr-TN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} · {orderStatusLabel(o)}{o.paid ? ' · payée' : ''}</div>
                </div>
                <div>{o.total.toFixed(3)} {currency}</div>
              </div>
            ))}
          </div>
          <div className="moiCard">
            <div className="moiCardTitle">Historique fidélité</div>
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
          {!requiresAccountLogin && (
            <button className="moiBtn" style={{ margin: '0 16px 16px' }} onClick={() => { setAccount(null) }}>← Changer de numéro</button>
          )}
        </>
      )}
    </>
  )

  if (loading) return <div className="moiWrap moiCenter" data-theme={theme}><div className="moiSpinner" /></div>
  if (loadError || !info) return <div className="moiWrap moiCenter" data-theme={theme}><div className="moiErr">{loadError || 'Erreur'}</div></div>

  if (requiresAccountLogin && !accountReady) {
    return (
      <div className="moiWrap" data-theme={theme}>
        
        <header className="moiHead">
          <div className="moiLogo">{info.logo}</div>
          <div style={{ flex: 1 }}>
            <div className="moiName">{info.name}</div>
            {info.tagline && <div className="moiTagline">{info.tagline}</div>}
          </div>
          <button className="moiThemeBtn" onClick={toggleTheme}>{theme === 'dark' ? '☀️' : '🌙'}</button>
        </header>
        <div className="moiBody">
          <div className="moiCard">
            <div className="moiHint">Connectez-vous avec votre numéro pour commander, voir votre solde fidélité et suivre vos commandes.</div>
          </div>
          {accountPanel}
        </div>
        <div className="moiFooter">Propulsé par Servio ⚡</div>
      </div>
    )
  }

  return (
    <div className="moiWrap" data-theme={theme}>
      

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
        <div className="moiBody">{accountPanel}</div>
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
                  {tableNum == null && !requiresAccountLogin && (
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
                  {payMethod === 'wallet' && tableNum == null && !requiresAccountLogin && (
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
