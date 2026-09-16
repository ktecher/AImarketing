/**
 * The campaign meeting: the planner that interviews before it advises.
 *
 * `suggest()` in lib/campaigns.ts stays, and stays the fast path — a rough idea
 * in, a brief out, one call. What it cannot do is ask. It never learns what is
 * special about the phone, it does not know what the shop is willing to spend,
 * and it has no opinion about how that money should be divided, because nobody
 * ever told it. A form cannot ask a follow-up question.
 *
 * This module is the meeting instead. The person opens with the idea; every
 * planner turn reads back what it understood, asks the ONE question that would
 * most change its advice, and says what it would do with what it knows so far.
 * The person decides when it is finished, not a slot counter.
 *
 * Three things are load-bearing and none of them are the model:
 *
 * **The slots are filled by a constrained call and chosen by TypeScript.** Which
 * question to ask next is a fact about what is missing, not a judgement — and a
 * model asked to notice its own missing context sometimes notices and sometimes
 * confidently proceeds. `converse.ts` learned this; `nextSlot()` is the same
 * lesson.
 *
 * **The suggested answers are derived, never generated.** They come from the
 * closed lists this project already owns and from the catalogue rows retrieval
 * actually returned. That is what makes them answerable — and it costs no third
 * model call on a turn a person is waiting through.
 *
 * **Every digit belongs to TypeScript.** The model proposes a spend as weight
 * WORDS and `split()` in lib/spend.ts turns them into fils. CLAUDE.md rule 2 is
 * not bent here, it is routed around: see the comment on `plan()`.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { generate, generateJson, generateStream, MODELS } from '@/lib/ai/generate'
import { blockers, check, isProductIdentity, normaliseArabic } from '@/lib/content/guard'
import { retrieve } from '@/lib/rag/retrieve'
import { campaignProducts } from '@/lib/template/columns'
import { composeContext, OBJECTIVES, OFFER_MECHANICS, SLOTS, type Slot } from '@/lib/brief'
// `shelf` lives in lib/campaigns.ts because `suggest()` there had the identical
// function and the identical bug — an empty shelf printed as an ABSENT line, so
// the planner was told nothing rather than told nothing matched. One copy now.
import { WEEKEND, guardrails, list as listCampaigns, report, shelf, whereInTheYear } from '@/lib/campaigns'
import { readKnowledge } from '@/lib/kuwait'
import { LINE_ITEMS, WEIGHTS, split, type PlanLine, type SpendLine } from '@/lib/spend'
import type { Check } from '@/lib/content/guard'

/** Bump when the prompt changes, so an old plan stays explicable. */
export const MEETING_PROMPT_VERSION = 'meeting/v1'

/* ── What the meeting is trying to find out ──────────────────────────────── */

// Defined in lib/brief.ts, not here, and re-exported so server callers read the
// same names. That file has no dependencies; this one reaches `pg` through
// lib/campaigns.ts, and the meeting's screen is a client component — importing
// SLOTS from here put a Postgres driver in the browser bundle. See D92.
export { OBJECTIVES, SLOTS, type Slot } from '@/lib/brief'

/**
 * Channels the plan may name, online and off.
 *
 * The offline half is here because the person may already have booked a mall
 * screen and a plan that cannot allocate to it is useless. What the planner may
 * NOT do is assert anything about Kuwaiti out-of-home — there is nothing in
 * knowledge/kuwait/ about billboards, malls, events, cinema or radio, and a
 * model asked about them invents reach figures and costs. Naming a channel is
 * structural; claiming it reaches forty thousand people is rule 3's failure.
 * The prompt says so explicitly and `ONLY_IF_OFFERED` is why they are asked for.
 */
export const CHANNEL_OPTIONS = [
  'Snapchat', 'Instagram', 'TikTok', 'YouTube', 'X',
  'Mall activation', 'Print', 'Radio', 'Cinema', 'In-store',
] as const

/* ── The record ──────────────────────────────────────────────────────────── */

/** One side of the meeting. `you` is the person; `planner` is this module. */
export type Turn = { role: 'you' | 'planner'; text: string; at: string }

export type Meeting = {
  id: string
  /** Set once the campaign is created. Null while this is still a meeting. */
  campaign_id: string | null
  started_at: string
  turns: Turn[]
  /** What the planner has established. Filled in any order, never cleared. */
  known: Partial<Record<Slot, string>>
  plan: Plan | null
  model: string
  prompt_version: string
}

/** What one turn hands back to the screen. */
export type Ask = { slot: Slot; question: string; suggestions: string[] }

export type Plan = {
  /** What to call the campaign. Stamped on every design and caption made under it. */
  name: string
  objective: string
  /** The single-minded proposition. One sentence, one idea. */
  say: string
  audience: string
  offer: string
  channels: { channel: string; role: string }[]
  /** Every figure here was computed by TypeScript from the person's own total. */
  spend: SpendLine[]
  /** The total the PERSON typed, echoed back so the split can be checked by eye. */
  budget: string
  /** When it runs, in words. Never a date range — that is a scheduling column. */
  shape: string
  measure: string[]
  /**
   * The date on the trends file this plan was written against, or null.
   * timely/README.md is explicit that this is displayed, not hidden.
   */
  kuwait_context_as_of: string | null
  /** Figures the model wrote. Shown to the person, never quietly kept. */
  invented: string[]
  /** Checks the planner's own prose failed. Shown, never swallowed. */
  caution: Check[]
  /**
   * The planner thinking out loud, from the free call that the constrained call
   * is then written against.
   *
   * This was generated and thrown away. It is the only place the reasoning
   * behind the plan exists — the fields below are its conclusions — so it is
   * kept and shown folded. Optional because plans written before this existed
   * are still on disk.
   *
   * NOT run through `figuresIn`. It is working-out, not copy: it never reaches
   * a caption, a design, or `campaigns.context`, and warning about a figure in
   * a paragraph nobody can edit would be a warning that teaches people to
   * ignore the next one. The screen says as much where it renders it.
   */
  reasoning?: string
  model: string
  prompt_version: string
}

/* ── On disk ─────────────────────────────────────────────────────────────── */

/**
 * Files, beside chat and the content studio, for the same reason they are:
 * this is the size of system where a table is a migration nobody needed.
 *
 * And deliberately NOT a column on `campaigns`. CLAUDE.md §6: campaigns are
 * four columns, guarded against a future self, because the fifth column is
 * always the start of a CRM. The meeting is the record; `context` is the
 * handoff, composed once when the campaign is created.
 */
const dir = () => join(process.cwd(), 'data/state/meeting')
const pathFor = (id: string) => join(dir(), `${id}.json`)

/** Ids are filenames. A traversal here would read or write anywhere on disk. */
const safe = (id: string) => /^[A-Za-z0-9_-]{1,64}$/.test(id)

