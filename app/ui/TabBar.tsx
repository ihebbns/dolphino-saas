'use client'
// ═══════════════════════════════════════════════════════════════════
// The one navigation definition for the whole back-office.
//
// It replaces a black top navbar that scrolled sideways on a phone and hid
// half its items. Everything now lives at the BOTTOM, thumb-height, the way a
// phone app is navigated — and the desktop gets the same list as a sidebar so
// there is only ever one place to change it.
//
// Self-contained on purpose: styles are inline, so this can sit on the dark
// dashboard (its own CSS module) and on the light pages (theme.css) without
// either fighting the other. That conflict is exactly why the old navbar was
// duplicated inline inside the dashboard in the first place.
//
// Five destinations is the ceiling for thumbs. Anything finer is a SUB-ROUTE,
// rendered as a segmented control under the title.
// ═══════════════════════════════════════════════════════════════════
import { Icon, IconName } from './Icon'

export type SubRoute = { href: string; name: string }
export type Destination = {
  href: string
  name: string
  short: string        // what fits under an icon on a 375px screen
  icon: IconName
  subs?: SubRoute[]
}

export const DESTINATIONS: Destination[] = [
  { href: '/dashboard', name: 'Tableau de bord', short: 'Ventes', icon: 'home' },
  {
    href: '/stock', name: 'Produits', short: 'Produits', icon: 'box',
    subs: [
      { href: '/stock', name: 'Stock' },
      { href: '/catalog', name: 'Coûts' },
      { href: '/ingredients', name: 'Recettes' },
    ],
  },
  { href: '/audit', name: 'Caisse', short: 'Caisse', icon: 'drawer' },
  { href: '/credits', name: 'Créances', short: 'Créances', icon: 'receipt' },
  // Établissement is deliberately absent: its settings move under Profil, so the
  // owner has one place for "me and my account" instead of two.
  { href: '/profil', name: 'Profil', short: 'Profil', icon: 'settings' },
]

/** Which destination owns a route, following sub-routes. */
export function destinationOf(active: string): Destination | undefined {
  return DESTINATIONS.find(d => d.href === active || d.subs?.some(s => s.href === active))
}

const PALETTE = {
  dark:  { bg: '#0F0C08', line: '#231C12', idle: '#9C9285', on: '#E8A84C', pill: 'rgba(245,158,11,.16)' },
  light: { bg: '#FFFFFF', line: '#E3E6EA', idle: '#6B7280', on: '#B45309', pill: '#FEF3C7' },
}

/**
 * Fixed bottom navigation. Render it once per page, last in the tree.
 * Remember to leave `paddingBottom: 72` on the scrolling content so the final
 * row is never trapped underneath it.
 */
export function TabBar({
  active,
  theme = 'light',
  badges,
}: {
  active: string
  theme?: 'dark' | 'light'
  badges?: Record<string, number>
}) {
  const c = PALETTE[theme]
  const dest = destinationOf(active)

  return (
    <nav
      aria-label="Navigation principale"
      style={{
        position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 90,
        display: 'flex', alignItems: 'stretch',
        background: c.bg, borderTop: '1px solid ' + c.line,
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        fontFamily: "-apple-system,'Segoe UI',system-ui,sans-serif",
      }}
    >
      {DESTINATIONS.map(d => {
        const on = dest?.href === d.href
        const badge = badges?.[d.href] ?? d.subs?.reduce((a, s) => a + (badges?.[s.href] ?? 0), 0)
        return (
          <a
            key={d.href}
            href={d.href}
            aria-current={on ? 'page' : undefined}
            style={{
              flex: 1, minWidth: 0, minHeight: 58,
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', gap: 3,
              textDecoration: 'none', color: on ? c.on : c.idle,
              fontSize: 10.5, fontWeight: 600,
            }}
          >
            <span style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center',
                           width: 34, height: 24, borderRadius: 999,
                           background: on ? c.pill : 'transparent' }}>
              <Icon name={d.icon} size={19} />
              {badge ? (
                <span aria-hidden="true" style={{
                  position: 'absolute', top: -2, right: 2, width: 8, height: 8,
                  borderRadius: 999, background: '#B42318', border: '1.5px solid ' + c.bg,
                }} />
              ) : null}
            </span>
            <span style={{ maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {d.short}
            </span>
          </a>
        )
      })}
    </nav>
  )
}

/**
 * Sub-routes for the active destination, as a segmented control. Returns null
 * when the destination has only one view, so pages can render it blindly.
 */
export function SubNav({
  active,
  theme = 'light',
  badges,
}: {
  active: string
  theme?: 'dark' | 'light'
  badges?: Record<string, number>
}) {
  const c = PALETTE[theme]
  const dest = destinationOf(active)
  const subs = dest?.subs
  if (!subs || subs.length < 2) return null

  return (
    <div
      role="tablist"
      aria-label={dest?.name}
      style={{
        display: 'flex', gap: 6, padding: '10px 14px 2px',
        overflowX: 'auto', WebkitOverflowScrolling: 'touch',
        fontFamily: "-apple-system,'Segoe UI',system-ui,sans-serif",
      }}
    >
      {subs.map(s => {
        const on = s.href === active
        return (
          <a
            key={s.href}
            href={s.href}
            role="tab"
            aria-selected={on}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '9px 15px', minHeight: 40, borderRadius: 999,
              textDecoration: 'none', whiteSpace: 'nowrap',
              fontSize: 13, fontWeight: 600,
              border: '1px solid ' + (on ? 'transparent' : c.line),
              background: on ? c.pill : 'transparent',
              color: on ? c.on : c.idle,
            }}
          >
            {s.name}
            {badges?.[s.href] ? (
              <span style={{
                fontSize: 10.5, fontWeight: 700, background: '#B42318', color: '#fff',
                borderRadius: 999, padding: '0 5px', minWidth: 16, textAlign: 'center',
              }}>{badges[s.href]}</span>
            ) : null}
          </a>
        )
      })}
    </div>
  )
}
