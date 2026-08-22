/**
 * Finding the catalogue rows a customer's question is about.
 *
 * Two passes, because they fail in opposite directions. Lexical matching finds
 * a SKU, a model number or a brand exactly and is blind to phrasing; embeddings
 * find "wireless earbuds" in a row that says "AirPods" and are notoriously bad
 * at alphanumeric identifiers. `bge-m3` was chosen partly because it emits
 * sparse vectors alongside dense for this reason — until that is wired up, the
 * lexical pass is the sparse half, done in TypeScript.
 *
 * No pgvector and no index: sixty rows, cosine in a loop, microseconds. That is
 * the architecture's own instruction below thousands of rows.
 */

import { cosine, embed } from '@/lib/ai/generate'
import { forRetrieval, searchText } from '@/lib/catalogue'
import { importedProducts } from '@/lib/template/columns'

export type Row = Record<string, unknown>

export type Hit = {
  sku: string
  row: Row
  /** How well this row matched. Not a judgement about the row — see rule 4. */
  relevance: number
  /** Why this row came back, so a rep reading the transcript can tell. */
  why: 'sku' | 'category' | 'lexical' | 'meaning'
}

/** Fields a customer's words could plausibly match. */
const SEARCHABLE = ['sku', 'name_en', 'name_ar', 'display_name', 'brand', 'category', 'description_en']

/**
 * The sheet's own category tree, used to FIND rows and never to speak from.
 *
 * "Do you sell laptops?" returned no MacBook, because the sheet files them under
 * the category "MacBook Pro" and neither that nor "Apple MacBook Pro 16, M4 Pro
 * Chip" contains the word laptop. The path does:
 *
 *   Computers & Tablets > Laptops > Apple MacBook > MacBook Pro
 *   Computers & Tablets > Laptop Accessories > ... > Laptop Sleeves
 *
 * which is also the only thing in the sheet that separates a laptop from a
 * laptop sleeve. D48 calls the spare columns hazards, and they are — for
 * SPEAKING. This is retrieval: finding a row is not a claim about it, and the
 * chat's fact sheet still refuses to offer any of this to the model.
 */
const PATH_COLUMNS = ['Category Path', 'Category path', 'category_path']

function categoryPath(p: Row): string {
  // `flatten` in lib/template/columns spreads the sheet's spare columns to the
  // top level, so the path is p['Category Path'] and not p.extra['Category
  // Path']. Both are checked: a row that has not been flattened still resolves.
  const extra = (p.extra ?? {}) as Record<string, unknown>
  for (const k of PATH_COLUMNS) if (p[k]) return String(p[k])
  for (const k of PATH_COLUMNS) if (extra[k]) return String(extra[k])
  return ''
}

const norm = (v: string) =>
  v.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim()

/** The text of a row, for matching and for embedding. Identity fields first. */
export function rowText(p: Row): string {
  // The catalogue table embeds with searchText; a row from Postgres must be
  // described the same way here or its stored vector and a freshly computed one
  // would disagree about the same product.
  if (p.category_path !== undefined) return searchText(p as never)
  return [...SEARCHABLE.map((k) => String(p[k] ?? '')), categoryPath(p)]
    .filter(Boolean)
    .join(' · ')
}

/**
 * Words worth matching on. Two characters or fewer are noise in both languages,
 * except a token carrying a digit — "16", "4", "M4" are the whole question.
 */
function terms(q: string): string[] {
  return norm(q).split(' ').filter((w) => w.length > 2 || /\d/.test(w))
}

function lexicalMatch(q: string, p: Row): number {
  const hay = norm(rowText(p))
  const want = terms(q)
  if (!want.length) return 0
  let hits = 0
  for (const w of want) if (hay.includes(w)) hits++
  return hits / want.length
}

/**
 * Embeddings for the loaded catalogue, computed once.
 *
 * Keyed by the row text so a re-import with different products misses the cache
 * rather than answering about a product that is no longer in the sheet.
 */
