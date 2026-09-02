/**
 * The loop, and the only place that closes it.
 *
 * Marketing and sales already write `campaign_id` — `assets` since migration
 * two, `content_pieces` and `conversations` since each was written. Every value
 * has been null, because nothing owned the id. This module owns it, and answers
 * the one question the whole system exists to answer:
 *
 *   we promoted these twelve products — what did customers ask about,
 *   and what could the bot not answer?
 *
 * `vision.md` calls that second half **the most valuable byproduct in the
 * system**, because it tells marketing exactly what the catalogue is missing.
 *
 * Four columns, per CLAUDE.md. Two things follow from that and are load-bearing:
 *
 * **Membership is derived, never stored.** Which products a campaign promoted is
 * the set of products whose designs and copy carry its id. A `campaign_products`
 * table would be a second answer to the same question, and the two would
 * disagree the first time somebody exported a design and forgot to tick a box.
 *
 * **The current campaign is the newest one.** A rule, not a column, because
 * `status` and `starts_on` are the first two columns of a CRM. It holds until
 * campaigns get planned weeks in advance, which is the reversal condition.
 */

import { readFileSync } from 'node:fs'
import { postedFor } from '@/lib/social/store'
import { join } from 'node:path'
import { z } from 'zod'
import { query } from '@/lib/db'
import { generateJson, MODELS } from '@/lib/ai/generate'
import { inbox, forgetCampaign as forgetInChat, type Conversation } from '@/lib/chat/store'
import { allPieces, forgetCampaign as forgetInCopy, type Piece } from '@/lib/content/studio'
import { why } from '@/lib/chat/reasons'
import { campaignProducts } from '@/lib/template/columns'
import { OFFER_MECHANICS } from '@/lib/brief'
import { blockers, check, isProductIdentity } from '@/lib/content/guard'
import { retrieve } from '@/lib/rag/retrieve'

export type Campaign = {
  id: string
  name: string
  context: string
  created_at: string
}

/** A product this campaign promoted, and how far it got. */
export type Promoted = {
  sku: string
  name: string
  /** Designs exported carrying this campaign. */
  designs: number
  /** Copy drafted, and how much of it a human approved. */
  drafts: number
  approved: number
  /** Conversations in which the assistant answered about this product. */
  asked: number
  /**
   * Posts that actually went out carrying this product.
   *
   * The last step of the loop, and it was missing: posts have been stamped with
   * the campaign since D83 and `postedFor` has never been called outside its own
   * test, while the Publish screen promised everything was "counted in its
   * report". A design exported and a design a customer saw are different facts
   * and this is the one marketing came for.
   */
  posted: number
}

/** A question the assistant handed to a person, with the reason it did. */
export type Unanswered = {
  conversation: string
  at: string
  question: string
  why: string
}

export type Report = {
  campaign: Campaign
  promoted: Promoted[]
  /**
   * Products customers asked about that this campaign never promoted. The other
   * half of the return leg: marketing chose twelve products and customers came
   * asking about four different ones.
   */
  unpromoted: { sku: string; name: string; asked: number }[]
  unanswered: Unanswered[]
  conversations: number
}

const rowToCampaign = (r: Record<string, unknown>): Campaign => ({
  id: String(r.id),
  name: String(r.name),
  context: String(r.context ?? ''),
  created_at: new Date(r.created_at as string).toISOString(),
})

export async function list(): Promise<Campaign[]> {
  try {
    const rows = await query('select id, name, context, created_at from campaigns order by created_at desc')
    return rows.map(rowToCampaign)
  } catch {
    // No database, no migration, or Postgres is not running. The caller shows
    // that state rather than an empty list, which would read as "no campaigns".
    return []
  }
}

export async function get(id: string): Promise<Campaign | null> {
  const rows = await query('select id, name, context, created_at from campaigns where id = $1', [id])
  return rows.length ? rowToCampaign(rows[0]) : null
}

