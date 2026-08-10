'use client'
// ═══════════════════════════════════════════════════════════════════
// /ready/[slug] — the pickup board (servio.tn/ready/<slug>). A screen mounted
// near the counter/kitchen pass, showing which order numbers are ready right
// now — the customer-facing mirror of the kiosk's "Votre numéro : #12"
// confirmation screen. No login, no interaction: this is meant to run
// full-screen, unattended, on a TV or spare tablet, forever.
//
// Reads GET /api/public/[slug]/ready-orders, which is really reading the
// SAME kitchen tickets the till's KDS overlay and /kitchen/[slug] already
// bump — a number appears here the instant kitchen staff mark that ticket
// done, no separate action for anyone. Scoped to TODAY, which is what
// clears the board automatically at the next business day's first ticket.
//
// Each entry is tagged by channel (caisse / kiosque / en ligne) — parsed
// server-side from the ticket's own num prefix (see printOnlineOrderKitchenTicket
// in the POS) — so a shouted number is never ambiguous between two
// completely different orders that happen to share a digit.
// ═══════════════════════════════════════════════════════════════════
import { useEffect, useState } from 'react'

type Source = 'kiosk' | 'moi' | 'caisse'
type ReadyOrder = { display_num: string; source: Source; first_name: string; ready_at: string }

const SOURCE_META: Record<Source, { label: string; icon: string; color: string; glow: string }> = {
  caisse: { label: 'Caisse', icon: '🏪', color: '#E8A84C', glow: 'rgba(232,168,76,.16)' },
  kiosk:  { label: 'Kiosque', icon: '🖥️', color: '#4ADE80', glow: 'rgba(74,222,128,.16)' },
  moi:    { label: 'En ligne', icon: '🌐', color: '#60A5FA', glow: 'rgba(96,165,250,.16)' },
}

export default function ReadyBoard({ params }: { params: { slug: string } }) {
  const slug = params.slug
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [restaurantName, setRestaurantName] = useState('')
  const [orders, setOrders] = useState<ReadyOrder[]>([])
  const [note, setNote] = useState('')
  const [now, setNow] = useState(() => Date.now())
  const [clock, setClock] = useState('')

  useEffect(() => {
    let stopped = false
    async function poll() {
      try {
        const res = await fetch(`/api/public/${slug}/ready-orders`, { cache: 'no-store' })
        const data = await res.json()
        if (stopped) return
        if (!data.ok) { setLoadError(data.error || 'Erreur'); setLoading(false); return }
        if (data.restaurant_name) setRestaurantName(data.restaurant_name)
        if (data.ready === false) { setNote(data.note || ''); setOrders([]) }
        else { setNote(''); setOrders(Array.isArray(data.orders) ? data.orders : []) }
        setLoading(false)
      } catch {
        if (!stopped) { setLoadError('Impossible de contacter le serveur'); setLoading(false) }
      }
    }
    poll()
    const iv = setInterval(poll, 5000)
    return () => { stopped = true; clearInterval(iv) }
  }, [slug])

  // Drives both the elapsed-time labels ("à l'instant" -> "il y a 2 min")
  // and the header clock — a screen left running for hours needs both to
  // keep moving on their own between polls, not just when new data arrives.
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(iv)
  }, [])
  useEffect(() => {
    setClock(new Date(now).toLocaleTimeString('fr-TN', { hour: '2-digit', minute: '2-digit' }))
  }, [now])

  function elapsedLabel(readyAt: string) {
    const mins = Math.max(0, Math.floor((now - new Date(readyAt).getTime()) / 60000))
    if (mins < 1) return 'à l’instant'
    return `il y a ${mins} min`
  }
  // A number that's been sitting ready a while (nobody's come for it) gets a
  // visual nudge — same idea as a real pickup board dimming/flagging stale
  // calls so staff notice a forgotten order, not just customers.
  function isStale(readyAt: string) {
    return (now - new Date(readyAt).getTime()) > 8 * 60000
  }

  return (
    <div className="rbWrap">
      <style>{RB_CSS}</style>
      <div className="rbBgGlow" />
      <div className="rbHeader">
        <div className="rbHeaderLeft">
          <div className="rbTitle">{restaurantName || 'Commandes prêtes'}</div>
          <div className="rbSubtitle">Commandes prêtes — appelez votre numéro</div>
        </div>
        <div className="rbHeaderRight">
          <div className="rbClock">{clock}</div>
          <div className="rbLive"><span className="rbLiveDot" />EN DIRECT</div>
        </div>
      </div>

      {loading ? (
        <div className="rbCenter"><div className="rbSpinner" /></div>
      ) : loadError ? (
        <div className="rbCenter"><div className="rbErr">{loadError}</div></div>
      ) : note ? (
        <div className="rbCenter"><div className="rbErr">{note}</div></div>
      ) : orders.length === 0 ? (
        <div className="rbCenter">
          <div className="rbIdleIcon">🍽️</div>
          <div className="rbIdleText">Aucune commande prête pour le moment</div>
        </div>
      ) : (
        <div className="rbGrid">
          {orders.map(o => {
            const meta = SOURCE_META[o.source] || SOURCE_META.caisse
            const stale = isStale(o.ready_at)
            return (
              <div key={`${o.source}-${o.display_num}`} className={'rbCard' + (stale ? ' rbCardStale' : '')} style={{ '--rb-accent': meta.color, '--rb-glow': meta.glow } as any}>
                <div className="rbCardSource"><span>{meta.icon}</span>{meta.label}</div>
                <div className="rbNum">#{o.display_num}</div>
                {o.first_name && <div className="rbName">{o.first_name}</div>}
                <div className="rbElapsed">{elapsedLabel(o.ready_at)}</div>
              </div>
            )
          })}
        </div>
      )}

      <div className="rbFooter">Propulsé par Servio ⚡</div>
    </div>
  )
}

