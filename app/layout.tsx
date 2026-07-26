import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Servio — Back-office',
  description: 'Back-office de caisse Servio',
}

// Next 14 wants viewport as its own export; keeping it inside `metadata`
// produced a warning on every page build.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
}

// Set data-theme before the first paint.
//
// The theme lives in localStorage, which the server cannot read, so if we waited
// for React to mount, every load would flash the default palette and then snap to
// the chosen one. This runs synchronously in <head>, ahead of any paint.
// suppressHydrationWarning on <html> is required because this script mutates the
// element the server just rendered.
const THEME_BOOT = `(function(){try{var t=localStorage.getItem('d_theme');if(t!=='light'&&t!=='dark')t='dark';document.documentElement.setAttribute('data-theme',t)}catch(e){document.documentElement.setAttribute('data-theme','dark')}})()`

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body>{children}</body>
    </html>
  )
}
