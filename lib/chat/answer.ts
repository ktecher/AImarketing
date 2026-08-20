/**
 * A grounded answer, or an escalation. There is no third outcome.
 *
 * Three hard rules meet here, and each is enforced in TypeScript rather than
 * asked of the model:
 *
 *   2. The model never emits a number. It writes `{price_now:502037}` and the
 *      catalogue fills it through the one formatter — the same trick the content
 *      studio uses, extended with a SKU because a reply can span two products.
 *   3. Never state a fact that is not in a retrieved row. Cited SKUs must be a
 *      subset of what retrieval actually returned; that is a set operation,
 *      never a question put to the model.
 *
 * And the rule that makes the other two safe: when a check fails, the customer
 * gets a person, not a softened guess. A bot that hedges into an answer is worse
 * than one that says it does not know, because the hedge still gets quoted back.
 */

import { z } from 'zod'
import { generate, isGrounded, MODELS } from '@/lib/ai/generate'
import { isProductIdentity } from '@/lib/content/guard'
import { formatKwd } from '@/lib/money'
import { retrieve, type Hit, type Row } from '@/lib/rag/retrieve'

export const PROMPT_VERSION = 'chat/v1'

/** Fields the assistant may speak about. Spare sheet columns are hazards — D48. */
const SPEAKABLE = ['name_en', 'name_ar', 'display_name', 'brand', 'category', 'description_en'] as const
const PRICE_FIELDS = ['price_now', 'price_was', 'discount_pct'] as const

export type Answer = {
  reply: string
  /** SKUs the reply is grounded in. Empty when escalating. */
  cited: string[]
  retrieved: string[]
  escalated: boolean
  /** Named, quotable reason when escalating — never a vague apology. */
  reason?: 'nothing-retrieved' | 'ungrounded-sku' | 'invented-number' | 'unresolved-field' | 'model-unavailable'
  model: string
  prompt_version: string
}

const TOKEN = /\{(\w+):([\w-]+)\}/g

/** `{price_now:502037}` → `19.900 KD`, from the row and nothing else. */
export function fillFacts(text: string, rows: Map<string, Row>): { filled: string; unresolved: string[] } {
  const unresolved: string[] = []
  const filled = text.replace(TOKEN, (whole, field: string, sku: string) => {
    const row = rows.get(sku)
    if (!row) { unresolved.push(whole); return whole }

    if (field === 'discount_pct') {
      const now = Number(row.price_now), was = Number(row.price_was)
      // Derived from the two prices, never read from the sheet's own column —
      // a stale "Discount %" disagreeing with the prices beside it is the bug
      // the renderer already refuses to reproduce.
      if (!(Number.isFinite(now) && Number.isFinite(was) && was > now)) { unresolved.push(whole); return whole }
      return `${Math.round((1 - now / was) * 100)}%`
    }
    if (field === 'price_now' || field === 'price_was') {
      const money = formatKwd(row[field])
      if (!money) { unresolved.push(whole); return whole }
      return money
    }
    const v = row[field]
    if (v === undefined || v === null || v === '') { unresolved.push(whole); return whole }
    return String(v)
  })
  return { filled, unresolved }
}

/**
 * A digit the model typed itself, outside a token it was given.
 *
 * A figure that is part of a retrieved product's own name is not invented —
 * "Apple Pencil 1st generation" and "Airpods 4" are the answer, and blocking
 * them blocked every reply. Same rule and the same function the copy guard
 * uses, because two copies of "is this figure the product's own name" is the
 * duplication D32/D38/D39 record; it must not exist twice.
 */
export function bareNumber(text: string, rows: Map<string, Row> = new Map()): string | undefined {
  const words = text.replace(TOKEN, ' ').match(/\S*\d[\d.,%]*\S*/g) ?? []
  const named = [...rows.values()]
  // A retrieved row's own SKU is grounded by definition — it IS the key that
  // row was found by. The copy guard's identity fields are name, brand and
  // category, which is right for a caption and wrong here: the model writes
  // "(SKU 561044)" to say which product it means, and blocking that escalated
  // an otherwise perfect answer.
  const skus = new Set([...rows.keys()].map((k) => k.toLowerCase()))
  const bare = (w: string) => w.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
  return words.find((w) => !skus.has(bare(w)) && !named.some((row) => isProductIdentity(w, row)))
}

