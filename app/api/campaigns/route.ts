import { NextResponse } from 'next/server'
import { readJson } from '@/lib/http'
import { reachable } from '@/lib/db'
import { create, current, list, remove, report, setContext } from '@/lib/campaigns'

export const runtime = 'nodejs'

const down = () =>
  NextResponse.json(
    { up: false, error: 'Postgres is not answering. Run: npm run db:up' },
    { status: 503 },
  )

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get('id')

  if (id) {
    try {
      const r = await report(id)
      if (!r) return NextResponse.json({ error: 'No campaign with that id.' }, { status: 404 })
      return NextResponse.json({ up: true, ...r })
    } catch {
      return down()
    }
  }

  // An empty list means two different things and they need different words on
  // screen: nobody has made a campaign, or the database is not running.
  if (!(await reachable())) return down()
  const campaigns = await list()
  return NextResponse.json({ up: true, campaigns, current: await current() })
}

export async function POST(req: Request) {
  const { id, name, context } = (await readJson(req)) as { id?: string; name?: string; context?: string }

  try {
    if (id) {
      // Editing "this week's context" is the one field that changes after a
      // campaign starts — that is what it is for.
      await setContext(id, String(context ?? ''))
      return NextResponse.json({ ok: true })
    }
    return NextResponse.json({ ok: true, campaign: await create(String(name ?? ''), String(context ?? '')) })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Could not save the campaign.'
    // A missing name is the user's to fix; anything else is the database.
    return message.startsWith('A campaign needs')
      ? NextResponse.json({ error: message }, { status: 400 })
      : down()
  }
}

/**
 * Delete a campaign and detach everything stamped with it.
 *
 * The work survives, the id does not — see `remove` for why a dangling
 * campaign_id is worse than none. What was detached comes back so the screen
 * can say it, rather than reporting a bare success for something irreversible.
 */
export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Which campaign?' }, { status: 400 })
  try {
    const result = await remove(id)
    if (!result.gone) return NextResponse.json({ error: 'No campaign with that id.' }, { status: 404 })
    return NextResponse.json({ ok: true, ...result })
  } catch {
    return down()
  }
}
