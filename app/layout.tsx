import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Servio OS — Dashboard',
  description: 'Restaurant POS Dashboard by Servio OS',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  )
}
