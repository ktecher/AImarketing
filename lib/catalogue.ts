/**
 * The full catalogue — what the shop sells, not what a campaign is about.
 *
 * Two different things share the word "products" in this project and it is
 * worth being blunt about which is which:
 *
 *   the campaign sheet   ~60 rows, a file, changes weekly. Designs and the
 *                        content studio work from it. Nobody wants to render
 *                        five thousand posters.
 *   this                 everything in stock, in Postgres, edited in the app.
 *                        The assistant and the advisor read it, because a
 *                        customer or a caption can be about anything you sell.
 *
 * Writes are why this is a table and not a file: a person editing one price
 * must not rewrite twenty megabytes, and two people editing must not lose one
 * of each other's changes.
 */

import { embed } from '@/lib/ai/generate'
import { query } from '@/lib/db'
import type { ProductRow } from '@/lib/excel/parse'

export type CatalogueRow = {
  sku: string
  name_en: string | null
  name_ar: string | null
  display_name: string | null
  brand: string | null
  category: string | null
  category_path: string | null
  description_en: string | null
  price_now: string | null
  price_was: string | null
  in_stock: boolean
  extra: Record<string, string>
  updated_at: string
  updated_by: string | null
  /** What the last sheet supplied. Comparing it to the row shows a hand edit. */
  sheet_values?: Record<string, string | null>
  /** Filled by `list`: which fields a person has changed since the last sheet. */
  edited?: string[]
  has_photo?: boolean
}

/**
 * A price and, only when there is one, a sale price.
 *
 * The poster and the assistant speak `price_now` / `price_was` — the figure a
 * customer pays and the struck-through one. That is poster language, and it
 * makes no sense on a product that was never on sale: a thing that costs 20 is
 * not "now 20", it is 20.
 *
 * So the tab shows PRICE and SALE PRICE, and this is the only place the two
 * vocabularies meet. Nothing downstream changes.
 */
export const asShopPrices = (r: { price_now: string | null; price_was: string | null }) =>
  r.price_was !== null && Number(r.price_was) > Number(r.price_now)
    ? { price: r.price_was, sale_price: r.price_now }
    : { price: r.price_now, sale_price: null }

/** The reverse: what a person typed, back into what the renderer binds. */
export function asRenderPrices(price: number | null, salePrice: number | null) {
  // A sale price that is not below the price is not a sale. Storing it as one
  // would strike through a figure identical to the one beside it.
  if (salePrice !== null && price !== null && salePrice < price) {
    return { price_now: salePrice, price_was: price }
  }
  return { price_now: salePrice ?? price, price_was: null }
}

/** What gets embedded, and what a lexical pass searches. Identity first. */
export function searchText(r: Partial<CatalogueRow>): string {
  return [r.sku, r.name_en, r.name_ar, r.display_name, r.brand, r.category, r.category_path, r.description_en]
    .filter(Boolean)
    .join(' · ')
}

const PATH_KEYS = ['Category Path', 'Category path', 'category_path']

function pathOf(p: ProductRow): string {
  const extra = (p.extra ?? {}) as Record<string, string>
  for (const k of PATH_KEYS) if (extra[k]) return extra[k]
  return ''
}

/**
 * Load a parsed sheet into the catalogue.
 *
 * Upsert by SKU: a re-imported sheet UPDATES a product rather than creating a
 * second one, and a row the new sheet happens to omit is left alone rather than
 * deleted. A supplier sending a partial price list must not empty the shop.
 *
 * An edited price survives a re-import only if the sheet does not carry that
 * SKU. When it does, the sheet wins — it is the source of truth, and a stale
 * hand-edit quietly overriding it is worse than losing the edit.
 */
/** Fields a sheet supplies and a person can also edit. The overlap is the
 *  only place "who wrote this last" is a question worth answering. */
const SHEET_FIELDS = ['name_en', 'name_ar', 'display_name', 'category',
                      'description_en', 'price_now', 'price_was'] as const

export type Overwrite = { sku: string; field: string; yours: string; sheet: string }

/**
 * Are these two field values the same thing?
 *
 * The only definition, used by the import and by the table alike. It exists
 * because jsonb stores 5.500 as a NUMBER and JSON.parse hands JavaScript back
 * 5.5, while `numeric` comes out of pg as the string "5.500" — so the same
 * untouched price compared unequal to itself, every row read as hand-edited,
 * and a re-import claimed to have overwritten 119 corrections that were never
 * made. Postgres agreed with itself throughout; only the client disagreed.
 *
 * Two of these comparisons in two files is how they drift, which is the fault
 * D32, D38 and D39 record. One function.
 */
