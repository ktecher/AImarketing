/**
 * The advisor, as a conversation.
 *
 * `review.ts` is unchanged and stays the ground truth: string operations and
 * catalogue lookups, no model, nothing to hallucinate. This module wraps it and
 * adds the two things a person actually wanted from an advisor and could not
 * get from a checklist — it ASKS when it cannot tell what it is looking at, and
 * it ANSWERS on the things v1 listed under "not looked at": hook, clarity, call
 * to action, what to cut.
 *
 * The split is the point. Anything checkable is checked in TypeScript and the
 * model is shown the result so it cannot contradict it. The model supplies
 * phrasing and judgement about the writing, and never a figure: rule 2 holds
 * here exactly as it holds in the studio, and its rewrites go through the same
 * `check()` the studio approves copy with — one definition of a safe line, not
 * a second one that drifts.
 *
 * What it still is not: a grader. Rule 4 — no aggregate, no score, no rating.
 * The verdicts stay the binary named checks review.ts already produced.
 */

import { z } from 'zod'
import { generate, generateJson, isQuoted, MODELS } from '@/lib/ai/generate'
import { blockers, check, type Check } from '@/lib/content/guard'
import { CHANNELS, type Channel } from '@/lib/content/studio'
import { type Row } from '@/lib/rag/retrieve'
import { moneyFigures, review, type Review, type ReviewOptions } from './review'

/** Bump when the prompt changes, so an old answer stays explicable. */
export const ADVISOR_PROMPT_VERSION = 'advisor/v2'

/** One side of the conversation. `you` is the person; `advisor` is this module. */
export type Turn = { role: 'you' | 'advisor'; text: string }

/**
 * A line the advisor proposes in place of one you wrote.
 *
 * `instead_of` is verified to exist in the draft before it is shown — a rewrite
 * of a sentence you never wrote is the advisor inventing the thing it is
 * reviewing. `checks` is the studio's guard run over the replacement, so a
 * suggestion carrying an invented price arrives visibly blocked rather than
 * quietly copied into a caption.
 */
export type Rewrite = { instead_of: string; write: string; checks: Check[] }

export type Answer = {
  /** The deterministic half, unchanged. */
  review: Review
  /** What the advisor says this turn. Prose, no figures. */
  say: string
  /** What it needs before it can say more. Empty when nothing is missing. */
  asks: string[]
  rewrites: Rewrite[]
  /** Checks the advisor's own prose failed. Shown, never silently swallowed. */
  caution: Check[]
  /** Set when the model could not be reached. The checks above still ran. */
  offline?: string
  model: string
  prompt_version: string
}

/**
 * What the advisor cannot work out on its own.
 *
 * Computed in TypeScript, not asked of the model, because every one of these is
 * a fact about the request rather than a judgement: either a row was matched or
 * it was not. A model asked to notice its own missing context will sometimes
 * notice and sometimes confidently proceed, and the second one is the failure.
 */
function missing(draft: string, r: Review, opts: { channel?: string; pinned: boolean }): string[] {
  const out: string[] = []
  if (!r.matched && !opts.pinned) {
    out.push(
      'Which product is this for? Name it or paste its SKU. Without a row I cannot check a ' +
      'single price or spec — only the wording.',
    )
  }
  if (!opts.channel) {
    out.push('Where is this going — Instagram, Snapchat or TikTok? The advice is different for each.')
  }
  if (moneyFigures(draft).length > 1) {
    out.push(
      'This draft carries more than one price, and each belongs to a different product. ' +
      'Which is which? I will not guess at it.',
    )
  }
  return out
}

/**
 * What the model may know about the product: its identity, and nothing numeric.
 *
 * Same reasoning as the studio's fact sheet — a figure the model has seen is a
 * figure it will paraphrase into advice, and advice gets pasted into captions.
 */
