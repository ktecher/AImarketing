import './globals.css'
import { Barlow, Barlow_Condensed } from 'next/font/google'
import type { ReactNode } from 'react'

export const metadata = {
  title: 'AImarketing',
  description: 'Marketing and sales in one system, running entirely on this machine.',
}

/*
 * next/font, not a <link> to fonts.googleapis.com. The files are fetched once at
 * build time and served from this machine — a hotlink would mean every page view
 * makes a request to Google, which is exactly what this project does not do.
 */
const body = Barlow({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-body',
  display: 'swap',
})
const heading = Barlow_Condensed({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-heading',
  display: 'swap',
})

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
    <html lang="en" className={`${body.variable} ${heading.variable}`} suppressHydrationWarning>
      <head>
        {/*
          Set before first paint, not in an effect.
          Every link here is a plain <a>, so navigating is a full page load. Read
          in an effect, the scheme would flash the other way on every single
          click before correcting itself.

          It ALWAYS writes the attribute — falling back to the OS rather than
          leaving it unset. That is what lets the stylesheet hold the deep
          palette exactly once. While a "no attribute" state existed, the sheet
          needed a duplicate palette under prefers-color-scheme, and every
          correction written as :root[data-theme="deep"] .foo silently missed
          that second path. Three bugs came from it; see docs/decisions.md D59.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var t=localStorage.getItem('theme')||" +
              "(matchMedia('(prefers-color-scheme:dark)').matches?'deep':'glass');" +
              "document.documentElement.setAttribute('data-theme',t)}catch(e){}",
          }}
        />
      </head>
      <body>
        {children}
      </body>
    </html>
  )
}
