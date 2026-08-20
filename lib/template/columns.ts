/**
 * What can be dropped onto a template.
 *
 * Prefers the columns of the sheet actually imported, so the editor speaks the
 * user's vocabulary rather than ours. Falls back to the columns of the blank
 * template we hand out, which is the next best guess at what a sheet will hold.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { FORBIDDEN_PRICE_FIELDS } from '../money'

export type Column = {
  name: string
  label: string
  kind: 'text' | 'image' | 'price'
  /** Value used when previewing an empty template. */
  placeholder: string
}

/**
 * Price fields no template may bind, and what to use instead.
 *
 * These are the sheet's own columns. Every product in a real catalogue can be
 * discounted, so "the price" is ambiguous and binding it puts the pre-discount
 * number on the poster. The palette must never offer them.
 */
export const FORBIDDEN_COLUMNS = new Set(Object.keys(FORBIDDEN_PRICE_FIELDS))

const DEFAULTS: Column[] = [
  { name: 'image',          label: 'Product photo',  kind: 'image', placeholder: '' },
  { name: 'name_en',        label: 'Name (EN)',      kind: 'text',  placeholder: 'Product name in English' },
  // Resolved, never blank: falls back to name_en when nobody has shortened this
  // product yet, so a template binding it is always safe to bind.
  { name: 'display_name',   label: 'Short name',     kind: 'text',  placeholder: 'iPad Pro M4 13-inch' },
  { name: 'name_ar',        label: 'Name (AR)',      kind: 'text',  placeholder: 'اسم المنتج بالعربية' },
  // Derived in parse.ts, not columns in the sheet — and the only price fields a
  // template is allowed to bind.
  { name: 'price_now',      label: 'Price',          kind: 'price', placeholder: '449.5' },
  { name: 'price_was',      label: 'Was (struck)',   kind: 'price', placeholder: '599.9' },
  { name: 'discount_label', label: 'Discount badge', kind: 'text',  placeholder: '-34%' },
  { name: 'brand',          label: 'Brand',          kind: 'text',  placeholder: 'Apple' },
  { name: 'category',       label: 'Category',       kind: 'text',  placeholder: 'Laptops' },
  { name: 'description_en', label: 'Description (EN)', kind: 'text', placeholder: 'Short product description.' },
  { name: 'description_ar', label: 'Description (AR)', kind: 'text', placeholder: 'وصف قصير للمنتج.' },
  { name: 'sku',            label: 'SKU',            kind: 'text',  placeholder: 'ABC-123' },
]

type LastImport = {
  fileName: string
  columns: string[]
  mapping: Record<string, string>
  sample: Record<string, unknown> & { extra?: Record<string, string> }
  preview?: (Record<string, unknown> & { sku: string; name_en?: string; extra?: Record<string, string> })[]
  products?: (Record<string, unknown> & { sku: string; name_en?: string; extra?: Record<string, string> })[]
}

export function lastImport(): LastImport | null {
  const p = join(process.cwd(), 'data/state/last-import.json')
  if (!existsSync(p)) return null
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as LastImport
  } catch {
    return null
  }
}

const guessKind = (name: string): Column['kind'] =>
  /price|cost|kwd/i.test(name) ? 'price' : /image|photo|picture/i.test(name) ? 'image' : 'text'

const humanise = (name: string) =>
  name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

export function availableColumns(): { columns: Column[]; source: string } {
  const imported = lastImport()
  if (!imported) {
    return { columns: DEFAULTS.filter((c) => !FORBIDDEN_COLUMNS.has(c.name)), source: 'the blank product sheet' }
  }

  const seen = new Set<string>()
  const columns: Column[] = []

  // The derived fields always exist, because parse.ts computes them from the
  // sheet's price columns rather than reading them.
  const DERIVED = new Set(['price_now', 'price_was', 'discount_label'])

  for (const d of DEFAULTS) {
    if (imported.mapping[d.name] || d.name === 'image' || DERIVED.has(d.name)) {
      columns.push({ ...d, label: DERIVED.has(d.name) ? d.label : imported.mapping[d.name] ?? d.label })
      seen.add(d.name)
    }
  }
  for (const name of imported.columns) {
    if (seen.has(name) || FORBIDDEN_COLUMNS.has(name)) continue
    seen.add(name)
    const value = (imported.sample?.extra?.[name] ?? '') as string
    columns.push({
      name,
      label: humanise(name),
      kind: guessKind(name),
      placeholder: value || humanise(name),
    })
  }

  return { columns, source: imported.fileName }
}

/**
 * Real products to preview a layout against. The longest name comes first,
 * because a layout that survives the worst case survives everything else.
 */
export function previewProducts(): { sku: string; label: string; values: Record<string, string | number> }[] {
  const imported = lastImport()
  if (!imported?.preview?.length) return []

  const names = displayNames()
  return imported.preview.map((p) => {
    const values = flatten(p, names)
    const name = String(p.name_en ?? p.sku)
    return { sku: p.sku, label: name.length > 46 ? `${name.slice(0, 44)}…` : name, values }
  })
}

