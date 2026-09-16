/**
 * One product's photo: what it is now, what a candidate would be, and saving it.
 *
 * ── this route reaches off this machine, on purpose (D99) ──
 *
 * Hard rule 1 says no request may leave localhost, and this is the third
 * enumerated exception after publishing (D83) and cloud AI (D97). It is also
 * the loosest, so it is worth being exact about what it does and does not do:
 *
 *   - It fetches ONE url, which a person typed or picked, and does nothing
 *     else with the network.
 *   - No catalogue row goes out. The SKU is used to name the file on this
 *     machine; it is never sent anywhere.
 *   - Nothing is saved by fetching. A candidate comes back as bytes for the
 *     screen to show, and a second, explicit request stores it.
 *
 * `scripts/check-localhost.mjs` cannot see this: it bans HTTP client IMPORTS
 * outside the seam and absolute URL LITERALS outside `lib/social/`, and this
 * uses neither — the host arrives in the request body. That is exactly the
 * hole its own comment warns about, so the enumeration in CLAUDE.md is the
 * only thing standing here, and it is why this file says so at the top.
 *
 * ── what is NOT checked, deliberately ──
 *
 * Whether the image is actually of the product. It cannot be: a CDN answering
 * `img404=default` returns a crossed-out camera icon as a valid 2400x2400
 * JPEG, which passes every mechanical test there is. Measured on 2026-09-16 —
 * three different asset ids, one of them invented, returned byte-identical
 * placeholders. The checks below catch what a machine can catch; the person
 * looking at the preview catches the rest, which is why accepting is a
 * separate press.
 */

import { existsSync, readFileSync } from 'node:fs'
import { NextResponse } from 'next/server'
import sharp from 'sharp'
import { readJsonStrict, isResponse } from '@/lib/http'
import { photoFacts, photoPath, writePhoto } from '@/lib/catalogue'
import { cutout, haveModel } from '@/lib/cutout'

export const runtime = 'nodejs'
// A cutout is ~5s of CPU: a 1024x1024 forward pass, plus two resizes. The
// default would cut it off partway and report a timeout as a failed removal.
export const maxDuration = 120

/** A SKU names a file on this machine, so it may not contain a path. */
const SAFE_SKU = /^[A-Za-z0-9._-]{1,64}$/

/** The renderer works at 600px. Below that a fetch is worse than what we have. */
const MIN_EDGE = 600
/** What the approval screen is allowed to call HQ. */
const HQ_EDGE = 1200
/** A product photo is never this big. A download that is, is not one. */
const MAX_BYTES = 15 * 1024 * 1024

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status })

/**
 * Refuse a url that points back at this machine or its network.
 *
 * Not a security boundary — the app is staff-only on localhost, and anyone who
 * can type in this box can already open a terminal. It is here so that pasting
 * the wrong thing fails with a sentence instead of the app fetching its own
 * database port and reporting "not an image".
 */
function unreachableReason(u: URL): string | null {
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return `${u.protocol.replace(':', '')} is not a web address — paste an http or https link.`
  }
  const h = u.hostname.toLowerCase()
  const local =
    h === 'localhost' || h.endsWith('.localhost') || h === '0.0.0.0' || h === '[::1]' || h === '::1' ||
    /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h)
  return local ? 'That address is on this machine or this network, not the web.' : null
}

/** What the screen needs to say about an image, from the bytes themselves. */
async function describe(bytes: Buffer) {
  // From the decoder, never from a header or an API's claimed dimensions —
  // those are routinely stale, and a placeholder is happy to claim anything.
  const meta = await sharp(bytes).metadata()
  const width = meta.width ?? 0
  const height = meta.height ?? 0
  return {
    width, height, bytes: bytes.byteLength,
    hq: Math.min(width, height) >= HQ_EDGE,
    // The screen needs this to know whether to show a checkerboard. A cutout
    // previewed on white is indistinguishable from the photo it came from.
    alpha: Boolean(meta.hasAlpha),
  }
}

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams
  const sku = q.get('sku') ?? ''
  if (!SAFE_SKU.test(sku)) return bad('Not a usable SKU.')

  if (q.get('raw') === '1') {
    const path = photoPath(sku)
    if (!existsSync(path)) return bad('No photo for that product.', 404)
    return new NextResponse(new Uint8Array(readFileSync(path)), {
      headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' },
    })
  }

  return NextResponse.json({ sku, ...(await photoFacts(sku)) })
}

