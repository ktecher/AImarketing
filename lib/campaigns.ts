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

import { query } from '@/lib/db'
import { inbox, type Conversation } from '@/lib/chat/store'
import { allPieces, type Piece } from '@/lib/content/studio'
import { why } from '@/lib/chat/reasons'

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

  const promotedSkus = [...new Set([...designs.keys(), ...drafts.keys()])]
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
