// ═══════════════════════════════════════════════════════════════════
// One icon set, inline SVG, no dependency.
//
// Emoji used to stand in for iconography here (📦 🔒 💡 ⚠). It reads
// informal, renders differently on every OS, and cannot inherit colour or
// stroke weight — wrong for a tool that handles someone's money.
//
// Inline rather than a package: about twenty icons are needed, and these
// repos are public, so every avoided dependency is one less supply-chain
// surface. Everything is 24x24, stroke-based, and inherits currentColor.
// ═══════════════════════════════════════════════════════════════════

export type IconName =
  | 'home' | 'box' | 'drawer' | 'receipt' | 'settings'
  | 'lock' | 'unlock' | 'alert' | 'check' | 'close'
  | 'chevronRight' | 'plus' | 'minus' | 'clipboard'
  | 'search' | 'refresh' | 'print' | 'trash' | 'edit'
  | 'arrowUp' | 'arrowDown' | 'store' | 'flask' | 'tag'

const P: Record<IconName, string> = {
  home:        'M3 10.5 12 3l9 7.5M5 9.5V21h14V9.5',
  box:         'M3 7.5 12 3l9 4.5v9L12 21l-9-4.5v-9ZM3 7.5 12 12m0 0 9-4.5M12 12v9',
  drawer:      'M3 8h18v11H3zM3 8l2-4h14l2 4M9 13h6',
  receipt:     'M6 3h12v18l-3-2-3 2-3-2-3 2V3ZM9 8h6M9 12h6',
  settings:    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2 2 2 0 1 1-4 0 1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 4.6 15a2 2 0 1 1 0-4 1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 11.5 4a2 2 0 1 1 4 0 1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.7 1.7 0 0 0 19.4 11a2 2 0 1 1 0 4Z',
  lock:        'M6 11h12v10H6zM9 11V7a3 3 0 0 1 6 0v4',
  unlock:      'M6 11h12v10H6zM9 11V7a3 3 0 0 1 5.8-1',
  alert:       'M12 3 2 20h20L12 3ZM12 9v5m0 3h.01',
  check:       'M4 12.5 9 17.5 20 6.5',
  close:       'M6 6l12 12M18 6 6 18',
  chevronRight:'M9 5l7 7-7 7',
  plus:        'M12 5v14M5 12h14',
  minus:       'M5 12h14',
  clipboard:   'M9 4h6v3H9zM7 5H5v16h14V5h-2M9 12h6M9 16h4',
  search:      'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM20 20l-4-4',
  refresh:     'M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5',
  print:       'M7 8V3h10v5M7 18H5v-7h14v7h-2M7 14h10v7H7z',
  trash:       'M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6',
  edit:        'M4 20h4L20 8l-4-4L4 16v4ZM14 6l4 4',
  arrowUp:     'M12 20V4M5 11l7-7 7 7',
  arrowDown:   'M12 4v16M5 13l7 7 7-7',
  store:       'M4 9v12h16V9M2 9l2-5h16l2 5H2ZM9 21v-6h6v6',
  flask:       'M9 3h6v5l4 9a2 2 0 0 1-1.8 3H6.8A2 2 0 0 1 5 17l4-9V3ZM7 14h10',
  tag:         'M20 12 12 20l-8-8V4h8l8 8ZM7.5 7.5h.01',
}

export function Icon({
  name,
  size = 18,
  label,
  className,
}: {
  name: IconName
  size?: number
  /** Provide when the icon carries meaning on its own; omit when decorative. */
  label?: string
  className?: string
}) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      <path d={P[name]} />
    </svg>
  )
}
