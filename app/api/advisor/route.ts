import { NextResponse } from 'next/server'
import { readJson } from '@/lib/http'
import { reachable } from '@/lib/db'
import { converse, type Turn } from '@/lib/advisor/converse'
import { campaignProducts } from '@/lib/template/columns'
import type { Channel } from '@/lib/content/studio'

export const runtime = 'nodejs'
// Two model calls a turn, prose then structure. Cold, the first also loads the model.
export const maxDuration = 300

const CHANNELS = new Set<Channel>(['instagram', 'snapchat', 'tiktok'])

/**
 * What there is to check a draft against — and the list itself, so the advisor
 * can offer a picker when it asks "which product is this for?". A question with
 * no way to answer it is not a question.
 */
export async function GET() {
  // An unreachable database is not an empty catalogue.
  //
  // `campaignProducts()` returns [] on any database error — deliberately, so a
  // stopped Postgres cannot take an export down with it — which means "nobody
  // has imported a sheet" and "Postgres is not running" arrived here as the
  // same empty list. The advisor screen then said "Import a product sheet
  // first", which is the one action that cannot possibly help: importing needs
  // the database too. Naming the state costs one round trip, and it is the
  // difference between a wasted afternoon and `npm run db:up`.
  //
  // Same seam `app/api/social/accounts` and `app/api/social/posts` already use.
  if (!(await reachable())) {
    return NextResponse.json(
      { up: false, products: 0, list: [], error: 'Postgres is not answering. Run: npm run db:up' },
      { status: 503 },
    )
  }
  const products = await campaignProducts()
  return NextResponse.json({
    up: true,
    products: products.length,
    list: products.map((p) => ({ sku: String(p.sku), name: String(p.name_en ?? p.sku) })),
  })
}

export async function POST(req: Request) {
  const { text, channel, lang, sku, turns } = (await readJson(req)) as {
    text?: string; channel?: string; lang?: 'en' | 'ar'; sku?: string; turns?: Turn[]
  }
  if (!text?.trim()) {
    return NextResponse.json({ error: 'Paste a draft to review.' }, { status: 400 })
  }
  // 503 before 400. An outage is not the person's mistake, and a 400 says it
  // was: this handler answered "Import a product sheet first" with a refusal
  // status for a database nobody had started. Two different states, and only
  // one of them is something they did.
  if (!(await reachable())) {
    return NextResponse.json(
      { error: 'Postgres is not answering, so there is nothing to check a price against. Run: npm run db:up' },
      { status: 503 },
    )
  }
  const products = await campaignProducts()
  if (!products.length) {
    return NextResponse.json(
      { error: 'No catalogue is loaded, so there is nothing to check a price against. Import a product sheet first.' },
      { status: 400 },
    )
  }

  // A person naming the product settles what retrieval exists to guess at. An
  // unknown SKU is a 404 rather than a silent fall back to guessing: the answer
  // would then be checked against a different product than the one on screen.
  let row
  if (sku) {
    row = products.find((p) => String(p.sku) === sku)
    if (!row) return NextResponse.json({ error: `No product ${sku} in the loaded sheet.` }, { status: 404 })
  }

  try {
    // Only the draft and what the person said about it cross this line. The
    // advisor is still given no idea whether a model wrote the draft or a human
    // did, which is the point review.ts was built around.
    return NextResponse.json({
      answer: await converse(text, Array.isArray(turns) ? turns.slice(-8) : [], {
        lang,
        row,
        ...(channel && CHANNELS.has(channel as Channel) ? { channel: channel as Channel } : {}),
      }),
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Could not review that.'
    return NextResponse.json(
      { error: /fetch failed|ECONNREFUSED/i.test(msg) ? 'Ollama is not answering on localhost. Run: brew services start ollama' : msg },
      { status: 500 },
    )
  }
}