export function sameValue(a: unknown, b: unknown): boolean {
  const x = a === null || a === undefined ? '' : String(a)
  const y = b === null || b === undefined ? '' : String(b)
  if (x === y) return true
  if (!x || !y) return false
  const m = Number(x), n = Number(y)
  return Number.isFinite(m) && Number.isFinite(n) && m === n
}

export async function upsert(
  products: ProductRow[], by = 'sheet',
): Promise<{ written: number; overwrote: Overwrite[]; restored: string[] }> {
  let written = 0
  const overwrote: Overwrite[] = []
  const restored: string[] = []

  // What is there now, so the import can say which of YOUR corrections it is
  // about to replace. Read before anything is written, obviously.
  const before = new Map(
    (await query<{ sku: string; row: Record<string, unknown>; sheet_values: Record<string, string | null> }>(
      `select sku, to_jsonb(products) - 'embedding' as row, sheet_values from products`,
    )).map((r) => [String(r.sku), r]),
  )

  for (const p of products) {
    if (!p.sku) continue
    const sku = String(p.sku)
    const prev = before.get(sku)
    // Prices as TEXT, fixed to three decimals. jsonb stores 5.500 as a number
    // and JSON.parse hands JavaScript 5.5 back, so a row nobody had touched
    // compared unequal to itself and read as hand-edited. Postgres agreed with
    // itself; only the client disagreed, which is the worst place to find out.
    const money = (v: number | undefined) => (v === undefined || v === null ? null : v.toFixed(3))
    const incoming: Record<string, unknown> = {
      name_en: p.name_en ?? null, name_ar: p.name_ar ?? null,
      display_name: p.display_name ?? null, category: p.category ?? null,
      description_en: p.description_en ?? null,
      price_now: money(p.price_now), price_was: money(p.price_was),
    }

    if (prev) {
      for (const f of SHEET_FIELDS) {
        const live = prev.row[f]
        const wasSheet = prev.sheet_values?.[f]
        const now = incoming[f]
        // Edited by a person (live differs from what the sheet last said) AND
        // this sheet is about to change it to something else again.
        if (!sameValue(live, wasSheet) && !sameValue(live, now)) {
          overwrote.push({
            sku, field: f,
            yours: live == null ? '' : String(live),
            sheet: now == null ? '' : String(now),
          })
        }
      }
    } else {
      // Not in the table. Either genuinely new, or one somebody deleted and the
      // supplier's sheet still lists. Both come back — the report says which.
      restored.push(sku)
    }

    await query(
      `insert into products
         (sku, name_en, name_ar, display_name, brand, category, category_path,
          description_en, description_ar, price_now, price_was, extra, source, updated_by, updated_at,
          sheet_values)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'sheet',$13, now(), $14)
       on conflict (sku) do update set
         name_en        = excluded.name_en,
         name_ar        = excluded.name_ar,
         display_name   = excluded.display_name,
         brand          = excluded.brand,
         category       = excluded.category,
         category_path  = excluded.category_path,
         description_en = excluded.description_en,
         description_ar = excluded.description_ar,
         price_now      = excluded.price_now,
         price_was      = excluded.price_was,
         extra          = excluded.extra,
         source         = 'sheet',
         updated_by     = excluded.updated_by,
         updated_at     = now(),
         -- The text changed, so the vector is stale. Clearing it puts the row
         -- back in the re-embedding queue rather than answering questions
         -- about a product description that no longer exists.
         embedding      = null,
         embedded_at    = null,
         sheet_values   = excluded.sheet_values`,
      [
        String(p.sku), p.name_en ?? null, p.name_ar ?? null, p.display_name ?? null,
        p.brand ?? null, p.category ?? null, pathOf(p) || null,
        p.description_en ?? null, p.description_ar ?? null,
        p.price_now ?? null, p.price_was ?? null,
        JSON.stringify(p.extra ?? {}), by, JSON.stringify(incoming),
      ],
    )
    written++
  }
  // `restored` only means something for a table that already had rows. On a
  // first import every product is new, and calling sixty products "restored"
  // would be noise on the one screen where it matters least.
  return { written, overwrote, restored: before.size ? restored : [] }
}

/**
 * Embed rows that have no vector, in batches.
 *
 * Chunked and resumable on purpose: a few thousand rows is minutes of model
 * time, and a request that dies halfway must leave the finished ones finished.
 */
