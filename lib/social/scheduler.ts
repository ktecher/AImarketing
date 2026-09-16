/**
 * The one thing in this project that acts without a person present.
 *
 * D83 said publishing is "never automatic, not on a timer". D89 widened that,
 * and this file is the whole of the widening — so it is worth being exact about
 * what it may and may not do.
 *
 * It may send a post that a person built, read, and set a time on. Everything
 * that involves judgement already happened: the design is rendered, the image is
 * on Cloudinary, the caption is fixed and approved. What is left is one Instagram
 * call. This module decides nothing about content; it decides *now* or *too
 * late*, and nothing else.
 *
 * It may not create a post, pick a product, write a caption, or retry forever.
 *
 * ── why `missed` exists ──
 *
 * This runs on a laptop that sleeps, and eventually on a server that will still
 * be restarted. A post whose moment passed while nothing was running has two bad
 * endings and one good one:
 *
 *   - sit on `scheduled` forever — a screen promising a future that will not come
 *   - fire whenever the machine next wakes — a "tonight only" offer reaching
 *     customers the following morning, which is worse than not posting
 *   - land as `missed`, visibly, and a person decides
 *
 * The grace window is which of the last two happens. Inside it, a laptop that was
 * shut for ten minutes still sends. Outside it, nobody sends on the app's behalf.
 */

import { abandon, failed, claim, due, giveUp, succeeded, tokenFor, upcoming, MAYBE_SENT, type Post } from '@/lib/social/store'
import { reachable } from '@/lib/db'
import { InstagramError, publishToInstagram } from '@/lib/social/instagram'

/**
 * How late is still worth sending.
 *
 * Thirty minutes: long enough to survive a closed lid over lunch, a restart, or
 * a migration, and short enough that nothing goes out into a different part of
 * the day than it was written for. Not configurable — a knob here is a knob that
 * gets turned up until the first bad post, and the honest fix for wanting a
 * bigger window is a machine that stays on.
 */
export const GRACE_MS = 30 * 60 * 1000

/** How often the sweep looks. A minute is finer than anybody schedules to. */
const EVERY_MS = 60 * 1000

/** What one pass did, so a caller can log or test it without reading the table. */
export type SweepResult = {
  sent: number
  failed: number
  missed: number
  /** Rows abandoned mid-publish by a crash, retired for a person to judge. */
  stuck?: number
  /** Set when Postgres could not be reached, so an outage is not read as a quiet pass. */
  down?: boolean
}

/**
 * How long a row may sit in `publishing` before it is treated as abandoned.
 *
 * `startPost` and `claim` both write `publishing` before the request leaves, so
 * a crash between that write and the result — a dev-server reload mid-publish, a
 * closed laptop, Ctrl-C — left a row NOTHING could reach: `claim`, `upcoming`
 * and `unschedule` all matched other statuses, so it could not be retried,
 * listed or dropped, and its uploaded images stayed on a paid host with only
 * that dead row able to name them.
 *
 * Ten minutes is far longer than any publish takes and short enough that a
 * person sees it the same afternoon.
 */
export const STUCK_MS = 10 * 60 * 1000

/**
 * One pass: retire what is too late, send what is due.
 *
 * Retiring comes FIRST. Doing it second leaves a window where a post that is
 * both overdue and inside the query's bounds gets published a moment before it
 * would have been given up on, which is a race whose outcome depends on how long
 * the previous post took to upload.
 *
 * Every post is caught individually. The realistic failure is one expired token,
 * and the other four in the queue are still perfectly sendable — the same reason
 * the publish route does not abort on one account.
 */
export async function sweep(): Promise<SweepResult> {
  // A database outage is not a quiet afternoon.
  //
  // `due()` returns [] and `giveUp()` returns 0 when Postgres is unreachable —
  // both swallow their errors so a blip cannot crash the timer — so this summed
  // to {sent: 0, failed: 0, missed: 0}, byte-identical to a healthy pass with
  // nothing due. The sweep runs every minute, unattended, and every scheduled
  // post in the queue would quietly miss its slot with nothing saying why.
  if (!(await reachable())) return { sent: 0, failed: 0, missed: 0, down: true }

  const stuck = await abandon(STUCK_MS)
  const missed = await giveUp(GRACE_MS)
  const ready = await due(GRACE_MS)

  let sent = 0
  let failedCount = 0
  for (const post of ready) {
    // Whoever claims it publishes it. Two overlapping sweeps, or a sweep racing
    // somebody pressing "Post it now", must not both send the same row —
    // Postgres decides, and the loser does nothing.
    if (!(await claim(post.id))) continue
    if ((await send(post)).ok) sent++
    else failedCount++
  }
  return { sent, failed: failedCount, missed, stuck }
}