export function load(id: string): Meeting | null {
  if (!safe(id) || !existsSync(pathFor(id))) return null
  try {
    return JSON.parse(readFileSync(pathFor(id), 'utf8')) as Meeting
  } catch {
    return null
  }
}

export function save(m: Meeting): void {
  if (!safe(m.id)) throw new Error('Bad meeting id.')
  mkdirSync(dir(), { recursive: true })
  writeFileSync(pathFor(m.id), JSON.stringify(m, null, 2))
}

export function start(id: string): Meeting {
  return {
    id,
    campaign_id: null,
    started_at: new Date().toISOString(),
    turns: [],
    known: {},
    plan: null,
    model: MODELS.english,
    prompt_version: MEETING_PROMPT_VERSION,
  }
}

/**
 * Throw a meeting away.
 *
 * Irreversible and deliberately so — the point of the button above it is that a
 * conversation which went nowhere should leave nothing behind. What it must NOT
 * do is take a campaign with it: `create` writes a row to Postgres and stamps it
 * on everything made afterwards, and that row does not know this file exists.
 * The screen only offers deletion while `campaign_id` is null, and this refuses
 * it otherwise rather than trusting the screen to remember.
 *
 * Returns false when there was nothing to delete, so a double-click reports
 * honestly instead of claiming to have removed something twice.
 */
export function remove(id: string): boolean {
  if (!safe(id) || !existsSync(pathFor(id))) return false
  const m = load(id)
  if (m?.campaign_id) {
    throw new Error('This meeting made a campaign. Delete the campaign instead — the meeting is how it got made.')
  }
  unlinkSync(pathFor(id))
  return true
}

/** Newest first. The screen lists these so a meeting can be walked away from. */
export function all(): Meeting[] {
  if (!existsSync(dir())) return []
  return readdirSync(dir())
    .filter((f) => f.endsWith('.json'))
    .map((f) => load(f.replace(/\.json$/, '')))
    .filter((m): m is Meeting => m !== null)
    .sort((a, b) => b.started_at.localeCompare(a.started_at))
}

/* ── Grounding ───────────────────────────────────────────────────────────── */

/**
 * What Kuwait was searching for, WITH THE DATE IT WAS SEARCHED.
 *
 * knowledge/kuwait/timely/README.md is explicit that `last_verified` is
 * displayed in the UI rather than held as a hidden assumption, and the same
 * applies to a model reading it: a trend with no date attached is a trend the
 * planner will treat as true today, and this file is the fastest-decaying
 * knowledge in the system.
 *
 * The file's own warning travels with it. Most days that feed is sport, weather
 * and world news, and whether any of it is usable for electronics retail is the
 * person's judgement — so the planner may OFFER a trend as an angle and may not
 * assert that one is relevant. Political and religious trends never arrive here
 * at all; `pull-trends.mjs` drops them upstream under rule 5.
 */
function trends(): { text: string; asOf: string | null } {
  const note = readKnowledge('timely/trending-searches.md')
  if (!note) return { text: '', asOf: null }
  const when = note.last_verified
  return {
    asOf: when,
    text: [
      when
        ? `WHAT KUWAIT WAS SEARCHING FOR ON ${when} — this is a raw feed, not a recommendation.`
        : 'WHAT KUWAIT WAS SEARCHING FOR (no date on the file — treat it as stale):',
      'Most of it is sport, weather and world news and has nothing to do with electronics.',
      'You may OFFER one as a possible angle, saying the date out loud. You may NOT claim any',
      'of it is relevant to retail — that judgement belongs to the person you are talking to.',
      note.text.slice(0, 2000),
    ].join('\n'),
  }
}

/**
 * How campaigns are known to work, from knowledge/kuwait/evergreen/campaign-craft.md.
 *
 * The planner already knew this market's calendar, its channels and its offer
 * mechanics, and none of that tells it what a campaign IS. Asked who a campaign
 * was for it wrote an age bracket; asked to split a budget it put everything
 * behind the offer; and told the audience was "our loyal customers" it agreed.
 * All three are the ordinary advice a model has read a decade of, and all three
 * are contradicted by the largest body of effectiveness evidence there is — see
 * the provenance section of that file.
 *
 * TWO HALVES, AND ONLY ONE IS PASTED HERE. Everything from the first section
 * heading to `## Provenance` is written without a digit, because rule 2 forbids
 * this model emitting a number and a prompt containing "60:40" is a prompt
 * teaching it to write figures. The evidence with its numbers, its caveats and
 * its URLs sits below that fence and is for people.
 *
 * The fence is a string match, which is the kind of thing that starts silently
 * skipping the moment somebody renames a heading — so `scripts/test-meeting.mjs`
 * asserts this returns something, and asserts what it returns holds no digit.
 * Both halves of that check matter: an empty return would drop the knowledge
 * with no error, and a moved fence would carry the figures into the prompt.
 */
export function craft(): string {
  const note = readKnowledge('evergreen/campaign-craft.md')
  if (!note) return ''

  const from = note.text.indexOf('\n## ')
  const to = note.text.indexOf('\n## Provenance')
  if (from < 0 || to < 0 || to <= from) return ''

  return [
    'HOW CAMPAIGNS ARE KNOWN TO WORK. This is evidence about campaigns in general, not a fact',
    'about Kuwait, this shop or any product. Use it to ask better questions and to argue for a',
    'shape. It licenses no claim about reach, cost or what will work here.',
    note.text.slice(from, to).trim(),
  ].join('\n')
}

/**
 * What the last campaign learned, which is the only thing this planner knows
 * that a generic marketing tool could not also know.
 *
 * `report()` already returns `unpromoted` — products customers asked about that
 * the campaign never promoted — and `unanswered`, the questions the assistant
 * had to hand to a human. vision.md calls that second list the most valuable
 * byproduct in the system, because it says exactly what the catalogue is
 * missing. Feeding it into the next campaign's plan is the loop paying out.
 *
 * Never throws: a planner that falls over because the database is down is worse
 * than one that plans without last month's numbers.
 */
async function lastTime(): Promise<string> {
  try {
    const [previous] = await listCampaigns()
    if (!previous) return ''
    const r = await report(previous.id)
    if (!r) return ''

    const missed = r.unpromoted.slice(0, 6).map((p) => p.name)
    const gaps = r.unanswered.slice(0, 5).map((u) => `- ${u.question}`)
    if (!missed.length && !gaps.length) return ''

    return [
      `WHAT THE LAST CAMPAIGN ("${previous.name}") ACTUALLY TAUGHT US:`,
      missed.length
        ? `Customers asked about these and the campaign never promoted them: ${missed.join(', ')}.`
        : '',
      gaps.length ? `Questions the assistant could not answer:\n${gaps.join('\n')}` : '',
      'This is real evidence from real conversations. Use it — it is the reason to prefer one',
      'angle over another. Do not invent any further history beyond these lines.',
    ].filter(Boolean).join('\n')
  } catch {
    return ''
  }
}

