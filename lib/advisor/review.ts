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

import { check as copyChecks, hasArabic, normaliseArabic } from '@/lib/content/guard'
import { formatKwd } from '@/lib/money'
import { retrieve, type Hit, type Row } from '@/lib/rag/retrieve'

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
  matched: { sku: string; name: string; confidence: 'sku' | 'category' | 'lexical' | 'meaning' } | null
  /**
   * Other rows that hold a price this draft quotes, when the retriever's first
   * choice was not the only plausible one. Empty in the ordinary case.
   *
   * A question, not a finding: `missing()` in converse.ts turns it into "which
   * of these is it?", because a figure the catalogue holds is never invented.
   */
  ambiguous: { sku: string; name: string }[]
}

export type ReviewOptions = {
  channel?: string
  lang?: 'en' | 'ar'
  /**
   * The row to check against, when a person has said which product this is.
   *
   * Retrieval exists to guess at that question; a person answering it settles
   * it, so nothing is retrieved and the checks run against the row they chose.
   * That also makes the deterministic half answer with Ollama stopped — no
   * embedding call — which is exactly when somebody most needs it to.
   */
  row?: Row
}

/** A figure a person typed that looks like money. `19.900 KD`, `KD 19.9`, `129KD`. */
const MONEY = /(?:(?:KWD|KD|د\.ك|دينار)\s*([\d][\d.,]*)|([\d][\d.,]*)\s*(?:KWD|KD|دينار|د\.ك))/gi

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
  text: string, row: Row,
): { drift: Blocker[]; verified: string[]; unjudged: string[] } {
  const spans = [...text.matchAll(MONEY)].map((m) => m[0].trim())
  const now = Number(row.price_now)
  const was = Number(row.price_was)
  // This row's own two prices, and nothing else. A second retrieved row used to
  // be folded in here to suppress false drift on multi-product drafts — but the
  // multi-figure rule below already does that job, and folding meant any figure
  // matching any of six prices from three loosely-related rows was accepted
  // while the screen said "Checked against <the one row>."
  const known = [now, was].filter((n) => Number.isFinite(n) && n > 0)
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
  //
  // Except when every figure is one of THIS row's own prices. "Was 40.500 KD,
  // now 19.900 KD" is one product written the way the strongest-performing
  // offer in electronics is always written, and declining to judge it — while
  // announcing that the two prices belong to different products — was wrong on
  // every sale caption the team writes.
  const own = moneyFigures(text).map(Number)
  if (own.length > 1 && !own.every((f) => known.some((k) => Math.abs(k - f) < 0.0005))) {
    return { drift: [], verified: [], unjudged: spans }
  }

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

  // A figure written without its unit, equal to a price this row holds. "was
  // 40.500 now 19.900 KD" writes the unit once; the struck figure is then not
  // money to the regex above, and the copy guard called the row's own
  // pre-discount price an invented number and blocked the caption.
  for (const m of text.matchAll(/\d[\d.,]*/g)) {
    const v = num(m[0])
    if (Number.isFinite(v) && known.some((k) => Math.abs(k - v) < 0.0005)) verified.push(m[0])
  }

  return { drift, verified, unjudged: [] }
}