/**
 * What happened when somebody pressed "Post it now".
 *
 * Three outcomes, not two. This used to be a bare `boolean`, and the route
 * turned every false into **"That post was already sent or is no longer
 * waiting"** — including the one case where the platform had just REFUSED it.
 *
 * The realistic failure is the sixty-day token expiring, which the `unschedule`
 * docstring already names as ordinary. The person pressed the button, Instagram
 * said no, the row went to `failed` with the real reason stored on it — and they
 * were told it had been sent. Refreshing corroborated the lie: `upcoming()`
 * returns only scheduled and missed, so the post had vanished from the panel
 * they were looking at.
 */
export type SendOutcome =
  | { outcome: 'sent' }
  /** Nothing to send: already published, or dropped. */
  | { outcome: 'gone' }
  /** A sweep or another tab claimed it first. It is being sent right now. */
  | { outcome: 'taken' }
  /** The platform refused it. `reason` is what the platform actually said. */
  | { outcome: 'refused'; reason: string }
  /**
   * The connection died mid-send, so it may or may not be public.
   *
   * Not a fourth flavour of failure — the opposite fact. A refusal means the
   * post is definitely not out; this means nobody knows, and the person has to
   * look at the account before pressing anything again. See `MAYBE_SENT`.
   */
  | { outcome: 'unknown'; reason: string }

/**
 * Send one scheduled or missed post now, by hand.
 *
 * The same claim and the same send the sweep uses, deliberately: a second path
 * to publishing is a second place for the token handling and the row bookkeeping
 * to drift.
 */
export async function sendNow(id: string): Promise<SendOutcome> {
  const rows = await upcoming()
  const post = rows.find((r) => r.id === id)
  if (!post) return { outcome: 'gone' }
  if (!(await claim(id))) return { outcome: 'taken' }

  // The same message `send` wrote to the row, taken from `send` rather than
  // read back out of the table: it is the report either way, and re-reading two
  // hundred rows to find a string we were just handed is a query for nothing.
  const r = await send(post)
  if (r.ok) return { outcome: 'sent' }
  return { outcome: r.refused ? 'refused' : 'unknown', reason: r.message }
}

/** How one attempt ended, and whether the platform actually answered. */
type Sent = { ok: true } | { ok: false; refused: boolean; message: string }

/**
 * One scheduled post, already rendered and uploaded. Never throws.
 *
 * `refused` separates two opposite facts. `InstagramError` is thrown only where
 * Meta ANSWERED — a socket reset or dropped Wi-Fi comes out of `fetch` as a
 * plain TypeError, and by then Meta may well have processed the request and the
 * post may be public right now. Writing "the platform refused it" on that row is
 * what makes somebody send it again and post the same poster twice, which is the
 * uncertainty `abandon()` already writes down for the crash version of it.
 */
async function send(post: Post): Promise<Sent> {
  // Flipped the moment the token is in hand: nothing above this line can put
  // bytes on the wire, so a failure there is a certainty rather than a mystery.
  let attempted = false
  try {
    const token = await tokenFor(post.account_id)
    if (!token) throw new Error('That account is no longer connected.')
    attempted = true

    const published = await publishToInstagram({
      igUserId: post.account_id.split(':')[1] ?? '',
      token,
      caption: post.caption,
      // Already on Cloudinary — uploaded when the post was scheduled, so nothing
      // here renders and nothing here can fail on a font or a missing photo.
      imageUrls: post.image_urls,
    })
    await succeeded(post.id, published.platformPostId, published.permalinkUrl || undefined)
    return { ok: true }
  } catch (e) {
    // The message is already scrubbed of the token where the response became an
    // Error. Nothing here logs it: a scheduled post fails while nobody is
    // watching, so the row IS the report.
    const said = e instanceof Error ? e.message : 'The platform refused this post.'
    const refused = !attempted || e instanceof InstagramError
    // The cause is kept in brackets: "fetch failed" is the difference between a
    // dead Wi-Fi and a dead machine, and the row is the only place it survives.
    const message = refused ? said : `${MAYBE_SENT} (${said})`
    await failed(post.id, message)
    return { ok: false, refused, message }
  }
}

/**
 * Start sweeping, once per server instance.
 *
 * Module-level, because `instrumentation.ts` can run `register()` more than once
 * across hot reloads in development and a second interval would double-send —
 * except it would not, because `claim()` makes that safe. This guard is about
 * not stacking timers, not about correctness.
 *
 * `running` stops a slow pass overlapping the next tick. A carousel of ten
 * images can take minutes, and a second sweep starting on top of it is how a
 * laptop ends up with six concurrent uploads.
 */
let timer: ReturnType<typeof setInterval> | null = null
let running = false

export function startSweeping(): void {
  if (timer) return
  timer = setInterval(() => {
    if (running) return
    running = true
    void sweep()
      .catch(() => { /* a sweep that cannot reach Postgres tries again in a minute */ })
      .finally(() => { running = false })
  }, EVERY_MS)
  // Never hold the process open for a timer. Without this a script that imported
  // this module would refuse to exit.
  timer.unref?.()
}
