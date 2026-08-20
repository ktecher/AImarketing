// Renders real product rows into the brand template and writes SVG + PNG.
import { readFileSync, writeFileSync } from 'node:fs'
import { Resvg } from '@resvg/resvg-js'
const { loadFont } = await import('../lib/template/layout.ts')
const { renderProduct } = await import('../lib/template/render.ts')

const id = process.argv[2] ?? 'brand-poster'
const template = readFileSync(`data/templates/${id}.svg`, 'utf8')
const manifest = JSON.parse(readFileSync(`data/templates/${id}.json`, 'utf8'))
const fonts = { Cairo: loadFont(readFileSync('data/fonts/Cairo-Variable.ttf')) }

const PRODUCTS = [
  { sku: 'MBP14-M5', name_en: 'MacBook Pro 14-inch M5', name_ar: 'ماك بوك برو 14 بوصة', price_kwd: 449.5 },
  { sku: 'RT-AX88U', name_en: 'ASUS RT-AX88U Wi-Fi 6 Dual Band Gigabit Router',
    name_ar: 'راوتر أسوس واي فاي 6 ثنائي النطاق', price_kwd: 89.75 },
  { sku: 'SPK-BT9',  name_en: 'JBL Flip 6', name_ar: 'سماعة جي بي إل فليب 6', price_kwd: 24.9 },
]



for (const p of PRODUCTS) {
  // Images are embedded as data URIs so the SVG is a single self-contained file
  // — it opens correctly wherever it is sent, with no missing links.
  let images = {}
  try {
    const buf = readFileSync(`data/samples/images/${p.sku}.png`)
    images = { image: `data:image/png;base64,${buf.toString('base64')}` }
  } catch { /* no photo for this product — the report will say so */ }

  const { svg, report } = renderProduct(template, manifest, p, fonts, { mode: 'auto', images })
  writeFileSync(`renders/${id}-${p.sku}.svg`, svg)

  const png = new Resvg(svg, {
    fitTo: { mode: 'width', value: 930 },   // 2x for a legible preview
    font: { fontDirs: ['data/fonts'], defaultFontFamily: 'Cairo', loadSystemFonts: false },
  }).render().asPng()
  writeFileSync(`renders/${id}-${p.sku}.png`, png)

  const notes = report.length
    ? report.map(r => `${r.slot}:${r.truncated ? 'TRUNCATED' : r.shrunkTo ? `shrunk→${r.shrunkTo}` : r.missingImage ? 'no image' : 'empty'}`).join('  ')
    : 'clean'
  console.log(`${p.sku.padEnd(10)} ${String(png.length / 1024 | 0).padStart(4)} KB   ${notes}`)
}
console.log('\nwrote renders/*.svg and renders/*.png')
