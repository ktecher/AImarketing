/**
 * Reviewing a draft the team wrote themselves.
 *
 * `review(text, {channel, lang})` takes TEXT, not a draft object. There is
 * deliberately nowhere to put the generator's context, so the compiler enforces
 * what would otherwise be discipline: the thing that writes copy must never be
 * the thing that judges it.
 *
 * v1 has no model and no score, per architecture.md. Everything here is a
 * string operation or a catalogue lookup, which means no hallucination surface
 * and nothing to be wrong about. The most valuable check is also the dumbest:
 * *your caption says 129 KD, the catalogue says 119.500 as of yesterday.*
 *
 * CLAUDE.md rule 4 governs the shape. Binary named checks, each anchored to a
 * quoted span. No aggregate number anywhere, and the words score, rating and
 * grade do not appear — not in a field name, not in the UI.
 */

import { check as copyChecks } from '@/lib/content/guard'
import { formatKwd } from '@/lib/money'
import { retrieve, type Row } from '@/lib/rag/retrieve'

/** Advice tops out at "needs work". Only a check may say "problem". */
export type Verdict = 'ok' | 'needs work' | 'problem'

export type Blocker = { quote: string; criterion: string; why: string }
export type Fix = { quote: string; change: string; why: string; criterion: string }

export type Review = {
  verdicts: Record<string, Verdict>
  /** Publish is disabled while any of these stand. */
  blockers: Blocker[]
  /** Ranked, most important first. Three is the cap — twelve is none. */
  fixes: Fix[]
  /** Named honestly, with the reason. Silence here would read as a pass. */
  not_assessed: string[]
  /** The row the draft was checked against, so a human can disagree with it. */
  matched: { sku: string; name: string; confidence: 'sku' | 'lexical' | 'meaning' } | null
}

export type ReviewOptions = { channel?: string; lang?: 'en' | 'ar' }

/** A figure a person typed that looks like money. `19.900 KD`, `KD 19.9`, `129KD`. */
const MONEY = /(?:(?:KWD|KD)\s*([\d][\d.,]*)|([\d][\d.,]*)\s*(?:KWD|KD|دينار|د\.ك))/gi

const num = (v: string) => Number(v.replace(/,/g, ''))

/**
 * Prices in the draft that the catalogue does not agree with.
 *
 * Compared numerically, not as strings: "119.5", "119.500" and "119,500" are
 * the same price written three ways, and flagging a formatting difference as a
 * wrong price is how a check loses its credibility.
 */
export function priceDrift(text: string, row: Row): Blocker[] {
  const now = Number(row.price_now)
  const was = Number(row.price_was)
  const known = [now, was].filter((n) => Number.isFinite(n) && n > 0)
  if (!known.length) return []

  const out: Blocker[] = []
  for (const m of text.matchAll(MONEY)) {
    const written = num(m[1] ?? m[2] ?? '')
    if (!Number.isFinite(written)) continue
    // Fils is three decimals; a rounding difference under half a fils is the
    // same price, not a drift.
    if (known.some((k) => Math.abs(k - written) < 0.0005)) continue
    out.push({
      quote: m[0].trim(),
      criterion: 'the price matches the catalogue',
      why: `The catalogue says ${formatKwd(now)}${
        Number.isFinite(was) && was > now ? `, was ${formatKwd(was)}` : ''
      } for ${row.name_en ?? row.sku}.`,
    })
  }
  return out
}

/** Checks that can block, from the guard the studio already uses. */
const BLOCKING = new Set([
  'no invented numbers',
  'no claim taken from a spare column',
  'no unsubstantiable superlative',
  'no comparison to a competitor',
  'no guarantee the company has not made',
  'nothing religious or political',
])

/**
 * What v1 cannot look at, and why.
 *
 * An empty list would read as "everything checked out". Each entry names the
 * thing that is missing rather than the capability, so it doubles as the list
 * of what to go and get.
 */
function notAssessed(lang: 'en' | 'ar', hasHistory: boolean): string[] {
  const out = [
    'trend fit — nothing offline knows what is trending this week',
    'hook, clarity, retention, CTA — advice needs a model, and v1 has none',
  ]
  if (!hasHistory) {
    out.push(
      'how it compares to what worked before — no post history loaded. ' +
        'Export the last 100 posts with captions joined to per-post reach.',
    )
  }
  if (lang === 'ar') {
    out.push(
      'whether the Arabic reads Kuwaiti or reads translated — permanently human. ' +
        'Judge agreement in Arabic is measured near zero on harder tasks, and scale does not fix it.',
    )
  }
  return out
}

/**
 * Review a draft.
 *
 * Returns blockers before fixes because they are different in kind: a fix is a
 * suggestion a person may ignore, a blocker is a reason not to publish.
 */
export async function review(text: string, opts: ReviewOptions = {}): Promise<Review> {
  const lang = opts.lang ?? 'en'
  const body = text.trim()

  if (!body) {
    return {
      verdicts: {}, blockers: [], fixes: [], matched: null,
      not_assessed: ['nothing to review — paste a caption, a script, or a slogan'],
    }
  }

  const hits = await retrieve(body, 1)
  const hit = hits[0] ?? null
  const row = hit?.row ?? null

  const blockers: Blocker[] = []

  // The flagship check. Needs no model and no cleverness.
  if (row) blockers.push(...priceDrift(body, row))

  // Claim safety, reusing the checks the studio approves copy with — one
  // definition of "is this claim safe", not a second one that drifts.
  if (row) {
    for (const c of copyChecks(body, row as Record<string, unknown>)) {
      if (c.pass || !BLOCKING.has(c.name) || !c.span) continue
      // A figure already reported as drifting must not be reported twice under
      // a second name. The customer-facing problem is one problem.
      if (blockers.some((b) => b.quote.includes(c.span as string))) continue
      blockers.push({ quote: c.span, criterion: c.name, why: c.hint ?? '' })
    }
  }

  const verdicts: Record<string, Verdict> = {
    'facts against the catalogue': !row ? 'needs work'
      : blockers.some((b) => b.criterion.startsWith('the price')) ? 'problem' : 'ok',
    'claims and compliance': blockers.some((b) => !b.criterion.startsWith('the price')) ? 'problem' : 'ok',
  }

  // Ranked: a wrong price outranks a superlative, because one is a number the
  // customer will be charged and the other is a word.
  const fixes: Fix[] = blockers
    .slice(0, 3)
    .map((b) => ({
      quote: b.quote,
      change: b.criterion.startsWith('the price')
        ? `Use ${formatKwd(row?.price_now)}, or re-check the sheet.`
        : 'Remove it, or say something the catalogue can back.',
      why: b.why,
      criterion: b.criterion,
    }))

  return {
    verdicts,
    blockers,
    fixes,
    not_assessed: notAssessed(lang, false),
    matched: hit ? { sku: hit.sku, name: String(hit.row.name_en ?? hit.sku), confidence: hit.why } : null,
  }
}
