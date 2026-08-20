// Renders the whole imported sheet through a template. The real test of the
// engine is not one design, it is two hundred of them looking like a set.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { Resvg } from '@resvg/resvg-js'
import { parseWorkbook } from '../lib/excel/parse.ts'
import { loadFont } from '../lib/template/layout.ts'
import { renderProduct } from '../lib/template/render.ts'
import { displayNames } from '../lib/template/columns.ts'

const [sheet = 'data/samples/retailer-products.xlsx', id = 'brand-poster', limit = '60'] = process.argv.slice(2)
const template = readFileSync(`data/templates/${id}.svg`, 'utf8')
const manifest = JSON.parse(readFileSync(`data/templates/${id}.json`, 'utf8'))
const fonts = { Cairo: loadFont(readFileSync('data/fonts/Cairo-Variable.ttf')) }

const { products } = await parseWorkbook(readFileSync(sheet))
// Short names are part of the catalogue, not part of the sheet — they are
// keyed by SKU and survive a re-import. A report that ignored them would be
// measuring a poster nobody is going to print.
const short = displayNames()
for (const p of products) if (short[p.sku]) p.display_name = short[p.sku]
mkdirSync(`renders/${id}`, { recursive: true })

const t0 = Date.now()
const flagged = []
let clean = 0

for (const p of products.slice(0, +limit)) {
  const photo = `data/samples/images/${p.sku}.png`
  const images = existsSync(photo)
    ? { image: `data:image/png;base64,${readFileSync(photo).toString('base64')}` }
    : {}

  const { svg, report } = renderProduct(template, manifest, p, fonts, { mode: 'auto', images })
  writeFileSync(`renders/${id}/${p.sku}.svg`, svg)
  writeFileSync(`renders/${id}/${p.sku}.png`, new Resvg(svg, {
    fitTo: { mode: 'width', value: 620 },
    font: { fontDirs: ['data/fonts'], defaultFontFamily: 'Cairo', loadSystemFonts: false },
  }).render().asPng())

  if (report.length) flagged.push({ sku: p.sku, name: (p.name_en ?? '').slice(0, 40), report })
  else clean++
}

const secs = (Date.now() - t0) / 1000
const n = Math.min(products.length, +limit)
console.log(`\n${n} designs in ${secs.toFixed(1)}s  (${(secs / n * 1000).toFixed(0)} ms each)`)
console.log(`${clean} clean, ${flagged.length} needed attention\n`)

const kinds = {}
for (const f of flagged) for (const r of f.report) {
  const k = r.boxTooShort ? 'box too short (template fault)'
    : r.truncated ? 'text cut' : r.missingImage ? 'no photo' : r.empty ? 'empty column' : 'shrunk'
  kinds[k] = (kinds[k] ?? 0) + 1
}
for (const [k, v] of Object.entries(kinds)) console.log(`  ${String(v).padStart(3)}  ${k}`)

console.log('\nfirst few that need a look:')
for (const f of flagged.slice(0, 6)) {
  console.log(`  ${f.sku}  ${f.name.padEnd(42)} ${f.report.map(r =>
    r.boxTooShort ? `${r.slot}:BOX ${r.boxTooShort.have}<${r.boxTooShort.need}`
    : r.truncated ? `${r.slot}:CUT` : r.empty ? `${r.slot}:empty` : `${r.slot}:${r.shrunkTo}pt`).join(' ')}`)
}
