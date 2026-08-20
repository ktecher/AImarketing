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
const GROUPS: { title: string; items: { href: string; label: string; hint: string }[] }[] = [
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
      { href: '/campaigns', label: 'Campaigns', hint: 'the loop' },
    ],
  },
  {
    title: 'Tools',
    items: [
      { href: '/import', label: 'Import', hint: 'column mapping, skipped rows' },
      { href: '/typography', label: 'Typography', hint: 'a string against a box' },
    ],
  },
]

export default function StaffLayout({ children }: { children: ReactNode }) {
  const path = usePathname()
  // Seeded from the attribute the head script already set, so the first render
  // agrees with what is on screen and React has nothing to correct.
  const [open, setOpen] = useState(true)

  useEffect(() => {
    setOpen(document.documentElement.getAttribute('data-side') !== 'off')
  }, [])

  const toggle = useCallback(() => {
    setOpen((was) => {
      const now = !was
      document.documentElement.setAttribute('data-side', now ? 'on' : 'off')
      try { localStorage.setItem('side', now ? 'on' : 'off') } catch { /* private window */ }
      return now
    })
  }, [])

  return (
    <div className="shell">
      {/* Outside the sidebar, so it is still reachable once the sidebar is
          gone. One control in one place beats a second button appearing
          somewhere else when the first one disappears. */}
      <button
        className="side-toggle"
        onClick={toggle}
        aria-expanded={open}
        aria-controls="staff-nav"
        title={open ? 'Hide the menu' : 'Show the menu'}
      >
        <span aria-hidden>{open ? '⟨' : '⟩'}</span>
        <span className="sr">{open ? 'Hide the menu' : 'Show the menu'}</span>
      </button>

      <aside className="side" id="staff-nav">
        <a className="brand" href="/">AImarketing</a>

        {GROUPS.map((g) => (
          <div className="side-group" key={g.title}>
            <h2>{g.title}</h2>
            {g.items.map((n) => {
              // startsWith, so /templates/brand-poster/edit still lights up
              // Designs. Landing on a sub-page with nothing selected reads as
              // having navigated out of the app.
              const on = path === n.href || path.startsWith(`${n.href}/`)
              return (
                <a key={n.href} href={n.href} className={on ? 'on' : ''} aria-current={on ? 'page' : undefined}>
                  <b>{n.label}</b>
                  <span>{n.hint}</span>
                </a>
              )
            })}
          </div>
        ))}

        <div className="side-foot">
          {/* The claim the whole project rests on, kept in view rather than in
              a README nobody has open. */}
          <span className="local">local only</span>
          <a href="/chat" target="_blank" rel="noreferrer">the customer widget ↗</a>
        </div>
      </aside>

      <div className="shell-main">{children}</div>
    </div>
  )
}