/**
 * The campaign new work is stamped with, or null when there is none.
 *
 * Never throws. It is called on the path of an export, a draft and a customer's
 * first message, and a database that is down must not take any of those with it
 * — an unstamped asset is a gap in a report, an export that fails is a person's
 * afternoon.
 */
export async function current(): Promise<string | null> {
  return (await currentCampaign())?.id ?? null
}

/** The whole row, for the one caller that needs `context` too — the studio. */
export async function currentCampaign(): Promise<Campaign | null> {
  try {
    const rows = await query('select id, name, context, created_at from campaigns order by created_at desc limit 1')
    return rows.length ? rowToCampaign(rows[0]) : null
  } catch {
    return null
  }
}

/** `Eid sale — TVs` → `eid-sale-tvs`. Ids are stamped on data forever, so they read. */
const slug = (name: string): string =>
  name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)

export async function create(name: string, context = ''): Promise<Campaign> {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('A campaign needs a name.')

  const base = slug(trimmed) || 'campaign'
  const taken = new Set(
    (await query<{ id: string }>('select id from campaigns where id like $1', [`${base}%`])).map((r) => r.id),
  )
  // A name reused a year later is a different campaign and must not overwrite
  // the first one's history.
  let id = base
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`

  const rows = await query(
    'insert into campaigns (id, name, context) values ($1, $2, $3) returning id, name, context, created_at',
    [id, trimmed, context.trim()],
  )
  return rowToCampaign(rows[0])
}

/**
 * Delete a campaign, and un-stamp everything that carried it.
 *
 * The row goes; the work does not. Designs, drafts and conversations made under
 * it are real work somebody did, and deleting a label is not a reason to lose
 * them. What must not survive is the id itself — `campaign_id` pointing at a
 * row that no longer exists makes `report()` answer zero for work that really
 * happened, and a confident zero reads as a fact rather than a dangling
 * reference. There is no foreign key to do this for us, deliberately (see
 * db/004_campaigns.sql): two of the three consumers are still files.
 *
 * So all three are cleared here, in the same call, or the guarantee is worth
 * nothing. The counts come back so the screen can say what it just detached
 * rather than reporting a bare success.
 *
 * Irreversible: the loop's history for that campaign is what is being thrown
 * away, and nothing else in the system can reconstruct it. The screen asks
 * first, and it asks with the numbers in front of the person.
 */
export async function remove(id: string): Promise<{
  gone: boolean; designs: number; drafts: number; conversations: number
}> {
  const rows = await query<{ id: string }>('delete from campaigns where id = $1 returning id', [id])
  if (!rows.length) return { gone: false, designs: 0, drafts: 0, conversations: 0 }

  // Postgres first, files after. If the row is gone the id is dead either way,
  // and leaving a stamp on a file is recoverable by re-running this; leaving
  // the row while clearing the files is not.
  const cleared = await query<{ n: string }>(
    'update assets set campaign_id = null where campaign_id = $1 returning sku', [id],
  ).catch(() => [] as { n: string }[])

  return {
    gone: true,
    designs: cleared.length,
    drafts: forgetInCopy(id),
    conversations: forgetInChat(id),
  }
}

export async function setContext(id: string, context: string): Promise<void> {
  await query('update campaigns set context = $1 where id = $2', [context.trim(), id])
}

/** Product names for a set of SKUs. A SKU the catalogue lost still gets a row. */
async function namesFor(skus: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>()
  if (!skus.length) return names
  try {
    const rows = await query<{ sku: string; name: string | null }>(
      'select sku, coalesce(display_name, name_en) as name from products where sku = any($1)',
      [skus],
    )
    for (const r of rows) if (r.name) names.set(r.sku, r.name)
  } catch { /* a report without names is still a report */ }
  return names
}

const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1)

/**
 * Both legs of the loop for one campaign.
 *
 * Reads three stores — `assets` in Postgres, content drafts and conversations on
 * disk — and joins them in TypeScript. At sixty products and a few hundred
 * conversations that is milliseconds; `docs/db.md` records what the two file
 * stores' first migrations must carry when they move.
 */
export async function report(id: string): Promise<Report | null> {
  const campaign = await get(id)
  if (!campaign) return null

  const designs = new Map<string, number>()
  for (const r of await query<{ sku: string }>('select sku from assets where campaign_id = $1', [id])) {
    bump(designs, r.sku)
  }

  const drafts = new Map<string, number>()
  const approved = new Map<string, number>()
  let pieces: Piece[] = []
  try { pieces = allPieces() } catch { /* no drafts written yet */ }
  for (const p of pieces) {
    if (p.campaign_id !== id) continue
    bump(drafts, p.sku)
    if (p.status === 'approved') bump(approved, p.sku)
  }

  // A product counts as asked about when the assistant ANSWERED about it —
  // `cited_ids`, not `retrieved_ids`. Retrieval returns its top few rows for
  // every question, so counting those would report interest in whatever the
  // catalogue happens to rank near the words used. The questions retrieval could
  // not place are not lost by this: they escalate, and they are the list below.
  const asked = new Map<string, number>()
  const unanswered: Unanswered[] = []
  let convos: Conversation[] = []
  try { convos = inbox() } catch { /* nobody has used the widget yet */ }
  const mine = convos.filter((c) => c.campaign_id === id)

  for (const c of mine) {
    const once = new Set<string>()
    c.messages.forEach((m, i) => {
      if (!m.provenance) return
      for (const sku of m.provenance.cited_ids) once.add(sku)
      if (!m.provenance.escalated) return
      // The question is the customer's last words before the assistant gave up.
      // Printing the assistant's own reply instead would show the same apology
      // over and over and say nothing about what the catalogue is missing.
      const question = [...c.messages.slice(0, i)].reverse().find((p) => p.sender === 'customer')
      unanswered.push({
        conversation: c.id,
        at: m.at,
        question: question?.text ?? '(no question recorded)',
        why: why(m.provenance.reason),
      })
    })
    for (const sku of once) bump(asked, sku)
  }

  // Empty when Postgres is down, like every other read here — a report missing
  // its publish counts is still a report.
  const posted = await postedFor(campaign.id)

  // Posted counts as promoted. A product that was published without ever being
  // designed or drafted here (a caption written by hand, say) would otherwise
  // drop out of the table entirely, which is the loop's own last step going
  // missing from the screen built to show it.
  const promotedSkus = [...new Set([...designs.keys(), ...drafts.keys(), ...posted.keys()])]
  const names = await namesFor([...new Set([...promotedSkus, ...asked.keys()])])
  const named = (sku: string) => names.get(sku) ?? sku

  const promoted: Promoted[] = promotedSkus
    .map((sku) => ({
      sku,
      name: named(sku),
      designs: designs.get(sku) ?? 0,
      drafts: drafts.get(sku) ?? 0,
      approved: approved.get(sku) ?? 0,
      asked: asked.get(sku) ?? 0,
      posted: posted.get(sku) ?? 0,
    }))
    // What customers asked about first: that is the column marketing came for.
    .sort((a, b) => b.asked - a.asked || a.name.localeCompare(b.name))

  const unpromoted = [...asked.entries()]
    .filter(([sku]) => !promotedSkus.includes(sku))
    .map(([sku, n]) => ({ sku, name: named(sku), asked: n }))
    .sort((a, b) => b.asked - a.asked)

  return {
    campaign,
    promoted,
    unpromoted,
    unanswered: unanswered.sort((a, b) => b.at.localeCompare(a.at)),
    conversations: mine.length,
  }
}

/* ── Help writing one ─────────────────────────────────────────────────────
 * Making a campaign is the first thing anybody does here, and a blank form is
 * the worst possible first screen: the fields are load-bearing — stamped on
 * every design and caption from then on — and nothing on screen says what a
 * good answer looks like.
 *
 * The first version of this asked for a name and a summary paragraph, and it
 * handed back what you typed: its entire grounding was a comma-list of category
 * names. Type "laptops for students in September" and it replied "Back to
 * school — laptops" plus a paragraph about laptops, students and September. The
 * honest reaction is *I typed that.*
 *
 * So it is grounded in the four things the person genuinely does not have in
 * front of them — what the catalogue actually holds, where in the retail year
 * today falls, which offer mechanics exist in this market, and what the last
 * campaign said — and it is asked for the field a 12B model is actually better
 * at than a blank box: the single-minded proposition. One sentence, one idea.
 */

/**
 * The products this idea is actually about, grouped by category.
 *
 * This replaced a comma-list of twenty category names, and it is the change
 * that makes the assist say something the person did not type: "Standard
 * Laptops, Convertible Laptops, Copilot Laptops" is the shop's filing system
 * read back, while "MacBook Air 13 M4, Lenovo IdeaPad Slim 3" is what is on the
 * shelf. Retrieval is already loaded for this request.
 *
 * Names and categories only. No price, no sale price, no specs — the model has
 * no use for a figure it may not write, and a figure it has seen is a figure it
 * paraphrases. The count the marketer actually wants comes from SQL, beside the
 * Pushing input, and never through the model.
 */
async function matchingRows(idea: string): Promise<string> {
  const hits = await retrieve(idea, 15).catch(() => [])
  if (!hits.length) return ''
  const byCategory = new Map<string, string[]>()
  for (const h of hits) {
    const cat = String(h.row.category ?? 'Other').trim() || 'Other'
    const name = String(h.row.display_name ?? h.row.name_en ?? '').trim()
    if (!name) continue
    byCategory.set(cat, [...(byCategory.get(cat) ?? []), name])
  }
  return [...byCategory].map(([cat, names]) => `${cat}: ${names.join(', ')}`).join('\n')
}

/**
 * Where today sits in the Kuwait retail year.
 *
 * Only the windows fixed to the Gregorian calendar are derived here.
 * knowledge/kuwait/evergreen/retail-calendar.md is explicit that the Hijri
 * dates shift ~11 days a year and says "always confirm the actual dates; do not
 * compute them" — so Ramadan and the two Eids are never asserted by this code,
 * and the note below says out loud that a person has to confirm them. A
 * confidently wrong Ramadan date is exactly the failure the file warns about.
 *
 * Exported: the campaign meeting (docs/superpowers/specs/2026-09-02-campaign-meeting-design.md) shares this rather than reimplementing it.
 */
export function whereInTheYear(now = new Date()): string {
  const month = now.getUTCMonth() + 1
  const day = now.getUTCDate()
  if (month === 2) {
    return day >= 25
      ? 'National Day and Liberation Day, 25–26 February, run as one two-day period. Patriotic themes, heavy decoration.'
      : 'Hala Febrayer runs through February — Kuwait’s own festival season and the biggest fixed retail window in the year.'
  }
  if (month === 8 || month === 9) return 'Back to School — late summer into September.'
  if (month === 6 || month === 7) return 'Summer travel: a long outbound period, much of the audience is abroad, and electronics move earlier than the trip.'
  if (month === 11) return 'Black Friday is observed here, though some retailers frame it as White Friday.'
  return ''
}

/**
 * True every week of the year, so it is always appended rather than derived.
 * Lifted from retail-calendar.md; it changes what "the weekend" means in a
 * brief, and a model trained mostly on Saturday–Sunday markets gets it wrong.
 *
 * Exported: also appended by the campaign meeting, same reason as above.
 */
export const WEEKEND = 'The Kuwaiti weekend is Friday and Saturday; Thursday evening behaves like a Friday evening elsewhere.'

/**
 * The compliance rules from their source rather than paraphrased.
 *
 * Read here as well as in the studio because a superlative in the brief is
 * worse than one in a caption: the brief steers every caption written under it,
 * so "best prices in Kuwait" typed once becomes sixty blocked drafts later.
 * Cheaper to prevent at brief time than to detect sixty times.
 *
 * Exported: the campaign meeting reads the same file through this, not a copy.
 */
export function guardrails(): string {
  try {
    return readFileSync(join(process.cwd(), 'knowledge/kuwait/compliance-guardrails.md'), 'utf8')
  } catch {
    return ''
  }
}

const SuggestSchema = z.object({
  name: z.string().min(3).max(60),
  pushing: z.string().max(120),
  audience: z.string().max(120),
  // An enum, not a string: the mechanics are a closed list, and a constrained
  // decode cannot return a sixth one for the form to silently drop.
  offer: z.enum(OFFER_MECHANICS),
  say: z.string().min(10).max(120),
  channels: z.array(z.enum(['Snapchat', 'Instagram', 'TikTok', 'YouTube', 'X'])).min(1).max(3),
  runs: z.string().max(80),
})

export type Suggestion = z.infer<typeof SuggestSchema> & {
  /** Figures the model wrote. Shown to the person, never quietly kept. */
  invented: string[]
  /** Why the proposition is not yet single-minded, if it is not. */
  weak: string[]
  model: string
}

/**
 * The catalogue's identity text, shaped as a row so `isProductIdentity` can
 * read it.
 *
 * A campaign is not about one product, so there is no single row to check a
 * word against — but "M4" and "M3" are what the products ARE, and the first
 * version of this flagged both as invented figures because it used a bare digit
 * regex instead of the check that already exists for exactly this. A model name
 * on a box is not a price somebody made up.
 */
async function catalogueIdentity(): Promise<Record<string, unknown>> {
  const products = await campaignProducts()
  return {
    name_en: products.map((p) => `${p.name_en ?? ''} ${p.brand ?? ''} ${p.category ?? ''}`).join(' '),
  }
}

/**
 * A campaign brief from a rough idea.
 *
 * One constrained call, not the studio's prose-then-structure pair, and that is
 * a considered exception: every field here is a label or a single sentence, not
 * copy anybody publishes, so there is no long-form writing quality to protect —
 * and this call sits between a person and the first thing they do in the
 * system, where the wait is the cost that matters.
 *
 * Figures are extracted rather than trusted. What comes back steers every
 * prompt downstream, so a price the model invented here would ride into
 * captions wearing a person's authority — CLAUDE.md rule 2, one layer out. The
 * person's own figure goes on the Offer line in the form, which is a different
 * thing entirely and is allowed.
 */
export async function suggest(idea: string): Promise<Suggestion> {
  const rows = await matchingRows(idea)
  const season = whereInTheYear()
  const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
  // What this team already said. Two, not ten: the point is continuity of
  // voice, and a model shown ten past briefs starts averaging them.
  const before = (await list().catch(() => [] as Campaign[]))
    .slice(0, 2)
    .filter((c) => c.context.trim())

  const out = await generateJson(
    [
      'You are a campaign planner for a consumer electronics shop in Kuwait.',
      'A colleague has given you a rough idea. Turn it into the head of a brief.',
      '',
      `THE ROUGH IDEA:\n${idea}`,
      '',
      `TODAY IS ${today}. What is happening in Kuwait retail right now:`,
      season || 'No fixed retail window this month.',
      WEEKEND,
      // Named rather than computed: retail-calendar.md says the Hijri dates
      // shift ~11 days a year and "always confirm the actual dates; do not
      // compute them". A confidently wrong Ramadan date is the exact failure.
      'Ramadan and the two Eids move about eleven days earlier each year. Never state a date for',
      'them and never assume one is near — a person confirms those.',
      '',
      rows
        ? `PRODUCTS IN THE CATALOGUE THAT MATCH THE IDEA — name only these kinds of thing:\n${rows}`
        : '',
      '',
      `OFFER MECHANICS THAT EXIST IN THIS MARKET — pick the closest ONE, spelled exactly:\n${OFFER_MECHANICS.join(' | ')}`,
      'Was/now pairs are the strongest performer in electronics here. Instalment framing is',
      'widespread in Gulf electronics retail. Bundles pair a device with an accessory.',
      '',
      'CHANNELS:',
      'Snapchat is not a secondary channel in Kuwait; it reaches nearly half the country.',
      'The first few seconds decide distribution; Snapchat’s own guidance is stricter still.',
      'Vertical, full-screen, sound-independent — much viewing is muted.',
      before.length
        ? `\nWHAT THIS TEAM SAID ON ITS LAST CAMPAIGN${before.length > 1 ? 'S' : ''} — match the voice, do not copy the content:\n${before.map((c) => `${c.name}:\n${c.context}`).join('\n\n')}`
        : '',
      '',
      guardrails(),
      '',
      'RETURN THESE FIELDS. The hardest one first, because it is the one that matters:',
      '',
      'say — the single-minded proposition: the ONE thing the audience should take away, in one',
      'sentence under fifteen words. No "and", no comma-joined list, no second idea — if it needs',
      'an "and" it is two campaigns. Make it about what the customer GETS, not what the shop is',
      'doing: "a laptop that lasts the whole degree" is a proposition; "get great deals on our',
      'laptop range" is an announcement. No superlatives — "best", "ultimate", "fastest" are',
      'claims nobody can substantiate and are blocked downstream. This is the line every caption',
      'will be a different way of saying, so it has to be worth saying twenty times.',
      '',
      'name — what to call this campaign, under eight words. It is stamped on every design and',
      'caption, so it must read as a label somebody recognises months later: "Back to school —',
      'laptops". Not a slogan, not a sentence.',
      '',
      'pushing — what is being promoted, in the plain words a person would say out loud: two to',
      'six words, like "laptops and tablets". NOT a list of the shop’s category labels, and not a',
      'product name — those are how the catalogue files things, not how anybody describes a',
      'campaign. It must still be a kind of thing that appears in the product rows above.',
      '',
      'audience — who it is for and what they already believe or worry about. Not a demographic',
      'bracket. "Students, and the parents actually paying" beats "18-24".',
      '',
      'offer — one of the mechanics listed above, spelled exactly as written there. If the idea',
      'describes no offer, answer "No offer — new arrivals". Describe nothing numeric: the',
      'specifics are a separate field a PERSON fills in.',
      '',
      'channels — up to three, from Snapchat, Instagram, TikTok, YouTube, X.',
      '',
      'runs — when it runs, as a phrase and never as dates: "through the first week of September".',
      '',
      'NEVER WRITE A NUMBER in any field — no price, no percentage, no date, no quantity. Describe',
      'an offer in words and let a person fill the figure in.',
      'Invent no product, no brand and no partnership that is not in the idea or the rows above.',
    ].filter(Boolean).join('\n'),
    SuggestSchema,
    z.toJSONSchema(SuggestSchema),
    { maxTokens: 600 },
  )

  // A figure in any field. Checked here rather than asked of the model: the
  // thing that wrote the number is the wrong thing to ask about it.
  //
  // A token carrying a LETTER is exempt when the catalogue's own identity text
  // holds it — "iPad Pro M4" is what the product is called. A bare number never
  // is: the joined identity text of sixty products contains most small integers
  // by accident, so exempting those would exempt everything.
  const identity = await catalogueIdentity()
  const invented = [...`${out.name} ${out.pushing} ${out.audience} ${out.say}`.matchAll(/\S*\d[\d.,%]*\S*/g)]
    .map((m) => m[0])
    .filter((w) => !(/\p{L}/u.test(w) && isProductIdentity(w, identity)))

  // Not a blocker — the person edits this before anything is saved — but said
  // out loud, because both failures are invisible until a caption carries them.
  // A superlative in the context propagates into every draft written under it,
  // and a proposition with an "and" in it is two campaigns wearing one name.
  const weak = [
    ...blockers(check(`${out.name} ${out.say}`, identity))
      .filter((c) => c.name === 'no unsubstantiable superlative' || c.name === 'no comparison to a competitor')
      .map((c) => `“${c.span}” is a claim nobody can back — the advisor blocks it in copy too.`),
    ...(/\band\b/i.test(out.say)
      ? ['The one thing to say has an “and” in it, so it is two things. Pick the one that sells.']
      : []),
  ]

  return { ...out, invented: [...new Set(invented)], weak, model: MODELS.english }
}