/** Every `{field:sku}` the model reached for. */
export function citedSkus(text: string): string[] {
  return [...new Set([...text.matchAll(TOKEN)].map((m) => m[2]))]
}

/**
 * What the model is allowed to know.
 *
 * Prices appear as field NAMES, never as figures — showing a model a number it
 * is forbidden to repeat is asking it to paraphrase one. Same reason the content
 * studio's fact sheet names `price_now` and never carries its value.
 */
export function factSheet(hits: Hit[]): string {
  return hits
    .map(({ sku, row }) => {
      const lines = [`SKU ${sku}`]
      for (const f of SPEAKABLE) if (row[f]) lines.push(`  ${f}: ${row[f]}`)
      // Stock is a real column on the catalogue, not one of the sheet's spare
      // ones, so the assistant may say it. "Is it in stock" is one of the
      // questions the whole pillar exists to stop a person answering by hand.
      if (row.in_stock !== undefined) {
        lines.push(`  availability: ${row.in_stock ? 'in stock' : 'OUT OF STOCK — say so plainly'}`)
      }
      for (const f of PRICE_FIELDS) {
        if (f === 'discount_pct' ? Number(row.price_was) > Number(row.price_now) : row[f] !== undefined) {
          lines.push(`  ${f}: write {${f}:${sku}}`)
        }
      }
      return lines.join('\n')
    })
    .join('\n\n')
}

const SYSTEM =
  'You answer customer questions for a Kuwait electronics retailer, from the product facts you are given and nothing else.\n' +
  'NEVER write a figure — no price, no percentage, no quantity. Write the token exactly as the facts show it, e.g. {price_now:502037}.\n' +
  'Only mention a product whose SKU appears in the facts.\n' +
  'If the facts do not answer the question, reply with exactly: ESCALATE\n' +
  'Two sentences at most. No greeting, no sign-off, no emoji.'

export const ESCALATION =
  'I do not have that in the catalogue, so I am passing you to someone who can answer properly.'

/**
 * Answer a question, or escalate.
 *
 * `hits` is threaded out rather than re-derived so the caller can record exactly
 * what was retrieved: `messages.provenance` is the column that lets somebody
 * answer "your bot told me 40 KD" six weeks later.
 */
export async function answer(question: string): Promise<Answer & { hits: Hit[] }> {
  const base = { model: MODELS.english, prompt_version: PROMPT_VERSION }
  const escalate = (reason: Answer['reason'], hits: Hit[] = []) => ({
    ...base, hits, reply: ESCALATION, cited: [], escalated: true, reason,
    retrieved: hits.map((h) => h.sku),
  })

  const hits = await retrieve(question)
  if (!hits.length) return escalate('nothing-retrieved')

  const retrieved = hits.map((h) => h.sku)
  const rows = new Map(hits.map((h) => [h.sku, h.row]))

  let raw: string
  try {
    raw = await generate(`${factSheet(hits)}\n\nCustomer: ${question}`, { system: SYSTEM, temperature: 0, maxTokens: 220 })
  } catch {
    return escalate('model-unavailable', hits)
  }

  if (/^\s*ESCALATE\s*$/i.test(raw)) return escalate('nothing-retrieved', hits)

  // Set operation, not a question for the model.
  const cited = citedSkus(raw)
  if (!isGrounded(cited, retrieved)) return escalate('ungrounded-sku', hits)

  if (bareNumber(raw, rows)) return escalate('invented-number', hits)

  const { filled, unresolved } = fillFacts(raw, rows)
  if (unresolved.length) return escalate('unresolved-field', hits)

  return { ...base, hits, reply: filled.trim(), cited, retrieved, escalated: false }
}

/** Shape check for a posted message. Kept here so the route stays thin. */
export const AskSchema = z.object({
  question: z.string().trim().min(1).max(500),
  // nullish, not optional. A browser sending JSON writes `null` for "no
  // conversation yet", and `.optional()` rejects null — which failed every
  // first message with "Type a question first", blaming the customer for a
  // field they never touched.
  conversationId: z.string().trim().max(64).nullish(),
})