function identity(row: Row | null): string {
  if (!row) return 'No product row. Say nothing about price, specs, stock or availability.'
  const keep = ['display_name', 'name_en', 'brand', 'category']
  const lines = keep
    .map((k) => [k, row[k]] as const)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}: ${v}`)
  lines.push('Prices and specs exist but are deliberately not shown to you. Never write a figure.')
  return lines.join('\n')
}

/**
 * The checks that already ran, so the model cannot contradict or repeat them.
 *
 * The rejected spans are listed twice on purpose — once with their reason, once
 * as a bare do-not-touch list. Given only the first, gemma4 opened a review of
 * a draft saying "Best stylus in Kuwait, guaranteed" with *the "best" claim
 * works well here because it establishes authority without being a prohibited
 * superlative*, directly above the blocker saying otherwise, and then reused the
 * word in a replacement line. An advisor that praises what the checks reject is
 * worse than one that says nothing: the reader believes the friendlier half.
 */
function findings(r: Review): string {
  if (!r.blockers.length) return 'The automatic checks found nothing. Do not invent a problem to have one.'
  const spans = r.blockers.map((b) => `"${b.quote}"`).join(', ')
  return [
    'Checks that ALREADY RAN in code and are already on screen. Treat them as settled,',
    'do not repeat them back, and never disagree with one:',
    ...r.blockers.map((b) => `- "${b.quote}" — ${b.criterion}. ${b.why}`),
    '',
    `These exact words are REJECTED and are being removed from the draft: ${spans}.`,
    'Do not call any of them good, effective, confident or acceptable — they are not, and',
    'a person is reading your answer directly above the list that rejects them.',
    'Do not use any of them in a line you suggest, in any form.',
  ].join('\n')
}

const AdviceSchema = z.object({
  /** At most one, and only when something is genuinely unclear. */
  questions: z.array(z.string()).max(2),
  rewrites: z.array(z.object({ instead_of: z.string(), write: z.string() })).max(3),
})

/**
 * One turn.
 *
 * Two model calls, prose then structure, for the reason CLAUDE.md gives:
 * grammar-constrained decoding measurably degrades writing, so the judgement is
 * written freely and a second cheap call pulls the rewrites out of it.
 *
 * The model failing is not the request failing. Everything above it is
 * deterministic, so a stopped Ollama returns the checks with `offline` set
 * rather than an error page — the half that works is the half people rely on.
 */
export async function converse(
  draft: string,
  turns: Turn[],
  opts: ReviewOptions & { channel?: Channel } = {},
): Promise<Answer> {
  const r = await review(draft, opts)
  const row = opts.row ?? null
  const asks = missing(draft, r, { channel: opts.channel, pinned: Boolean(opts.row) })

  // v1 listed hook, clarity, retention and CTA as "not looked at" because it had
  // no model. It has one now, so leaving the line up would be the stale-doc
  // failure wearing a UI: it would tell somebody nothing was said about the
  // thing the answer below is entirely about.
  const notAssessed = r.not_assessed.filter((n) => !n.startsWith('hook, clarity'))

  const base = [
    'You are a senior creative director at a consumer electronics retailer in Kuwait.',
    'A colleague has written a draft and wants your read on it. You are not a checker —',
    'code already did the checking. You judge the WRITING.',
    '',
    'THE DRAFT:',
    draft,
    '',
    'THE PRODUCT:',
    identity(row),
    '',
    findings(r),
    opts.channel ? `\nCHANNEL — ${CHANNELS[opts.channel].label}. ${CHANNELS[opts.channel].brief}` : '',
    turns.length ? `\nWHAT WE HAVE SAID SO FAR:\n${turns.map((t) => `${t.role}: ${t.text}`).join('\n')}` : '',
    '',
    'NEVER WRITE A NUMBER — not a price, not a percentage, not a spec, not a year.',
    'Where a figure belongs in a line you suggest, write {price_now}, {price_was} or',
    '{discount_pct} and the catalogue fills it in.',
    'Nothing religious or political, as a topic or as an angle.',
  ].filter(Boolean).join('\n')

  let prose: string
  try {
    prose = await generate(
      `${base}\n\n` +
        'Give your read in under 120 words. Say the one thing that is working, then the ' +
        'biggest problem with the opening line, then whether the call to action is doing ' +
        'anything. Name what to cut. Talk to the person, not about the draft. No lists, ' +
        'no headings, no preamble.\n\n' +
        'Where you say a line should change, WRITE THE REPLACEMENT OUT in full, in quotes, ' +
        'ready to publish as it stands. "Open with something about creativity" is not a ' +
        'replacement — it is homework. Give them the sentence.' +
        (asks.length
          ? '\n\nThey have not told you which product or channel this is for. Say what you can ' +
            'about the wording anyway — the missing pieces are being asked for separately, so ' +
            'do not ask for them again.'
          : ''),
      // Judgement about writing, phrased for a person. At 0 it produces the same
      // three sentences for every draft, which reads as a template and gets ignored.
      { temperature: 0.6 },
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : ''
    return {
      review: { ...r, not_assessed: r.not_assessed },
      say: '',
      asks,
      rewrites: [],
      caution: [],
      offline: /fetch failed|ECONNREFUSED/i.test(msg)
        ? 'Ollama is not answering, so there is no written advice this turn. The checks below ran anyway — they need no model.'
        : 'The model failed this turn. The checks below ran anyway.',
      model: MODELS.english,
      prompt_version: ADVISOR_PROMPT_VERSION,
    }
  }

  // The structuring pass. Small, cheap, and separate — it pulls out the concrete
  // suggestions without the constraint touching the prose above.
  let extracted: z.infer<typeof AdviceSchema>
  try {
    extracted = await generateJson(
      'Pull the concrete suggestions out of this creative note.\n\n' +
        'rewrites: only where the note WROTE OUT a replacement line. `instead_of` must be copied ' +
        'WORD FOR WORD from the draft below; `write` must be the finished line, publishable as ' +
        'it stands. If the note only describes a change — "a hook about creativity", "something ' +
        'punchier" — that is not a replacement: return no rewrite rather than passing the ' +
        'description off as one.\n' +
        'questions: only what the note genuinely still needs answered. Usually none.\n' +
        'Never write a digit in either field.\n\n' +
        `THE DRAFT:\n${draft}\n\nTHE NOTE:\n${prose}`,
      AdviceSchema,
      z.toJSONSchema(AdviceSchema),
      { maxTokens: 600 },
    )
  } catch {
    // Unusable JSON twice loses the suggestions, not the advice. The prose is
    // the answer; the rewrites are a convenience on top of it.
    extracted = { questions: [], rewrites: [] }
  }

  // Grounding, in TypeScript: a rewrite of a line that is not in the draft is
  // the advisor reviewing something it made up. Never ask the model to confirm
  // its own quote.
  const rewrites: Rewrite[] = extracted.rewrites
    .filter((w) => w.instead_of.trim() && w.write.trim() && isQuoted(w.instead_of.trim(), draft))
    // "A hook about creativity" is an instruction wearing a suggestion's clothes,
    // and it arrived with a Copy button beside it. A replacement line is at least
    // a few words and is not phrased as a noun the person is meant to go and
    // write; anything shorter than four words is the description, not the line.
    .filter((w) => w.write.trim().split(/\s+/).length >= 4)
    // "Shop the Apple Pencil at [Store Name] today." — a fill-in-the-blank the
    // guard cannot see, because it checks braces and this is brackets. It sits
    // under a Copy button, so it is one click from a live caption.
    .filter((w) => !/\[[^\]]+\]/.test(w.write))
    .map((w) => ({
      instead_of: w.instead_of.trim(),
      write: w.write.trim(),
      checks: check(w.write.trim(), (row ?? {}) as Record<string, unknown>),
    }))

  return {
    review: { ...r, not_assessed: notAssessed },
    say: prose,
    // The model's question comes after the ones we worked out ourselves, and
    // only when we had none: two sources of "tell me more" in one turn is a
    // form to fill in, not a conversation.
    asks: asks.length ? asks : extracted.questions.filter((q) => q.trim().endsWith('?')).slice(0, 1),
    rewrites,
    // The advisor's own prose held to the same rule as the copy it reviews.
    // Shown rather than swallowed: a figure in advice gets pasted into a caption.
    //
    // Except a figure it quoted back out of the draft. "Cut the 129 KD from the
    // opening line" is the advice working, and warning that the catalogue never
    // supplied 129 KD — when the whole point is that it did not — is the check
    // crying wolf on the one thing it got right. review.ts learned this about
    // verified prices; it is the same lesson one layer out.
    // Every rule the copy it reviews is held to, not just two of them.
    // `findings()` can only forbid spans the checks ALREADY rejected, so on a
    // clean draft the model was unconstrained — free to suggest "the best cable
    // we sell, guaranteed" in prose sitting above a panel that blocks exactly
    // that wording in a caption.
    caution: blockers(check(prose, (row ?? {}) as Record<string, unknown>))
      .filter((c) => c.name !== 'every placeholder is a real field' && c.name !== 'every placeholder has a value')
      .filter((c) => !(c.span && draft.includes(c.span))),
    model: MODELS.english,
    prompt_version: ADVISOR_PROMPT_VERSION,
  }
}