/** Prices in the draft that the catalogue does not agree with. */
export function priceDrift(text: string, row: Row): Blocker[] {
  return scanPrices(text, row).drift
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
function notAssessed(
  lang: 'en' | 'ar', hasHistory: boolean, manyPrices = false, arabic = false, contested: string[] = [],
): string[] {
  const out = [
    'trend fit — nothing offline knows what is trending this week',
    // True of the CHECKS, which is what this function is. When the model layer
    // answers, converse.ts drops this line rather than leaving it contradicting
    // the note printed directly above it.
    'hook, clarity, retention, CTA — not something a check can decide. The advisor answers these in its written note, which needs the model running.',
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
  if (contested.length) {
    out.push(
      `the price — the catalogue holds it for ${contested.join(' and ')}, which is not the row ` +
        'this draft matched. Say which product it is for and the price gets checked against that one.',
    )
  }
  if (lang === 'ar') {
    out.push(
      'whether the Arabic reads Kuwaiti or reads translated — permanently human. ' +
        'Judge agreement in Arabic is measured near zero on harder tasks, and scale does not fix it.',
    )
  }
  if (arabic) {
    // Said whether or not the checks found something, because "ok" on Arabic
    // used to mean "no English patterns matched" and read as "this is fine".
    // The Arabic vocabulary is a curated list, not the parity the guardrails
    // ask for, and the difference belongs on screen rather than in a comment.
    out.push(
      'the full range of Arabic claim wording — superlatives, guarantees and religious framing ' +
        'are matched against a curated list of terms, not the complete vocabulary the English ' +
        'checks cover. A clean result here is weaker evidence than a clean result in English.',
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
  // Normalised once, at the door. Arabic-Indic digits are invisible to every
  // check below, and the alef forms make the same word two words. Everything
  // downstream — retrieval, the price scan, the quoted spans — reads this copy,
  // so what is judged is what is quoted back.
  const body = (hasArabic(text) ? normaliseArabic(text) : text).trim()

  if (!body) {
    return {
      verdicts: {}, blockers: [], fixes: [], matched: null, ambiguous: [],
      not_assessed: ['nothing to review — paste a caption, a script, or a slogan'],
    }
  }

  const pinned = opts.row ?? null
  // The money is stripped from the retrieval query. Measured: "the fastest
  // charger we sell" alone scores 0.461 and correctly declines to match, while
  // the same sentence "for 12.000 KD" scores 0.500 lexically against an Anker
  // cable — the figure you asked to have checked was promoting the row that
  // then failed it. Advisor only; the chatbot's retrieval, where a customer
  // typing a model number is meaningful, is untouched.
  const hits = pinned ? [] : await retrieve(body.replace(MONEY, ' '), 3)
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
  // Every reason is gated, not only `meaning`. A lexical hit was accepted at any
  // strength, so eight mostly-generic words matched an Anker cable at 0.500 and
  // the advisor issued a specific, authoritative, wrong "Do not publish" naming
  // an unrelated product's price. A CATEGORY hit is refused outright: retrieval
  // returns every row on the shelf at relevance 1, so whichever landed first
  // became the row a price was judged against. A category can find a product;
  // it can never be the row a fact is checked against.
  // ponytail: two thresholds tuned on this one catalogue — revisit if the sheet
  // changes shape. Measured, money stripped from the query first:
  //   "Grab the Apple Pencil 1st generation for only ..."  lexical 0.625  — a real match
  //   "the fastest charger we sell — grab it for ..."      lexical 0.500  — no product at all
  // 0.58 sits between them. Below it a draft is not placed, and `missing()` in
  // converse.ts asks which product it is for, which costs the reader one answer
  // and costs nothing when they decline.
  const FLOOR: Record<Hit['why'], number> = {
    sku: 0, lexical: 0.58, meaning: CONFIDENT, category: Infinity,
  }
  const hit: { sku: string; row: Row; why: Hit['why'] } | null = pinned
    ? { sku: String(pinned.sku ?? ''), row: pinned, why: 'sku' }
    : top && relevance >= FLOOR[top.why] ? top : null
  const row = hit?.row ?? null

  const blockers: Blocker[] = []

  // The flagship check. Needs no model and no cleverness.
  const prices = row
    ? scanPrices(body, row)
    : { drift: [], verified: [] as string[], unjudged: [] as string[] }

  // The other rows the retriever thought plausible. Not folded into the prices
  // this draft is checked against — D32 records why that was wrong — but used
  // for one question only: does anybody else hold the figure being called
  // invented? Measured, money stripped from the query first:
  //   "Best deal in Kuwait! Apple Pencil now only ..."  meaning 0.530  2nd gen, 39.900
  //                                                     meaning 0.528  1st gen, 19.900
  // Two thousandths of relevance picked which Pencil the shop's own correct
  // 19.900 was declared a fabrication against, at the weakest match tier there
  // is. A figure the catalogue holds is never an invented figure; it is an
  // unanswered question about which product this is, and `missing()` in
  // converse.ts asks it. An exact SKU and a row a person pinned settle that
  // question themselves, so neither has rivals.
  const rivals = hit && hit.why !== 'sku'
    ? hits.filter((h) => h.sku !== hit.sku && h.relevance >= FLOOR[h.why])
    : []
  const holds = (r: Row, v: number) =>
    [Number(r.price_now), Number(r.price_was)].some((k) => Number.isFinite(k) && Math.abs(k - v) < 0.0005)
  const contested = prices.drift.filter((b) => {
    const v = Number(moneyFigures(b.quote)[0])
    return Number.isFinite(v) && rivals.some((h) => holds(h.row, v))
  })
  const alternatives = rivals.filter((h) =>
    contested.some((b) => holds(h.row, Number(moneyFigures(b.quote)[0]))),
  )

  blockers.push(...prices.drift.filter((b) => !contested.includes(b)))

  // Scrubbed, not filtered. `bareDigits` reports the FIRST offending span and
  // nothing else, so filtering the result afterwards meant a correct price
  // consumed the whole check: "Only 19.900 KD — the first 50 customers get a
  // free case" came back green, and so did "that is 51% off". Removing the
  // verified figures from the text first leaves the rest to be caught. The
  // spans are literal substrings of `body`, so removing them is safe.
  const scrubbed = [...prices.verified, ...prices.unjudged, ...contested.map((b) => b.quote)]
    .reduce((t, span) => t.split(span).join(' '), body)

  // Claim safety, reusing the checks the studio approves copy with — one
  // definition of "is this claim safe", not a second one that drifts. The claim
  // half runs whether or not a product was matched.
  for (const c of copyChecks(scrubbed, (row ?? {}) as Record<string, unknown>)) {
    const wanted = row ? CLAIM_CHECKS.has(c.name) || FACT_CHECKS.has(c.name) : CLAIM_CHECKS.has(c.name)
    if (c.pass || !wanted || !c.span) continue
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
    // `prices.unjudged`, not a second count of the figures: scanPrices now
    // verifies a was/now pair belonging to this row, and re-deriving "more than
    // one price" here said "needs work" on a draft it had just checked.
    'facts against the catalogue': factProblem ? 'problem'
      : !row || prices.unjudged.length || contested.length ? 'needs work' : 'ok',
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
    not_assessed: notAssessed(
      lang, false, prices.unjudged.length > 0, hasArabic(body),
      alternatives.map((h) => String(h.row.name_en ?? h.sku)),
    ),
    matched: hit ? { sku: hit.sku, name: String(hit.row.name_en ?? hit.sku), confidence: hit.why } : null,
    ambiguous: alternatives.map((h) => ({ sku: h.sku, name: String(h.row.name_en ?? h.sku) })),
  }
}