/* ── Short names ──────────────────────────────────────────────────────────
 * A catalogue title is not a headline. `display_name` can come from the sheet's
 * own column, or be written here by a person; the app's version wins, and
 * clearing it returns the product to the sheet — the same shape as a per-slot
 * override, and for the same reason: the exception must be visibly an exception.
 *
 * Deliberately NOT cleared by re-importing a sheet. Shortening sixty names is
 * expensive human judgement, and it is keyed by SKU, which is how a product is
 * identified across imports.
 */

const namesPath = () => join(process.cwd(), 'data/state/display-names.json')

export function displayNames(): Record<string, string> {
  const p = namesPath()
  if (!existsSync(p)) return {}
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as Record<string, string>
  } catch {
    return {}
  }
}

/** An empty or absent value removes the override rather than storing a blank. */
export function saveDisplayNames(edits: Record<string, string>): Record<string, string> {
  const all = displayNames()
  for (const [sku, name] of Object.entries(edits)) {
    if (name?.trim()) all[sku] = name.trim()
    else delete all[sku]
  }
  mkdirSync(join(process.cwd(), 'data/state'), { recursive: true })
  writeFileSync(namesPath(), JSON.stringify(all, null, 2))
  return all
}

/** Flattens a stored product row into the flat values a template binds against. */
function flatten(
  p: Record<string, unknown> & { extra?: Record<string, string> },
  names: Record<string, string> = {},
) {
  const values: Record<string, string | number> = {}
  for (const [k, v] of Object.entries(p)) {
    if (v !== null && v !== undefined && typeof v !== 'object') values[k] = v as string | number
  }
  for (const [k, v] of Object.entries(p.extra ?? {})) values[k] = v
  // Resolved once, here, rather than at each of the four call sites that need
  // it. A poster, a caption, an export and a preview must never disagree about
  // what a product is called.
  values.display_name = names[String(p.sku)] || String(values.display_name ?? '') || String(values.name_en ?? '')
  return values
}

/** Every product from the last import, for rendering the real catalogue. */
export function importedProducts(): Record<string, string | number>[] {
  const names = displayNames()
  return (lastImport()?.products ?? []).map((p) => flatten(p, names))
}

/**
 * The campaign, priced from the catalogue.
 *
 * Two sources used to disagree about the same product: the sheet said 19.9 and
 * the Products tab said 19.900, and editing a price there changed nothing on a
 * poster. That makes "12 designs are out of date" meaningless — the design was
 * never reading the price that moved.
 *
 * One rule settles it: **the sheet says WHICH products are in the campaign, the
 * catalogue says WHAT THEY COST.** A product the catalogue has not heard of
 * keeps the sheet's price, so a campaign can still be run before the full
 * catalogue is uploaded.
 *
 * Only the fields a person can edit on the Products tab are overlaid. Nothing
 * else the catalogue holds reaches a poster from here.
 */
export async function campaignProducts(): Promise<Record<string, string | number>[]> {
  const rows = importedProducts()
  if (!rows.length) return rows

  try {
    const { query } = await import('@/lib/db')
    const priced = await query<{
      sku: string; price_now: string | null; price_was: string | null
      name_en: string | null; display_name: string | null; in_stock: boolean
    }>('select sku, price_now, price_was, name_en, display_name, in_stock from products')
    if (!priced.length) return rows

    const byId = new Map(priced.map((r) => [String(r.sku), r]))
    return rows.map((p) => {
      const c = byId.get(String(p.sku))
      if (!c) return p
      const out = { ...p }
      if (c.price_now !== null) out.price_now = Number(c.price_now)
      // Null, not absent: a product taken off sale in the catalogue must lose
      // its struck-through price on the poster rather than keep the sheet's.
      out.price_was = c.price_was === null ? '' : Number(c.price_was)
      if (c.name_en) out.name_en = c.name_en
      if (c.display_name) out.display_name = c.display_name
      // display_name falls back to the title in the renderer (D47), so an
      // emptied short name must not resolve to the sheet's stale one.
      else if (c.name_en) out.display_name = names(String(p.sku)) || c.name_en
      out.in_stock = c.in_stock ? 1 : 0
      return out
    })
  } catch {
    // No database or Postgres down. The sheet still renders, exactly as before.
    return rows
  }
}

/** A saved short name, or empty. Kept here so the overlay uses one lookup. */
function names(sku: string): string {
  return displayNames()[sku] ?? ''
}

/** Sample values for previewing a template, from the real sheet where possible. */
export function sampleValues(): Record<string, string | number | undefined> {
  const imported = lastImport()
  const base: Record<string, string | number | undefined> = {}
  for (const c of DEFAULTS) base[c.name] = c.placeholder

  if (imported?.sample) {
    Object.assign(base, flatten(imported.sample as Record<string, unknown>, displayNames()))
  }
  return base
}