const vectors = new Map<string, number[]>()

async function vectorFor(texts: string[]): Promise<number[][]> {
  const missing = texts.filter((t) => !vectors.has(t))
  if (missing.length) {
    const fresh = await embed(missing)
    missing.forEach((t, i) => vectors.set(t, fresh[i]))
  }
  return texts.map((t) => vectors.get(t) as number[])
}

/** Singular and plural are the same shelf. "laptop" and "Laptops" must meet. */
const stem = (v: string) => norm(v).replace(/s$/, '')

/**
 * Words that carry no product meaning, so their presence does not make a
 * question specific. Everything a customer says around the thing they want.
 */
const ASIDES = new Set([
  'do', 'doe', 'you', 'your', 'we', 'the', 'thi', 'that', 'any', 'some', 'and', 'or',
  'have', 'ha', 'got', 'get', 'sell', 'selling', 'stock', 'carry', 'offer', 'available',
  'what', 'which', 'i', 'me', 'my', 'want', 'need', 'looking', 'look', 'for', 'there',
  'are', 'is', 'in', 'of', 'a', 'an', 'pleas', 'kind', 'type', 'sort', 'show', 'list',
])

/**
 * Rows under a category the question names.
 *
 * "Do you sell laptops?" is not a similarity question, and answering it by
 * similarity put a Laptop Sleeve first and no MacBook anywhere — the sleeve
 * says "laptop" three times and a MacBook never says it at all. The sheet's own
 * tree settles it: laptops sit under `> Laptops >`, sleeves under
 * `> Laptop Accessories >`. Matching the SEGMENT rather than the string is what
 * keeps the accessory out.
 */
function byCategory(question: string, products: Row[]): Hit[] {
  const asked = new Set(terms(question).map(stem))
  if (!asked.size) return []

  // Every segment of every path, so "Laptops" is a node and not a substring.
  const segments = new Set<string>()
  for (const p of products) {
    for (const seg of categoryPath(p).split('>')) {
      const t = stem(seg)
      if (t) segments.add(t)
    }
  }

  // A segment matches only when the question contains ALL of its words, so
  // "laptop sleeves" reaches "Laptop Sleeves" and not only "Laptops".
  const matched = [...segments]
    .map((seg) => ({ seg, words: seg.split(' ').filter(Boolean) }))
    .filter(({ words }) => words.length > 0 && words.every((w) => asked.has(stem(w))))
  if (!matched.length) return []

  // Most specific wins. "Do you sell laptop sleeves" matches both "laptop" and
  // "laptop sleeve"; answering with every laptop would be answering a different
  // question.
  const deepest = Math.max(...matched.map((m) => m.words.length))
  const named = matched.filter((m) => m.words.length === deepest).map((m) => m.seg)

  // And only when the question is ABOUT the category rather than merely
  // containing its name. "How much is the Asus Vivobook 15 Laptop, AMD Ryzen 5"
  // says laptop too, and answering it with twenty laptops — MacBooks first —
  // is worse than the gap this was written to close.
  const leftover = [...asked].filter(
    (t) => !ASIDES.has(t) && !named.some((seg) => seg.split(' ').includes(t)),
  )
  if (leftover.length) return []

  return products
    .filter((p) => categoryPath(p).split('>').some((seg) => named.includes(stem(seg))))
    .map((p) => ({ sku: String(p.sku), row: p, relevance: 1, why: 'category' as const }))
}

/**
 * The rows to answer from, best first.
 *
 * An exact SKU in the question wins outright — somebody pasting a code wants
 * that product and nothing else, and burying it under semantic neighbours is
 * how a bot answers about the wrong item.
 */
/**
 * The rows to search: the full catalogue when one is loaded, the campaign sheet
 * otherwise.
 *
 * Two different things, and the assistant wants the bigger one — a customer can
 * ask about anything the shop sells, not only what this week's posters are
 * about. Designs and the content studio keep reading the sheet directly and are
 * untouched by this.
 *
 * Vectors come back with the row when the catalogue is in Postgres, so a
 * restart costs nothing. The sheet path still embeds on first use, which is two
 * seconds at sixty rows and the reason the database exists at five thousand.
 */
