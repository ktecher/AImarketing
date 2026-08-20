import JSZip from 'jszip'
import { renderProduct, type ProductValues } from '@/lib/template/render'
import { buildTemplateSvg, readSlots } from '@/lib/template/svg'
import { fonts, fontDir, loadOverrides, loadTemplate, productImage } from '@/lib/template/store'
import { importedProducts } from '@/lib/template/columns'
import { renderPng, safeName, toJpg, toPdf, type Format } from '@/lib/template/export'
import { readJson } from '@/lib/http'

export const runtime = 'nodejs'
export const maxDuration = 600

export async function POST(req: Request) {
  const { templateId, formats, width, skus } = (await readJson(req)) as {
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

  const artwork = /<image[^>]*id="artwork"[^>]*(?:xlink:)?href="([^"]+)"/.exec(template.svg)?.[1] ?? ''
  const size = /<svg[^>]*width="(\d+)"[^>]*height="(\d+)"/.exec(template.svg)
  const [tw, th] = [size ? +size[1] : 0, size ? +size[2] : 0]
  void readSlots

  const all = importedProducts()
  const rows: ProductValues[] = skus?.length ? all.filter((p) => skus.includes(String(p.sku))) : all
  if (!rows.length) return Response.json({ error: 'Nothing to export — import a product sheet first.' }, { status: 400 })

  const px = Number(width) || tw * 2
  const zip = new JSZip()

  try {
  const flagged: { sku: string; issues: string[] }[] = []
  // Faults in the template, not in a product. Identical on every row that
  // follows it, so collected once and printed at the TOP of the note: a slot
  // printing one product's words on all sixty is not a footnote.
  let faults: string[] = []

  for (const p of rows) {
    const sku = String(p.sku ?? '')
    const mine = overrides[sku]

    const svg = mine
      ? buildTemplateSvg({ name: template.manifest.name, width: tw, height: th, background: artwork, slots: mine.boxes })
      : template.svg
    const manifest = mine ? { ...template.manifest, slots: mine.slots } : template.manifest

    const { svg: rendered, report, templateFaults } = renderProduct(svg, manifest, p, f, {
      mode: 'auto',
      images: productImage(sku) ? { image: productImage(sku) as string } : {},
    })

    const name = String(p.name_en ?? p.name_ar ?? sku)
    const png = wanted.some((w) => w !== 'svg') ? renderPng(rendered, dir, px) : null

    if (wanted.includes('svg')) zip.file(`svg/${safeName(sku, name, 'svg')}`, rendered)
    if (wanted.includes('png') && png) zip.file(`png/${safeName(sku, name, 'png')}`, png)
    if (wanted.includes('jpg') && png) zip.file(`jpg/${safeName(sku, name, 'jpg')}`, await toJpg(png))
    if (wanted.includes('pdf') && png) zip.file(`pdf/${safeName(sku, name, 'pdf')}`, await toPdf(png, tw, th))

    if (!mine && !faults.length && templateFaults.length) {
      faults = templateFaults.map((r) =>
        r.literalText
          ? `${r.slot}: printing the same words on every design — "${r.literalText.printing}" — instead of each product's ${r.literalText.insteadOf}. Clear that slot's text in the layout editor.`
          : `${r.slot}: box is ${r.boxTooShort?.have}px, needs ${r.boxTooShort?.need}px for ${manifest.slots.find((s) => s.id === r.slot)?.maxLines ?? 1} line(s) at its size`,
      )
    }

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

  const blob = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  return new Response(new Uint8Array(blob), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${id}-${rows.length}-designs.zip"`,
      'X-Needs-Attention': String(flagged.length),
      'X-Template-Faults': String(faults.length),
    },
  })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Render failed.'
    // A template binding a forbidden field is a template problem, and the
    // person who can fix it is looking at this screen — so say what is wrong.
    return Response.json({ error: msg }, { status: 400 })
  }
}
