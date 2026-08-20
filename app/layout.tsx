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
    // suppressHydrationWarning because the head script below deliberately
    // mutates <html> before React hydrates. React compares the server HTML with
    // what it finds and reports a mismatch it cannot patch — true, and expected:
    // the whole point is that the attribute is set before React exists. Scoped
    // to this element only; it does not silence anything inside the app.
    <html lang="en" suppressHydrationWarning>
      <head>
        {/*
          Set before first paint, not in an effect.
          Every link here is a plain <a>, so navigating is a full page load. Read
          in an effect, the sidebar would flash open on every single click before
          collapsing again — worse than not having the toggle.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{if(localStorage.getItem('side')==='off')" +
              "document.documentElement.setAttribute('data-side','off')}catch(e){}",
          }}
        />
      </head>
      <body>
        {children}
      </body>
    </html>
  )
}
