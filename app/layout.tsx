import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Dolphino POS — Dashboard',
  description: 'Restaurant POS Dashboard',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  )
}
