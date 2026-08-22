import { NextResponse } from 'next/server'
import { readJson } from '@/lib/http'
import { importedProducts } from '@/lib/template/columns'
import { check, fill } from '@/lib/content/guard'
import { approve, coverage, draft, load, save, type Channel, type Piece } from '@/lib/content/studio'
import { currentCampaign, get } from '@/lib/campaigns'

export const runtime = 'nodejs'
// Four model calls. On this machine a full set takes 20-40s cold, less warm.
export const maxDuration = 300

const CHANNELS = new Set<Channel>(['instagram', 'snapchat', 'tiktok'])

/** The row a draft is grounded in. Copy without its row cannot be checked. */
function row(sku: string): Record<string, string | number> | undefined {
  return importedProducts().find((p) => String(p.sku) === sku)
}

/**
 * Drafts as the UI reads them: the stored text keeps its placeholders so it
 * stays true after a price change, and a filled copy rides alongside for
 * reading. Both halves of the script travel — the fields are displayed
 * separately from `text`, and filling only `text` leaves {price_now} on screen.
 */
const dress = (pieces: Piece[], values: Record<string, unknown>) =>
  pieces.map((p) => ({
    ...p,
    filled: fill(p.text, values),
    checks: check(p.text, values),
    ...(p.script
      ? {
          script: {
            hook: fill(p.script.hook, values),
            body: fill(p.script.body, values),
            say: fill(p.script.say, values),
            avoid: p.script.avoid.map((a) => fill(a, values)),
          },
        }
      : {}),
  }))

export async function GET(req: Request) {
  const sku = new URL(req.url).searchParams.get('sku')
  const products = importedProducts()

  if (!sku) {
    const done = coverage()
    return NextResponse.json({
      products: products.map((p) => ({
        sku: String(p.sku),
        name: String(p.name_en ?? p.sku),
        brand: p.brand ? String(p.brand) : undefined,
        onSale: Number(p.price_was) > Number(p.price_now),
        ...done[String(p.sku)],
      })),
    })
  }

  const values = row(sku)
  if (!values) return NextResponse.json({ error: `No product ${sku} in the loaded sheet.` }, { status: 404 })
  return NextResponse.json({ product: values, pieces: dress(load(sku), values) })
}

export async function POST(req: Request) {
  const { sku, channel, campaignId } = (await readJson(req)) as {
    sku?: string; channel?: Channel; campaignId?: string | null
  }
  if (!sku) return NextResponse.json({ error: 'Pick a product first.' }, { status: 400 })
  if (!channel || !CHANNELS.has(channel)) {
    return NextResponse.json({ error: 'Pick a channel.' }, { status: 400 })
  }
  const values = row(sku)
  if (!values) return NextResponse.json({ error: `No product ${sku} in the loaded sheet.` }, { status: 404 })

  try {
    // The caller may name a campaign; nothing does yet, and nothing should have
    // to. Copy written today belongs to the campaign running today — and the
    // campaign's "this week's context" rides into the prompt, which is the whole
    // reason that field exists. `get` can throw when Postgres is down; a draft
    // without context is still a draft, so it degrades rather than fails.
    const camp = campaignId
      ? await get(campaignId).catch(() => null)
      : await currentCampaign()
    const fresh = await draft(values, channel, camp?.id ?? campaignId ?? null, camp?.context ?? '')
    // Approved pieces survive a re-run. Losing an approval to a click that was
    // meant to produce alternatives is not recoverable from the UI.
    const kept = load(sku).filter((p) => p.status === 'approved')
    const pieces = [...kept, ...fresh.map((p, i) => ({ ...p, id: `${p.id}:${Date.now()}${i}` }))]
    save(sku, pieces)
    return NextResponse.json({ pieces: dress(pieces, values) })
  } catch (e) {
    // Ollama not running is the overwhelmingly likely cause and the message
    // from fetch alone does not say so.
    const msg = e instanceof Error ? e.message : 'Generation failed.'
    return NextResponse.json(
      { error: /fetch failed|ECONNREFUSED/i.test(msg) ? 'Ollama is not answering on localhost. Run: brew services start ollama' : msg },
      { status: 500 },
    )
  }
}

/** Edit the wording of a draft, or approve one. */
export async function PUT(req: Request) {
  const { sku, id, text, action } = (await readJson(req)) as {
    sku?: string; id?: string; text?: string; action?: 'edit' | 'approve' | 'unapprove' | 'delete'
  }
  if (!sku || !id) return NextResponse.json({ error: 'Missing draft.' }, { status: 400 })
  const values = row(sku)
  if (!values) return NextResponse.json({ error: `No product ${sku} in the loaded sheet.` }, { status: 404 })

  try {
    if (action === 'approve') return NextResponse.json({ pieces: dress(approve(sku, id, values), values) })

    const pieces = load(sku)
    const piece = pieces.find((p) => p.id === id)
    if (!piece) return NextResponse.json({ error: 'That draft is gone.' }, { status: 404 })

    if (action === 'delete') {
      const left = pieces.filter((p) => p.id !== id)
      save(sku, left)
      return NextResponse.json({ pieces: dress(left, values) })
    }
    if (action === 'unapprove') {
      piece.status = 'draft'
      delete piece.approved_at
    } else {
      piece.text = text ?? piece.text
      // Provenance, not decoration: an edited line is a human's line, and the
      // approval that follows is approval of their words, not the model's.
      piece.source = 'human'
      piece.status = 'draft'
      delete piece.approved_at
    }
    piece.checks = check(piece.text, values)
    save(sku, pieces)
    return NextResponse.json({ pieces: dress(pieces, values) })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not save.' }, { status: 400 })
  }
}
