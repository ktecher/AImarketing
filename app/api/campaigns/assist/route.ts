import { NextResponse } from 'next/server'
import { readJson } from '@/lib/http'
import { suggest } from '@/lib/campaigns'

export const runtime = 'nodejs'
export const maxDuration = 120

/** Long enough for a paragraph of intent, short enough to stay an idea. */
const LIMIT = 500

/**
 * Turn a rough idea into a campaign name and a first context.
 *
 * Nothing is written to Postgres here. The suggestion goes back to the form the
 * person is already looking at, they edit it, and the existing POST /api/campaigns
 * creates the row — so a model's wording is never what got saved, only what got
 * offered.
 */
export async function POST(req: Request) {
  const { idea } = (await readJson(req)) as { idea?: string }
  const text = String(idea ?? '').trim().slice(0, LIMIT)
  if (!text) {
    return NextResponse.json({ error: 'Say roughly what the campaign is about.' }, { status: 400 })
  }

  try {
    return NextResponse.json({ suggestion: await suggest(text) })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Could not draft that.'
    return NextResponse.json(
      { error: /fetch failed|ECONNREFUSED/i.test(msg) ? 'Ollama is not answering on localhost. Run: brew services start ollama' : msg },
      { status: 500 },
    )
  }
}
