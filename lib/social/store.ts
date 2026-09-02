/**
 * Connected accounts, and what was published to them.
 *
 * The four pillars all stop at a file: a rendered poster, an approved caption.
 * Somebody then opens Meta's app and types it in again — and the moment they do,
 * the loop this system exists to close has a gap in it. `campaigns.report()` can
 * say twelve designs were exported and nothing about which ones went out.
 *
 * This is the smallest thing that closes it: which accounts we can post as, and
 * one row per publish attempt with how it ended.
 *
 * Two things are load-bearing here and both are enforced in db/005_social.sql:
 *
 * **A token is never returned by a listing.** `accounts()` selects columns by
 * name and `token_cipher` is not among them, so a screen or an API route cannot
 * accidentally serialise one. Exactly one function decrypts, and its name says
 * so.
 *
 * **A publish is written before it is attempted.** `startPost` inserts
 * `publishing`, the caller then does the slow, failable part, and `succeeded` or
 * `failed` closes the row. A crash mid-request leaves a row saying what was
 * being attempted rather than leaving no trace of a post that may well have gone
 * out — which is the state a person cannot recover from, because the only way to
 * check is to go and look at the account.
 */

import { randomUUID } from 'node:crypto'
import { query } from '@/lib/db'
import { decrypt, encrypt } from '@/lib/social/tokens'

// Instagram is the only platform anything writes since D86 — publishing through
// a Facebook Page needs a Meta Business portfolio the shop could not create. The
// union and the table's check constraint still allow 'facebook' because dropping
// it is a migration that buys nothing, and because a Page path may come back.
export type Platform = 'facebook' | 'instagram'
export type PostStatus = 'scheduled' | 'publishing' | 'posted' | 'failed' | 'missed'

export type Account = {
  id: string
  platform: Platform
  external_id: string
  name: string
  connected_at: string
}

export type Post = {
  id: string
  campaign_id: string | null
  skus: string[]
  account_id: string
  caption: string
  image_urls: string[]
  image_public_ids: string[]
  status: PostStatus
  platform_post_id: string | null
  permalink_url: string | null
  error: string | null
  posted_at: string | null
  /** When it should go out. Null for a post sent by hand. */
  scheduled_at: string | null
  created_at: string
}

/** What connecting an account supplies. The id is derived, never passed in. */
export type Connecting = {
  platform: Platform
  external_id: string
  name: string
  /** The long-lived token, in the clear. Encrypted here and nowhere else. */
  token: string
}

/**
 * `instagram:178…`. Derived rather than generated so that reconnecting the same
 * account updates the row it already has — a second row pointing at the same place
 * means two entries in a picker that post to one destination, and the person
 * choosing has no way to tell which token is the live one.
 */
export const accountId = (platform: Platform, externalId: string): string => `${platform}:${externalId}`

const ACCOUNT_COLS = 'id, platform, external_id, name, connected_at'

const rowToAccount = (r: Record<string, unknown>): Account => ({
  id: String(r.id),
  platform: r.platform as Platform,
  external_id: String(r.external_id),
  name: String(r.name),
  connected_at: new Date(r.connected_at as string).toISOString(),
})

const rowToPost = (r: Record<string, unknown>): Post => ({
  id: String(r.id),
  campaign_id: (r.campaign_id as string | null) ?? null,
  skus: (r.skus as string[]) ?? [],
  account_id: String(r.account_id),
  caption: String(r.caption),
  image_urls: (r.image_urls as string[]) ?? [],
  image_public_ids: (r.image_public_ids as string[]) ?? [],
  status: r.status as PostStatus,
  platform_post_id: (r.platform_post_id as string | null) ?? null,
  permalink_url: (r.permalink_url as string | null) ?? null,
  error: (r.error as string | null) ?? null,
  posted_at: r.posted_at ? new Date(r.posted_at as string).toISOString() : null,
  scheduled_at: r.scheduled_at ? new Date(r.scheduled_at as string).toISOString() : null,
  created_at: new Date(r.created_at as string).toISOString(),
})

/**
 * Connect an account, or refresh the one already there.
 *
 * Tokens expire and get re-issued, so this is an upsert on every field but
 * `connected_at`: reconnecting is the normal way a token gets replaced, and it
 * must not be the way an account acquires a duplicate.
 *
 * Not wrapped in a catch. A connection that silently did nothing is worse than
 * an error — the person walks away believing the shop can post.
 */
export async function connect(a: Connecting): Promise<Account> {
  const id = accountId(a.platform, a.external_id)
  const rows = await query(
    `insert into social_accounts (id, platform, external_id, name, token_cipher)
     values ($1, $2, $3, $4, $5)
     on conflict (id) do update set
       name         = excluded.name,
       token_cipher = excluded.token_cipher
     returning ${ACCOUNT_COLS}`,
    [id, a.platform, a.external_id, a.name, encrypt(a.token)],
  )
  return rowToAccount(rows[0])
}

/**
 * Everything connected, oldest first, and never the tokens.
 *
 * Empty on a database that is not running, the same way `campaigns.list()` is:
 * this is read on the way into a screen, and the screen says which state it is
 * in rather than turning a stopped container into a crash.
 */
