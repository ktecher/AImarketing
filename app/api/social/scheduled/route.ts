/**
 * What is waiting to go out, and the two things a person can do about it.
 *
 * Reading is separate from `/api/social/posts` on purpose: that route answers
 * "what happened", newest first, and this one answers "what has not happened
 * yet", soonest first. Folding them together means the screen showing tonight's
 * queue has to filter history to find it.
 */

import { NextResponse } from 'next/server'
import { reachable } from '@/lib/db'
import { unschedule, upcoming } from '@/lib/social/store'
import { sendNow } from '@/lib/social/scheduler'
import { remove } from '@/lib/social/cloudinary'
import { readJson } from '@/lib/http'

export const runtime = 'nodejs'
// Sending by hand is a real publish: an upload Meta has to fetch, then polling.
export const maxDuration = 300

/** Everything scheduled or missed. `up` named, so a dead database is not "nothing due". */
export async function GET() {
  if (!(await reachable())) {
    return NextResponse.json(
      { up: false, posts: [], error: 'Postgres is not answering. Run: npm run db:up' },
      { status: 503 },
    )
  }
  return NextResponse.json({ up: true, posts: await upcoming() })
}

/**
 * Send one now — a missed post somebody still wants out, or a scheduled one
 * brought forward. Goes through the same claim the sweep uses, so the two cannot
 * both send it.
 */
export async function POST(req: Request) {
  const { id } = (await readJson(req)) as { id?: string }
  if (!id) return NextResponse.json({ error: 'Which post?' }, { status: 400 })

  // The same guard GET and DELETE already have, and the same reason: `upcoming()`
  // swallows a down database and returns [], `.find` misses, and the outcome is
  // `gone` — which this route renders as "it has already gone out". A stopped
  // Postgres told the person their post was published.
  if (!(await reachable())) {
    return NextResponse.json(
      { error: 'Postgres is not answering. Run: npm run db:up' },
      { status: 503 },
    )
  }

  try {
    const r = await sendNow(String(id))

    // Three outcomes, three sentences. This used to collapse them into one:
    // every falsy result was reported as "already sent or no longer waiting",
    // INCLUDING the case where Instagram had just refused the post. The person
    // was told their post had gone out, refreshed, saw it gone from the queue —
    // because `upcoming()` lists only scheduled and missed — and had every
    // reason to believe it. The row held the real reason the whole time.
    if (r.outcome === 'refused') {
      return NextResponse.json(
        { ok: false, refused: true, error: `Instagram refused it: ${r.reason}` },
        { status: 502 },
      )
    }
    // Not a refusal, and it must not borrow that sentence: the connection died
    // while the request was in flight, so the post may be public right now. The
    // reason already carries what to do about it — see MAYBE_SENT.
    if (r.outcome === 'unknown') {
      return NextResponse.json({ ok: false, error: r.reason }, { status: 502 })
    }
    if (r.outcome === 'taken') {
      return NextResponse.json(
        { ok: false, error: 'It is going out right now — the scheduler reached it first. Refresh in a moment.' },
        { status: 409 },
      )
    }
    if (r.outcome === 'gone') {
      return NextResponse.json(
        { ok: false, error: 'That post is no longer waiting — it has already gone out, or it was dropped.' },
        { status: 409 },
      )
    }
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Could not send that post.' },
      { status: 502 },
    )
  }
}

/**
 * Drop one that has not gone out. Refuses anything already published — a post
 * that is public cannot be unpublished from here, and offering to would be a
 * button that lies.
 */
export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Which post?' }, { status: 400 })

  try {
    const orphans = await unschedule(id)
    if (orphans === null) {
      return NextResponse.json(
        { error: 'Nothing waiting with that id. It may already have gone out.' },
        { status: 404 },
      )
    }
    // The row is gone, so nothing can reach these again. Failures are swallowed
    // on purpose: the post IS dropped either way, and turning a tidy-up into an
    // error would report a failure for something that succeeded.
    await Promise.all(orphans.map((one) => remove(one).catch(() => {})))
    return NextResponse.json({ ok: true, imagesRemoved: orphans.length })
  } catch {
    return NextResponse.json(
      { error: 'Postgres is not answering. Run: npm run db:up' },
      { status: 503 },
    )
  }
}
