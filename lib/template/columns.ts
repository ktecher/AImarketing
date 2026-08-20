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
