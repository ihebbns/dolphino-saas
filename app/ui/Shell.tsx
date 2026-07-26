'use client'
// ═══════════════════════════════════════════════════════════════════
// App shell — phone first.
//
// The owner checks this from a phone, standing up, usually at closing
// time. So the phone is the design target and the desktop sidebar is the
// wide variant, not the other way round.
//
// Under 700px: a fixed bottom tab bar. Five destinations is the practical
// ceiling for thumbs, so the seven old pages collapse into five, with
// tabs inside the ones that carried more than one job:
//
//   Aujourd'hui   what did I take today
//   Produits      Stock · Coûts · Recettes
//   Caisse        what happened at the till
//   Créances      who owes me money
//   Compte        my establishment
//
// The destination list is DATA. Splitting Produits back out, or reordering
// the bar, is an edit to one array — not a refactor. That matters because
// this structure was reasoned from thumb reach rather than measured
// against Square and Toast, so it is the most likely thing to change.
//
// Routes are unchanged: tabs are ordinary links, so nothing had to move
// and no redirects were needed.
// ═══════════════════════════════════════════════════════════════════
import { useEffect, useState } from 'react'
import './theme.css'
import { Icon, IconName } from './Icon'
import { DESTINATIONS } from './TabBar'
import { useTheme } from './useTheme'
import { qtyTrim } from './fmt'

/** Theme switch, present on every Shell page. Lives here rather than per-page so
 *  there is exactly one control and it cannot drift out of sync. */
export function ThemeToggle() {
  const { dark, toggle } = useTheme()
  return (
    <button
      className="btn btnGhost btnSm"
      onClick={toggle}
      title={dark ? 'Passer en clair' : 'Passer en sombre'}
      aria-label={dark ? 'Passer en thème clair' : 'Passer en thème sombre'}
    >
      {dark ? 'Clair' : 'Sombre'}
    </button>
  )
}

export const API = process.env.NEXT_PUBLIC_API_URL || 'https://servio.tn'

export type Dest = {
  href: string
  name: string
  icon: IconName
  /** Views inside this destination, rendered as a segmented control. */
  tabs?: { href: string; name: string }[]
}

// Single source of truth, shared with the dashboard's dark page via ui/TabBar.
export const DESTS: Dest[] = DESTINATIONS.map(d => ({
  href: d.href,
  name: d.name,
  icon: d.icon,
  tabs: d.subs,
}))

/**
 * Reads which optional modules this establishment uses. Presentation only: a
 * module that is off simply stops being offered, so a café that does not do
 * recipes never sees a Recettes tab it will not maintain.
 * Defaults to ON so nothing disappears for an existing client.
 */
export function useModules(key: string | null) {
  const [modules, setModules] = useState<Record<string, boolean>>({})
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    if (!key) return
    apiGet('/api/me/config', key).then(d => {
      const m = (d && (d.modules || (d.config && d.config.modules))) || {}
      setModules(typeof m === 'object' ? m : {})
      setLoaded(true)
    }).catch(() => setLoaded(true))
  }, [key])
  const on = (name: string) => modules[name] !== false
  return { modules, loaded, on }
}

/** Kept for anything still importing the old grouped nav. */
export const NAV = DESTS

const destOf = (active: string) =>
  DESTS.find(d => d.href === active || d.tabs?.some(t => t.href === active))

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

// ── Formatting ────────────────────────────────────────────────────
// Re-exported so pages have one import. fmt.ts is the single source.
export { money, money0, qty, qtyTrim, qtyDelta, qtyOrUncounted, variance, varianceMoney, when, atTime, onDay, since, num, CURRENCY } from './fmt'
export { Icon } from './Icon'
export type { IconName } from './Icon'

