/**
 * The click that takes a finished post off this machine.
 *
 * Everything before this route is local: a design rendered here, a caption
 * written here, a person who read both. This is the one place in the app where a
 * deliberate press sends them to Meta — per post, never on a render, never on a
 * save, never on a schedule (D83).
 *
 * The order below is the whole design, and it is ordered by what each step
 * costs:
 *
 *   1. refuse what cannot work — no accounts, no caption, no image — BEFORE
 *      anything is uploaded or written. Instagram has no endpoint for a
 *      text-only post, so an imageless post cannot succeed at any point later,
 *      and finding that out after the image is on a paid host is the expensive
 *      version of the same answer.
 *   2. get the image: either render it here through the same path `/api/render`
 *      uses, or take what the screen already rendered.
 *   3. upload once, publish many. Two accounts posting the same poster fetch the
 *      same URL; uploading per account would pay twice for one image.
 *   4. per account: write `publishing`, attempt, close the row.
 *
 * ── one account failing must not abort the others ──
 *
 * The realistic failure is one account's token having expired — Instagram's last
 * sixty days, not forever (D86) — while another's is fine. A loop that throws on
 * the first failure leaves the person with a red box and no idea whether the
 * other account went out, so every account is caught individually and every
 * account gets a line in the result, whichever way it went.
 *
 * Nothing here logs. An Instagram error carries whatever Meta chose to quote
 * back, and `lib/social/instagram.ts` scrubs the token out of it at the moment
 * it becomes an Error — writing the raw error anywhere else would undo that.
 */

import { NextResponse } from 'next/server'
import { readJson } from '@/lib/http'
import { reachable } from '@/lib/db'
import { current } from '@/lib/campaigns'
import { accounts, failed, startPost, succeeded, tokenFor, MAYBE_SENT, type Account } from '@/lib/social/store'
import { InstagramError, publishToInstagram } from '@/lib/social/instagram'
import { remove, upload } from '@/lib/social/cloudinary'
// The rendering path, not a copy of it. A second implementation of "turn this
// SKU into a PNG" drifts from the one the Designs screen shows, and the first
// anybody hears about it is a customer looking at a poster that does not match
// the preview. Calling the handler is ugly; two renderers is worse.
import { POST as renderRoute } from '@/app/api/render/route'

export const runtime = 'nodejs'
// Instagram polls its media container up to ten times at two seconds each, per
// image, per account — a three-image carousel to two accounts is minutes of
// waiting on Meta before anything comes back. `/api/studio` sets 300 for four
// model calls; this is the same order of patience for the same reason.
export const maxDuration = 300

/** Instagram's carousel limit. Beyond it Meta fails the whole post, late. */
const MAX_IMAGES = 10

type Result = {
  accountId: string
  name: string
  platform: Account['platform'] | 'unknown'
  ok: boolean
  platformPostId?: string
  permalinkUrl?: string
  error?: string
  /** Set instead of a post id when the row was scheduled rather than sent. */
  scheduled?: string
}

/** `data:image/png;base64,…` or bare base64 — the screen has sent both. */
const bytesOf = (dataUrl: string): Buffer =>
  Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64')

/**
 * The PNG for one design, produced by `/api/render`'s own handler.
 *
 * Returns base64, which is what that route returns and what the screen already
 * sends back when it rendered the preview itself — so both paths into this route
 * meet at the same shape one step later.
 */
async function renderPng(sku: string, templateId: string): Promise<string> {
  const res = await renderRoute(
    new Request('http://localhost/api/render', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ templateId, skus: [sku] }),
    }),
  )
  const body = (await res.json()) as { results?: { png?: string }[]; error?: string }
  const png = body.results?.[0]?.png
  if (!png) {
    throw new Error(
      body.error ?? `Nothing rendered for ${sku} on template ${templateId}. Check the design first.`,
    )
  }
  return png
}