const RB_CSS = `
*{box-sizing:border-box;}
.rbWrap{position:relative;min-height:100vh;background:#0A0704;color:#F0E8D8;font-family:-apple-system,Segoe UI,system-ui,sans-serif;display:flex;flex-direction:column;padding:36px 44px;overflow:hidden;}
.rbBgGlow{position:absolute;inset:0;pointer-events:none;background:
  radial-gradient(ellipse 900px 500px at 15% -10%, rgba(232,168,76,.10), transparent 60%),
  radial-gradient(ellipse 700px 500px at 105% 10%, rgba(74,222,128,.06), transparent 60%);
  z-index:0;}
.rbHeader{position:relative;z-index:1;display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:40px;flex-wrap:wrap;gap:16px;}
.rbTitle{font-size:36px;font-weight:900;color:#E8A84C;letter-spacing:.3px;}
.rbSubtitle{font-size:15px;color:#8A7E6C;margin-top:6px;letter-spacing:.4px;}
.rbHeaderRight{text-align:right;}
.rbClock{font-size:30px;font-weight:800;font-variant-numeric:tabular-nums;color:#F0E8D8;}
.rbLive{display:flex;align-items:center;gap:6px;justify-content:flex-end;font-size:11px;font-weight:800;letter-spacing:1.2px;color:#4ADE80;margin-top:4px;}
.rbLiveDot{width:7px;height:7px;border-radius:50%;background:#4ADE80;box-shadow:0 0 8px #4ADE80;animation:rbPulseDot 1.6s ease-in-out infinite;}
@keyframes rbPulseDot{0%,100%{opacity:1;}50%{opacity:.35;}}
.rbCenter{position:relative;z-index:1;flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;}
.rbSpinner{width:44px;height:44px;border:4px solid #231C12;border-top-color:#C8913A;border-radius:50%;animation:rbSpin .8s linear infinite;}
@keyframes rbSpin{to{transform:rotate(360deg);}}
.rbErr{font-size:19px;color:#8A7E6C;text-align:center;max-width:520px;}
.rbIdleIcon{font-size:64px;opacity:.35;}
.rbIdleText{font-size:22px;color:#6B6154;font-weight:600;}
.rbGrid{position:relative;z-index:1;flex:1;display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:22px;align-content:start;}
.rbCard{position:relative;background:linear-gradient(160deg, color-mix(in srgb, var(--rb-accent) 10%, #15110C), #100C08);
  border:1.5px solid color-mix(in srgb, var(--rb-accent) 55%, transparent);
  box-shadow:0 0 0 1px color-mix(in srgb, var(--rb-accent) 12%, transparent), 0 14px 34px -10px var(--rb-glow), inset 0 1px 0 rgba(255,255,255,.04);
  border-radius:22px;padding:22px 18px 18px;text-align:center;animation:rbCardIn .45s cubic-bezier(.2,.9,.3,1.2);}
@keyframes rbCardIn{from{opacity:0;transform:scale(.88) translateY(8px);}to{opacity:1;transform:scale(1) translateY(0);}}
.rbCardStale{animation:rbCardIn .45s cubic-bezier(.2,.9,.3,1.2), rbStalePulse 2.4s ease-in-out infinite .45s;}
@keyframes rbStalePulse{0%,100%{box-shadow:0 0 0 1px color-mix(in srgb, var(--rb-accent) 12%, transparent), 0 14px 34px -10px var(--rb-glow);}50%{box-shadow:0 0 0 1px var(--rb-accent), 0 14px 40px -6px var(--rb-glow);}}
.rbCardSource{display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:800;letter-spacing:.8px;text-transform:uppercase;color:var(--rb-accent);background:color-mix(in srgb, var(--rb-accent) 14%, transparent);border:1px solid color-mix(in srgb, var(--rb-accent) 30%, transparent);border-radius:20px;padding:4px 12px;margin-bottom:14px;}
.rbNum{font-size:60px;font-weight:900;color:#F5EFE4;line-height:1;letter-spacing:.5px;}
.rbName{font-size:15px;font-weight:700;color:#C9BEA8;margin-top:8px;}
.rbElapsed{font-size:11px;color:#7A6E5F;margin-top:10px;text-transform:uppercase;letter-spacing:.6px;font-weight:600;}
.rbFooter{position:relative;z-index:1;text-align:center;color:#5A5045;font-size:11px;padding-top:24px;letter-spacing:.4px;}
`
