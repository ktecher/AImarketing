'use client'

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'

/**
 * The staff sidebar.
 *
 * It lives in the (staff) group and not in the root layout, which matters: the
 * customer widget at /chat is a public page, and it was rendering links to the
 * Inbox, the Products table and Campaigns. A customer asking the price of a
 * stylus should not be shown the way into the catalogue.
 *
 * Grouped rather than listed. Seven flat links is a list you read every time;
 * four groups of two is a shape you learn once.
 */
const GROUPS: {
  title: string
  items: { href: string; label: string; hint: string; external?: boolean }[]
}[] = [
  {
    title: 'Catalogue',
    items: [
      { href: '/products', label: 'Products', hint: 'everything you sell' },
      { href: '/templates', label: 'Designs', hint: 'sheet in, posters out' },
    ],
  },
  {
    title: 'Words',
    items: [
      { href: '/studio', label: 'Studio', hint: 'copy from the same rows' },
      { href: '/advisor', label: 'Advisor', hint: 'check a draft you wrote' },
    ],
  },
  {
    title: 'Customers',
    items: [
      { href: '/sales', label: 'Inbox', hint: 'what the assistant could not answer' },
      // Opens in a new tab, and that is not a detail. /chat is the PUBLIC
      // widget: it has no sidebar, so navigating there in this tab strands you
      // on a page with no way back. It is listed because staff need to see what
      // a customer sees, and a link buried in the footer is not findable.
      { href: '/chat', label: 'Customer widget', hint: 'what a customer sees ↗', external: true },
      { href: '/campaigns', label: 'Campaigns', hint: 'the loop' },
    ],
  },
]

/*
 * No "Tools" group, and this is deliberate — I added one and it was wrong.
 *
 * /import and /typography were folded into the Designs workspace in an earlier
 * session and should not come back as their own tabs. Designs already loads a
 * sheet and shows the column mapping and every skipped row ("check them"), and
 * the layout editor already carries font, size, alignment, line height, shrink
 * floor and Arabic text mode per slot, plus font upload. Listing them again
 * offers two doors into one workflow, which is the thing the merge removed.
 *
 * The routes still answer if typed, which is useful when debugging the layout
 * engine on its own. They are not navigation.
 */

export default function StaffLayout({ children }: { children: ReactNode }) {
  const path = usePathname()
  // Seeded from the attribute the head script already set, so the switch agrees
  // with what is already on screen; no stored choice means the OS decides.
  // An effect, deliberately, and NOT a lazy useState initialiser reading the
  // DOM. That initialiser makes the first CLIENT render correct but disagree
  // with the server HTML, and the only way to quiet that is
  // suppressHydrationWarning — which does not patch the text, it KEEPS the
  // server's. The switch then reads "Light" on a deep page until you click it.
  // Correcting in an effect costs one extra render and is right afterwards.
  const [deep, setDeep] = useState(false)

  useEffect(() => {
    const set = document.documentElement.getAttribute('data-theme')
    setDeep(set ? set === 'deep' : window.matchMedia('(prefers-color-scheme: dark)').matches)
  }, [])

  const toggleTheme = useCallback(() => {
    setDeep((was) => {
      const now = !was
      document.documentElement.setAttribute('data-theme', now ? 'deep' : 'glass')
      try { localStorage.setItem('theme', now ? 'deep' : 'glass') } catch { /* private window */ }
      return now
    })
  }, [])

  return (
    <div className="shell">
      {/* Before the nav, so it is the first thing a keyboard reaches. */}
      <a className="skip" href="#content">Skip to content</a>

      {/* <nav>, not <aside>: this is the primary navigation, and as an <aside>
          it announced as a "complementary" landmark with no name. */}
      <nav className="side" aria-label="Staff sections">
        <a className="brand" href="/">AImarketing</a>

        {/* A <div role="group">, not an <h2>. As headings these three sat in the
            same outline as page content and preceded every page's <h1>, which
            makes the outline useless for navigating by heading. */}
        {GROUPS.map((g) => (
          <div className="side-group" key={g.title} role="group" aria-labelledby={`sg-${g.title}`}>
            <div className="side-group-title" id={`sg-${g.title}`}>{g.title}</div>
            {g.items.map((n) => {
              // startsWith, so /templates/brand-poster/edit still lights up
              // Designs. Landing on a sub-page with nothing selected reads as
              // having navigated out of the app.
              const on = !n.external && (path === n.href || path.startsWith(`${n.href}/`))
              return (
                <a
                  key={n.href}
                  href={n.href}
                  className={on ? 'on' : ''}
                  aria-current={on ? 'page' : undefined}
                  {...(n.external ? { target: '_blank', rel: 'noreferrer' } : {})}
                >
                  <b>{n.label}</b>
                  <span>{n.hint}</span>
                </a>
              )
            })}
          </div>
        ))}

        <div className="side-foot">
          {/* Same before-first-paint reasoning as the head script: the click
              writes the attribute and localStorage, nothing re-renders. */}
          {/* No aria-label. It read "Deep mode" while the button visibly said
              "Light", so the accessible name did not contain the visible one
              (WCAG 2.5.3) and voice control could not target it. The visible
              text is the name; aria-pressed carries the state. */}
          <button
            className="theme-switch"
            onClick={toggleTheme}
            aria-pressed={deep}
          >
            <i className="track"><i className="knob" /></i>
            <span className="label">
              <b>{deep ? 'Deep' : 'Light'}</b>
              <span>glass mode</span>
            </span>
          </button>
        </div>
      </nav>

      <div className="shell-main" id="content">{children}</div>
    </div>
  )
}
