import './globals.css'
import type { ReactNode } from 'react'

export const metadata = {
  title: 'AImarketing',
  description: 'Marketing and sales in one system, running entirely on this machine.',
}

/**
 * Deliberately bare.
 *
 * Staff navigation belongs to the (staff) group, not here. /chat is the public
 * customer widget and this is its layout too — it was rendering the whole staff
 * sidebar, so a customer asking the price of a stylus was shown the way into
 * the Inbox and the product catalogue.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
      </body>
    </html>
  )
}
