/**
 * The campaign meeting, one turn per request.
 *
 * Nothing here writes to Postgres. A meeting is a conversation on disk until
 * the person presses Create, and that goes through the existing
 * POST /api/campaigns — so a model's wording is never what got saved, only what
 * got offered. Same guarantee `/api/campaigns/assist` already makes.
 *
 * Three actions rather than three routes, because they are three verbs on one
 * object and splitting them would mean the screen holds three URLs to do one
 * thing. `say` is a turn, `plan` writes the plan, and GET reads a meeting back
 * after somebody closed the tab.
 */

import { NextResponse } from 'next/server'
import { readJson } from '@/lib/http'
import { contextFrom, load, mergeSave, plan, remove, reply, start, type Meeting, type Step } from '@/lib/meeting'
import { create as createCampaign } from '@/lib/campaigns'

export const runtime = 'nodejs'
// Two model calls per turn on a local 12B. The default would cut the reply off
// mid-generation and report it as a failure.
export const maxDuration = 300

/** Long enough for a paragraph of intent, short enough to stay one turn. */
const LIMIT = 2000

/** Ids are filenames in `lib/meeting.ts`. Rejected here as well as there. */
const safe = (id: string) => /^[A-Za-z0-9_-]{1,64}$/.test(id)

const failed = (e: unknown) => {
  const msg = e instanceof Error ? e.message : 'The planner could not answer.'
  return /fetch failed|ECONNREFUSED/i.test(msg)
    ? 'Ollama is not answering on localhost. Run: brew services start ollama'
    : msg
}

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get('id')
  if (!id || !safe(id)) return NextResponse.json({ error: 'Which meeting?' }, { status: 400 })
  const meeting = load(id)
  if (!meeting) return NextResponse.json({ error: 'No meeting with that id.' }, { status: 404 })
  return NextResponse.json({ meeting })
}

export async function POST(req: Request) {
  const body = (await readJson(req)) as { id?: string; said?: string; action?: string }
  const id = String(body.id ?? '').trim()
  if (!id || !safe(id)) {
    return NextResponse.json({ error: 'Which meeting?' }, { status: 400 })
  }

  // A meeting that does not exist yet is started rather than refused: the first
  // turn and the "new meeting" button are the same gesture, and making the
  // screen create an empty file first would be a round trip that can fail
  // between two that cannot.
  const meeting: Meeting = load(id) ?? start(id)

  if (body.action === 'plan') {
    if (!meeting.turns.length) {
      return NextResponse.json({ error: 'Nothing has been said yet.' }, { status: 400 })
    }
    try {
      const written = await plan(meeting)
      // Kept on the meeting, not just returned. Two model calls and a minute of
      // somebody's afternoon went into this, and a closed tab must not be what
      // throws it away.
      //
      // Merged onto a fresh read rather than written whole: this request has
      // been running for a minute, and a turn sent during it would otherwise be
      // reverted by the copy loaded before that turn existed.
      mergeSave(meeting, { plan: written })
      return NextResponse.json({ plan: written })
    } catch (e) {
      return NextResponse.json({ error: failed(e) }, { status: 500 })
    }
  }

  /**
   * The meeting becomes a campaign.
   *
   * This is the only thing here that writes to Postgres, and it goes through
   * `create()` in lib/campaigns.ts rather than its own insert — the id-collision
   * handling and the slug rule live there, and a second insert would be a second
   * set of rules that drifts.
   *
   * The plan is composed into `context` by `contextFrom`, so `campaigns` gains
   * nothing: four columns, exactly as before.
   */
  if (body.action === 'create') {
    if (!meeting.plan) {
      return NextResponse.json({ error: 'Write the plan first.' }, { status: 400 })
    }
    if (meeting.campaign_id) {
      return NextResponse.json({ error: 'This meeting already made a campaign.', campaign_id: meeting.campaign_id }, { status: 409 })
    }
    try {
      const campaign = await createCampaign(meeting.plan.name, contextFrom(meeting, meeting.plan))
      mergeSave(meeting, { campaign_id: campaign.id })
      return NextResponse.json({ campaign })
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not create the campaign.'
      return NextResponse.json(
        { error: /ECONNREFUSED|does not exist|relation/i.test(msg) ? 'Postgres is not answering. Run: npm run db:up' : msg },
        { status: 500 },
      )
    }
  }

  const said = String(body.said ?? '').trim().slice(0, LIMIT)
  if (!said) {
    return NextResponse.json({ error: 'Say roughly what the campaign is about.' }, { status: 400 })
  }

  /**
   * A turn is server-sent events, not JSON, and there is no JSON fallback.
   *
   * The screen is the only caller — nothing in `scripts/` posts a turn — so a
   * second response shape would be a second thing to keep working with nobody
   * exercising it. Every step of the turn goes down the same pipe: what the
   * catalogue matched, what was written down, what it decided to ask, then the
   * reply as it is written, then the whole `Reply` object the screen already
   * knew how to render.
   *
   * `reply` saves the transcript itself, including on the offline path — what a
   * person typed must not be lost because the model was not running. That still
   * happens inside the stream, so a closed tab loses the rendering, never the
   * turn.
   */
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
      try {
        const out = await reply(meeting, said, (step: Step) => send({ step }))
        send({ done: out })
      } catch (e) {
        // A 200 is already on the wire by the time anything in here can fail,
        // so the error travels as an event. The screen reads this the same way
        // it used to read a 500 body.
        send({ error: failed(e) })
      }
      controller.close()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })
}

/**
 * Throw the meeting away and leave nothing behind.
 *
 * A meeting that went nowhere is not history worth keeping, and the alternative
 * — a list of abandoned conversations nobody will ever reopen — is a screen
 * somebody has to maintain. `remove()` refuses when the meeting made a campaign;
 * that is the one case where the transcript is the record of how something real
 * got built.
 */
export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get('id')
  if (!id || !safe(id)) return NextResponse.json({ error: 'Which meeting?' }, { status: 400 })
  try {
    return NextResponse.json({ gone: remove(id) })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Could not delete it.' },
      { status: 409 },
    )
  }
}
