/**
 * The checks that stand between a generated draft and an approved one.
 *
 * Every check is BINARY and NAMED, and reports the span that triggered it —
 * never a score. See CLAUDE.md rule 4: a composite number gets screenshotted
 * and quoted in meetings and means nothing. A failing check names itself.
 *
 * These run in TypeScript, not in the model. Asking a model whether its own
 * caption invented a price is asking the thing that invented it.
 */

import { formatKwd, FORBIDDEN_PRICE_FIELDS } from '@/lib/money'

/**
 * Placeholders the copy may use, beyond the sheet's own columns.
 *
 * Everything else a draft references must be a column of the row it describes —
 * which is also exactly what the model was shown. Keeping the vocabulary equal
 * to the fact sheet is what stops it inventing a field to hang a claim on.
 */
export const DERIVED = ['price_now', 'price_was', 'discount_pct'] as const

/**
 * Columns that are source material rather than something to drop into a
 * sentence. A retail description is a spec dump — "Bluetooth Wireless
 * Connectivity. Transmits Position, Angle, Force." — and substituting it
 * mid-sentence produces copy that parses and reads like a parts list. The model
 * still SEES these, and writes its own words about them.
 */
const PROSE = /^(description|details|specs?|features|overview)/i

/**
 * Bookkeeping the copy has no business referencing. `{row}` printed the Excel
 * row number and `{on_sale}` printed "true"; neither is a fact about a product.
 */
const INTERNAL = new Set(['row', 'image', 'hasImage', 'on_sale', 'sku'])

/**
 * Columns a caption may not reference, whatever a particular sheet calls them.
 *
 * `parse.ts` keeps every unmapped column verbatim — deliberately, so nothing is
 * silently lost — and the real Retailer sheet carries `Stock: Yes`,
 * `Monthly Installment: 5.000 KWD`, `Discount %` and `Category Path` among
 * them. A template slot binding one of those is a human dragging it there. A
 * caption is the model choosing it, which is a different risk entirely.
 *
 * Matched on the column NAME, because the next sheet will spell them
 * differently and the reason will be identical.
 */
const UNSAFE: { pattern: RegExp; why: string }[] = [
  {
    pattern: /^(stock|availab|qty|quantity|inventory|in.?stock)/i,
    why: 'availability is a claim and a sheet is a snapshot — knowledge/kuwait/compliance-guardrails.md treats stock guarantees as blockers',
  },
  {
    pattern: /(installment|instalment|monthly|finance|financing|bnpl|tabby|tamara)/i,
    why: 'a financing figure is a commitment somebody has to have actually made',
  },
  {
    // Not discount_pct, which is derived from the two prices that will print.
    pattern: /^discount(?!_pct$)|%/i,
    why: 'the discount is derived from the two prices, never read from a column that can disagree with them — write {discount_pct}',
  },
  {
    pattern: /(url|link|path|breadcrumb|slug)/i,
    why: 'a link or a category path is not a fact about the product',
  },
]

const unsafeReason = (name: string) => UNSAFE.find((u) => u.pattern.test(name))?.why

/** Every placeholder that could stand for something on this row. */
const substitutable = (values: Record<string, unknown>): string[] => [
  ...new Set([
    ...DERIVED,
    ...Object.keys(values).filter(
      (k) =>
        !INTERNAL.has(k) &&
        !PROSE.test(k) &&
        !unsafeReason(k) &&
        // The pre-discount price is not a placeholder. Reaching it through one
        // is the same failure as binding it on a poster, and costs the same.
        !(k in FORBIDDEN_PRICE_FIELDS),
    ),
  ]),
]

/** Those that would actually print — what a person or the model may use. */
export const tokensFor = (values: Record<string, unknown>): string[] =>
  substitutable(values).filter((t) => resolves(t, values))

/** Whether a placeholder would print something rather than a gap. */
function resolves(name: string, values: Record<string, unknown>): boolean {
  if (name === 'discount_pct') {
    const now = Number(values.price_now), was = Number(values.price_was)
    return Number.isFinite(now) && Number.isFinite(was) && was > now
  }
  const v = values[name]
  return v !== undefined && v !== null && v !== ''
}