async function corpus(): Promise<{ rows: Row[]; vectors: Map<string, number[]> }> {
  try {
    const catalogue = await forRetrieval()
    if (catalogue.length) {
      const vectors = new Map<string, number[]>()
      for (const r of catalogue) if (r.embedding?.length) vectors.set(String(r.sku), r.embedding)
      // Prices arrive from `numeric` as strings. Everything downstream does
      // Number() on them, and formatKwd is the only thing that prints one.
      return { rows: catalogue as unknown as Row[], vectors }
    }
  } catch {
    // No database, no migration, or Postgres is down. The sheet still answers.
  }
  return { rows: importedProducts(), vectors: new Map() }
}

export async function retrieve(question: string, limit = 4): Promise<Hit[]> {
  const { rows: products, vectors: stored } = await corpus()
  if (!products.length) return []

  const asked = norm(question)
  const exact = products.filter((p) => {
    const sku = norm(String(p.sku ?? ''))
    return sku.length > 2 && new RegExp(`\\b${sku}\\b`).test(asked)
  })
  if (exact.length) {
    return exact.slice(0, limit).map((p) => ({ sku: String(p.sku), row: p, relevance: 1, why: 'sku' as const }))
  }

  const lex = products
    .map((p) => ({ sku: String(p.sku), row: p as Row, relevance: lexicalMatch(question, p), why: 'lexical' as const }))
    .filter((h) => h.relevance > 0)
    .sort((a, b) => b.relevance - a.relevance)

  // A confident lexical match needs no model. "Do you have the Anker 542" is
  // answered by the words, and a round trip to the embedder buys nothing.
  const CONFIDENT_PRODUCT = 0.75
  if ((lex[0]?.relevance ?? 0) >= CONFIDENT_PRODUCT) return lex.slice(0, limit)

  // Only once no single product is the obvious answer. "How much is the Asus
  // Vivobook 15 laptop" names a category word too, and must not come back with
  // twenty laptops instead of the one that was asked about.
  const category = byCategory(question, products)
  if (category.length) return category.slice(0, limit)

  let semantic: Hit[] = []
  try {
    // Only the question needs embedding when the catalogue brought its vectors.
    // A few rows without one — just imported, or their text just edited — embed
    // inline, which also covers the whole sheet path on its first question. But
    // only a few: a large catalogue that has never been through the Products
    // tab's embed queue would otherwise turn one customer's question into
    // minutes of model time. Beyond the cap those rows still answer lexically
    // and by category; they join the meaning pass when the queue has run.
    const INLINE_CAP = 64
    let missing = products.filter((p) => !stored.has(String(p.sku)))
    if (missing.length > INLINE_CAP) missing = []
    const texts = missing.map((p) => rowText(p))
    const [qv, ...fresh] = await vectorFor([question, ...texts])
    missing.forEach((p, i) => stored.set(String(p.sku), fresh[i]))

    semantic = products
      .filter((p) => stored.has(String(p.sku)))
      .map((p) => ({
        sku: String(p.sku),
        row: p as Row,
        relevance: cosine(qv, stored.get(String(p.sku)) as number[]),
        why: 'meaning' as const,
      }))
  } catch {
    // The embedder being down must not make the assistant silent. Lexical hits
    // still answer most questions; nothing at all escalates, which is correct.
    return lex.slice(0, limit)
  }

  // Merge, keeping the better reason for a row both passes found.
  const best = new Map<string, Hit>()
  for (const h of [...lex, ...semantic]) {
    const prev = best.get(h.sku)
    if (!prev || h.relevance > prev.relevance) best.set(h.sku, h)
  }

  return [...best.values()]
    .sort((a, b) => b.relevance - a.relevance)
    .filter((h) => h.relevance >= 0.35)
    .slice(0, limit)
}