/** The catalogue's identity text, shaped as a row so `isProductIdentity` reads it. */
async function catalogueIdentity(): Promise<Record<string, unknown>> {
  try {
    const products = await campaignProducts()
    return { name_en: products.map((p) => `${p.name_en ?? ''} ${p.brand ?? ''} ${p.category ?? ''}`).join(' ') }
  } catch {
    return { name_en: '' }
  }
}

/**
 * Figures the model wrote, extracted rather than trusted.
 *
 * Lifted from `suggest()` and it works the same way for the same reason: the
 * thing that wrote the number is the wrong thing to ask about it. A token
 * carrying a LETTER is exempt when the catalogue's own identity text holds it —
 * "iPad Pro M4" is what the product is called. A bare number never is: the
 * joined identity text of sixty products contains most small integers by
 * accident, so exempting those would exempt everything.
 */
export function figuresIn(
  text: string,
  identity: Record<string, unknown>,
  said: string,
  /**
   * The shelf block the planner was given, if any. A digit inside a product
   * name WE handed it is not a figure it invented — the same principle as the
   * person's own words below, and it became load-bearing the moment the planner
   * was told to name the rows: asked for laptops it correctly listed four, and
   * the banner reported 24, 14, 13.3 and 15.6 as figures nobody gave it, out of
   * "24 GB", "14 inch OLED", "13.3”" and "15.6"". Four false positives in one
   * turn is how a reader learns to skip the real one.
   */
  rows = '',
): string[] {
  const catalogue = String(identity.name_en ?? '')
  const words = text.split(/\s+/)
  const out: string[] = []

  // Punctuation flattened to spaces so a bigram survives the comma and the
  // inch mark a spec sheet is full of. `.` is kept — 13.3 is one number.
  const flat = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}.]+/gu, ' ').replace(/\s+/g, ' ').trim()
  const shelf = flat(rows)

  // A DIGIT IN EITHER SCRIPT. `\d` is ASCII-only in JavaScript, so
  // `/\d/.test('٥٠٪')` is false and a planner writing «خصم ٥٠٪ على الفئة» got no
  // invented-figure banner at all — the guard rule 2 leans on was blind to
  // exactly the language most of this shop's copy is written in.
  // `/\p{Nd}/u.test('٥٠٪')` is true.
  const digit = /\p{Nd}/u
  // ٪ (U+066A) is the Arabic percent sign and belongs to the token the same way
  // % does; without it the trailing trim quietly drops it from what is quoted
  // back to the person.
  const token = (raw: string) => raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}%٪]+$/gu, '')

  // The person's own figures, tokenised exactly as the model's are below, so
  // the comparison is token-to-token rather than a substring of the transcript.
  //
  // Both sides normalised, so ٣٠٠٠ and 3000 are one figure. A person typing
  // their budget in Arabic numerals and a planner echoing it back in ASCII is
  // the same number twice, and reporting it as invented is the warning crying
  // wolf — the failure this exemption exists to prevent.
  const mine = new Set(
    normaliseArabic(said).split(/\s+/).map(token).filter((w) => w && digit.test(w)),
  )

  words.forEach((raw, i) => {
    const w = token(raw)
    if (!w || !digit.test(w)) return

    // A token carrying a LETTER that the catalogue's own identity text holds —
    // "M4", "S26". That is what the product is called, not a figure.
    if (/\p{L}/u.test(w) && isProductIdentity(w, identity)) return

    // A BARE digit that is the model number of a real product. "Apple AirPods 4"
    // arrives as two tokens, and the 4 alone can never be vouched for by
    // `isProductIdentity` — the joined identity text of sixty products contains
    // most small integers by accident, so exempting bare numbers wholesale would
    // exempt everything. Checking it WITH the word before it is the difference:
    // "AirPods 4" is in the catalogue, a loose "4" is not. The planner naming a
    // real product was being reported as an invented figure, which is the same
    // warning-that-cries-wolf failure as quoting the person's own words back.
    const before = words[i - 1]?.replace(/[^\p{L}\p{N}]/gu, '')
    if (before && catalogue.toLowerCase().includes(`${before} ${w}`.toLowerCase())) return

    // The same trick against the shelf, and BOTH sides of the token — a spec
    // number is followed by its unit far more often than it is preceded by
    // anything distinguishing. "24 GB" and "13.3 Windows" are in a name we
    // supplied; "14 days" and "for 14" are not, so a made-up duration is still
    // caught in the middle of a sentence full of copied model numbers.
    const after = words[i + 1]?.replace(/[^\p{L}\p{N}]/gu, '')
    if (shelf && before && shelf.includes(flat(`${before} ${w}`))) return
    if (shelf && after && shelf.includes(flat(`${w} ${after}`))) return

    // A figure the PERSON typed, repeated back. `converse.ts` learned the same
    // thing about prices quoted out of a draft: warning somebody that nobody
    // verified their own words is the check crying wolf, and a warning that
    // fires every turn is one nobody reads by the third.
    //
    // The token has to match one of THEIRS EXACTLY. This was `said.includes(w)`,
    // and a substring test is catastrophic here: the budget slot exists to make
    // somebody type a long number, so once they answer "3000 KD" every one of
    // 3, 30, 300, 000 and 00 is a substring of what they said, and the model can
    // invent almost any short figure for the rest of the meeting without the
    // banner firing. Verified: person says "budget is 3000 KD", model writes
    // "Put 300 KD into photography and 50 into print", and only the 50 was
    // reported. The guard the UI's warning is built on had a hole shaped like
    // its own most important slot.
    if (mine.has(normaliseArabic(w))) return

    // Reported exactly as the model wrote it, Arabic numerals and all — the
    // banner quotes this straight back to the person.
    out.push(w)
  })

  return [...new Set(out)]
}

/**
 * An audience answer that names only people who already buy here.
 *
 * Deliberately narrow. It matches "our loyal customers", "existing shoppers",
 * "repeat buyers" — the phrasings that mean the campaign has been aimed at the
 * people who were coming in anyway. It does NOT match "loyal customers and
 * students", because that answer already contains somebody new, and pushing back
 * on it would be pushing back on a correct answer. A guard that fires on
 * legitimate input teaches the reader to ignore it.
 */
export const LOYALTY_ONLY =
  /^(?:(?:our|the)\s+)?(?:(?:loyal|existing|current|repeat|regular|returning|previous|past)\s+)+(?:customers?|clients?|shoppers?|buyers?|users?)(?:\s+base)?$|^our\s+(?:customers?|clients?|shoppers?|buyers?)(?:\s+base)?$/i

/** Everything established so far, as labelled lines the model can read. */
function established(known: Partial<Record<Slot, string>>): string {
  const lines = SLOTS.filter((s) => known[s]?.trim()).map((s) => `${s}: ${known[s]}`)
  return lines.length ? `WHAT YOU HAVE ALREADY ESTABLISHED — do not ask about these again:\n${lines.join('\n')}` : ''
}

