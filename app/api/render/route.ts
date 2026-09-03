import { Resvg } from '@resvg/resvg-js'
import { renderProduct, type ProductValues } from '@/lib/template/render'
import { fonts, fontDir, layoutFor, loadOverrides, loadTemplate, productImage, templateShape } from '@/lib/template/store'
import { productsFor } from '@/lib/template/columns'
import { readJson } from '@/lib/http'
import { reachable } from '@/lib/db'

export const runtime = 'nodejs'
export const maxDuration = 120

export async function POST(req: Request) {
  const { templateId, products, skus, format, width, limit, offset } = await readJson(req)

  const template = loadTemplate(String(templateId ?? 'brand-poster'))
  if (!template) return Response.json({ error: 'Template not found.' }, { status: 404 })

  const f = fonts()
  const dir = fontDir()
  const overrides = loadOverrides(String(templateId ?? 'brand-poster'))

  const shape = templateShape(template.svg)

  // Three ways to say what to render, narrowest first: rows handed over
  // wholesale (the editor previewing an unsaved layout), a list of SKUs picked
  // from the catalogue, or nothing — which still means "the sheet we imported".
  const handedOver = Array.isArray(products) && products.length
  // Only when this actually goes to the catalogue. The editor hands its rows
  // over wholesale to preview an unsaved layout and needs no database at all —
  // refusing that would break a screen that was working.
  //
  // On the path that DOES read: `productsFor()` returns [] on a database error,
  // so an outage rendered as `total: 0` with a 200 beside it, and the Designs
  // grid came up empty with nothing saying why. See app/api/advisor/route.ts.
  if (!handedOver && !(await reachable())) {
    return Response.json(
      { error: 'Postgres is not answering. Run: npm run db:up' },
      { status: 503 },
    )
  }

  const all: ProductValues[] = handedOver
    ? (products as ProductValues[])
    : await productsFor(Array.isArray(skus) ? (skus as unknown[]).map(String) : undefined)

  const from = Number(offset ?? 0)
  const rows = all.slice(from, from + Number(limit ?? all.length))

  try {
  const results = rows.map((p) => {
    const sku = String(p.sku ?? '')
    const image = productImage(sku)

    const { svg: svgForProduct, manifest: manifestForProduct, overridden } =
      layoutFor(template, shape, overrides[sku])

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
      // For the Designs grid's category filter. A rendered batch is often the
      // whole of what a campaign is pushing, and "show me only the laptops" is
      // the first thing anybody asks of a list that long.
      category: p.category ? String(p.category) : undefined,
      overridden,
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