export async function POST(req: Request) {
  const { accountIds, caption, skus, templateId, imageDataUrls, scheduledAt } = (await readJson(req)) as {
    accountIds?: unknown[]
    caption?: string
    /**
     * The products this post is about, in the order their images appear.
     *
     * One shape for both modes (D88). A single-product post is a one-element
     * list; a carousel is the same call with more in it. There is deliberately
     * no "mode" parameter: "post these five separately" is the SCREEN calling
     * this route five times, and it needs nothing from here to do that.
     */
    skus?: unknown[]
    templateId?: string
    imageDataUrls?: unknown[]
    /**
     * An ISO time to send it instead of sending it now (D89).
     *
     * Everything before the send is identical either way — same render, same
     * upload, same row. Only the last call is deferred, which is what makes a
     * scheduled post safe to leave to a timer: nothing about it is decided later.
     */
    scheduledAt?: string
  }

  const ids = Array.isArray(accountIds) ? accountIds.map(String).filter(Boolean) : []
  const text = String(caption ?? '').trim()
  // De-duplicated: the same product on two slides is two images but one product,
  // and the history counts posts per product.
  const skuList = [...new Set((Array.isArray(skus) ? skus : []).map(String).filter(Boolean))]

  if (!ids.length) {
    return NextResponse.json(
      { error: 'Pick at least one account to post to.' },
      { status: 400 },
    )
  }
  if (!text) {
    return NextResponse.json(
      { error: 'A post needs a caption. Write one, or approve a draft in the studio first.' },
      { status: 400 },
    )
  }

  // Parsed before anything is rendered or uploaded. A time nobody can act on is
  // worth finding out about while it is still free to find out.
  let when: Date | null = null
  if (scheduledAt) {
    const t = new Date(String(scheduledAt))
    if (Number.isNaN(t.getTime())) {
      return NextResponse.json({ error: 'That is not a time this can read.' }, { status: 400 })
    }
    // A minute of slack, so "in a moment" is not rejected for arriving a second
    // after the clock it was chosen against.
    if (t.getTime() < Date.now() - 60_000) {
      return NextResponse.json(
        { error: 'That time has already passed. Pick one in the future, or post it now.' },
        { status: 400 },
      )
    }
    when = t
  }

  const dataUrls = (Array.isArray(imageDataUrls) ? imageDataUrls : []).map(String).filter(Boolean)
  if (dataUrls.length > MAX_IMAGES) {
    return NextResponse.json(
      { error: `A post carries at most ${MAX_IMAGES} images; this one has ${dataUrls.length}.` },
      { status: 400 },
    )
  }

  // Instagram has no endpoint for a text-only post, so this cannot be made to
  // work by retrying, and the person should hear it before an image is uploaded.
  // Every account is an Instagram account since D86, so this is now the whole
  // check rather than a per-platform one.
  if (!dataUrls.length && !(skuList.length && templateId)) {
    return NextResponse.json(
      { error: 'Instagram will not accept a post with no image. Render the design first.' },
      { status: 400 },
    )
  }
  // Instagram caps a carousel at ten and refuses the whole post rather than the
  // eleventh slide — late, after every image is already on a paid host.
  if (skuList.length > MAX_IMAGES) {
    return NextResponse.json(
      { error: `A carousel carries at most ${MAX_IMAGES} products; this one has ${skuList.length}.` },
      { status: 400 },
    )
  }

  // Asked before anything is rendered or uploaded, and the one route here that
  // did not ask. `accounts()` swallows a down database and returns [], so every
  // target below read as "not connected any more" — a sentence sending somebody
  // to reconnect an account that is connected — AFTER the poster was already on
  // a paid host, with no row left able to name it. Same guard as the sibling
  // routes, one round trip, before anything is spent.
  if (!(await reachable())) {
    return NextResponse.json(
      { error: 'Postgres is not answering, so nothing was published. Run: npm run db:up' },
      { status: 503 },
    )
  }

  // Which account each id actually is. An id nobody connected gets a line in the
  // results rather than a 400 for the whole request — the other accounts in the
  // same press are still perfectly publishable.
  const connected = new Map((await accounts()).map((a) => [a.id, a]))
  const targets = ids.map((id) => ({ id, account: connected.get(id) }))

  // ── the image ────────────────────────────────────────────────────────────
  let images: string[]
  try {
    // Sequential, not Promise.all: rendering shapes text and rasterises SVG, and
    // ten at once on a laptop also running Postgres and a local model is how a
    // demo runs out of memory. This order is the carousel order.
    if (dataUrls.length) {
      images = dataUrls
    } else {
      images = []
      for (const one of skuList) images.push(await renderPng(one, String(templateId)))
    }
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Could not render the design to publish.' },
      { status: 400 },
    )
  }

  const uploaded: { url: string; publicId: string }[] = []
  try {
    // Sequential: a carousel is ordered, and the order the team arranged the
    // images in is the order a customer sees.
    for (const image of images) {
      uploaded.push(await upload(bytesOf(image), { folder: 'aimarketing/posts' }))
    }
  } catch (e) {
    // Whatever did land is unreachable by anything else — no row references it
    // yet — so it is deleted rather than left on the account as paid-for litter.
    await Promise.all(uploaded.map((u) => remove(u.publicId).catch(() => {})))
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Could not upload the image for publishing.' },
      { status: 502 },
    )
  }

  const imageUrls = uploaded.map((u) => u.url)
  const imagePublicIds = uploaded.map((u) => u.publicId)
  // Stamped so `campaigns.report()` can say which of the twelve promoted
  // products actually went out. Null when nobody has made a campaign yet, which
  // is a gap in a report and not a reason to refuse a post.
  const campaignId = await current()

  // ── the publish ──────────────────────────────────────────────────────────
  const results: Result[] = []
  // How many rows ended up naming the uploaded images. A row is the ONLY thing
  // that remembers which uploads belong to a post, so if this stays at zero the
  // images below are litter on a paid host the moment this request returns.
  let rowsWritten = 0
  for (const { id, account } of targets) {
    if (!account) {
      results.push({ accountId: id, name: id, platform: 'unknown', ok: false,
        error: 'That account is not connected any more. Connect it again on the accounts screen.' })
      continue
    }

    // Written before the request leaves, so a crash mid-publish leaves a row
    // saying what was being attempted rather than no trace of a post that may
    // well have gone out.
    let postRow: string
    try {
      postRow = (await startPost({
        accountId: id, caption: text, imageUrls, imagePublicIds,
        campaignId, skus: skuList, scheduledAt: when,
      })).id
      rowsWritten++
    } catch {
      results.push({ accountId: id, name: account.name, platform: account.platform, ok: false,
        error: 'Postgres is not answering, so this publish was not recorded and was not attempted. Run: npm run db:up' })
      continue
    }

    // Scheduled: the row is the whole outcome. The images are uploaded and the
    // caption is fixed, so the sweep has one call left and no decisions — and
    // nothing is public until it makes it.
    if (when) {
      results.push({
        accountId: id, name: account.name, platform: account.platform, ok: true,
        scheduled: when.toISOString(),
      })
      continue
    }

    // Flipped the moment the token is in hand: nothing above this line can put
    // bytes on the wire, so a failure there is a certainty rather than a mystery.
    let attempted = false
    try {
      const token = await tokenOrThrow(id)
      attempted = true
      const published = await publishToInstagram({
        igUserId: account.external_id,
        token,
        caption: text,
        imageUrls,
      })
      await succeeded(postRow, published.platformPostId, published.permalinkUrl || undefined)
      results.push({
        accountId: id, name: account.name, platform: account.platform, ok: true,
        platformPostId: published.platformPostId,
        // '' when Meta would not give one up. The post is published either way
        // — see `permalinkOf` — so the screen shows the post id instead.
        permalinkUrl: published.permalinkUrl || undefined,
      })
    } catch (e) {
      const said = e instanceof Error ? e.message : 'Instagram refused this post.'
      // Two opposite facts, and they used to share one sentence. `InstagramError`
      // is thrown only where Meta ANSWERED; a socket reset or dropped Wi-Fi comes
      // out of `fetch` as a plain TypeError, and by then Meta may well have
      // processed the request and the post may be public right now. "It refused
      // it" there is what makes somebody press Publish again and post the same
      // poster twice — the same uncertainty `abandon()` writes for a crash.
      const message = !attempted || e instanceof InstagramError ? said : `${MAYBE_SENT} (${said})`
      await failed(postRow, message).catch(() => {})
      results.push({ accountId: id, name: account.name, platform: account.platform, ok: false, error: message })
    }
  }

  // Nothing ever referenced these. Every target failed before `startPost`, so no
  // row holds their public ids and nothing will ever be able to name them again
  // — the same paid-for litter the upload catch above clears. A row that WAS
  // written keeps its images even when Instagram refused the post: the row names
  // them, and dropping it is what frees them (see `unschedule`).
  if (!rowsWritten) {
    await Promise.all(uploaded.map((u) => remove(u.publicId).catch(() => {})))
  }

  return NextResponse.json({
    campaignId,
    imageUrls,
    // Counted apart, because "3 published" for three posts that have not happened
    // yet is the false success this whole file is arranged to avoid.
    published: when ? 0 : results.filter((r) => r.ok).length,
    scheduled: when ? results.filter((r) => r.ok).length : 0,
    scheduledAt: when?.toISOString() ?? null,
    results,
  })
}

/**
 * The token for one account, or an error saying what to do about it.
 *
 * `tokenFor` returns null for an account nobody connected — which, after the
 * lookup at the top of this request, means it was disconnected while the person
 * was pressing the button. The message says the one thing that fixes it.
 */
async function tokenOrThrow(accountId: string): Promise<string> {
  const token = await tokenFor(accountId)
  if (!token) throw new Error('No stored token for that account. Connect it again.')
  return token
}
