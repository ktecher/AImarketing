'use client'

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'

/**
 * The staff sidebar.
 *
 * It lives in the (staff) group and not in the root layout, which matters: the
 * customer widget at /chat is a public page, and it was rendering links to the
 * Inbox, the Products table and Campaigns. A customer asking the price of a
 * stylus should not be shown the way into the product list.
 *
 * One flat list, in the order the work happens. It used to be three named
 * groups — Catalogue, Words, Customers — and the names were the problem: they
 * were categories invented to justify the grouping rather than anything a
 * person looks for. Nobody arrives wanting "Words". The pairs that ARE one job
 * became tabs inside a screen instead (see tabs.tsx), which is where the
 * grouping actually belonged.
 *
 * Campaigns is first because it is first: everything else stamps its output
 * with the campaign running today, so making one is the thing you do before
 * the rest of the system has anything to attach work to.
 */
const NAV: {
  href: string
  icon: string
  label: string
  /** Other routes that are this entry — the far half of a tab pair. */
  also?: string[]
  /** Sub-entries revealed when this one is open. */
  under?: { href: string; label: string }[]
  external?: boolean
}[] = [
  { href: '/campaigns', icon: '\u{1F9F1}', label: 'Campaigns' },
  {
    href: '/products', icon: '\u{1F4E6}', label: 'Products & designs', also: ['/templates'],
    // The two halves are one job, so they are one entry — but they are also two
    // screens, and the tab strip inside them is invisible until you have already
    // arrived. The accordion puts both doors in the sidebar without putting two
    // destinations there.
    under: [
      { href: '/products', label: 'Products' },
      { href: '/templates', label: 'Designs' },
    ],
  },
  {
    href: '/studio', icon: '\u{270D}\uFE0F', label: 'Social media', also: ['/social'],
    // Writing a caption and posting it are one job in two screens, which is the
    // same shape as Products & designs \u2014 so it gets the same accordion rather
    // than a second top-level entry. A flat "Publish" beside "Social media"
    // would read as somewhere you go INSTEAD of writing, and it is where you go
    // after.
    under: [
      { href: '/studio', label: 'Write' },
      { href: '/social', label: 'Publish' },
    ],
  },
  { href: '/advisor', icon: '\u{1F50E}', label: 'Advisor' },
  { href: '/kuwait', icon: '\u{1F1F0}\u{1F1FC}', label: 'Kuwait' },
  { href: '/sales', icon: '\u{1F4AC}', label: 'Inbox' },
  // Opens in a new tab, and that is not a detail. /chat is the PUBLIC widget:
  // it has no sidebar, so navigating there in this tab strands you on a page
  // with no way back. It is listed because staff need to see what a customer
  // sees, and a link buried in the footer is not findable.
  { href: '/chat', icon: '\u{1F441}\uFE0F', label: 'Customer widget', external: true },
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
  // Which accordion the person clicked open, independent of where they are.
  const [opened, setOpened] = useState<string | null>(null)

  useEffect(() => {
    // The head script always writes the attribute now, so there is no
    // "unset, ask the OS" case left to handle here.
    setDeep(document.documentElement.getAttribute('data-theme') === 'deep')
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

        <div className="side-group">
          {NAV.map((n) => {
            // startsWith, so /templates/brand-poster/edit still lights up
            // Products & designs. Landing on a sub-page with nothing selected
            // reads as having navigated out of the app.
            const mine = [n.href, ...(n.also ?? [])]
            const on = !n.external && mine.some((h) => path === h || path.startsWith(`${h}/`))
            // Open when you are inside it, or when you have clicked it open.
            // Two sources, because the sidebar has to be usable from a page that
            // is not underneath it — otherwise the only way to reach Designs
            // from Campaigns is to go to Products first.
            const open = n.under ? (on || opened === n.href) : false
            return (
              <div key={n.href} className={open ? 'nav-open' : undefined}>
                <a
                  href={n.href}
                  className={on ? 'on' : ''}
                  aria-current={on ? 'page' : undefined}
                  aria-expanded={n.under ? open : undefined}
                  {...(n.external ? { target: '_blank', rel: 'noreferrer' } : {})}
                  onClick={() => {
                    // Open AND navigate. This used to swallow the first click so
                    // that both doors were seen before landing on one — but the
                    // parent href IS the first door, and `open` becomes true the
                    // moment you arrive, so the accordion unfolds anyway. The
                    // swallow bought nothing and cost a click on every visit.
                    if (n.under) setOpened(n.href)
                  }}
                >
                  <i className="ico" aria-hidden="true">{n.icon}</i>
                  <b>{n.label}</b>
                  {n.under && <i className="caret" aria-hidden="true" />}
                </a>
                {n.under && open && (
                  <div className="side-under">
                    {n.under.map((u) => (
                      <a
                        key={u.href}
                        href={u.href}
                        className={path === u.href || path.startsWith(`${u.href}/`) ? 'on' : ''}
                        aria-current={path === u.href ? 'page' : undefined}
                      >
                        {u.label}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>

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
              {/* Both words are in the DOM and CSS shows one, keyed off the
                  data-theme the head script has already written. Rendering
                  `deep ? 'Deep' : 'Light'` meant the SERVER decided, and the
                  server has no localStorage — so a deep page painted a light
                  switch for one frame on every navigation, and every link here
                  is a full page load. display:none also takes the hidden word
                  out of the accessibility tree, so the name stays singular. */}
              <b className="on-light">Light</b>
              <b className="on-deep">Deep</b>
              <span>glass mode</span>
            </span>
          </button>
        </div>
      </nav>

      <div className="shell-main" id="content">{children}</div>
    </div>
  )
}
