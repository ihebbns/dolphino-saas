import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Servio OS — Dashboard',
  description: 'Restaurant POS Dashboard by Servio OS',
  viewport: 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  )
}
