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
export async function upsert(products: ProductRow[], by = 'sheet'): Promise<{ written: number }> {
  let written = 0
  for (const p of products) {
    if (!p.sku) continue
    await query(
      `insert into products
         (sku, name_en, name_ar, display_name, brand, category, category_path,
          description_en, description_ar, price_now, price_was, extra, source, updated_by, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'sheet',$13, now())
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
         embedded_at    = null`,
      [
        String(p.sku), p.name_en ?? null, p.name_ar ?? null, p.display_name ?? null,
        p.brand ?? null, p.category ?? null, pathOf(p) || null,
        p.description_en ?? null, p.description_ar ?? null,
        p.price_now ?? null, p.price_was ?? null,
        JSON.stringify(p.extra ?? {}), by,
      ],
    )
    written++
  }
  return { written }
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

/** Every row with its vector, for retrieval. */
export async function forRetrieval(): Promise<(CatalogueRow & { embedding: number[] | null })[]> {
  return query(
    `select sku, name_en, name_ar, display_name, brand, category, category_path,
            description_en, price_now, price_was, in_stock, extra, updated_at, updated_by, embedding
       from products`,
  )
}