type Body = { sku?: string; url?: string; dataUrl?: string; cut?: boolean }

export async function POST(req: Request) {
  const body = await readJsonStrict<Body>(req)
  if (isResponse(body)) return body

  const sku = String(body.sku ?? '')
  if (!SAFE_SKU.test(sku)) return bad('Not a usable SKU.')

  /* Cut the background out — of the candidate on screen if there is one, and of
     the stored photo otherwise. Like a fetch, this produces something to look
     at and stores nothing: the same accept press saves it. */
  if (body.cut) {
    if (!haveModel()) {
      return bad('The background-removal model is not on this machine. Run: npm run cutout:model', 503)
    }
    const source = body.dataUrl
      ? Buffer.from(body.dataUrl.slice(body.dataUrl.indexOf(',') + 1), 'base64')
      : existsSync(photoPath(sku)) ? readFileSync(photoPath(sku)) : null
    if (!source) return bad('There is no photo to cut out.')
    let png: Buffer
    try { png = await cutout(source) } catch (e) {
      return bad(e instanceof Error ? e.message : 'The background could not be removed.', 500)
    }
    return NextResponse.json({
      sku,
      ...(await describe(png)),
      from: 'background removed',
      dataUrl: `data:image/png;base64,${png.toString('base64')}`,
    })
  }

  // Order matters: a cut request carries a dataUrl as its SOURCE, so this has
  // to come after the cut branch or asking to remove a background silently
  // saves the untouched candidate instead.
  // Saving takes bytes the screen already showed somebody. Fetching again here
  // would store an image nobody approved — the url could answer differently
  // the second time, which is exactly what this project watched Meta's CDN do.
  if (body.dataUrl) {
    const comma = body.dataUrl.indexOf(',')
    if (comma < 0 || !/^data:image\//.test(body.dataUrl)) return bad('That is not an image to save.')
    const bytes = Buffer.from(body.dataUrl.slice(comma + 1), 'base64')
    if (!bytes.byteLength) return bad('That image was empty.')
    await writePhoto(sku, bytes)
    return NextResponse.json({ saved: true, sku, ...(await photoFacts(sku)) })
  }

  const raw = String(body.url ?? '').trim()
  if (!raw) return bad('Paste the address of an image.')
  let url: URL
  try { url = new URL(raw) } catch { return bad('That is not a web address.') }
  const why = unreachableReason(url)
  if (why) return bad(why)

  let res: Response
  try {
    res = await fetch(url, { headers: { Accept: 'image/*' }, redirect: 'follow' })
  } catch {
    return bad('Nothing answered at that address.')
  }
  if (!res.ok) return bad(`That address answered ${res.status}.`)

  const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
  // SVG passes an `image/*` test and is never a product photograph — it is an
  // icon, and an icon is what a broken page serves.
  if (!type.startsWith('image/') || type === 'image/svg+xml') {
    return bad(`That address served ${type || 'no image type'}, not a photograph.`)
  }

  const bytes = Buffer.from(await res.arrayBuffer())
  if (bytes.byteLength > MAX_BYTES) return bad('That file is too big to be a product photo.')

  let facts: Awaited<ReturnType<typeof describe>>
  try { facts = await describe(bytes) } catch { return bad('That file could not be read as an image.') }

  if (Math.min(facts.width, facts.height) < MIN_EDGE) {
    return bad(
      `That image is ${facts.width}×${facts.height}. The poster needs at least ${MIN_EDGE} on the short edge.`,
    )
  }

  return NextResponse.json({
    sku,
    ...facts,
    from: url.host,
    // The screen shows these bytes and sends them back to save, so what is
    // approved and what is stored cannot differ.
    dataUrl: `data:${type};base64,${bytes.toString('base64')}`,
  })
}
