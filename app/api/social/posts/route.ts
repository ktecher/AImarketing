/**
 * What has been posted, and how it went.
 *
 * The Social screen's history panel. Kept separate from `/api/social/publish`
 * because publishing is a write with real consequences and this is a read —
 * folding the list into the publish response would mean the only way to see
 * yesterday's posts is to make another one.
 *
 * `store.posts()` returns an empty list when Postgres is down rather than
 * throwing, which reads identically to "nothing posted yet" — so `up` is
 * reported alongside, and the screen can tell the two apart.
 *
 * This was very nearly shipped with a comment claiming the screen learned that
 * from the accounts panel instead. It does not: that route also returns a bare
 * 200 with an empty list, so a stopped database showed "nothing connected" and
 * offered a Connect button that could not work. Same shape of mistake as D56 —
 * a screen reporting success for something that never happened.
 */

import { NextResponse } from 'next/server'
import { reachable } from '@/lib/db'
import { posts } from '@/lib/social/store'

export const runtime = 'nodejs'

/** A cap, so a long history cannot turn one screen into a slow query. */
const MOST = 100

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams
  const asked = Number(q.get('limit') ?? 20)
  // NaN from a junk parameter must not become a query with `limit NaN`; a
  // person typing nonsense in a URL gets the default, not a 500.
  const limit = Number.isFinite(asked) ? Math.min(Math.max(Math.trunc(asked), 1), MOST) : 20

  if (!(await reachable())) {
    return NextResponse.json(
      { up: false, posts: [], error: 'Postgres is not answering. Run: npm run db:up' },
      { status: 503 },
    )
  }

  return NextResponse.json({
    up: true,
    posts: await posts({
      campaignId: q.get('campaignId') || undefined,
      sku: q.get('sku') || undefined,
      limit,
    }),
  })
}