/**
 * The preamble every call in this module shares.
 *
 * `ideas` is the opening idea and, on a turn, the newest thing said — see the
 * comment on `shelf()`. Both are searched and the rows merged.
 */
async function preamble(
  m: Meeting,
  ...ideas: string[]
): Promise<{ text: string; asOf: string | null; matched: boolean; rows: string }> {
  const rows = await shelf(...ideas)
  const season = whereInTheYear()
  const t = trends()
  const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })

  return {
    asOf: t.asOf,
    // Handed back so the caller's OWN instructions can branch on it. The first
    // version of this did not, and `reply()` went on telling the planner to
    // "list the matching products from the shelf above by name" on a turn where
    // the shelf was the sentence "nothing matches" — so it listed a Huawei Nova
    // 12 and a P60 Pro, neither of which this shop has ever stocked. An
    // instruction to speak from the shelf is a licence to invent one when there
    // is no shelf.
    matched: rows.matched,
    // Handed back for `figuresIn`: a digit in a product name we supplied is not
    // a figure the model made up.
    rows: rows.matched ? rows.text : '',
    text: [
      'You are a senior campaign planner for a consumer electronics retailer in Kuwait,',
      'sitting in a meeting with a colleague who has an idea. You know this market well.',
      '',
      `TODAY IS ${today}. What is happening in Kuwait retail right now:`,
      season || 'No fixed retail window this month.',
      WEEKEND,
      'Ramadan and the two Eids move about eleven days earlier each year. Never state a date for',
      'them and never assume one is near — a person confirms those.',
      '',
      rows.text,
      // Said as an instruction rather than left for the model to infer. Asked
      // about a phone the shop has never heard of, the planner produced a
      // finished three-way budget split and flagged nothing — the shelf being
      // empty was invisible to it, and now it is the loudest line in the
      // prompt.
      rows.matched
        ? ''
        : 'YOUR FIRST SENTENCE must tell them plainly that we do not carry the thing they named,\n' +
          'naming it. Then ask what it is called in our catalogue, or which of our products they\n' +
          'meant. Ask nothing else this turn and write no plan for it.',
      '',
      t.text,
      '',
      await lastTime(),
      '',
      `OFFER MECHANICS THAT EXIST IN THIS MARKET:\n${OFFER_MECHANICS.join(' | ')}`,
      'Was/now pairs are the strongest performer in electronics here. Instalment framing is',
      'widespread in Gulf electronics retail. Bundles pair a device with an accessory.',
      '',
      'CHANNELS. Snapchat is not a secondary channel in Kuwait; it reaches nearly half the',
      'country. The first few seconds decide distribution. Vertical, full-screen and',
      'sound-independent — much viewing is muted.',
      '',
      'ABOUT ANYTHING NOT ONLINE — billboards, malls, events, cinema, radio, print:',
      'You have NO data on these for Kuwait. You may say what KIND of thing a channel suits —',
      'an activation fits a launch better than a clearance — and you may NEVER name a mall, a',
      'site, an audience size, a cost, or claim any of it is worth it here. If offline matters,',
      'ASK what they already have access to and plan around their answer.',
      '',
      craft(),
      '',
      established(m.known),
      m.turns.length ? `\nTHE MEETING SO FAR:\n${m.turns.map((x) => `${x.role}: ${x.text}`).join('\n')}` : '',
      '',
      guardrails(),
      '',
      'NEVER WRITE A NUMBER — no price, no percentage, no budget figure, no date, no quantity,',
      'no audience size. Describe things in words and let the person supply the figure.',
      // Without this the rule reads as forbidding "MacBook Pro M4" and "iPad
      // Pro 2024", and it was taken that way: shown three real MacBook Pro M4
      // rows and asked point blank which ones we stock, the planner named none
      // of them and asked a question its own prompt had already answered. A
      // product's name is not a figure — `figuresIn` already knows this and
      // exempts a digit the catalogue's own identity text holds.
      rows.matched
        ? 'A PRODUCT NAME IS NOT A NUMBER. Copy a name from the shelf above exactly as written, digits\n' +
          'and all — "Apple MacBook Pro, M4 Max Chip, 14-inch" is what the thing is CALLED. If they\n' +
          'ask what we have, answer with those names. Never say you cannot see the catalogue.\n' +
          'Invent no product, no brand and no partnership that is not in the rows above.'
        // Stated as an absence rather than as a prohibition to weigh. "Invent
        // no product that is not in the rows above" is a rule the model has to
        // check itself against, and on a miss it read the empty shelf as
        // permission to supply one.
        : 'THERE ARE NO PRODUCT ROWS ABOVE — the catalogue matched nothing. Any product name or\n' +
          'brand you write would therefore be one you made up, including as a suggestion, an\n' +
          'alternative or an example. Write NONE. Talk about the campaign in kinds and categories\n' +
          'until they tell you a product we actually sell.',
      'Nothing religious or political, as a topic or as an angle.',
    ].filter(Boolean).join('\n'),
  }
}

/* ── One turn ────────────────────────────────────────────────────────────── */

/**
 * `objective` and `offer` are enums here, not free strings, and the empty string
 * is a member of both.
 *
 * A free string let the first live meeting answer `offer: "No offer"` — which is
 * not one of the mechanics, is not empty, and would have been carried forward as
 * settled for the rest of the meeting before failing the plan's own enum at the
 * very end. A constrained decode cannot return a value that is not on the list,
 * so the wrong answer stops being possible rather than being caught later.
 */
const KnownSchema = z.object({
  pushing: z.string().max(120),
  special: z.string().max(240),
  objective: z.enum([...OBJECTIVES, '']),
  audience: z.string().max(160),
  budget: z.string().max(60),
  channels: z.string().max(160),
  when: z.string().max(80),
  offer: z.enum([...OFFER_MECHANICS, '']),
  constraints: z.string().max(240),
})

/**
 * Which question to ask next — decided in TypeScript, never asked of the model.
 *
 * Whether a slot is filled is a fact, not a judgement. `converse.ts` computes
 * its own `missing()` list for exactly this reason: a model asked to notice what
 * it has not been told will sometimes notice and sometimes confidently proceed,
 * and the second one is the failure that produces a plan built on nothing.
 *
 * `constraints` is deliberately never asked for on its own — it is a catch-all
 * that only makes sense once something is on the table, so it comes back as
 * null and the planner is told it has enough.
 */
export function nextSlot(known: Partial<Record<Slot, string>>): Slot | null {
  return SLOTS.filter((s) => s !== 'constraints').find((s) => !known[s]?.trim()) ?? null
}

/**
 * The clickable answers, derived rather than generated.
 *
 * Every one of these comes from a closed list this project already owns or from
 * rows retrieval actually returned. That is the point: a suggestion the model
 * invented is a suggestion that can be wrong, and these sit under a button a
 * person presses without reading twice. It also costs no third model call on a
 * turn somebody is waiting through.
 *
 * The free-text slots get none, honestly. There is no closed list of reasons a
 * phone is worth buying, and offering three would narrow the one answer that
 * matters most to whichever three a machine thought of first.
 */
