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
  // This screen runs unattended for hours on a TV/tablet — dark by default
  // (easier on the eyes in a dim dining room), but a bright kitchen or a
  // screen near a sunny window needs light mode. Persisted per-restaurant,
  // same pattern as /moi and /kiosk's own theme toggle.
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')
  useEffect(() => {
    try { const saved = localStorage.getItem('servio_ready_theme_' + slug); if (saved === 'light' || saved === 'dark') setTheme(saved) } catch {}
  }, [slug])
  function toggleTheme() {
    setTheme(t => {
      const next = t === 'dark' ? 'light' : 'dark'
      try { localStorage.setItem('servio_ready_theme_' + slug, next) } catch {}
      return next
    })
  }

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
    <div className="rbWrap" data-theme={theme}>
      <style>{RB_CSS}</style>
      <div className="rbBgGlow" />
      <div className="rbHeader">
        <div className="rbHeaderLeft">
          <div className="rbTitle">{restaurantName || 'Commandes prêtes'}</div>
          <div className="rbSubtitle">Commandes prêtes — appelez votre numéro</div>
        </div>
        <div className="rbHeaderRight">
          <button className="rbThemeBtn" onClick={toggleTheme} aria-label="Changer de thème">{theme === 'dark' ? '☀️' : '🌙'}</button>
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
.rbWrap[data-theme=dark]{
  --rb-bg:#0A0704; --rb-text:#F0E8D8; --rb-title:#E8A84C; --rb-muted:#8A7E6C; --rb-muted2:#6B6154; --rb-muted3:#5A5045;
  --rb-card-base1:#15110C; --rb-card-base2:#100C08; --rb-card-border-tint:rgba(255,255,255,.04);
  --rb-num:#F5EFE4; --rb-name:#C9BEA8; --rb-elapsed:#7A6E5F;
  --rb-spinner-track:#231C12; --rb-spinner-head:#C8913A;
  --rb-glow1:rgba(232,168,76,.10); --rb-glow2:rgba(74,222,128,.06);
}
.rbWrap[data-theme=light]{
  --rb-bg:#FAF7F1; --rb-text:#1C1710; --rb-title:#B45309; --rb-muted:#7A6E5F; --rb-muted2:#5A5045; --rb-muted3:#9C917E;
  --rb-card-base1:#FFFFFF; --rb-card-base2:#FBF8F2; --rb-card-border-tint:rgba(0,0,0,.03);
  --rb-num:#1C1710; --rb-name:#4B4536; --rb-elapsed:#8A7E6C;
  --rb-spinner-track:#E8E2D6; --rb-spinner-head:#B45309;
  --rb-glow1:rgba(232,168,76,.14); --rb-glow2:rgba(22,163,74,.08);
}
.rbWrap{position:relative;min-height:100vh;background:var(--rb-bg);color:var(--rb-text);font-family:-apple-system,Segoe UI,system-ui,sans-serif;display:flex;flex-direction:column;padding:36px 44px;overflow:hidden;transition:background .2s,color .2s;}
.rbBgGlow{position:absolute;inset:0;pointer-events:none;background:
  radial-gradient(ellipse 900px 500px at 15% -10%, var(--rb-glow1), transparent 60%),
  radial-gradient(ellipse 700px 500px at 105% 10%, var(--rb-glow2), transparent 60%);
  z-index:0;}
.rbHeader{position:relative;z-index:1;display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:40px;flex-wrap:wrap;gap:16px;}
.rbTitle{font-size:36px;font-weight:900;color:var(--rb-title);letter-spacing:.3px;}
.rbSubtitle{font-size:15px;color:var(--rb-muted);margin-top:6px;letter-spacing:.4px;}
.rbHeaderRight{text-align:right;display:flex;align-items:center;gap:14px;}
.rbThemeBtn{width:40px;height:40px;border-radius:50%;border:1px solid color-mix(in srgb, var(--rb-muted) 35%, transparent);background:color-mix(in srgb, var(--rb-muted) 10%, transparent);font-size:17px;cursor:pointer;display:flex;align-items:center;justify-content:center;}
.rbClock{font-size:30px;font-weight:800;font-variant-numeric:tabular-nums;color:var(--rb-text);}
.rbLive{display:flex;align-items:center;gap:6px;justify-content:flex-end;font-size:11px;font-weight:800;letter-spacing:1.2px;color:#4ADE80;margin-top:4px;}
.rbLiveDot{width:7px;height:7px;border-radius:50%;background:#4ADE80;box-shadow:0 0 8px #4ADE80;animation:rbPulseDot 1.6s ease-in-out infinite;}
@keyframes rbPulseDot{0%,100%{opacity:1;}50%{opacity:.35;}}
.rbCenter{position:relative;z-index:1;flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;}
.rbSpinner{width:44px;height:44px;border:4px solid var(--rb-spinner-track);border-top-color:var(--rb-spinner-head);border-radius:50%;animation:rbSpin .8s linear infinite;}
@keyframes rbSpin{to{transform:rotate(360deg);}}
.rbErr{font-size:19px;color:var(--rb-muted);text-align:center;max-width:520px;}
.rbIdleIcon{font-size:64px;opacity:.35;}
.rbIdleText{font-size:22px;color:var(--rb-muted2);font-weight:600;}
.rbGrid{position:relative;z-index:1;flex:1;display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:22px;align-content:start;}
.rbCard{position:relative;background:linear-gradient(160deg, color-mix(in srgb, var(--rb-accent) 10%, var(--rb-card-base1)), var(--rb-card-base2));
  border:1.5px solid color-mix(in srgb, var(--rb-accent) 55%, transparent);
  box-shadow:0 0 0 1px color-mix(in srgb, var(--rb-accent) 12%, transparent), 0 14px 34px -10px var(--rb-glow), inset 0 1px 0 var(--rb-card-border-tint);
  border-radius:22px;padding:22px 18px 18px;text-align:center;animation:rbCardIn .45s cubic-bezier(.2,.9,.3,1.2);}
@keyframes rbCardIn{from{opacity:0;transform:scale(.88) translateY(8px);}to{opacity:1;transform:scale(1) translateY(0);}}
.rbCardStale{animation:rbCardIn .45s cubic-bezier(.2,.9,.3,1.2), rbStalePulse 2.4s ease-in-out infinite .45s;}
@keyframes rbStalePulse{0%,100%{box-shadow:0 0 0 1px color-mix(in srgb, var(--rb-accent) 12%, transparent), 0 14px 34px -10px var(--rb-glow);}50%{box-shadow:0 0 0 1px var(--rb-accent), 0 14px 40px -6px var(--rb-glow);}}
.rbCardSource{display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:800;letter-spacing:.8px;text-transform:uppercase;color:var(--rb-accent);background:color-mix(in srgb, var(--rb-accent) 14%, transparent);border:1px solid color-mix(in srgb, var(--rb-accent) 30%, transparent);border-radius:20px;padding:4px 12px;margin-bottom:14px;}
.rbNum{font-size:60px;font-weight:900;color:var(--rb-num);line-height:1;letter-spacing:.5px;}
.rbName{font-size:15px;font-weight:700;color:var(--rb-name);margin-top:8px;}
.rbElapsed{font-size:11px;color:var(--rb-elapsed);margin-top:10px;text-transform:uppercase;letter-spacing:.6px;font-weight:600;}
.rbFooter{position:relative;z-index:1;text-align:center;color:var(--rb-muted3);font-size:11px;padding-top:24px;letter-spacing:.4px;}
`
