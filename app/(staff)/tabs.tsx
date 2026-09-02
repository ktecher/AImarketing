'use client'

import { usePathname } from 'next/navigation'

/**
 * A tab strip over two routes that are one piece of work.
 *
 * Products and Designs are one job — load a sheet, make posters from it — and
 * so are the two halves of Kuwait. As separate sidebar entries each read as
 * somewhere you go INSTEAD of the other, which is exactly wrong: you use both,
 * in order, on the same task. Two routes rather than one merged page because
 * the two screens are 587 and 852 lines; welding them into one file buys a tab
 * strip at the cost of a file nobody can edit.
 */
export function Tabs({ items }: { items: { href: string; label: string }[] }) {
  const path = usePathname()
  return (
    <nav className="tabs" aria-label="Sections">
      {items.map((t) => {
        // startsWith so /templates/brand-poster/edit keeps Designs lit; exact
        // for the shortest href, or /kuwait would match /kuwait/search too.
        const on = path === t.href
          || (items.every((o) => o.href === t.href || !o.href.startsWith(t.href)) && path.startsWith(`${t.href}/`))
        return (
          <a key={t.href} href={t.href} className={on ? 'on' : ''} aria-current={on ? 'page' : undefined}>
            {t.label}
          </a>
        )
      })}
    </nav>
  )
}

/** The two pairs that exist. Named here so a route cannot list a different half. */
export const CATALOGUE_TABS = [
  { href: '/products', label: 'Products' },
  { href: '/templates', label: 'Designs' },
]

export const KUWAIT_TABS = [
  { href: '/kuwait', label: 'Today' },
  { href: '/kuwait/search', label: 'Search a topic' },
]