export async function suggestionsFor(slot: Slot, idea: string): Promise<string[]> {
  if (slot === 'objective') return [...OBJECTIVES]
  if (slot === 'offer') return [...OFFER_MECHANICS]
  if (slot === 'channels') return ['Snapchat + Instagram', 'Snapchat only', 'Social plus in-store', 'We have offline booked too']
  if (slot === 'pushing') {
    const hits = await retrieve(idea, 8).catch(() => [])
    return [...new Set(hits.map((h) => String(h.row.category ?? '').trim()).filter(Boolean))].slice(0, 4)
  }
  if (slot === 'when') {
    const season = whereInTheYear()
    return [season ? 'Into the window we are already in' : 'Over the next two weeks', 'One weekend only', 'A full month'].filter(Boolean)
  }
  return []
}

/**
 * What the planner is doing, while it is doing it.
 *
 * A turn is fifteen to twenty seconds of a person watching the word "Thinking",
 * and three of the four things that happen in it are decided before the model
 * writes a word: the catalogue is searched, what they said is written down, and
 * the next question is chosen in TypeScript. Those are the interesting parts and
 * they were invisible. The fourth is the reply, which now arrives as it is
 * written.
 *
 * Nothing here is saved. It describes a turn in flight, and once the turn lands
 * the reply itself is the record.
 */
export type Step =
  | { at: 'shelf'; matched: boolean }
  | { at: 'noted'; known: Partial<Record<Slot, string>> }
  | { at: 'asking'; slot: Slot | null }
  | { at: 'writing'; delta: string }

export type Reply = {
  meeting: Meeting
  say: string
  ask: Ask | null
  /** True once nothing required is missing. The PERSON still decides when to stop. */
  enough: boolean
  invented: string[]
  caution: Check[]
  /** Set when the model could not be reached. The transcript still saved. */
  offline?: string
}

/**
 * One turn of the meeting.
 *
 * Two model calls, and the order is the opposite of the advisor's on purpose.
 * There, prose comes first because the structure is pulled out of it. Here the
 * read-back has to reflect what was just understood, so extraction runs first
 * and the prose is written against a filled-in checklist. Both calls stay small
 * and the prose one stays unconstrained, which is the rule that matters:
 * grammar-constrained decoding measurably degrades writing.
 *
 * A third constrained call to rebuild the whole plan every turn was the obvious
 * design and is not this one. On a local 12B it is another twenty seconds
 * against a person who is waiting, every turn, to be told something they mostly
 * already know. The plan is written when they ask for it; the advice arrives
 * every turn, in the prose.
 */
/**
 * Write these fields onto whatever is on disk NOW, rather than over it.
 *
 * Every writer here loads the meeting at the start of a request that can take a
 * minute — two model calls on a local 12B — and saves the whole object at the
 * end. Two requests overlapping means the slower one silently reverts the
 * faster one: a turn sent while the plan was being written erased the plan, or
 * the plan erased the turn, depending on which finished last. The screen kept
 * showing whichever it had in React state, so nothing looked wrong until Create
 * re-read the file and answered "Write the plan first" about a plan on screen.
 *
 * Merging one field onto a fresh read is the whole fix; these writes never
 * contend for the same field.
 */
export function mergeSave(base: Meeting, patch: Partial<Meeting>): Meeting {
  // `base` on the first turn, when nothing is on disk yet; the fresh read every
  // time after.
  const merged = { ...(load(base.id) ?? base), ...patch }
  save(merged)
  return merged
}

