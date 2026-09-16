import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { Resvg } from '@resvg/resvg-js'
import { buildTemplateSvg, readSlots, type Manifest } from '@/lib/template/svg'
import { renderProduct } from '@/lib/template/render'
import { familyOf, fontFiles, fonts, fontDir, loadOverrides, loadTemplate, productImage, saveOverride } from '@/lib/template/store'
import { availableColumns, previewProducts, sampleValues } from '@/lib/template/columns'
import { readJson } from '@/lib/http'
import { snapshot } from '@/lib/snapshot'

export const runtime = 'nodejs'

const dir = () => join(process.cwd(), 'data/templates')

/**
 * Ids are filenames. Next fully percent-decodes a dynamic segment before the
 * handler sees it, so `..%2F..%2Fdata%2Ftemplates%2Fflyer` arrives as a real
 * `../` and escapes data/templates — reading a template that was not asked for,
 * overwriting any .json the process can write, and deleting .svg/.json/
 * .overrides.json anywhere. Same guard as lib/chat/store.ts and the sku check
 * in app/api/products/route.ts.
 */
const safe = (id: string) => /^[A-Za-z0-9_-]{1,64}$/.test(id)

/** The artwork href, pulled back out of the template so a save can re-emit it. */
function artworkOf(svg: string): string {
  const m = /<image[^>]*id="artwork"[^>]*(?:xlink:)?href="([^"]+)"/.exec(svg)
  return m?.[1] ?? ''
}

function sizeOf(svg: string): { width: number; height: number } {
  const m = /<svg[^>]*width="(\d+)"[^>]*height="(\d+)"/.exec(svg)
  return { width: m ? +m[1] : 0, height: m ? +m[2] : 0 }
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  // Next 16: route params are async.
  const { id } = await ctx.params
  if (!safe(id)) return Response.json({ error: 'Template not found.' }, { status: 404 })
  const t = loadTemplate(id)
  if (!t) return Response.json({ error: 'Template not found.' }, { status: 404 })

  // ?sku=… edits one product's exception rather than the template itself.
  // ?skus=… is what the Designs page had chosen, so editing the template for
  // all of them still previews against one of them and not a stranger.
  const q = new URL(_req.url).searchParams
  const sku = q.get('sku') ?? ''
  const picked = (q.get('skus') ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  const overrides = loadOverrides(id)
  const mine = sku ? overrides[sku] : undefined

  const { columns, source } = availableColumns()
  return Response.json({
    sku,
    hasOverride: Boolean(mine),
    overriddenSkus: Object.keys(overrides),
    id,
    manifest: mine ? { ...t.manifest, slots: mine.slots } : t.manifest,
    boxes: mine ? mine.boxes : readSlots(t.svg),
    artwork: artworkOf(t.svg),
    ...sizeOf(t.svg),
    columns,
    columnSource: source,
    sample: sampleValues(),
    products: await previewProducts(sku, picked),
    fonts: fontFiles().map(familyOf),
  })
}

/** Saves geometry into the SVG and policy into the manifest — the D13 split. */
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  if (!safe(id)) return Response.json({ error: 'Template not found.' }, { status: 404 })
  const { boxes, manifest, sku, reset } = (await readJson(req)) as {
    boxes: { id: string; x: number; y: number; width: number; height: number }[]
    manifest: Manifest
    sku?: string
    reset?: boolean
  }

  // An editor save with no layout in it is a malformed request, not a template
  // wiped to nothing. Unguarded this reads `manifest.name` off undefined and
  // becomes a 500 with an empty body — the shape D50 exists to stop.
  if (!Array.isArray(boxes) || !manifest?.slots) {
    return Response.json({ error: 'That save carried no layout. Reload the editor and try again.' }, { status: 400 })
  }

  // Saving with a sku writes an exception for that one product; the template is
  // left alone. Reset deletes the exception and the product follows the template
  // again, which is the way back that stops fifty products becoming fifty layouts.
  if (sku) {
    saveOverride(id, sku, reset ? null : { boxes, slots: manifest.slots })
    return Response.json({ saved: true, sku, reset: Boolean(reset) })
  }

  const svgPath = join(dir(), `${id}.svg`)
  if (!existsSync(svgPath)) return Response.json({ error: 'Template not found.' }, { status: 404 })

  const current = readFileSync(svgPath, 'utf8')
  const { width, height } = sizeOf(current)

  writeFileSync(
    svgPath,
    buildTemplateSvg({ name: manifest.name, width, height, background: artworkOf(current), slots: boxes }),
  )
  writeFileSync(join(dir(), `${id}.json`), JSON.stringify(manifest, null, 2))

  // Products with their own layout keep it — that is the point of an override,
  // but it means they do NOT pick up this change. Say how many, so a template
  // fix is not silently missed by the products that most needed it.
  const stale = Object.keys(loadOverrides(id))
  return Response.json({ saved: true, slots: boxes.length, notFollowing: stale })
}

/** Live preview: render the current, unsaved layout against sample values. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  if (!safe(id)) return Response.json({ error: 'Template not found.' }, { status: 404 })
  const { boxes, manifest, values } = (await readJson(req)) as {
    boxes: { id: string; x: number; y: number; width: number; height: number }[]
    manifest: Manifest
    values?: Record<string, string | number>
  }

  if (!Array.isArray(boxes) || !manifest?.slots) {
    return Response.json({ error: 'That preview carried no layout.' }, { status: 400 })
  }

  const t = loadTemplate(id)
  if (!t) return Response.json({ error: 'Template not found.' }, { status: 404 })

  const { width, height } = sizeOf(t.svg)
  const svg = buildTemplateSvg({
    name: manifest.name, width, height, background: artworkOf(t.svg), slots: boxes,
  })

  // Previewing a REAL product shows that product and nothing else. Filling its
  // gaps from placeholder samples would paint Arabic onto a catalogue that has
  // none, which is precisely the thing the preview exists to reveal.
  const vals = values ?? sampleValues()
  const sku = String(vals.sku ?? '')
  const image = productImage(sku)

  const { svg: rendered, report, resolved } = renderProduct(svg, manifest, vals, fonts(), {
    mode: 'auto',
    images: image ? { image } : {},
  })

  const png = new Resvg(rendered, {
    fitTo: { mode: 'width', value: Math.min(760, width * 2) },
    font: { fontDirs: [fontDir()], defaultFontFamily: 'Cairo', loadSystemFonts: false },
  }).render().asPng().toString('base64')

  return Response.json({ png, report, resolved })
}

/** Removes a template. Its per-product exceptions go with it. */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  if (!safe(id)) return Response.json({ error: 'Template not found.' }, { status: 404 })
  const svg = join(dir(), `${id}.svg`)
  if (!existsSync(svg)) return Response.json({ error: 'Template not found.' }, { status: 404 })

  const files = [`${id}.svg`, `${id}.json`, `${id}.overrides.json`]
  // The layout work and every per-product exception go with it, and neither is
  // in version control. Copy first.
  const saved = snapshot(`deleted-template-${id}`, files.map((f) => join('data/templates', f)))

  for (const f of files) rmSync(join(dir(), f), { force: true })
  return Response.json({ deleted: id, backup: saved ? saved.replace(process.cwd() + '/', '') : null })
}
