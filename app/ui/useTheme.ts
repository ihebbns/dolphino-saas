'use client'
// ═══════════════════════════════════════════════════════════════════
// useTheme — one theme for the whole back office
// ═══════════════════════════════════════════════════════════════════
// The dashboard used to own a private toggle (`d_theme` + data-theme) while
// every other page imported a stylesheet that only had light values. Flipping
// the switch changed one page out of seven, which reads as a bug.
//
// So: one storage key, one attribute, one hook. Any page that renders a toggle
// gets the same state, and the attribute is applied to <html> so the palette
// covers whatever route is mounted.
//
// The key stays `d_theme` — it is already in users' localStorage and renaming it
// would silently reset everyone's choice.
// ═══════════════════════════════════════════════════════════════════
import { useEffect, useState } from 'react'

export type Theme = 'dark' | 'light'

export const THEME_KEY = 'd_theme'
const DEFAULT: Theme = 'dark'

export function readTheme(): Theme {
  if (typeof window === 'undefined') return DEFAULT
  try {
    const v = localStorage.getItem(THEME_KEY)
    return v === 'light' || v === 'dark' ? v : DEFAULT
  } catch { return DEFAULT }
}

export function applyTheme(t: Theme) {
  if (typeof document === 'undefined') return
  document.documentElement.setAttribute('data-theme', t)
}

export function useTheme() {
  // Start from the default rather than reading storage, so the first render
  // matches the server's HTML and React does not report a hydration mismatch.
  // The real value is applied in the effect below, before paint.
  const [theme, setTheme] = useState<Theme>(DEFAULT)

  useEffect(() => {
    const t = readTheme()
    setTheme(t)
    applyTheme(t)

    // Keep other tabs and other mounted pages in step.
    const onStorage = (e: StorageEvent) => {
      if (e.key !== THEME_KEY) return
      const next = readTheme()
      setTheme(next)
      applyTheme(next)
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  function toggle() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    applyTheme(next)
    try { localStorage.setItem(THEME_KEY, next) } catch {}
  }

  return { theme, toggle, dark: theme === 'dark' }
}