export async function reply(
  m: Meeting,
  said: string,
  /**
   * Called as the turn progresses. Defaulted to a noop so `reply` is still one
   * function with one behaviour — a caller with no screen simply hears nothing.
   */
  on: (step: Step) => void = () => {},
): Promise<Reply> {
  const text = said.trim()
  if (!text) throw new Error('Say something first.')

  const now = new Date().toISOString()
  const withYou: Meeting = { ...m, turns: [...m.turns, { role: 'you', text, at: now }] }

  // The opening idea stays a retrieval query for the whole meeting, and the
  // newest turn is searched TOO rather than instead. Replacing it swung the
  // shelf around every time somebody answered a question about the budget,
  // which is why this was frozen to turn one — but frozen meant a product named
  // in turn three was never searched for at all. Merging keeps both: the shelf
  // only ever grows, and an answer that names no product now contributes
  // nothing rather than noise, because retrieval finally reports a miss as a
  // miss. Verified: `retrieve('3000 KD')` returns zero rows.
  const idea = withYou.turns.find((t) => t.role === 'you')?.text ?? text
  const { text: base, matched, rows } = await preamble(withYou, idea, text)
  on({ at: 'shelf', matched })

  // Extraction first, and DELIBERATELY NOT against `base`.
  //
  // The first version of this passed the shared preamble, and the leak was
  // immediate: told it was Back to School season and shown the compliance
  // guardrails, the extractor answered `special: "Back to School"` and
  // `constraints: "No superlatives, no competitor mentions"` on a turn where
  // the person had said neither. Both then stuck, because the prompt asks it to
  // carry established values forward — and `special` being falsely filled meant
  // the planner never asked what is actually different about the phone, which
  // is the one question this whole feature exists to ask.
  //
  // So this call sees the conversation and nothing else. No season, no
  // guardrails, no trends, no shelf, no last campaign. There is nothing in its
  // context to mistake for something the person said. It is also a much smaller
  // prompt, on a call somebody is waiting through.
  let known = withYou.known
  try {
    const out = await generateJson(
      [
        'Read this meeting transcript and record only what the COLLEAGUE has actually said.',
        'You are a note-taker, not a planner. You are not being asked what would be sensible.',
        '',
        `THE TRANSCRIPT:\n${withYou.turns.map((x) => `${x.role}: ${x.text}`).join('\n')}`,
        '',
        established(withYou.known) || 'Nothing established yet.',
        '',
        // What each field MEANS, from the one place that defines it. Without
        // this the first live meeting put "push it hard this month" in `pushing`
        // and the product name in `special` — it had the words and no idea which
        // box they went in. `pushing` then stuck, wrong, for the whole meeting.
        'WHAT EACH FIELD IS:',
        ...SLOTS.map((slot) => `- ${slot}: ${QUESTION_FOR[slot]}`),
        '',
        // D92 fixed this for the PLAN call and left the EXTRACTION call
        // undescribed. `.max()` under a constrained decode TRUNCATES rather
        // than rejecting — Ollama masks the token that would exceed the limit,
        // so an over-long answer arrives cut off mid-word and then passes Zod
        // cleanly, because by the time Zod sees it it is within the limit. Here
        // that is worse than in the plan: rule 2 of this prompt carries the
        // slot forward every turn afterwards, and `contextFrom` writes it
        // permanently into `campaigns.context`. A three-hundred-character
        // answer to "what is genuinely different about it" would be a truncated
        // sentence stamped on every design and caption made under the campaign.
        // The caps below are the backstop; these lines are the actual limit.
        'HOW LONG EACH ANSWER MAY BE. Going over does not fail — it gets CUT OFF MID-WORD and',
        'kept, so stay well inside these. Summarise what they said; do not quote them at length.',
        '- pushing: a few plain words, like "laptops and tablets". Under fifteen words.',
        '- special: one sentence, under thirty words. The reason, not the whole spec sheet.',
        '- audience: one short phrase, under twenty-five words.',
        '- budget: THEIR figure and its currency, nothing else. A handful of characters.',
        '- channels: the channels only, comma-separated. Under twenty words.',
        '- when: a short phrase, under twelve words.',
        '- constraints: one sentence, under thirty words.',
        '- objective and offer: exactly one value from the list, or empty.',
        '',
        'Rules, in order of importance:',
        '1. An empty string is the CORRECT answer for anything they have not said. Most fields',
        '   are empty early on and that is expected. Never fill a field with what a campaign',
        '   like this usually has, with the season, or with a rule you were given — none of',
        '   those are things they said.',
        '2. Carry forward values already established, unless the newest thing they said',
        '   contradicts one — then replace it with what they now say.',
        '3. Never put a number in any field except budget, where you copy THEIR figure exactly',
        '   as they typed it. Leave budget empty if they have not named one.',
        '4. pushing is WHAT is being sold. special is what makes that thing different. They are',
        '   not the same answer: "the new Galaxy" is pushing, "the camera works in the dark" is',
        '   special. Never put the product name in special.',
      ].join('\n'),
      KnownSchema,
      z.toJSONSchema(KnownSchema),
      { maxTokens: 700 },
    )
    known = Object.fromEntries(SLOTS.map((s) => [s, (out[s] ?? '').trim() || withYou.known[s] || ''])) as Partial<Record<Slot, string>>
  } catch {
    // Unusable JSON twice loses this turn's extraction, not the meeting. The
    // slots keep their previous values and the planner asks again.
    known = withYou.known
  }

  on({ at: 'noted', known })

  const slot = nextSlot(known)
  on({ at: 'asking', slot })
  const suggestions = slot ? await suggestionsFor(slot, idea) : []
  const identity = await catalogueIdentity()
  // Everything the PERSON has said, for the guards below. Their own figures are
  // theirs to state — rule 2 forbids the MODEL emitting one.
  const mine = withYou.turns.filter((t) => t.role === 'you').map((t) => t.text).join('\n')

  // Composed into a variable rather than passed inline: this exact string is
  // handed back in the trace, and a prompt the screen shows has to be the one
  // that was sent, not a second copy that drifts from it.
  const prompt = [
    base,
    '',
    `THEY JUST SAID: ${text}`,
    '',
    // The planner was shown three real MacBook Pro M4 rows, asked "which
    // models do we actually have in stock?", named none of them, and asked
    // a question its own prompt had already answered. The shelf was
    // present, correct, and treated as scenery.
    //
    // Branched on whether there IS a shelf. Unbranched, this same
    // instruction on a turn where nothing matched produced a "Huawei Nova
    // 12 series or the Huawei P60 Pro" — told to list products and given
    // none, it listed some.
    matched
      ? 'IF WHAT THEY JUST SAID IS A QUESTION ABOUT WHAT WE STOCK, answer it first and answer\n' +
        'it properly: list the matching products from the shelf above by name. That is what the\n' +
        'shelf is for. Then carry on below. Never tell them to go and look it up.'
      : 'IF WHAT THEY JUST SAID IS A QUESTION ABOUT WHAT WE STOCK, the honest answer is the only\n' +
        'one you have: nothing in our catalogue matches what they described. Say that, ask them\n' +
        'for a kind of product instead, and name no product and no brand of your own. Do NOT\n' +
        'say you cannot see the catalogue — you can, and it has nothing like this in it.',
    '',
    'Reply in under 110 words, talking to them, not about them. In this order:',
    '1. One or two sentences reading back what you now understand. If you are unsure, say so.',
    '2. What you would do with what you know so far — a real opinion about the angle, the',
    '   channel or the offer, not a summary of what they told you. This is the half they',
    '   came for. Say it even when you are still missing things.',
    // Three turns of a real meeting produced the same paragraph three times:
    // was/now, bundle it with the keyboard or the case, lead on Snapchat. Each
    // was reasonable and the second and third were worthless — the person had
    // answered a question and been told what they had already been told. The
    // model was not being stupid: nothing asked it to move on, and its own
    // earlier advice sat in the transcript being the most relevant thing in
    // its context.
    ...(m.turns.some((t) => t.role === 'planner')
      ? [
          '   YOU HAVE ALREADY GIVEN ADVICE IN THIS MEETING. Read your own earlier turns above.',
          '   Anything you have already recommended is SETTLED — do not recommend it again, in',
          '   the same words or in new ones. Say something you have not said yet, or say what',
          '   their newest answer CHANGES about what you already suggested. If it changes',
          '   nothing and you have nothing to add, say so in one short sentence and go to the',
          '   question. A repeated recommendation is worse than no advice: it tells them you',
          '   did not read what they just said.',
        ]
      : []),
    // The one piece of the craft file that has to fire on a specific turn
    // rather than sit in the background being read.
    //
    // "Push laptops to our loyal customers" is the most ordinary sentence in
    // retail and the planner agreed with it — it read back "our existing loyal
    // customer base", picked two laptops and moved on. The craft knowledge says
    // plainly that acquisition campaigns beat loyalty ones, and it was in the
    // prompt at the time; a rule competing with eight other blocks loses to the
    // thing the person just said.
    //
    // So TypeScript decides WHEN it is said, the same way `nextSlot` decides
    // which question comes next. Fired on the turn the audience slot goes from
    // empty to loyalty-shaped, and on that turn only: it is a thing to say once,
    // and a planner repeating it every turn is the D95 failure with a new line.
    ...(!m.known.audience?.trim() && LOYALTY_ONLY.test(known.audience ?? '')
      ? [
          '   THEY HAVE JUST DESCRIBED THE AUDIENCE AS PEOPLE WHO ALREADY BUY FROM US. In step 2,',
          '   in one sentence and without lecturing, say that campaigns aimed at people who do',
          '   NOT buy from us yet do better, and name the situation somebody would be in who',
          '   might buy this and has never bought from us. Do not ask them about it — step 3 is',
          '   still the only question this turn. Do not refuse the campaign.',
        ]
      : []),
    // The question is prescribed, not chosen. Left to itself the planner
    // asked "How many units are we aiming to sell this month?" on a turn
    // whose answers on screen were Sell it / Launch it / Clear it — two
    // different questions in one place, and the person answers whichever
    // they read first. Rephrasing is allowed; changing what is asked for is
    // not, and the available answers are shown so it cannot ask something
    // they cannot answer.
    slot
      ? [
          `3. End with ONE question, on its own line, asking for exactly this: ${QUESTION_FOR[slot]}`,
          '   Put it in your own words so it sounds like you, but do NOT ask for anything',
          '   other than that — not a number, not a second thing, not a variation on it.',
          suggestions.length
            ? `   They will answer with one of: ${suggestions.join(' | ')} — so it must be a question those answer.`
            : '',
        ].filter(Boolean).join('\n')
      : '3. Tell them you have enough to write the plan whenever they are ready. Ask nothing.',
    '',
    'No lists, no headings, no preamble, no bullet points. Plain sentences.',
  ].join('\n')

  let prose: string
  try {
    // A planner that answers at 0 gives the same three sentences to every idea,
    // which reads as a template and stops being read. This is judgement, not fact.
    prose = await generateStream(prompt, { temperature: 0.6 }, (delta) => on({ at: 'writing', delta }))
  } catch (e) {
    const msg = e instanceof Error ? e.message : ''
    // Merged, not written whole: a plan finishing while this turn was in flight
    // must not be reverted by it.
    const meeting = mergeSave(withYou, { turns: withYou.turns, known })
    return {
      meeting,
      say: '',
      ask: null,
      enough: slot === null,
      invented: [],
      caution: [],
      offline: /fetch failed|ECONNREFUSED/i.test(msg)
        ? 'Ollama is not answering on localhost, so there is no reply this turn. Run: brew services start ollama. What you said was saved.'
        : 'The model failed this turn. What you said was saved.',
    }
  }

  const meeting = mergeSave(withYou, {
    known,
    turns: [...withYou.turns, { role: 'planner', text: prose, at: new Date().toISOString() }],
  })

  return {
    meeting,
    say: prose,
    ask: slot ? { slot, question: QUESTION_FOR[slot], suggestions } : null,
    enough: slot === null,
    // Held to the same rule as the copy written under it. A figure in planning
    // advice is a figure that reaches a caption wearing a person's authority.
    invented: figuresIn(prose, identity, mine, rows),
    caution: blockers(check(prose, identity))
      .filter((c) => c.name !== 'every placeholder is a real field' && c.name !== 'every placeholder has a value')
      // Same exemption as `invented`: a check that fires on the person's own
      // words is noise, and noise is how a real warning gets scrolled past.
      .filter((c) => !(c.span && mine.includes(c.span))),
  }
}