export async function accounts(): Promise<Account[]> {
  try {
    const rows = await query(`select ${ACCOUNT_COLS} from social_accounts order by connected_at`)
    return rows.map(rowToAccount)
  } catch {
    return []
  }
}

/**
 * Forget an account and everything published through it.
 *
 * The posts go with it, by cascade. That is the opposite of what deleting a
 * campaign does, and the difference is real: a campaign is a label over work
 * that still exists, while these rows are a history of an authority we no longer
 * hold — nothing can re-read a permalink, delete an uploaded image, or explain a
 * failure once the token is gone. Returns whether there was anything to forget.
 */
export async function disconnect(id: string): Promise<boolean> {
  const rows = await query<{ id: string }>('delete from social_accounts where id = $1 returning id', [id])
  return rows.length > 0
}

/**
 * The decrypted token, or null when no such account is connected.
 *
 * The one function that decrypts, and the only reason `token_cipher` is ever
 * selected. Null means "not connected"; a token that will not decrypt throws,
 * because a rotated key and an absent account are different problems and only
 * one of them is fixed by connecting again.
 */
export async function tokenFor(id: string): Promise<string | null> {
  let cipher: string | undefined
  try {
    const rows = await query<{ token_cipher: string }>(
      'select token_cipher from social_accounts where id = $1', [id],
    )
    cipher = rows[0]?.token_cipher
  } catch {
    return null
  }
  return cipher ? decrypt(cipher) : null
}

/**
 * Record a publish that is about to be attempted.
 *
 * Written before the request leaves, so the row exists even if the process dies
 * while Meta is thinking about it. `image_public_ids` is stored beside the URLs
 * because the ids are the only handle on media already uploaded — without them
 * a failed publish leaves images on the host that nothing can reach to delete.
 */
export async function startPost(p: {
  accountId: string
  caption: string
  imageUrls?: string[]
  imagePublicIds?: string[]
  campaignId?: string | null
  /** Every product the post is about, in the order their images appear. */
  skus?: string[]
  /**
   * When to send it, for a post nobody is waiting on (D89).
   *
   * With this set the row lands as `scheduled` and NOTHING is attempted — the
   * images are already uploaded and the caption fixed, so the sweep has one
   * Instagram call left and no decisions. Without it the row lands as
   * `publishing`, which means a request that may already have reached Meta.
   */
  scheduledAt?: Date | null
}): Promise<Post> {
  const rows = await query(
    `insert into social_posts
       (id, campaign_id, skus, account_id, caption, image_urls, image_public_ids,
        status, scheduled_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     returning *`,
    [
      randomUUID(), p.campaignId ?? null, p.skus ?? [], p.accountId, p.caption,
      p.imageUrls ?? [], p.imagePublicIds ?? [],
      p.scheduledAt ? 'scheduled' : 'publishing', p.scheduledAt ?? null,
    ],
  )
  return rowToPost(rows[0])
}

/**
 * The scheduled posts whose time has come, and which are still worth sending.
 *
 * Two bounds, not one. `scheduled_at <= now()` is due; `scheduled_at > now() -
 * grace` is still current. A post that came due while the laptop was asleep
 * falls out of the second and is NOT returned here — see `giveUp`. Sending it
 * anyway is how a "tonight only" offer reaches customers the next morning.
 *
 * Ordered oldest first so a backlog goes out in the order somebody intended.
 */
export async function due(graceMs: number): Promise<Post[]> {
  try {
    const rows = await query(
      `select * from social_posts
        where status = 'scheduled'
          and scheduled_at <= now()
          and scheduled_at > now() - ($1::text || ' milliseconds')::interval
        order by scheduled_at`,
      [String(graceMs)],
    )
    return rows.map(rowToPost)
  } catch {
    return []
  }
}

/**
 * Give up on everything whose moment passed while nothing was running.
 *
 * Returns how many, because a sweep that quietly retires six posts is a sweep
 * nobody knows ran. The row keeps its caption, its images and its time, so the
 * screen can offer to send it now — this marks a decision as needed, it does not
 * throw the work away.
 */
export async function giveUp(graceMs: number): Promise<number> {
  try {
    const rows = await query<{ id: string }>(
      `update social_posts
          set status = 'missed',
              error = 'Its time passed while nothing was running to send it.'
        where status = 'scheduled'
          and scheduled_at <= now() - ($1::text || ' milliseconds')::interval
        returning id`,
      [String(graceMs)],
    )
    return rows.length
  } catch {
    return 0
  }
}

/**
 * Move a scheduled or missed post to `publishing`, and say whether it was ours
 * to move.
 *
 * The guard on `status` is the whole point: two sweeps overlapping, or a sweep
 * racing somebody pressing "Post it now", must not both publish the same row.
 * Postgres decides — whoever updates the row first gets true, the other gets
 * false and does nothing.
 */
export async function claim(id: string): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `update social_posts set status = 'publishing'
      where id = $1 and status in ('scheduled','missed')
      returning id`,
    [id],
  )
  return rows.length > 0
}

