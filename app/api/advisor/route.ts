import { NextResponse } from 'next/server'
import { readJson } from '@/lib/http'
import { review } from '@/lib/advisor/review'
import { importedProducts } from '@/lib/template/columns'

export const runtime = 'nodejs'
export const maxDuration = 120

/** Whether there is a catalogue to check a draft against at all. */
export async function GET() {
  return NextResponse.json({ products: importedProducts().length })
}

export async function POST(req: Request) {
  const { text, channel, lang } = (await readJson(req)) as {
    text?: string; channel?: string; lang?: 'en' | 'ar'
  }
  if (!text?.trim()) {
    return NextResponse.json({ error: 'Paste a draft to review.' }, { status: 400 })
  }
  if (!importedProducts().length) {
    return NextResponse.json(
      { error: 'No catalogue is loaded, so there is nothing to check a price against. Import a product sheet first.' },
      { status: 400 },
    )
  }

  try {
    // Only the text crosses this line. The reviewer is given no idea whether a
    // model wrote the draft or a person did, which is the point.
    return NextResponse.json({ review: await review(text, { channel, lang }) })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Could not review that.'
    return NextResponse.json(
      { error: /fetch failed|ECONNREFUSED/i.test(msg) ? 'Ollama is not answering on localhost. Run: brew services start ollama' : msg },
      { status: 500 },
    )
  }
}