/**
 * What each slot is actually asking for, in the planner's own words.
 *
 * Written out rather than generated because these are the questions the whole
 * feature exists to ask, and a model rephrasing them every turn would ask a
 * subtly different question each time — which is how "what makes it special"
 * degrades into "tell me more about the product".
 */
const QUESTION_FOR: Record<Slot, string> = {
  pushing: 'exactly what they want to push — which products or which range.',
  special:
    'what is genuinely different about it and why somebody would choose it over the one beside it. ' +
    'If they answer with a spec sheet, push back ONCE and ask what that spec means for the person buying.',
  objective: `what winning looks like — one of: ${OBJECTIVES.join(', ')}.`,
  audience: 'who it is for, and what those people already believe or worry about.',
  budget: 'how much they are willing to spend in total. Ask for the figure plainly; you must not guess it.',
  channels: 'what they actually have access to — social only, or is anything offline already booked.',
  when: 'when it runs and how long for.',
  offer: `what kind of offer sits behind it, if any: ${OFFER_MECHANICS.join(', ')}.`,
  constraints: 'anything that rules an option out.',
}

/* ── The plan ────────────────────────────────────────────────────────────── */

/**
 * A `.max()` here is a truncation, not a rejection — worth knowing before you
 * debug one.
 *
 * Under grammar-constrained decoding Ollama masks the token that would exceed
 * the length, so an over-long field comes back CUT OFF MID-WORD and then passes
 * Zod cleanly, because by the time Zod sees it it is within the limit. The first
 * live meeting returned a `shape` reading "...the messaging highlights the" and
 * nothing downstream noticed.
 *
 * So the caps are a backstop and the PROMPT is what keeps a field short. Every
 * field below is described in the prompt with the length it should be; where a
 * description is missing the model fills the space it is given, which is what
 * happened to `shape` — it was the one field nothing described.
 */
const PlanSchema = z.object({
  name: z.string().min(3).max(60),
  say: z.string().min(10).max(140),
  audience: z.string().max(160),
  objective: z.enum(OBJECTIVES),
  offer: z.enum(OFFER_MECHANICS),
  channels: z.array(z.object({ channel: z.enum(CHANNEL_OPTIONS), role: z.string().max(120) })).min(1).max(5),
  // Weight WORDS, never amounts and never percentages. See the comment on plan().
  spend: z.array(z.object({
    item: z.enum(LINE_ITEMS),
    weight: z.enum(WEIGHTS),
    why: z.string().max(140),
  })).min(1).max(6),
  shape: z.string().max(140),
  measure: z.array(z.string().max(120)).min(1).max(4),
})

/**
 * The plan as the one field a campaign actually has.
 *
 * `campaigns` is four columns and stays four columns (CLAUDE.md §6), so this is
 * where the meeting stops being a conversation and becomes the thing the studio
 * and the designs screen read. It goes through `composeContext()` — the same
 * composer the brief form uses — because two ways of writing a context is two
 * formats for `rules()` in the studio to read, and the second one drifts.
 *
 * Deliberately one-way. There is no parser that reads this back into a Plan, for
 * the reason lib/brief.ts states twice: parsing the context back is the step that
 * turns a composer into a schema, and a schema here is the CRM. The meeting file
 * is the record if anybody needs the detail again.
 */
export function contextFrom(m: Meeting, p: Plan): string {
  return composeContext({
    objective: p.objective,
    pushing: m.known.pushing ?? '',
    audience: p.audience,
    offer: p.offer,
    // The offer's specifics are the person's to state. The model was forbidden
    // a figure, so there is nothing to put here and a blank is honest.
    offerDetail: '',
    say: p.say,
    channels: p.channels.map((c) => c.channel),
    runs: p.shape,
    // Pre-formatted, because brief.ts does no arithmetic and imports no
    // formatter. Every figure in this line came out of `split()`.
    spend: p.spend.map((l) => `${l.item} ${l.text}`).join(', '),
    measure: p.measure.join('; '),
    notes: [
      m.known.special ? `What is different about it: ${m.known.special}` : '',
      m.known.constraints ? `Constraints: ${m.known.constraints}` : '',
      p.budget ? `Budget stated: ${p.budget}` : '',
      p.kuwait_context_as_of ? `Kuwait context as of ${p.kuwait_context_as_of}` : '',
    ].filter(Boolean).join('. '),
  })
}

