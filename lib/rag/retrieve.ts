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
import { importedProducts } from '@/lib/template/columns'

export type Row = Record<string, unknown>

export type Hit = {
  sku: string
  row: Row
  /** How well this row matched. Not a judgement about the row — see rule 4. */
  relevance: number
  /** Why this row came back, so a rep reading the transcript can tell. */
  why: 'sku' | 'lexical' | 'meaning'
}

/** Fields a customer's words could plausibly match. Never the spare columns. */
const SEARCHABLE = ['sku', 'name_en', 'name_ar', 'display_name', 'brand', 'category', 'description_en']

const norm = (v: string) =>
  v.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim()

/** The text of a row, for matching and for embedding. Identity fields first. */
export function rowText(p: Row): string {
  return SEARCHABLE.map((k) => String(p[k] ?? '')).filter(Boolean).join(' · ')
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

/**
 * The rows to answer from, best first.
 *
 * An exact SKU in the question wins outright — somebody pasting a code wants
 * that product and nothing else, and burying it under semantic neighbours is
 * how a bot answers about the wrong item.
 */
export async function retrieve(question: string, limit = 4): Promise<Hit[]> {
  const products = importedProducts()
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
  if ((lex[0]?.relevance ?? 0) >= 0.75) return lex.slice(0, limit)

  let semantic: Hit[] = []
  try {
    const texts = products.map((p) => rowText(p))
    const [qv, ...rest] = await vectorFor([question, ...texts])
    semantic = products.map((p, i) => ({
      sku: String(p.sku),
      row: p as Row,
      relevance: cosine(qv, rest[i]),
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
