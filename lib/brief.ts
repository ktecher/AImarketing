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
 */
export function composeContext(b: Brief): string {
  const offer = [b.offer, b.offerDetail.trim()].filter(Boolean).join(' — ')
  return [
    ['Pushing', b.pushing.trim()],
    ['For', b.audience.trim()],
    ['Offer', offer],
    ['Say', b.say.trim()],
    ['Channels', b.channels.join(', ')],
    ['Runs', b.runs.trim()],
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
 */
export function pushingFrom(context: string): string[] {
  const line = context.split('\n').find((l) => /^\s*pushing\s*:/i.test(l))
  if (!line) return []
  return line
    .slice(line.indexOf(':') + 1)
    .split(',')
    // "laptops, keyboards, and backpacks" — the Oxford comma leaves the last
    // term as "and backpacks", which matches nothing in the catalogue.
    .map((t) => t.trim().replace(/^and\s+/i, '').trim())
    .filter(Boolean)
    .slice(0, 6)
}
