import { NextResponse } from 'next/server'
import { readJson } from '@/lib/http'
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
  const products = await campaignProducts()
  return NextResponse.json({
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
