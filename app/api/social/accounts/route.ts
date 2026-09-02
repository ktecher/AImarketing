/**
 * What the shop can post as, and forgetting one.
 *
 * Thin on purpose: `lib/social/store.ts` selects account columns by name and
 * `token_cipher` is not among them, so there is no token here to leak and no
 * filtering to remember to do. That is the guarantee — not a `delete row.token`
 * in this file, which is the version somebody eventually forgets.
 */

import { NextResponse } from 'next/server'
import { reachable } from '@/lib/db'
import { accounts, disconnect } from '@/lib/social/store'

export const runtime = 'nodejs'

/**
 * Every connected Page and Instagram account.
 *
 * `accounts()` returns an empty list when Postgres is down rather than throwing,
 * which reads identically to "nothing connected" — so the state is named here.
 * The difference matters: one is fixed by pressing Connect, the other by
 * starting the database.
 */
export async function GET() {
  // The comment above described this handler for a while before it was true:
  // `accounts()` swallows a down database and the route returned a bare 200, so
  // a stopped Postgres rendered as "nothing connected" beside a Connect button
  // that could not possibly work. Naming the state costs one round trip and is
  // the difference between "press Connect" and "start the database".
  if (!(await reachable())) {
    return NextResponse.json(
      { up: false, accounts: [], error: 'Postgres is not answering. Run: npm run db:up' },
      { status: 503 },
    )
  }
  return NextResponse.json({ up: true, accounts: await accounts() })
}

/**
 * Disconnect an account, and with it every post published through it.
 *
 * The history goes by cascade, and that is deliberate — see `disconnect()`.
 * Nothing can re-read a permalink or delete an uploaded image once the token is
 * gone, so what would be left is a list nothing can act on. The screen asks
 * before it calls this.
 */
export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Which account?' }, { status: 400 })

  try {
    const gone = await disconnect(id)
    if (!gone) return NextResponse.json({ error: 'No account with that id.' }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json(
      { error: 'Postgres is not answering. Run: npm run db:up' },
      { status: 503 },
    )
  }
}