/**
 * Anything brace-shaped, not just lowercase names.
 *
 * Narrower, this missed `{hasImage}` and `{Colour}` entirely, and `{Monthly
 * Installment}` and `{Discount %}` for the extra reason that they contain a
 * space — not flagged, not substituted, printed as literal braces into a
 * caption. A real retailer's sheet names columns in prose, so the model reaches
 * for them exactly as written; every one now either resolves or fails a check.
 */
const TOKEN_RE = /\{([^{}]+)\}/g

/** A brand may contain a regex metacharacter — "AT&T", "M+A". */
const escapeRe = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export type Check = {
  /** Stable name. The UI shows this; nothing sums them. */
  name: string
  pass: boolean
  /** The exact text that failed, quoted from the draft. Empty when it passed. */
  span?: string
  /** What to do about it, in the language a marketer would use. */
  hint?: string
}

/**
 * Patterns that are blockers under knowledge/kuwait/compliance-guardrails.md.
 *
 * Deliberately literal and over-eager. A false positive costs one glance from
 * the person approving; a false negative is a published claim the company
 * cannot substantiate.
 */
const SUPERLATIVE = /\b(best|cheapest|lowest|biggest|greatest|fastest|number\s*one|no\.?\s*1|unbeatable|unbelievable)\b/i
const COMPARATIVE = /\b(better|cheaper|faster|stronger|smarter)\s+than\b/i
const GUARANTEE = /\b(guarantee[ds]?|we promise|always in stock|risk[- ]free|lifetime)\b/i
const FAITH_POLITICS =
  /\b(bless|blessing|blessed|halal|haram|pray(er|ers|ing)?|holy|sacred|faith|god[- ]?given|allah|barakah|thawab|government|minister|parliament|election|political|regime|war)\b/i

/**
 * A digit-bearing word that is part of the product's own identity.
 *
 * `M4`, `iPhone 16`, `Wi-Fi 6`, `RT-AX88U` are what the product IS, and they
 * appear verbatim in its row. Blocking them made the guard fire on three of
 * eight drafts for an iPad Pro, and a check that cries wolf on the product's
 * own name is a check people learn to click past.
 *
 * Deliberately only the IDENTITY fields — not the description. A figure the
 * model lifted out of a spec paragraph is the thing rule 2 is about; the model
 * name on the box is not. Same reasoning as `isQuoted`: verify against the
 * source in TypeScript rather than trusting the writer.
 */
export function isProductIdentity(word: string, values: Record<string, unknown>): boolean {
  const identity = ['name_en', 'display_name', 'brand', 'category']
    .map((k) => String(values[k] ?? ''))
    .join(' ')
    .toLowerCase()
  const w = word.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
  if (!w.length) return false

  // A bare number has to BE one of the numbers in the name, not appear inside
  // one. `includes('4')` is true of "14-inch", "512GB" and "M4 Max", so the
  // assistant answered "how many laptops do you have" with "I have 4 laptops"
  // — a figure it invented, waved through by a substring match. There are 23.
  if (/^\d+$/.test(w)) return (identity.match(/\d+/g) ?? []).includes(w)

  if (identity.includes(w)) return true

  // A hashtag closes the spaces a title leaves open: "#M4Pro" against a product
  // called "MacBook Pro 16, M4 Pro Chip". Blocking it blocked the whole
  // hashtags piece, since the eight are approved as one.
  //
  // Only for a token that carries a LETTER. Comparing bare digits with the
  // separators removed would let "99s" match across "16GB RAM, 99 something",
  // and a figure the shop never set is the one thing this check exists to stop.
  if (!/\p{L}/u.test(w)) return false
  const squash = (v: string) => v.replace(/[^\p{L}\p{N}]+/gu, '')
  return squash(identity).includes(squash(w))
}

/** Digits that came from the model rather than from a catalogue row. */
function bareDigits(text: string, values: Record<string, unknown>): string | undefined {
  const withoutTokens = text.replace(TOKEN_RE, ' ')
  const found = withoutTokens.match(/\S*\d[\d.,%]*\S*/g) ?? []
  return found.find((w) => !isProductIdentity(w, values))
}

/**
 * Checks one piece of copy against the row it claims to describe.
 *
 * `values` is the flattened product row. A token whose value is missing is a
 * failure, not a blank: "was {price_was}" on a product that is not discounted
 * would otherwise render as a dangling word and read as a stripped price.
 */