/**
 * The budget the PERSON typed, as a number.
 *
 * Their own figure, which rule 2 has never forbidden — rule 2 forbids the MODEL
 * emitting one. `lib/brief.ts` makes the same distinction about the offer line
 * and D69 verified that path.
 *
 * Returns null rather than a default when nothing usable was typed. A default
 * here would be a budget nobody set, split into line items that look exactly as
 * authoritative as a real one.
 */
export function budgetOf(known: Partial<Record<Slot, string>>): number | null {
  // Arabic-Indic digits FIRST. JS `\d` is ASCII-only, so `budgetOf({ budget:
  // '٣٠٠٠ د.ك' })` returned null, `plan()` got total=null, and the screen
  // printed "No budget figure was given, so there is nothing to split" about a
  // budget sitting two panels away. The whole spend feature disappeared for
  // anyone typing Arabic numerals — silently, because null is also the honest
  // answer for somebody who never named one. `normaliseArabic` already folds
  // ٠-٩, the Arabic decimal separator ٫ and the thousands mark ٬.
  const raw = normaliseArabic(known.budget ?? '').replace(/,/g, '')
  const m = raw.match(/\d+(?:\.\d+)?/)
  if (!m) return null
  const n = Number(m[0])
  // Number.isFinite FIRST. A NaN passes both halves of a range check, because
  // every comparison against NaN is false, and would flow on as a number.
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * Write the plan.
 *
 * Two calls again — the proposition and the reasoning are written freely, then a
 * cheap constrained pass pulls the structure out. The constrained half is where
 * the budget lives, and it is the reason this whole module can exist under
 * CLAUDE.md rule 2:
 *
 * **The model returns weight WORDS, never amounts and never percentages.** It
 * says Boosting is `dominant` and Photography is `moderate`, with a sentence
 * saying why. `split()` in lib/spend.ts turns that into fils against the total
 * the person typed, and `formatKwd` prints it. A percentage would be the model
 * emitting a number with extra steps, which is why the weights are words and
 * why both lists are Zod enums — a constrained decode cannot return a sixth
 * line item for the UI to silently drop.
 *
 * Without a budget there is no split, and the plan says so rather than
 * inventing a total to divide.
 */
export async function plan(m: Meeting): Promise<Plan> {
  const idea = m.turns.find((t) => t.role === 'you')?.text ?? ''
  // The opener, plus whatever the person settled on as the thing being pushed.
  // Same reasoning as `reply()`: a product named after turn one was otherwise
  // never on the shelf the plan is written from.
  const { text: base, asOf, rows } = await preamble(m, idea, m.known.pushing ?? '')
  const total = budgetOf(m.known)

  const reasoning = await generate(
    [
      base,
      '',
      'The meeting is done. Think out loud, in under 200 words, about the campaign you would',
      'actually run: the ONE thing to say, who it is for, which channels do which job, where the',
      'money should weigh heaviest and why, and how they will know afterwards whether it worked.',
      'Ground it in what is on the shelf and in what the last campaign taught us, where that',
      'applies. No numbers anywhere.',
    ].join('\n'),
    { temperature: 0.6 },
  )

  const out = await generateJson(
    [
      base,
      '',
      `YOUR OWN REASONING, which you are now turning into a plan:\n${reasoning}`,
      '',
      'Return the plan.',
      '',
      'name — what to call this campaign, under eight words. It is stamped on every design and',
      'caption made under it, so it has to read as a label somebody recognises months later:',
      '"Back to school — laptops". Not a slogan, not a sentence, and never a date.',
      '',
      'say — the single-minded proposition: the ONE thing the audience should take away, in one',
      'sentence under fifteen words. No "and", no comma-joined list, no second idea. Make it',
      'about what the customer GETS, not what the shop is doing. No superlatives — "best",',
      '"fastest", "ultimate" are claims nobody can substantiate and are blocked downstream.',
      '',
      'channels — each with the JOB it does. "Snapchat" is not a role; "where the launch is',
      'announced, vertical and muted" is. Name an offline channel ONLY if they told you they',
      'have it, and say nothing about its reach or cost.',
      '',
      'shape — WHEN IT RUNS AND FOR HOW LONG, as a short phrase of a few words: "through the',
      'last two weeks of September", "one weekend, then a fortnight of retargeting". It is not',
      'a summary of the campaign and it is not a sentence about the messaging — every other',
      'field already covers those. Keep it well under twenty words.',
      '',
      'audience — who it is for and what they already believe or worry about. Not a bracket.',
      '',
      'spend — one line per thing money goes on, each with a WEIGHT WORD and a reason.',
      `Weights, heaviest to lightest: ${WEIGHTS.join(' | ')}.`,
      `Lines available: ${LINE_ITEMS.join(' | ')}.`,
      'DO NOT write an amount and DO NOT write a percentage. A person supplied the total and the',
      'system does the arithmetic. Only include a line the campaign actually needs.',
      '',
      'measure — how they will know it worked, in words. Never a target figure.',
      '',
      'NEVER WRITE A NUMBER in any field.',
    ].join('\n'),
    PlanSchema,
    z.toJSONSchema(PlanSchema),
    { maxTokens: 900 },
  )

  const identity = await catalogueIdentity()
  const mine = m.turns.filter((t) => t.role === 'you').map((t) => t.text).join('\n')
  // EVERY piece of free text the model wrote, and the name most of all.
  //
  // `name` and the spend reasons were missing from this string, so nothing
  // checked them — and `name` is the worst possible field to leave unchecked:
  // it goes to `create()` and becomes `campaigns.name`, stamped on every design,
  // caption and conversation made under the campaign from then on. A plan named
  // "Back to school — 50% off laptops" carried an invented figure into the one
  // place rule 2 reaches furthest, with no warning shown. The spend reasons are
  // rendered verbatim in the plan's own table, so they need it too.
  const prose = [
    out.name, out.say, out.audience, out.shape,
    ...out.measure,
    ...out.channels.map((c) => c.role),
    ...out.spend.map((l) => l.why),
  ].join(' ')

  return {
    name: out.name,
    objective: out.objective,
    say: out.say,
    audience: out.audience,
    offer: out.offer,
    channels: out.channels,
    // No budget, no split. A plan that divided an invented total would look
    // exactly as authoritative as one that divided a real one.
    spend: total === null ? [] : split(total, out.spend as PlanLine[]),
    budget: m.known.budget ?? '',
    shape: out.shape,
    measure: out.measure,
    kuwait_context_as_of: asOf,
    reasoning,
    invented: figuresIn(prose, identity, mine, rows),
    caution: blockers(check(prose, identity))
      .filter((c) => c.name !== 'every placeholder is a real field' && c.name !== 'every placeholder has a value')
      .filter((c) => !(c.span && mine.includes(c.span))),
    model: MODELS.english,
    prompt_version: MEETING_PROMPT_VERSION,
  }
}
