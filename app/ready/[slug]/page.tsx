'use client'
// ═══════════════════════════════════════════════════════════════════
// /ready/[slug] — the pickup board (servio.tn/ready/<slug>). A screen mounted
// near the counter/kitchen pass, showing which order numbers are ready right
// now — the customer-facing mirror of the kiosk's "Votre numéro : #12"
// confirmation screen. No login, no interaction: this is meant to run
// full-screen, unattended, on a TV or spare tablet, forever.
//
// Reads GET /api/public/[slug]/ready-orders, which scopes to TODAY's orders
// only — that's what clears the board automatically at the next business
// day's first order, no "picked up" button for staff to remember to tap.
// ═══════════════════════════════════════════════════════════════════
import { useEffect, useState } from 'react'

type ReadyOrder = { daily_num: number; first_name: string; ready_at: string }

export default function ReadyBoard({ params }: { params: { slug: string } }) {
  const slug = params.slug
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [restaurantName, setRestaurantName] = useState('')
  const [orders, setOrders] = useState<ReadyOrder[]>([])
  const [note, setNote] = useState('')
  const [now, setNow] = useState(() => Date.now())

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

  // Just for the elapsed-time labels ("il y a 2 min") to tick forward on
  // their own between polls, not to drive any actual data fetch.
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 15000)
    return () => clearInterval(iv)
  }, [])

  function elapsedLabel(readyAt: string) {
    const mins = Math.max(0, Math.floor((now - new Date(readyAt).getTime()) / 60000))
    if (mins < 1) return 'à l’instant'
    return `il y a ${mins} min`
  }

  return (
    <div className="rbWrap">
      <style>{RB_CSS}</style>
      <div className="rbHeader">
        <div className="rbTitle">{restaurantName || 'Commandes prêtes'}</div>
        <div className="rbSubtitle">🍽️ Commandes prêtes — appelez votre numéro</div>
      </div>

      {loading ? (
        <div className="rbCenter"><div className="rbSpinner" /></div>
      ) : loadError ? (
        <div className="rbCenter"><div className="rbErr">{loadError}</div></div>
      ) : note ? (
        <div className="rbCenter"><div className="rbErr">{note}</div></div>
      ) : orders.length === 0 ? (
        <div className="rbCenter">
          <div className="rbIdleIcon">🕐</div>
          <div className="rbIdleText">Aucune commande prête pour le moment</div>
        </div>
      ) : (
        <div className="rbGrid">
          {orders.map(o => (
            <div key={o.daily_num} className="rbCard">
              <div className="rbNum">#{o.daily_num}</div>
              {o.first_name && <div className="rbName">{o.first_name}</div>}
              <div className="rbElapsed">{elapsedLabel(o.ready_at)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const RB_CSS = `
.rbWrap{min-height:100vh;background:#0A0704;color:#F0E8D8;font-family:-apple-system,Segoe UI,system-ui,sans-serif;display:flex;flex-direction:column;padding:32px;box-sizing:border-box;}
.rbHeader{text-align:center;margin-bottom:36px;}
.rbTitle{font-size:32px;font-weight:900;color:#E8A84C;}
.rbSubtitle{font-size:16px;color:#8A7E6C;margin-top:6px;letter-spacing:.5px;}
.rbCenter{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;}
.rbSpinner{width:40px;height:40px;border:4px solid #231C12;border-top-color:#C8913A;border-radius:50%;animation:rbSpin .8s linear infinite;}
@keyframes rbSpin{to{transform:rotate(360deg);}}
.rbErr{font-size:18px;color:#8A7E6C;text-align:center;max-width:480px;}
.rbIdleIcon{font-size:56px;opacity:.5;}
.rbIdleText{font-size:20px;color:#8A7E6C;}
.rbGrid{flex:1;display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:20px;align-content:start;}
.rbCard{background:linear-gradient(135deg,rgba(245,166,35,.14),rgba(245,166,35,.04));border:2px solid #E8A84C;border-radius:24px;padding:28px 20px;text-align:center;animation:rbCardIn .4s ease;}
@keyframes rbCardIn{from{opacity:0;transform:scale(.9);}to{opacity:1;transform:scale(1);}}
.rbNum{font-size:64px;font-weight:900;color:#E8A84C;line-height:1.1;}
.rbName{font-size:16px;font-weight:700;color:#F0E8D8;margin-top:6px;}
.rbElapsed{font-size:12px;color:#8A7E6C;margin-top:8px;text-transform:uppercase;letter-spacing:.5px;}
`