// Legacy names still used by pages not yet migrated.
export const f3 = (n: any) => Number(n || 0).toFixed(3)
export const f0 = (n: any) => String(Math.round(Number(n) || 0))
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
  hideTabs,
}: {
  active: string
  title: string
  subtitle?: string
  actions?: React.ReactNode
  children: React.ReactNode
  restName?: string
  badges?: Record<string, number>
  /** Sub-routes to hide, e.g. Recettes when the ingredients module is off. */
  hideTabs?: string[]
}) {
  const dest = destOf(active)
  const tabs = dest?.tabs

  const signOut = () => {
    localStorage.removeItem('d_api_key')
    location.href = '/dashboard'
  }

  return (
    <div className="app">
      {/* Desktop sidebar. Hidden on phones, where the bottom bar takes over. */}
      <nav className="nav" aria-label="Navigation principale">
        <div className="navBrand">
          <div className="navMark">S</div>
          <div style={{ minWidth: 0 }}>
            <div className="navName">Servio</div>
            <div className="navSub" title={restName || ''}>{restName || 'Back-office'}</div>
          </div>
        </div>

        <div className="navGroup">
          {DESTS.map(d => {
            const on = dest?.href === d.href
            const badge = badges?.[d.href] ?? d.tabs?.reduce((a, t) => a + (badges?.[t.href] ?? 0), 0)
            return (
              <a
                key={d.href}
                href={d.href}
                className="navItem"
                data-active={on}
                aria-current={on ? 'page' : undefined}
              >
                <span className="navIcon"><Icon name={d.icon} size={18} /></span>
                <span>{d.name}</span>
                {badge ? <span className="navBadge">{badge}</span> : null}
              </a>
            )
          })}
        </div>

        <div className="navFoot">
          <button className="btn btnGhost btnSm" style={{ width: '100%' }} onClick={signOut}>
            Se déconnecter
          </button>
        </div>
      </nav>

      <div className="main">
        {/* Print header — only visible on paper. The screen shows the title in the
            topbar; the printed page needs it self-contained since the topbar hides. */}
        <div className="printOnly printHead">
          <div className="printTitle">{restName || 'Servio'} — {title}</div>
          <div className="printSub">
            {subtitle ? subtitle + ' · ' : ''}
            Imprimé le {new Date().toLocaleDateString('fr-TN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
          </div>
        </div>

        <header className="topbar">
          <div style={{ minWidth: 0 }}>
            <div className="topTitle">{title}</div>
            {subtitle && <div className="topSub">{subtitle}</div>}
          </div>
          <div className="topRight">
            {actions}
            <button
              className="btn btnGhost btnSm"
              onClick={() => window.print()}
              title="Imprimer / enregistrer en PDF"
              aria-label="Imprimer"
            >
              <Icon name="print" size={15} />
            </button>
            <ThemeToggle />
          </div>
        </header>

        {tabs && tabs.filter(t => !hideTabs?.includes(t.href)).length > 1 && (
          <div className="segWrap" role="tablist" aria-label={dest?.name}>
            {tabs.filter(t => !hideTabs?.includes(t.href)).map(t => (
              <a
                key={t.href}
                href={t.href}
                className="seg"
                data-active={active === t.href}
                role="tab"
                aria-selected={active === t.href}
              >
                {t.name}
                {badges?.[t.href] ? <span className="segBadge">{badges[t.href]}</span> : null}
              </a>
            ))}
          </div>
        )}

        <div className="page">{children}</div>
      </div>

      {/* Phone navigation. Fixed, thumb-height, safe-area aware. */}
      <nav className="tabbar" aria-label="Navigation principale">
        {DESTS.map(d => {
          const on = dest?.href === d.href
          const badge = badges?.[d.href] ?? d.tabs?.reduce((a, t) => a + (badges?.[t.href] ?? 0), 0)
          return (
            <a
              key={d.href}
              href={d.href}
              className="tab"
              data-active={on}
              aria-current={on ? 'page' : undefined}
            >
              <span className="tabIcon">
                <Icon name={d.icon} size={20} />
                {badge ? <span className="tabDot" aria-hidden="true" /> : null}
              </span>
              <span className="tabLabel">{d.name}</span>
            </a>
          )
        })}
      </nav>
    </div>
  )
}

/** Shown when there is no stored API key. */
export function LoginGate() {
  const [k, setK] = useState('')
  const go = () => {
    if (!k.trim()) return
    localStorage.setItem('d_api_key', k.trim())
    location.reload()
  }
  return (
    <div className="gate">
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
            <label className="label" htmlFor="lic">Clé de licence</label>
            <input
              id="lic"
              className="input"
              value={k}
              onChange={e => setK(e.target.value)}
              placeholder="SRVO-XXXX-0000"
              autoComplete="off"
              onKeyDown={e => { if (e.key === 'Enter') go() }}
            />
            <span className="help">La même clé que celle utilisée par la caisse.</span>
          </div>
          <button className="btn btnPrimary" style={{ width: '100%' }} disabled={!k.trim()} onClick={go}>
            Ouvrir le back-office
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * Rendered when an endpoint reports its migration has not been run.
 * Two sentences: what is missing, and that nothing is lost.
 */
export function NotReady({
  sql,
  missing,
  db,
}: {
  sql: string
  /** Relations the server found absent. Naming them is the difference between
   *  advice someone can act on and a message that repeats after they already
   *  ran the migration. */
  missing?: string[]
  /** Database the server actually inspected. When the SQL was run against a
   *  different Neon branch, this is the only thing that reveals it. */
  db?: { database: string; schema: string } | null
}) {
  const hasDetail = (missing && missing.length > 0) || !!db
  return (
    <div className="notice nWarn">
      <span className="noticeIcon"><Icon name="alert" size={16} /></span>
      <div>
        <div className="noticeTitle">Base de données non initialisée</div>
        Exécutez <code className="k">{sql}</code> dans Neon. Les caisses gardent tout en local
        en attendant : rien n&apos;est perdu.

        {hasDetail && (
          <div className="t12" style={{ marginTop: 8, lineHeight: 1.7 }}>
            {missing && missing.length > 0 && (
              <div>
                Tables absentes :{' '}
                {missing.map((m, i) => (
                  <span key={m}>
                    {i > 0 ? ', ' : ''}<code className="k">{m}</code>
                  </span>
                ))}
              </div>
            )}
            {db && (
              <div className="cFaint">
                Base consultée : <code className="k">{db.database}</code>
                {' '}(schéma <code className="k">{db.schema}</code>).
                {' '}Si vous avez exécuté le SQL ailleurs, c&apos;est l&apos;explication.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/** Skeleton shaped like the content that follows, so nothing shifts. */
export function Loading() {
  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="statGrid">
        <div className="skel" style={{ height: 72 }} />
        <div className="skel" style={{ height: 72 }} />
        <div className="skel" style={{ height: 72 }} />
        <div className="skel" style={{ height: 72 }} />
      </div>
      <div className="skel" style={{ height: 56 }} />
      <div className="skel" style={{ height: 56 }} />
      <div className="skel" style={{ height: 56 }} />
    </div>
  )
}

/**
 * The ONE place teaching copy belongs. A view with data shows data; a view
 * with nothing explains itself, briefly, and offers the way forward.
 */
export function Empty({
  icon,
  text,
  action,
}: {
  icon?: IconName | string
  text: string
  action?: React.ReactNode
}) {
  const known = typeof icon === 'string' && icon in ICONS_BY_NAME
  return (
    <div className="empty">
      {icon ? (
        <div className="emptyIcon">
          {known ? <Icon name={icon as IconName} size={26} /> : null}
        </div>
      ) : null}
      <div className="emptyText">{text}</div>
      {action ? <div className="emptyAction">{action}</div> : null}
    </div>
  )
}

// Cheap membership test so `Empty` stays backwards compatible with the old
// emoji strings while new callers pass an icon name.
const ICONS_BY_NAME: Record<string, true> = {
  home: true, box: true, drawer: true, receipt: true, settings: true,
  lock: true, unlock: true, alert: true, check: true, close: true,
  chevronRight: true, plus: true, minus: true, clipboard: true,
  search: true, refresh: true, print: true, trash: true, edit: true,
  arrowUp: true, arrowDown: true, store: true, flask: true, tag: true,
}

/** A headline figure. Two per row on a phone, four on a desktop. */
export function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string
  value: React.ReactNode
  hint?: React.ReactNode
  tone?: 'ok' | 'warn' | 'danger'
}) {
  return (
    <div className="stat">
      <div className="statLabel">{label}</div>
      <div className={'statValue num' + (tone ? ' t-' + tone : '')}>{value}</div>
      {hint ? <div className="statHint">{hint}</div> : null}
    </div>
  )
}

/** Status as icon + word, never colour alone. */
export function StatusPill({
  tone,
  children,
  icon,
}: {
  tone: 'ok' | 'warn' | 'danger' | 'flat'
  children: React.ReactNode
  icon?: IconName
}) {
  return (
    <span className={'pill p-' + tone}>
      {icon ? <Icon name={icon} size={13} /> : null}
      {children}
    </span>
  )
}

/** Marks a field the POS owns. One glyph instead of a paragraph. */
export function OwnerMark({ what = 'caisse' }: { what?: string }) {
  return (
    <span className="ownerMark" title={'Géré depuis la ' + what}>
      <Icon name="lock" size={12} label={'Géré depuis la ' + what} />
    </span>
  )
}

// ── Graphics ──────────────────────────────────────────────────────
// Deliberately tiny. The point is that a number becomes a comparison without
// the reader doing arithmetic. No chart library: these print, work offline and
// add nothing to the bundle.

/**
 * Stock level against its reorder threshold.
 *
 * The scale is the important decision. A bar filled relative to "the biggest
 * quantity I happen to have" tells you nothing, so the track here represents
 * roughly three times the threshold — enough headroom to see a healthy stock as
 * clearly full — and the notch marks the threshold itself. That way the answer
 * to "do I order this?" is whether the fill has reached the notch.
 */
export function LevelMeter({
  value,
  threshold,
  unit,
  showCaption = true,
}: {
  value: number
  threshold: number
  unit?: string
  showCaption?: boolean
}) {
  const v = Number(value) || 0
  const th = Math.max(0, Number(threshold) || 0)
  // With no threshold set there is nothing to compare against, so scale to the
  // value and keep the bar neutral rather than implying a judgement.
  const scale = th > 0 ? th * 3 : Math.max(v, 1)
  const pct = Math.max(0, Math.min(100, (v / scale) * 100))
  const markPct = th > 0 ? Math.min(100, (th / scale) * 100) : null

  const tone =
    th <= 0 ? 'muted' :
    v <= th ? 'danger' :
    v <= th * 1.5 ? 'warn' : 'ok'

  return (
    <div className="meterRow">
      <div
        className="meter"
        role="meter"
        aria-valuenow={v}
        aria-valuemin={0}
        aria-valuemax={scale}
        aria-label={th > 0 ? `Stock ${v} ${unit || ''}, seuil ${th}` : `Stock ${v} ${unit || ''}`}
      >
        <div className="meterFill" data-tone={tone} style={{ width: pct + '%' }} />
        {markPct != null && <div className="meterMark" style={{ left: markPct + '%' }} />}
      </div>
      {showCaption && (
        <div className="meterCap">
          <span className="num">{qtyTrim(v, unit)}</span>
          {th > 0 ? <span className="num">seuil {qtyTrim(th)}</span> : <span>pas de seuil</span>}
        </div>
      )}
    </div>
  )
}

/**
 * Ranked horizontal bars. Scaled to the largest row so the top item fills the
 * track and the rest are read against it.
 */
export function BarList({
  rows,
  emptyText = 'Rien à afficher',
  max = 8,
}: {
  rows: { label: string; value: number; display?: string; sub?: string; tone?: 'ok' | 'danger' | 'info' }[]
  emptyText?: string
  max?: number
}) {
  const top = [...rows].sort((a, b) => b.value - a.value).slice(0, max)
  const peak = top.length ? Math.max(...top.map(r => Math.abs(r.value))) : 0
  if (!top.length || peak <= 0) return <Empty text={emptyText} />
  return (
    <div className="barList">
      {top.map((r, i) => (
        <div className="barItem" key={r.label + i}>
          <div className="barItemName" title={r.label}>{r.label}</div>
          <div className="barItemVal num">{r.display ?? qtyTrim(r.value)}</div>
          <div className="barItemTrack">
            <div
              className="barItemFill"
              data-tone={r.tone}
              style={{ width: Math.max(2, (Math.abs(r.value) / peak) * 100) + '%' }}
            />
          </div>
          {r.sub ? <div className="barItemSub">{r.sub}</div> : null}
        </div>
      ))}
    </div>
  )
}

/**
 * "Days of cover": stock divided by the daily burn rate.
 *
 * This is the figure that actually drives a purchase, and it is only honest when
 * a rate exists — so with no consumption recorded it says so instead of printing
 * a confident infinity.
 */
export function DaysCover({ days }: { days: number | null }) {
  if (days == null) return <span className="t12 cFaint">—</span>
  if (!Number.isFinite(days)) return <span className="t12 cFaint">—</span>
  const tone = days <= 2 ? 'cDanger' : days <= 5 ? 'cWarn' : 'cOk'
  return (
    <span className="cover">
      <span className={'coverNum ' + tone}>{days < 1 ? '<1' : Math.floor(days)}</span>
      <span className="coverUnit">j</span>
    </span>
  )
}
