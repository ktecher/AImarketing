import { NextResponse } from 'next/server'
import { readJson } from '@/lib/http'
import { campaignProducts } from '@/lib/template/columns'
import { blockers, check, DERIVED, fill } from '@/lib/content/guard'
import { approve, coverage, draft, load, save, type Channel, type Kind, type Piece } from '@/lib/content/studio'
import { currentCampaign, get } from '@/lib/campaigns'

export const runtime = 'nodejs'
// Four model calls. On this machine a full set takes 20-40s cold, less warm.
export const maxDuration = 300

const CHANNELS = new Set<Channel>(['instagram', 'snapchat', 'tiktok'])
const KINDS = new Set<Kind>(['slogan', 'caption', 'hashtags', 'script'])

/** A steer a person typed. Capped because it goes into a prompt, not a field. */
const NOTE_LIMIT = 300

/** The row a draft is grounded in. Copy without its row cannot be checked. */
async function row(sku: string): Promise<Record<string, string | number> | undefined> {
  return (await campaignProducts()).find((p) => String(p.sku) === sku)
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
  const products = await campaignProducts()

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

  const values = await row(sku)
  if (!values) return NextResponse.json({ error: `No product ${sku} in the loaded sheet.` }, { status: 404 })
  return NextResponse.json({ product: values, pieces: dress(load(sku), values) })
}

export async function POST(req: Request) {
  const { sku, channel, campaignId, only, note } = (await readJson(req)) as {
    sku?: string; channel?: Channel; campaignId?: string | null
    only?: string[]; note?: string
  }
  if (!sku) return NextResponse.json({ error: 'Pick a product first.' }, { status: 400 })
  if (!channel || !CHANNELS.has(channel)) {
    return NextResponse.json({ error: 'Pick a channel.' }, { status: 400 })
  }
  const values = await row(sku)
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
    // "More slogans" is one kind, one call. Anything not on this list is
    // dropped rather than trusted: it reaches a schema and a prompt.
    const kinds = Array.isArray(only) ? only.filter((k): k is Kind => KINDS.has(k as Kind)) : []
    const partial = kinds.length > 0
    const current = load(sku)

    // Improving the script means a better one, not a second one — so the model
    // is handed the script that exists. Only when the script is the ONLY thing
    // asked for; inside a full run it is a fresh write like everything else.
    const improve = partial && kinds.length === 1 && kinds[0] === 'script'
      ? current.find((p) => p.kind === 'script' && p.script)?.script
      : undefined

    const fresh = await draft(values, channel, camp?.id ?? campaignId ?? null, camp?.context ?? '', {
      only: kinds,
      note: typeof note === 'string' ? note.slice(0, NOTE_LIMIT) : '',
      improve,
    })

    // Approved pieces survive a re-run. Losing an approval to a click that was
    // meant to produce alternatives is not recoverable from the UI.
    //
    // Asking for MORE of one kind keeps the drafts already on screen — the
    // point of the button is another option beside the ones you are comparing,
    // and replacing them would make "more" mean "instead". The rewritten script
    // is the exception, for the reason above.
    const kept = partial
      ? current.filter((p) => !(improve && p.kind === 'script' && p.status !== 'approved'))
      : current.filter((p) => p.status === 'approved')
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

/**
 * Turns a piece's FILLED text back into placeholders, for the one prices
 * DERIVED holds: {price_now}, {price_was}, {discount_pct}.
 *
 * The Publish screen shows the box with real numbers substituted — a post is
 * fixed the moment it is public, per docs. A saved draft is not: it goes back
 * into the studio, where every other piece keeps its placeholders so it stays
 * true after a price change. Left as a literal number it would also fail
 * `check()`'s "no invented numbers" rule on every single save, because a
 * correctly formatted price is indistinguishable from one the model made up.
 */
function unfill(text: string, values: Record<string, unknown>): string {
  for (const name of DERIVED) {
    const literal = fill(`{${name}}`, values)
    if (literal !== `{${name}}`) text = text.split(literal).join(`{${name}}`)
  }
  return text
}

/** Edit the wording of a draft, approve one, or save an edit as a new draft. */
export async function PUT(req: Request) {
  const { sku, id, text, action, from } = (await readJson(req)) as {
    sku?: string; id?: string; text?: string
    action?: 'edit' | 'approve' | 'unapprove' | 'delete' | 'save-draft'
    from?: string
  }
  if (!sku) return NextResponse.json({ error: 'Missing draft.' }, { status: 400 })
  const values = await row(sku)
  if (!values) return NextResponse.json({ error: `No product ${sku} in the loaded sheet.` }, { status: 404 })

  try {
    // Publish's textarea holds an approved caption a person may have edited.
    // Approved copy is human-reviewed, so an edit NEVER overwrites it — it is
    // appended as a fresh draft, for someone to review and approve like any
    // other. The approved piece named by `from` is only where provenance and
    // channel come from; it is never touched.
    if (action === 'save-draft') {
      if (!from || typeof text !== 'string') return NextResponse.json({ error: 'Missing draft.' }, { status: 400 })
      const pieces = load(sku)
      const source = pieces.find((p) => p.id === from)
      if (!source) return NextResponse.json({ error: 'That draft is gone.' }, { status: 404 })

      const placeholderText = unfill(text, values)
      const checks = check(placeholderText, values)
      // A blocker here is exactly what approval already guards against —
      // an edit that introduced an invented price, say — so it is reported
      // and not saved, rather than saved silently and caught later.
      if (blockers(checks).length) return NextResponse.json({ saved: false, checks })

      const piece: Piece = {
        sku, lang: source.lang, kind: 'caption', channel: source.channel,
        text: placeholderText, checks, status: 'draft', source: 'human',
        model: source.model, prompt_version: source.prompt_version,
        campaign_id: source.campaign_id, created_at: new Date().toISOString(),
        id: `${sku}:caption:${Date.now()}`,
      }
      const next = [...pieces, piece]
      save(sku, next)
      return NextResponse.json({ saved: true, pieces: dress(next, values) })
    }

    if (!id) return NextResponse.json({ error: 'Missing draft.' }, { status: 400 })
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
