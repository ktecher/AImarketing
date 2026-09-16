/**
 * The campaign brief: seven short questions composed into one field.
 *
 * Its own file, and deliberately dependency-free — no database, no filesystem,
 * no model. `lib/campaigns.ts` imports `pg`, and the create form is a client
 * component, so composing the brief from there would ship a Postgres driver to
 * the browser.
 *
 * A campaign is four columns and stays four columns. But "this week's context"
 * was a single empty textarea, and an empty textarea asks a marketer to
 * remember, unprompted, everything a brief normally asks them. They do not, and
 * the studio then writes captions with no audience, no offer and no angle —
 * which is most of what makes a caption specific.
 *
 * So the FORM gets structure and the COLUMN does not. Seven short questions
 * compose into one labelled plain-text string, and after creation that string
 * is edited as free text exactly as before. There is deliberately no parser and
 * no round-trip: reopening a campaign does not repopulate the questions.
 * Parsing it back is the step that turns a composer into a schema, and a schema
 * here is the CRM CLAUDE.md forbids.
 *
 * Labelled lines rather than prose because two readers consume this: a person
 * scanning it, and `rules()` in lib/content/studio.ts fencing it into the
 * prompt as steer-not-fact. Both do better with named lines than a paragraph.
 */

/**
 * The offer mechanics that actually exist in Gulf electronics retail, from
 * knowledge/kuwait/evergreen/pricing-and-offers.md. A closed list, because in
 * retail the offer IS the campaign and "what kind of offer" has a real answer —
 * unlike the free text beside it, which is where the specifics go.
 */
export const OFFER_MECHANICS = [
  'Was/now',
  'Bundle',
  'Instalments',
  'Trade-in',
  'Percentage off',
  'No offer — new arrivals',
] as const

/**
 * The nine things the campaign meeting tries to find out, and the order it asks
 * in — see `lib/meeting.ts` and D92.
 *
 * They live HERE, in the file with no dependencies, for the same reason
 * `OFFER_MECHANICS` does: the meeting's screen is a client component, and
 * `lib/meeting.ts` reaches `lib/campaigns.ts` and therefore `pg`. Importing one
 * array from it put a Postgres driver in the browser bundle and broke the build
 * with `Can't resolve 'dns'` — while typecheck and the whole test suite stayed
 * green, because neither of them bundles anything. This file's header comment
 * warned about exactly that trap one function further down.
 *
 * `pushing` and `special` lead because everything downstream changes with them,
 * and because `special` decides whether the campaign is about a phone or about
 * THIS phone. `constraints` is last and is never asked on its own — it is a
 * catch-all, and asking what rules an option out before anything is on the
 * table gets a blank look.
 */
export type Slot =
  | 'pushing' | 'special' | 'objective' | 'audience' | 'budget'
  | 'channels' | 'when' | 'offer' | 'constraints'

export const SLOTS: readonly Slot[] = [
  'pushing', 'special', 'objective', 'audience', 'budget', 'channels', 'when', 'offer', 'constraints',
]

/**
 * A closed list, because in retail "what is the objective" has a small real
 * answer set, and an open string reliably produces "increase brand awareness and
 * drive sales" — which is two campaigns and no objective.
 */
export const OBJECTIVES = [
  'Sell it',         // move units now
  'Launch it',       // nobody knows it exists yet
  'Clear it',        // stock that has to go
  'Bring people in', // footfall to a branch
] as const

export type Brief = {
  /** What is being promoted. Products, a category, a range. */
  pushing: string
  /** Who it is for. Changes every caption the studio writes. */
  audience: string
  /** One of OFFER_MECHANICS, or empty. */
  offer: string
  /** The specifics of the offer. A person may type a figure here — see below. */
  offerDetail: string
  /** The single-minded proposition. One sentence, one idea. */
  say: string
  channels: string[]
  /** When it runs, in words. Not a date range — that is a scheduling column. */
  runs: string
  /** Whatever else. Seeded with the rough idea, which is usually the best line. */
  notes: string
  /**
   * The campaign meeting's closed list (`OBJECTIVES`). Optional: every caller
   * before the meeting existed has no objective and must keep composing exactly
   * as before.
   */
  objective?: string
  /**
   * The budget split, already formatted as a string by the caller — this file
   * does no arithmetic and imports no formatter, see the header comment.
   */
  spend?: string
  /** What to look at afterwards, from the meeting's plan. */
  measure?: string
}

/**
 * The brief as one string.
 *
 * A figure typed on the Offer line is fine and is not a rule 2 violation: rule
 * 2 forbids THE MODEL emitting a number. A person typing "up to 40% off" is a
 * person stating their own offer, and `rules()` fences this whole block as
 * something that steers angle and tone while the no-number rule still outranks
 * it — so the model may write around the offer and still cannot put a digit in
 * a caption. D69 verified that path.
 *
 * Empty answers are omitted rather than written as blank labels. A line reading
 * "For:" with nothing after it teaches the reader that the labels mean nothing.
 *
 * `objective`, `spend` and `measure` are the campaign meeting's addition (see
 * docs/superpowers/specs/2026-09-02-campaign-meeting-design.md) — all three
 * optional, so every caller that predates the meeting keeps composing exactly
 * as before. `Objective` sits near the top because it governs the rest of the
 * brief; `Spend` and `Measure` sit at the end, before `Notes`, because they are
 * what the meeting adds on top of a brief the rest of this function already
 * describes. `spend` arrives pre-formatted by the caller — this function does
 * no arithmetic, per the header comment.
 */
export function composeContext(b: Brief): string {
  const offer = [b.offer, b.offerDetail.trim()].filter(Boolean).join(' — ')
  return [
    ['Objective', b.objective?.trim() ?? ''],
    ['Pushing', b.pushing.trim()],
    ['For', b.audience.trim()],
    ['Offer', offer],
    ['Say', b.say.trim()],
    ['Channels', b.channels.join(', ')],
    ['Runs', b.runs.trim()],
    ['Spend', b.spend?.trim() ?? ''],
    ['Measure', b.measure?.trim() ?? ''],
    ['Notes', b.notes.trim()],
  ]
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n')
}

/**
 * The "Pushing" line read back out of a composed context.
 *
 * The Designs screen needs it to answer "which products is this campaign
 * about". Without it, arriving from a campaign that says *laptops and
 * accessories* designed the entire catalogue — sixty-two posters nobody asked
 * for, and no way to tell which of them the campaign meant.
 *
 * Split on commas, because "Standard Laptops, Convertible Laptops, Wireless
 * Earphones" is three searches; asking for it as one phrase matches nothing.
 * Capped at six for the same reason the campaign screen caps its own count:
 * beyond that somebody has written a paragraph, not a list.
 *
 * BOTH commas. Arabic writes its comma as ، (U+060C), so a Pushing line reading
 * «لابتوبات، تابلت، سماعات» split on the ASCII comma alone came back as ONE
 * twenty-four-character term that matches no product — which is precisely the
 * "sixty-two posters nobody asked for" this function exists to prevent, back
 * again and invisible, because a single term is a perfectly ordinary answer.
 */
export function pushingFrom(context: string): string[] {
  const line = context.split('\n').find((l) => /^\s*pushing\s*:/i.test(l))
  if (!line) return []
  return line
    .slice(line.indexOf(':') + 1)
    .split(/[,،]/)
    // "laptops, keyboards, and backpacks" — the Oxford comma leaves the last
    // term as "and backpacks", which matches nothing in the catalogue.
    .map((t) => t.trim().replace(/^and\s+/i, '').trim())
    .filter(Boolean)
    .slice(0, 6)
}
