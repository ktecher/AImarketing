import './globals.css'
import type { ReactNode } from 'react'

export const metadata = {
  title: 'AImarketing',
  description: 'Marketing and sales in one system, running entirely on this machine.',
}

const NAV = [
  { href: '/products', label: 'Products' },
  { href: '/templates', label: 'Designs' },
  { href: '/studio', label: 'Studio' },
  { href: '/advisor', label: 'Advisor' },
  { href: '/chat', label: 'Assistant' },
  { href: '/sales', label: 'Inbox' },
  { href: '/campaigns', label: 'Campaigns' },
]

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <nav>
          <div>
            <a className="brand" href="/">AImarketing</a>
            {NAV.map((n) => <a key={n.href} href={n.href}>{n.label}</a>)}
            <span className="local">local only</span>
          </div>
        </nav>
        {children}
      </body>
    </html>
  )
}