export async function embedPending(batch = 32): Promise<{ embedded: number; left: number }> {
  const rows = await query<CatalogueRow>(
    `select sku, name_en, name_ar, display_name, brand, category, category_path, description_en
       from products where embedding is null limit $1`,
    [batch],
  )
  if (!rows.length) return { embedded: 0, left: 0 }

  const texts = rows.map(searchText)
  const vectors = await embed(texts)

  for (let i = 0; i < rows.length; i++) {
    await query(
      'update products set embedding = $1, embedded_at = now(), embedded_text = $2 where sku = $3',
      [vectors[i], texts[i], rows[i].sku],
    )
  }

  const [{ n }] = await query<{ n: string }>(
    'select count(*)::text as n from products where embedding is null',
  )
  return { embedded: rows.length, left: Number(n) }
}

export type Filters = {
  search?: string
  category?: string
  brand?: string
  onSale?: boolean
  outOfStock?: boolean
  edited?: boolean
  noPhoto?: boolean
  sort?: string
  dir?: 'asc' | 'desc'
  limit?: number
  offset?: number
}

/** Columns a person may sort by. Anything else is ignored — this reaches SQL. */
const SORTABLE = new Set(['sku', 'name_en', 'brand', 'category', 'price_now', 'price_was',
                          'in_stock', 'updated_at'])

/** One page of the catalogue, for the table a person edits. */
export async function listFiltered(f: Filters): Promise<{
  rows: CatalogueRow[]; total: number; categories: string[]; brands: string[]
}> {
  const where: string[] = []
  const params: unknown[] = []
  const p = (v: unknown) => { params.push(v); return `$${params.length}` }

  if (f.search?.trim()) {
    const like = p(`%${f.search.trim()}%`)
    where.push(`(sku ilike ${like} or name_en ilike ${like} or name_ar ilike ${like}
                 or brand ilike ${like} or category ilike ${like} or category_path ilike ${like})`)
  }
  if (f.category) where.push(`category = ${p(f.category)}`)
  if (f.brand) where.push(`brand = ${p(f.brand)}`)
  if (f.onSale) where.push('price_was is not null and price_was > price_now')
  if (f.outOfStock) where.push('in_stock = false')
  // Edited: any field the person changed since the last sheet said otherwise.
  // A row the sheet never supplied is not "edited" — it was added by hand,
  // which is a different thing and has no sheet value to disagree with.
  if (f.edited) {
    where.push(`sheet_values <> '{}'::jsonb and exists (
      select 1 from jsonb_each_text(sheet_values) sv(k, v)
      where coalesce((to_jsonb(products) ->> sv.k), '') is distinct from coalesce(sv.v, ''))`)
  }

  const sql = where.length ? `where ${where.join(' and ')}` : ''
  const order = SORTABLE.has(String(f.sort)) ? String(f.sort) : 'updated_at'
  const dir = f.dir === 'asc' ? 'asc' : 'desc'
  const limit = Math.min(Math.max(Number(f.limit) || 20, 1), 100)
  const offset = Math.max(Number(f.offset) || 0, 0)

  const rows = await query<CatalogueRow>(
    `select sku, name_en, name_ar, display_name, brand, category, category_path,
            description_en, price_now, price_was, in_stock, extra, updated_at, updated_by,
            sheet_values
       from products ${sql}
      order by ${order} ${dir} nulls last, sku
      limit ${limit} offset ${offset}`,
    params,
  )
  const [{ n }] = await query<{ n: string }>(`select count(*)::text as n from products ${sql}`, params)

  // The pickers. Every value already in the catalogue, so a person chooses
  // rather than types and no two spellings of "Accessories" can coexist.
  const categories = (await query<{ v: string }>(
    `select distinct category as v from products where category is not null and category <> '' order by 1`,
  )).map((r) => r.v)
  const brands = (await query<{ v: string }>(
    `select distinct brand as v from products where brand is not null and brand <> '' order by 1`,
  )).map((r) => r.v)

  return { rows, total: Number(n), categories, brands }
}

/** One page of the catalogue, for the table a person edits. */
export async function list(
  { search = '', limit = 50, offset = 0 }: { search?: string; limit?: number; offset?: number },
): Promise<{ rows: CatalogueRow[]; total: number }> {
  const like = `%${search.trim()}%`
  const where = search.trim()
    ? `where sku ilike $1 or name_en ilike $1 or name_ar ilike $1 or brand ilike $1
         or category ilike $1 or category_path ilike $1`
    : ''
  const params = search.trim() ? [like] : []

  const rows = await query<CatalogueRow>(
    `select sku, name_en, name_ar, display_name, brand, category, category_path,
            description_en, price_now, price_was, in_stock, extra, updated_at, updated_by
       from products ${where}
      order by updated_at desc, sku
      limit ${Number(limit) || 50} offset ${Number(offset) || 0}`,
    params,
  )
  const [{ n }] = await query<{ n: string }>(`select count(*)::text as n from products ${where}`, params)
  return { rows, total: Number(n) }
}

