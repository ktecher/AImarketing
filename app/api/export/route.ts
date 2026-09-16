import JSZip from 'jszip'
import { renderProduct, type ProductValues } from '@/lib/template/render'
import { fonts, fontDir, layoutFor, loadOverrides, loadTemplate, productImage, templateShape } from '@/lib/template/store'
import { productsFor } from '@/lib/template/columns'
import { renderPng, safeName, toJpg, toPdf, type Format } from '@/lib/template/export'
import { isResponse, readJsonStrict } from '@/lib/http'
import { reachable } from '@/lib/db'
import { recordExport } from '@/lib/assets'
import { current } from '@/lib/campaigns'

export const runtime = 'nodejs'
export const maxDuration = 600

export async function POST(req: Request) {
  // An unparseable body is not a request to export the whole catalogue.
  // `readJson` answered {} for junk, so `skus` came out undefined, and undefined
  // means "every product" at the `productsFor()` call below: `curl --data
  // 'not json'` rendered all 62 designs, stamped all 62 `assets` rows with a
  // fresh `exported_at`, and returned a cheerful 200.
  //
  // A VALID body that omits `skus` still means the whole sheet — that is exactly
  // what the Designs page sends when nothing is picked, and it keeps working.
  const body = await readJsonStrict(req)
  if (isResponse(body)) return body

  const { templateId, formats, width, skus } = body as {
    templateId?: string
    formats?: Format[]
    width?: number
    skus?: string[]
  }

  const id = String(templateId ?? 'brand-poster')
  const template = loadTemplate(id)
  if (!template) return Response.json({ error: 'Template not found.' }, { status: 404 })

  const wanted: Format[] = formats?.length ? formats : ['png']
  const f = fonts()
  const dir = fontDir()
  const overrides = loadOverrides(id)

  const shape = templateShape(template.svg)
  const [tw, th] = [shape.width, shape.height]

  // Resolved rather than filtered: a SKU chosen from the catalogue is not in
  // any sheet, and filtering the sheet for it returned an empty ZIP.
  // 503 before the 400 below. `productsFor()` swallows a database error and
  // returns nothing, so an outage arrived at the next line and was reported as
  // "you chose nothing" — a refusal blamed on the person, for a database they
  // had not started.
  if (!(await reachable())) {
    return Response.json({ error: 'Postgres is not answering. Run: npm run db:up' }, { status: 503 })
  }
  const rows: ProductValues[] = await productsFor(skus)
  if (!rows.length) {
    return Response.json(
      { error: 'Nothing to export — choose products from the catalogue, or import a sheet.' },
      { status: 400 },
    )
  }

  const px = Number(width) || tw * 2
  const zip = new JSZip()

  try {
  const flagged: { sku: string; issues: string[] }[] = []
  // What each design actually carries, so a later price change can be traced to
  // the posters that are now wrong. Collected as we go and written once.
  const baked: { sku: string; templateId: string; bound: Record<string, string> }[] = []
  // Faults in the template, not in a product. Identical on every row that
  // follows it, so collected once and printed at the TOP of the note: a slot
  // printing one product's words on all sixty is not a footnote.
  let faults: string[] = []

  for (const p of rows) {
    const sku = String(p.sku ?? '')
    const { svg, manifest, overridden } = layoutFor(template, shape, overrides[sku])

    const { svg: rendered, report, templateFaults, resolved } = renderProduct(svg, manifest, p, f, {
      mode: 'auto',
      images: productImage(sku) ? { image: productImage(sku) as string } : {},
    })

    const name = String(p.name_en ?? p.name_ar ?? sku)
    const png = wanted.some((w) => w !== 'svg') ? renderPng(rendered, dir, px) : null

    if (wanted.includes('svg')) zip.file(`svg/${safeName(sku, name, 'svg')}`, rendered)
    if (wanted.includes('png') && png) zip.file(`png/${safeName(sku, name, 'png')}`, png)
    if (wanted.includes('jpg') && png) zip.file(`jpg/${safeName(sku, name, 'jpg')}`, await toJpg(png))
    if (wanted.includes('pdf') && png) zip.file(`pdf/${safeName(sku, name, 'pdf')}`, await toPdf(png, tw, th))

    if (!overridden && !faults.length && templateFaults.length) {
      faults = templateFaults.map((r) =>
        r.literalText
          ? `${r.slot}: printing the same words on every design — "${r.literalText.printing}" — instead of each product's ${r.literalText.insteadOf}. Clear that slot's text in the layout editor.`
          : `${r.slot}: box is ${r.boxTooShort?.have}px, needs ${r.boxTooShort?.need}px for ${manifest.slots.find((s) => s.id === r.slot)?.maxLines ?? 1} line(s) at its size`,
      )
    }

    baked.push({ sku, templateId: id, bound: resolved })

    if (report.length) {
      flagged.push({
        sku,
        issues: report.map((r) =>
          r.boxTooShort ? `${r.slot}: box is ${r.boxTooShort.have}px, needs ${r.boxTooShort.need}px — fix the template`
          : r.truncated ? `${r.slot}: text was cut`
          : r.missingImage ? `${r.slot}: no photo`
          : r.empty ? `${r.slot}: empty`
          : `${r.slot}: shrunk to ${r.shrunkTo}pt`,
        ),
      })
    }
  }

  // The report ships inside the ZIP. A folder of 60 designs with no note about
  // which ones needed a look is how a bad one reaches a customer.
  const lines = [
    `${template.manifest.name} — ${rows.length} designs`,
    `Exported ${new Date().toISOString().slice(0, 10)}  ·  ${wanted.join(', ')}  ·  ${px}px wide`,
    '',
    ...(faults.length
      ? ['THE TEMPLATE ITSELF NEEDS FIXING — this affects every design here:',
         ...faults.map((f) => `  ${f}`), '']
      : []),
    flagged.length
      ? `${flagged.length} of ${rows.length} need a look before publishing:`
      : `All ${rows.length} rendered cleanly.`,
    ...flagged.map((x) => `  ${x.sku}  ${x.issues.join('; ')}`),
    '',
    'PDF is RGB and carries the rendered image — an approval artifact, not a',
    'print master. A print house wanting CMYK needs a conversion step.',
  ]
  zip.file('README.txt', lines.join('\n'))

  // After the ZIP is built, never before: a failed export must not leave a
  // record claiming designs are out there that nobody has.
  let recorded = 0
  try {
    recorded = await recordExport(baked, { formats: wanted, width: px, campaignId: await current() })
  } catch {
    // No database is not a reason to fail an export. The designs are correct;
    // only the ability to notice them going stale is missing, and the header
    // below says so rather than implying they are being watched.
  }

  const blob = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  return new Response(new Uint8Array(blob), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${id}-${rows.length}-designs.zip"`,
      'X-Needs-Attention': String(flagged.length),
      'X-Template-Faults': String(faults.length),
      'X-Recorded': String(recorded),
    },
  })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Render failed.'
    // A template binding a forbidden field is a template problem, and the
    // person who can fix it is looking at this screen — so say what is wrong.
    return Response.json({ error: msg }, { status: 400 })
  }
}