/**
 * Forget a post that has not gone out, and hand back the images it was holding.
 *
 * Refuses anything already published — a public post cannot be unpublished from
 * here, and a function that pretended otherwise would be worse than none.
 *
 * The public ids come back because this row is the ONLY thing that knows which
 * uploaded images belong to it. Deleting it silently would leave them on a paid
 * host with nothing able to reach them again — the same paid-for litter the
 * publish route already cleans up when an upload fails halfway.
 *
 * **`failed` is on this list, and was not.** A publish that threw — an expired
 * token, sixty days after connecting, is the ordinary way — left a row nothing
 * could act on: `claim` and this function both matched only scheduled and
 * missed, and the screen offered its buttons on the same two. So the row sat
 * there forever and its uploaded images sat on Cloudinary forever with nothing
 * able to name them again. A failed post never went out, which makes it exactly
 * the kind of thing this function exists to forget.
 *
 * Null when there was nothing to forget, which is different from an empty list.
 */
export async function unschedule(id: string): Promise<string[] | null> {
  const rows = await query<{ image_public_ids: string[] }>(
    `delete from social_posts where id = $1 and status in ('scheduled','missed','failed')
      returning image_public_ids`,
    [id],
  )
  return rows.length ? (rows[0].image_public_ids ?? []) : null
}

/** What is waiting to go out, and what was missed. Soonest first. */
export async function upcoming(): Promise<Post[]> {
  try {
    const rows = await query(
      `select * from social_posts where status in ('scheduled','missed')
        order by scheduled_at`,
    )
    return rows.map(rowToPost)
  } catch {
    return []
  }
}

/**
 * `posted_at` is set here rather than at `startPost`, because it means the
 * moment it went out and not the moment somebody pressed the button. On a slow
 * upload those are minutes apart, and the first is the one a report is about.
 */
export async function succeeded(id: string, platformPostId: string, permalinkUrl?: string): Promise<void> {
  await query(
    `update social_posts
        set status = 'posted', platform_post_id = $2, permalink_url = $3, error = null, posted_at = now()
      where id = $1`,
    [id, platformPostId, permalinkUrl ?? null],
  )
}

/**
 * The message is kept, because "it failed" sends a person to Meta's dashboard
 * and "(#10) requires pages_manage_posts" tells them what to fix. Callers pass
 * the platform's own words; nothing here has a token to leak into them.
 */
export async function failed(id: string, message: string): Promise<void> {
  await query(
    `update social_posts set status = 'failed', error = $2, posted_at = null where id = $1`,
    [id, message],
  )
}

/**
 * History, newest first. Empty rather than throwing when Postgres is down, for
 * the same reason as `accounts()`.
 *
 * `limit` is capped: this feeds a screen, and a caller passing a number from a
 * query string should not be able to ask for the whole table.
 */
export async function posts(
  { campaignId, sku, limit = 50 }: { campaignId?: string; sku?: string; limit?: number } = {},
): Promise<Post[]> {
  const where: string[] = []
  const params: unknown[] = []
  if (campaignId) where.push(`campaign_id = $${params.push(campaignId)}`)
  // A post is about a list now, so 'this SKU' is membership, not equality.
  if (sku) where.push(`$${params.push(sku)} = any(skus)`)

  try {
    const rows = await query(
      `select * from social_posts
        ${where.length ? `where ${where.join(' and ')}` : ''}
        order by created_at desc
        limit $${params.push(Math.min(Math.max(limit, 1), 500))}`,
      params,
    )
    return rows.map(rowToPost)
  } catch {
    return []
  }
}

/**
 * How many posts actually went out carrying each SKU, for one campaign.
 *
 * `posted` only. A failed attempt is a thing to look at on the history screen,
 * not a thing to count in a report — the report answers "we promoted these
 * twelve products", and a product whose only publish failed was not promoted.
 *
 * ── what the number means, exactly ──
 *
 * POSTS carrying the SKU, not customers reached and not products. Two things
 * make those differ, and both are correct rather than bugs to fix here:
 *
 *   - `startPost` writes one row PER ACCOUNT, so the same design published to
 *     two Instagram accounts is two posts. It is: two audiences saw it.
 *   - one carousel carrying ten products adds one to each of ten SKUs.
 *
 * The `distinct` is not decoration. A carousel with the hero product on slide
 * one and again on slide ten unnests to two rows for one post, and without it
 * that post is counted twice — a wrong number rather than a missing one, which
 * is the failure mode this project cares most about.
 *
 * A Map because `campaigns.report()` joins in TypeScript against SKUs it already
 * has. Empty when the database is down, matching every other read in the report.
 */
export async function postedFor(campaignId: string): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  try {
    const rows = await query<{ sku: string; n: string }>(
      `select sku, count(*)::text as n
         from (select distinct id, unnest(skus) as sku
                 from social_posts
                where campaign_id = $1 and status = 'posted') one_per_post
        group by sku`,
      [campaignId],
    )
    for (const r of rows) counts.set(r.sku, Number(r.n))
  } catch { /* a report without publish counts is still a report */ }
  return counts
}