/** Fields a person may change by hand. Nothing else is editable in the app. */
const EDITABLE = ['name_en', 'name_ar', 'display_name', 'price_now', 'price_was', 'in_stock'] as const
export type Editable = (typeof EDITABLE)[number]

/**
 * Change one product.
 *
 * Editing the name changes what the row means, so its vector is dropped and it
 * re-queues for embedding. Editing only a price does not — the price is never
 * part of the text that was embedded, and re-embedding thousands of rows every
 * time somebody runs a sale would be minutes of model time for no change.
 */
export async function edit(
  sku: string,
  patch: Partial<Record<Editable, string | number | boolean | null>>,
  by: string,
): Promise<CatalogueRow | null> {
  const fields = Object.keys(patch).filter((k): k is Editable => (EDITABLE as readonly string[]).includes(k))
  if (!fields.length) return null

  const textChanged = fields.some((f) => f !== 'price_now' && f !== 'price_was' && f !== 'in_stock')
  const sets = fields.map((f, i) => `${f} = $${i + 3}`)
  if (textChanged) sets.push('embedding = null', 'embedded_at = null')

  const [row] = await query<CatalogueRow>(
    `update products
        set ${sets.join(', ')}, source = 'human', updated_by = $2, updated_at = now()
      where sku = $1
      returning sku, name_en, name_ar, display_name, brand, category, category_path,
                description_en, price_now, price_was, in_stock, extra, updated_at, updated_by`,
    [sku, by, ...fields.map((f) => patch[f] ?? null)],
  )
  return row ?? null
}

/**
 * Save a page of staged edits in one go.
 *
 * All or nothing: a Save that half-worked leaves a person unable to tell which
 * corrections landed, and the only way to find out is to check every field by
 * eye. A transaction is one line and removes the question.
 */
export async function saveEdits(
  changes: { sku: string; patch: Partial<Record<Editable, string | number | boolean | null>> }[],
  by: string,
): Promise<{ saved: number }> {
  if (!changes.length) return { saved: 0 }
  await query('begin')
  try {
    let saved = 0
    for (const c of changes) if (await edit(c.sku, c.patch, by)) saved++
    await query('commit')
    return { saved }
  } catch (e) {
    await query('rollback')
    throw e
  }
}

/** Add one product by hand. SKU, a name and a price is the minimum. */
export async function add(
  row: { sku: string; name_en: string; price: number; sale_price?: number | null
         name_ar?: string; category?: string; brand?: string; description_en?: string },
  by: string,
): Promise<CatalogueRow | null> {
  const { price_now, price_was } = asRenderPrices(row.price, row.sale_price ?? null)

  // A category the catalogue already knows carries a path, and the path is what
  // answers "do you sell laptops". Copying it from a sibling is the difference
  // between a hand-added product being findable and being invisible.
  const [sibling] = row.category
    ? await query<{ category_path: string | null }>(
        'select category_path from products where category = $1 and category_path is not null limit 1',
        [row.category])
    : []

  const [made] = await query<CatalogueRow>(
    `insert into products (sku, name_en, name_ar, brand, category, category_path,
                           description_en, price_now, price_was, source, updated_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'human',$10)
     on conflict (sku) do nothing
     returning sku, name_en, name_ar, display_name, brand, category, category_path,
               description_en, price_now, price_was, in_stock, extra, updated_at, updated_by`,
    [row.sku, row.name_en, row.name_ar ?? null, row.brand ?? null, row.category ?? null,
     sibling?.category_path ?? null, row.description_en ?? null, price_now, price_was, by],
  )
  return made ?? null
}

/**
 * Delete a product.
 *
 * Actually gone, not hidden. A later sheet carrying the same SKU brings it
 * back, and the import says so — suppliers keep discontinued items in their
 * files for months, and finding that out is more useful than a tool that
 * quietly re-deletes for you.
 *
 * What it already made is kept: posters exported, copy approved, conversations
 * that cited it. Those record what actually happened.
 */
export async function remove(sku: string): Promise<boolean> {
  const gone = await query('delete from products where sku = $1 returning sku', [sku])
  return gone.length > 0
}

/** Every row with its vector, for retrieval. */
export async function forRetrieval(): Promise<(CatalogueRow & { embedding: number[] | null })[]> {
  return query(
    `select sku, name_en, name_ar, display_name, brand, category, category_path,
            description_en, price_now, price_was, in_stock, extra, updated_at, updated_by, embedding
       from products`,
  )
}
