'use client'
// ═══════════════════════════════════════════════════════════════════
// App shell: sidebar navigation, auth guard, and the shared fetch helper.
//
// Information architecture — one page, one job. The old layout crammed
// products, costs, stock quantities and categories onto a single screen,
// which is why editing felt arbitrary and unsafe.
//
//   /dashboard    sales, profit, sessions
//   /catalog      products & purchase cost           (cost is web-owned)
//   /stock        levels, low-stock alerts, movements (read + count)
//   /ingredients  ingredients & recipes, optional     (web-owned)
//   /credits      ardoises and archived debts         (read-only)
//   /audit        cash drawer trail                   (read-only)
//   /account      restaurant profile & modules
// ═══════════════════════════════════════════════════════════════════
import { useEffect, useState } from 'react'
import './theme.css'

export const API = process.env.NEXT_PUBLIC_API_URL || 'https://servio.tn'

export const NAV = [
  {
    label: 'Pilotage',
    items: [
      { href: '/dashboard', icon: '📊', name: 'Tableau de bord' },
      { href: '/credits', icon: '📒', name: 'Créances' },
      { href: '/audit', icon: '🔓', name: 'Tiroir-caisse' },
    ],
  },
  {
    label: 'Produits',
    items: [
      { href: '/catalog', icon: '🏷️', name: 'Produits & coûts' },
      { href: '/stock', icon: '📦', name: 'Stock' },
      { href: '/ingredients', icon: '🥣', name: 'Ingrédients & recettes' },
    ],
  },
  {
    label: 'Réglages',
    items: [{ href: '/account', icon: '⚙️', name: 'Mon établissement' }],
  },
]

export function useApiKey() {
  const [key, setKey] = useState<string | null>(null)
  const [checked, setChecked] = useState(false)
  useEffect(() => {
    setKey(localStorage.getItem('d_api_key'))
    setChecked(true)
  }, [])
  return { key, checked }
}

/** GET helper that never throws — pages render a message instead of blanking. */
export async function apiGet(path: string, key: string) {
  try {
    const sep = path.includes('?') ? '&' : '?'
    const res = await fetch(`${API}${path}${sep}key=${encodeURIComponent(key)}`)
    return await res.json()
  } catch {
    return { ok: false, error: 'Impossible de contacter le serveur.' }
  }
}

export async function apiPost(path: string, body: any) {
  try {
    const res = await fetch(`${API}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return await res.json()
  } catch {
    return { ok: false, error: 'Impossible de contacter le serveur.' }
  }
}

export const f3 = (n: any) => Number(n || 0).toFixed(3)
export const f0 = (n: any) => String(Math.round(Number(n) || 0))
export const num = (v: any) =>
  v === '' || v === null || v === undefined ? 0 : Math.max(0, parseFloat(String(v)) || 0)

export const dt = (s: string | null | undefined) => {
  if (!s) return '—'
  const d = new Date(s)
  return isNaN(d.getTime())
    ? '—'
    : d.toLocaleString('fr-TN', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export const daysSince = (s: string | null | undefined) => {
  if (!s) return null
  const t = new Date(s).getTime()
  return isNaN(t) ? null : Math.floor((Date.now() - t) / 86400000)
}

export function Shell({
  active,
  title,
  subtitle,
  actions,
  children,
  restName,
  badges,
}: {
  active: string
  title: string
  subtitle?: string
  actions?: React.ReactNode
  children: React.ReactNode
  restName?: string
  badges?: Record<string, number>
}) {
  return (
    <div className="app">
      <nav className="nav">
        <div className="navBrand">
          <div className="navMark">S</div>
          <div style={{ minWidth: 0 }}>
            <div className="navName">Servio</div>
            <div className="navSub" title={restName || ''}>
              {restName || 'Back-office'}
            </div>
          </div>
        </div>

        {NAV.map(group => (
          <div className="navGroup" key={group.label}>
            <div className="navLabel">{group.label}</div>
            {group.items.map(it => (
              <a key={it.href} href={it.href} className="navItem" data-active={active === it.href}>
                <span className="navIcon">{it.icon}</span>
                <span>{it.name}</span>
                {badges?.[it.href] ? <span className="navBadge">{badges[it.href]}</span> : null}
              </a>
            ))}
          </div>
        ))}

        <div className="navFoot">
          <button
            className="btn btnGhost btnSm"
            style={{ width: '100%' }}
            onClick={() => {
              localStorage.removeItem('d_api_key')
              location.href = '/dashboard'
            }}
          >
            Se déconnecter
          </button>
        </div>
      </nav>

      <div className="main">
        <header className="topbar">
          <div>
            <div className="topTitle">{title}</div>
            {subtitle && <div className="topSub">{subtitle}</div>}
          </div>
          <div className="topRight">{actions}</div>
        </header>
        <div className="page">{children}</div>
      </div>
    </div>
  )
}

/** Shown when there is no stored API key. */
export function LoginGate() {
  const [k, setK] = useState('')
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
        background: 'var(--bg)',
      }}
    >
      <div className="card" style={{ maxWidth: 400, width: '100%' }}>
        <div className="cardPad">
          <div className="row mb14">
            <div className="navMark">S</div>
            <div>
              <div className="strong">Servio — back-office</div>
              <div className="t12 cMuted">Entrez votre clé de licence</div>
            </div>
          </div>
          <div className="field mb14">
            <label className="label">Clé de licence</label>
            <input
              className="input"
              value={k}
              onChange={e => setK(e.target.value)}
              placeholder="SRVO-XXXX-0000"
              onKeyDown={e => {
                if (e.key === 'Enter' && k.trim()) {
                  localStorage.setItem('d_api_key', k.trim())
                  location.reload()
                }
              }}
            />
            <span className="help">La même clé que celle utilisée par la caisse.</span>
          </div>
          <button
            className="btn btnPrimary"
            style={{ width: '100%' }}
            disabled={!k.trim()}
            onClick={() => {
              localStorage.setItem('d_api_key', k.trim())
              location.reload()
            }}
          >
            Ouvrir le back-office
          </button>
        </div>
      </div>
    </div>
  )
}

/** Rendered when an endpoint reports its migration has not been run. */
export function NotReady({ sql }: { sql: string }) {
  return (
    <div className="notice nWarn">
      <span className="noticeIcon">⚠</span>
      <div>
        <div className="noticeTitle">Base de données non initialisée</div>
        Exécutez <code className="k">{sql}</code> dans Neon. En attendant, les caisses
        conservent leurs données en local — rien n&apos;est perdu, mais rien n&apos;apparaît ici.
      </div>
    </div>
  )
}

export function Loading() {
  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="skel" style={{ height: 76 }} />
      <div className="skel" style={{ height: 260 }} />
    </div>
  )
}

export function Empty({ icon, text }: { icon: string; text: string }) {
  return (
    <div className="empty">
      <div className="emptyIcon">{icon}</div>
      {text}
    </div>
  )
}
