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

import { failed, claim, due, giveUp, succeeded, tokenFor, upcoming, type Post } from '@/lib/social/store'
import { publishToInstagram } from '@/lib/social/instagram'

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
export type SweepResult = { sent: number; failed: number; missed: number }

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
  const missed = await giveUp(GRACE_MS)
  const ready = await due(GRACE_MS)

  let sent = 0
  let failedCount = 0
  for (const post of ready) {
    // Whoever claims it publishes it. Two overlapping sweeps, or a sweep racing
    // somebody pressing "Post it now", must not both send the same row —
    // Postgres decides, and the loser does nothing.
    if (!(await claim(post.id))) continue
    if (await send(post)) sent++
    else failedCount++
  }
  return { sent, failed: failedCount, missed }
}

/**
 * Send one scheduled or missed post now, by hand.
 *
 * The same claim and the same send the sweep uses, deliberately: a second path
 * to publishing is a second place for the token handling and the row bookkeeping
 * to drift. Returns false when there was nothing to claim — already sent, or
 * another sweep got there first.
 */
export async function sendNow(id: string): Promise<boolean> {
  const rows = await upcoming()
  const post = rows.find((r) => r.id === id)
  if (!post) return false
  if (!(await claim(id))) return false
  return send(post)
}

/** One scheduled post, already rendered and uploaded. Never throws. */
async function send(post: Post): Promise<boolean> {
  try {
    const token = await tokenFor(post.account_id)
    if (!token) throw new Error('That account is no longer connected.')

    const published = await publishToInstagram({
      igUserId: post.account_id.split(':')[1] ?? '',
      token,
      caption: post.caption,
      // Already on Cloudinary — uploaded when the post was scheduled, so nothing
      // here renders and nothing here can fail on a font or a missing photo.
      imageUrls: post.image_urls,
    })
    await succeeded(post.id, published.platformPostId, published.permalinkUrl || undefined)
    return true
  } catch (e) {
    // The message is already scrubbed of the token where the response became an
    // Error. Nothing here logs it: a scheduled post fails while nobody is
    // watching, so the row IS the report.
    await failed(post.id, e instanceof Error ? e.message : 'The platform refused this post.')
    return false
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

export function stopSweeping(): void {
  if (timer) clearInterval(timer)
  timer = null
}