export function check(text: string, values: Record<string, unknown>): Check[] {
  const checks: Check[] = []
  const fail = (name: string, span: string | undefined, hint: string) =>
    checks.push({ name, pass: !span, ...(span ? { span, hint } : {}) })

  fail(
    'no invented numbers',
    bareDigits(text, values),
    'Numbers come from the catalogue. Write {price_now}, {price_was} or {discount_pct} instead. ' +
      "A figure that is part of the product's own name is fine; one that is not has to be substituted. " +
      'If it is not a quantity at all — "3D", "24/7" — the check cannot tell, so rewrite the line without it. ' +
      'The check stays strict on purpose: one price the shop never set costs more than one rephrasing.',
  )

  const unknown: string[] = []
  const unresolved: string[] = []
  let unsafe: { token: string; why: string } | undefined
  const valid = substitutable(values)
  for (const [, name] of text.matchAll(TOKEN_RE)) {
    // Checked before "is it a real field", because it IS a real field — that is
    // the point. "No such column" would be a misleading thing to tell someone
    // about a column their own sheet definitely has.
    const why = name in values ? unsafeReason(name) : undefined
    if (why) { unsafe ??= { token: `{${name}}`, why }; continue }
    if (!valid.includes(name)) unknown.push(`{${name}}`)
    else if (!resolves(name, values)) unresolved.push(`{${name}}`)
  }
  fail('no claim taken from a spare column', unsafe?.token, unsafe?.why ?? '')
  fail(
    'every placeholder is a real field',
    unknown[0],
    `This product sheet has no such column. Use one of: ${tokensFor(values).join(', ')}.`,
  )
  fail(
    'every placeholder has a value',
    unresolved[0],
    'This product has nothing in that column — the line would print with a gap where a number should be.',
  )

  fail('no unsubstantiable superlative', text.match(SUPERLATIVE)?.[0], 'A claim the company cannot prove is a blocker, not a tone note.')
  fail('no comparison to a competitor', text.match(COMPARATIVE)?.[0], 'Comparative claims against another product are a blocker.')
  fail('no guarantee the company has not made', text.match(GUARANTEE)?.[0], 'Only promise what someone has actually committed to.')
  fail('nothing religious or political', text.match(FAITH_POLITICS)?.[0], 'Neutral calendar facts only. See knowledge/kuwait/compliance-guardrails.md.')

  return checks
}

export const blockers = (checks: Check[]) => checks.filter((c) => !c.pass)

/**
 * Substitutes catalogue values into a draft.
 *
 * This is the only path from a row to a printed figure in generated copy, and
 * it is deterministic. The model supplies the sentence around it and never the
 * number inside it.
 */
export function fill(text: string, values: Record<string, unknown>): string {
  // "{brand} {display_name}" reads as "APPLE Apple Airpods 4" on a catalogue
  // whose titles already carry the brand — which is most of them. The model
  // cannot see the resolved strings when it writes, so this is fixed here
  // rather than in a prompt, and only when the name genuinely starts with the
  // brand: "APPLE MacBook" keeps its brand, "Apple Airpods" drops the repeat.
  const brand = String(values.brand ?? '').trim()
  if (brand) {
    text = text.replace(
      /\{brand\}(\s+)\{(display_name|name_en)\}/g,
      (whole, gap: string, field: string) => {
        const name = String(values[field] ?? values.name_en ?? '').trim()
        return new RegExp(`^${escapeRe(brand)}\\b`, 'i').test(name) ? `{${field}}` : whole
      },
    )
  }

  return text.replace(TOKEN_RE, (whole, name: string) => {
    switch (name) {
      case 'price_now': return formatKwd(values.price_now) || whole
      case 'price_was': return formatKwd(values.price_was) || whole
      case 'discount_pct': {
        const now = Number(values.price_now), was = Number(values.price_was)
        // Derived from the two prices, never read from the sheet — a stale
        // "Discount %" column disagreeing with the prices beside it is the
        // exact bug the template renderer already refuses to reproduce.
        return Number.isFinite(now) && Number.isFinite(was) && was > now
          ? `${Math.round((1 - now / was) * 100)}%`
          : whole
      }
      default: {
        const v = values[name]
        return v === undefined || v === null || v === '' ? whole : String(v)
      }
    }
  })
}
