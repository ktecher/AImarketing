/**
 * Short names for posters and captions.
 *
 * A catalogue title is not a headline. On this catalogue the median product
 * name is 66 characters and the longest is 177; Kuwaiti retail posters use
 * 16-35. Mechanical shortening was measured and rejected — cutting at the first
 * comma produced `HP Laptop` for two different laptops, which is worse than a
 * long name because it is wrong rather than merely ugly.
 *
 * So a model proposes and a person approves, and four checks stand between the
 * two. The checks are the reason this is allowed at all: a proposal that
 * invents a word, or collides with another product, cannot be saved.
 */

import { z } from 'zod'
import * as route from '@/lib/ai/route'

/** The range a poster headline actually occupies. Not a style preference. */
export const POSTER_MAX = 35

export type NameCheck = { name: string; pass: boolean; span?: string; hint?: string }

/** Words, lowercased, punctuation dropped. `RT-AX88U` is two words, both real. */
const words = (s: string) =>
  s.toLowerCase().split(/[^a-z0-9؀-ۿ]+/i).filter(Boolean)

/**
 * Checks one candidate against the row it shortens and the catalogue around it.
 *
 * `others` is every OTHER product's resolved display name. The collision check
 * needs the whole catalogue, which is why it cannot live in the model's head:
 * two independently reasonable shortenings are the failure mode.
 */
export function checkName(
  candidate: string,
  product: { sku: string; name_en?: string },
  others: { sku: string; name: string }[],
): NameCheck[] {
  const checks: NameCheck[] = []
  const fail = (name: string, span: string | undefined, hint: string) =>
    checks.push({ name, pass: !span, ...(span ? { span, hint } : {}) })

  const full = product.name_en ?? ''
  const source = new Set(words(full))

  // Every word must come from the product's own name. Digits included — a model
  // is not allowed to invent "14-inch", but it is allowed to keep it, and
  // keeping it is verified here in TypeScript rather than trusted.
  const invented = words(candidate).find((w) => !source.has(w))
  fail(
    'every word comes from the product name',
    invented,
    full
      ? `"${invented}" is not in the catalogue title. A short name selects from the name; it does not add to it.`
      : // Every word fails when there is nothing to select from, and the generic
        // message reads as nonsense. display_name is an English column.
        'This product has no English name, so there is nothing to shorten. Fill Product Name (EN) first.',
  )

  fail(
    `fits a poster (${POSTER_MAX} characters)`,
    candidate.length > POSTER_MAX ? `${candidate.length} characters` : undefined,
    'Longer than this and the layout shrinks it until it stops reading as a headline.',
  )

  fail(
    'shorter than the catalogue title',
    candidate.length >= full.length && full ? `${candidate.length} vs ${full.length}` : undefined,
    'A short name that is not shorter is just the title again.',
  )

  // The measured failure. Two laptops both shortened to "HP Laptop" is a
  // catalogue that cannot tell its own products apart on a shelf.
  const clash = others.find(
    (o) => o.sku !== product.sku && o.name.trim().toLowerCase() === candidate.trim().toLowerCase(),
  )
  fail(
    'not shared with another product',
    clash && `${clash.sku}`,
    `SKU ${clash?.sku} already uses this name. Two products with one headline is the failure that killed automatic shortening.`,
  )

  return checks
}

export const nameBlockers = (checks: NameCheck[]) => checks.filter((c) => !c.pass)

const Suggestion = z.object({
  suggestions: z.array(z.object({ sku: z.string(), short: z.string() })).max(12),
})

/**
 * Proposes short names, a batch at a time.
 *
 * Batched because sixty separate calls is three minutes of somebody watching a
 * spinner, and this task is mechanical enough to survive it. The SKU is echoed
 * back and verified against the batch, so a misaligned row is dropped rather
 * than silently attached to the wrong product.
 */
export async function suggestNames(
  products: { sku: string; name_en?: string; brand?: string }[],
  batchSize = 8,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {}

  // Sorted by name, so near-duplicates land in the SAME batch. The instruction
  // to keep two products apart is worthless if the model cannot see both — and
  // near-duplicates are the whole problem: on this catalogue, three iPhone
  // bumpers differing only by colour collapsed to one headline until this sort
  // put them in front of the model together.
  const ordered = [...products].sort((a, b) => (a.name_en ?? '').localeCompare(b.name_en ?? ''))

  for (let i = 0; i < ordered.length; i += batchSize) {
    const batch = ordered.slice(i, i + batchSize)
    const list = batch.map((p) => `${p.sku}: ${p.name_en ?? ''}`).join('\n')

    const prompt =
      `Shorten each product title to a headline for a retail poster in Kuwait.\n\n` +
      `RULES:\n` +
      `- Use ONLY words that already appear in that product's title. Never add a word.\n` +
      `- Some titles below differ only in one word — a colour, a chip, a screen size. ` +
      `When two would otherwise read the same, KEEP the word that tells them apart. ` +
      `Two products under one headline is the worst outcome here, worse than a long name.\n` +
      `- ${POSTER_MAX} characters maximum. Aim for 16 to 30. Cut in this order until it fits:\n` +
      `    1. everything after a comma\n` +
      `    2. model codes and capacities — MWRY3AB/A, 512GB SSD, 16GB RAM\n` +
      `    3. generic category words the brand and model already imply — "Laptop", "Tablet", ` +
      `"Cable", "Sleeve". "Asus Vivobook 16 Core Ultra 5", not "Asus Vivobook 16 Laptop Intel Core Ultra 5"\n` +
      `    4. the colour, but only if nothing else distinguishes this product\n` +
      `- Never cut the brand or the model. "Apple Pencil", not "Pencil".\n` +
      `- Echo each SKU exactly as given.\n\n` +
      `TITLES:\n${list}`

    try {
      const { suggestions } = await route.generateJson('content_studio', prompt, Suggestion, z.toJSONSchema(Suggestion), {
        maxTokens: 700,
      })
      const wanted = new Map(batch.map((p) => [p.sku, p]))
      for (const s of suggestions) {
        // A SKU that was not in this batch is a hallucinated row, not a result.
        if (wanted.has(s.sku) && s.short.trim()) out[s.sku] = s.short.trim()
      }
    } catch {
      // One unusable batch must not lose the batches that worked. The products
      // it covered simply come back without a suggestion, which is visible.
    }
  }
  return out
}
