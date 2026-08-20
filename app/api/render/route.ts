import { Resvg } from '@resvg/resvg-js'
import { renderProduct, type ProductValues } from '@/lib/template/render'
import { buildTemplateSvg, readSlots } from '@/lib/template/svg'
import { fonts, fontDir, loadOverrides, loadTemplate, productImage } from '@/lib/template/store'
import { importedProducts } from '@/lib/template/columns'
import { readJson } from '@/lib/http'

export const runtime = 'nodejs'
export const maxDuration = 120

export async function POST(req: Request) {
  const { templateId, products, format, width, limit, offset } = await readJson(req)

  const template = loadTemplate(String(templateId ?? 'brand-poster'))
  if (!template) return Response.json({ error: 'Template not found.' }, { status: 404 })

  const f = fonts()
  const dir = fontDir()
  const overrides = loadOverrides(String(templateId ?? 'brand-poster'))

  const artwork = /<image[^>]*id="artwork"[^>]*(?:xlink:)?href="([^"]+)"/.exec(template.svg)?.[1] ?? ''
  const size = /<svg[^>]*width="(\d+)"[^>]*height="(\d+)"/.exec(template.svg)
  const [tw, th] = [size ? +size[1] : 0, size ? +size[2] : 0]
  const baseBoxes = readSlots(template.svg)

  // No products given means "the catalogue we last imported".
  const all: ProductValues[] = Array.isArray(products) && products.length
    ? (products as ProductValues[])
    : importedProducts()

  const from = Number(offset ?? 0)
  const rows = all.slice(from, from + Number(limit ?? all.length))

  try {
  const results = rows.map((p) => {
    const sku = String(p.sku ?? '')
    const image = productImage(sku)

    // A product with an exception is rendered from its own layout; everything
    // else follows the template.
    const mine = overrides[sku]
    const svgForProduct = mine
      ? buildTemplateSvg({ name: template.manifest.name, width: tw, height: th, background: artwork, slots: mine.boxes })
      : template.svg
    const manifestForProduct = mine ? { ...template.manifest, slots: mine.slots } : template.manifest
    void baseBoxes

    const { svg, report, templateFaults: faults } = renderProduct(svgForProduct, manifestForProduct, p, f, {
      mode: 'auto',
      images: image ? { image } : {},
    })

    let png: string | undefined
    if (format !== 'svg') {
      png = new Resvg(svg, {
        fitTo: { mode: 'width', value: Number(width) || 620 },
        font: { fontDirs: [dir], defaultFontFamily: 'Cairo', loadSystemFonts: false },
      })
        .render()
        .asPng()
        .toString('base64')
    }

    return {
      sku, name: p.name_en ?? p.name_ar ?? sku, report, png, faults,
      overridden: Boolean(mine),
      svg: format === 'svg' ? svg : undefined,
    }
  })

  return Response.json({
    template: template.manifest.name,
    total: all.length,
    offset: from,
    results,
    // Everything that needed attention, across the whole batch.
    needsAttention: results.filter((r) => r.report.length > 0).length,
    // Faults in the template itself. Identical for every product that follows
    // it, so reported once — a per-product list would bury them under sixty
    // copies of the same line. Products with their own layout are excluded:
    // their fault is theirs, and it is named with the SKU.
    templateFaults: results.find((r) => !r.overridden)?.faults ?? [],
    overriddenFaults: results
      .filter((r) => r.overridden && r.faults.length)
      .map((r) => ({ sku: r.sku, faults: r.faults })),
  })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Render failed.'
    // A template binding a forbidden field is a template problem, and the
    // person who can fix it is looking at this screen — so say what is wrong.
    return Response.json({ error: msg }, { status: 400 })
  }
}
