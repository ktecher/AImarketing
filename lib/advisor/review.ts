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
/** Distinct money figures a person typed. Two means two products, usually. */
export function moneyFigures(text: string): string[] {
  return [...new Set([...text.matchAll(MONEY)].map((m) => String(num(m[1] ?? m[2] ?? ''))))]
}

/**
 * One scan, two views: which written prices the catalogue agrees with, and
 * which it does not. Two scans would be the duplication D32/D38/D39 record.
 */
function scanPrices(
  text: string, row: Row, alsoKnown: Row[],
): { drift: Blocker[]; verified: string[]; unjudged: string[] } {
  const spans = [...text.matchAll(MONEY)].map((m) => m[0].trim())
  const now = Number(row.price_now)
  const was = Number(row.price_was)
  const known = [now, was, ...alsoKnown.flatMap((r) => [Number(r.price_now), Number(r.price_was)])]
    .filter((n) => Number.isFinite(n) && n > 0)
  if (!known.length) return { drift: [], verified: [], unjudged: spans }

  // Two prices in one draft means two products, and retrieval returns one. The
  // Apple Pencil's correct 19.900 was reported as drift because the draft also
  // named the AirPods and the AirPods won the match. Declining to guess is the
  // only honest option: a check that flags a correct price is one people learn
  // to click past, and then the wrong price gets through too.
  //
  // Those figures come back as `unjudged`, not as nothing: saying "we cannot
  // check your prices" while a second check calls one of them invented is two
  // answers to one question, and the reader believes the harsher one.
  if (moneyFigures(text).length > 1) return { drift: [], verified: [], unjudged: spans }

  const drift: Blocker[] = []
  const verified: string[] = []
  const seen = new Set<number>()
  for (const m of text.matchAll(MONEY)) {
    const written = num(m[1] ?? m[2] ?? '')
    if (!Number.isFinite(written)) continue
    // Fils is three decimals; a rounding difference under half a fils is the
    // same price, not a drift.
    if (known.some((k) => Math.abs(k - written) < 0.0005)) { verified.push(m[0].trim()); continue }
    // The same wrong price written twice is one problem, not two.
    if (seen.has(written)) continue
    seen.add(written)
    drift.push({
      quote: m[0].trim(),
      criterion: 'the price matches the catalogue',
      why: `The catalogue says ${formatKwd(now)}${
        Number.isFinite(was) && was > now ? `, was ${formatKwd(was)}` : ''
      } for ${row.name_en ?? row.sku}.`,
    })
  }
  return { drift, verified, unjudged: [] }
}

/** Prices in the draft that the catalogue does not agree with. */
export function priceDrift(text: string, row: Row, alsoKnown: Row[] = []): Blocker[] {
  return scanPrices(text, row, alsoKnown).drift
}

/**
 * Checks that can block, split by what they need.
 *
 * The claim checks are pure text — a superlative is a superlative whether or
 * not we worked out which product the draft is about. Gating them behind a
 * product match meant a caption the retriever could not place got no safety
 * check at all, which is the worst case to be silent in.
 */
const CLAIM_CHECKS = new Set([
  'no unsubstantiable superlative',
  'no comparison to a competitor',
  'no guarantee the company has not made',
  'nothing religious or political',
])
const FACT_CHECKS = new Set([
  'no invented numbers',
  'no claim taken from a spare column',
])

/**
 * What v1 cannot look at, and why.
 *
 * An empty list would read as "everything checked out". Each entry names the
 * thing that is missing rather than the capability, so it doubles as the list
 * of what to go and get.
 */
function notAssessed(lang: 'en' | 'ar', hasHistory: boolean, manyPrices = false): string[] {
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
  if (manyPrices) {
    out.push(
      'the prices — this draft carries more than one, and each belongs to a different product. ' +
        'Review one product at a time to have them checked.',
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

  const hits = await retrieve(body, 3)
  // A draft the retriever could only place by meaning, and weakly, is a draft
  // we have not placed. Measured on this catalogue: text about no product at
  // all tops out around 0.43, a real product mention runs 0.50-0.58. Telling
  // somebody their price is wrong against a product they were not writing
  // about is the single fastest way to make them stop reading these.
  // ponytail: one tuned threshold on one catalogue — revisit if the sheet changes shape.
  const CONFIDENT = 0.47
  // Destructured to `relevance`: rule 4 keeps the word "score" out of the
  // advisor entirely, and the test greps for it. This is retrieval distance,
  // not a judgement about the draft — but a field nobody can name is a field
  // nobody can hallucinate into, which is the whole point of the rule.
  const top = hits[0] ?? null
  const relevance = top?.relevance ?? 0
  const hit = top && (top.why !== 'meaning' || relevance >= CONFIDENT) ? top : null
  const row = hit?.row ?? null

  const blockers: Blocker[] = []

  // The flagship check. Needs no model and no cleverness.
  const prices = row
    ? scanPrices(body, row, hits.slice(1).map((h) => h.row))
    : { drift: [], verified: [] as string[], unjudged: [] as string[] }
  blockers.push(...prices.drift)

  // Claim safety, reusing the checks the studio approves copy with — one
  // definition of "is this claim safe", not a second one that drifts. The claim
  // half runs whether or not a product was matched.
  for (const c of copyChecks(body, (row ?? {}) as Record<string, unknown>)) {
    const wanted = row ? CLAIM_CHECKS.has(c.name) || FACT_CHECKS.has(c.name) : CLAIM_CHECKS.has(c.name)
    if (c.pass || !wanted || !c.span) continue
    // A price the catalogue AGREES with is verified, not invented. The copy
    // guard exists to stop a model writing a figure at all; a person reviewing
    // their own draft has every right to type the correct price, and calling it
    // an invented number is the check crying wolf on the one thing it got right.
    if ([...prices.verified, ...prices.unjudged].some((v) => v.includes(c.span as string))) continue
    // A figure already reported as drifting must not be reported twice under
    // a second name. The customer-facing problem is one problem.
    if (blockers.some((b) => b.quote.includes(c.span as string))) continue
    blockers.push({ quote: c.span, criterion: c.name, why: c.hint ?? '' })
  }

  // Grouped by what the check is about, not by which list it came from. A spec
  // figure the catalogue cannot back is a fact problem; a superlative is a
  // claim problem. Filing one under the other tells the reader to look in the
  // wrong place.
  const factProblem = blockers.some(
    (b) => b.criterion.startsWith('the price') || FACT_CHECKS.has(b.criterion),
  )
  const claimProblem = blockers.some((b) => CLAIM_CHECKS.has(b.criterion))

  const verdicts: Record<string, Verdict> = {
    'facts against the catalogue': factProblem ? 'problem'
      : !row || moneyFigures(body).length > 1 ? 'needs work' : 'ok',
    'claims and compliance': claimProblem ? 'problem' : 'ok',
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
    not_assessed: notAssessed(lang, false, moneyFigures(body).length > 1),
    matched: hit ? { sku: hit.sku, name: String(hit.row.name_en ?? hit.sku), confidence: hit.why } : null,
  }
}
