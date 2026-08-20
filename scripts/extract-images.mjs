// Pulls the embedded photos out of a sheet and stores them by SKU.
//
// This is the step that proves the anchor reading actually works: the image
// written for a SKU has to be that product's photo, not the one above or below.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import sharp from 'sharp'
import { parseWorkbook } from '../lib/excel/parse.ts'

const file = process.argv[2] ?? 'data/samples/retailer-products.xlsx'
const { products, issues } = await parseWorkbook(readFileSync(file))
mkdirSync('data/samples/images', { recursive: true })

let written = 0
for (const p of products) {
  if (!p.image) continue
  // Normalised to PNG at a sane size — the renderer embeds these as data URIs.
  await sharp(p.image.buffer).resize(600, 600, { fit: 'inside', withoutEnlargement: true })
    .png().toFile(`data/samples/images/${p.sku}.png`)
  written++
}
console.log(`${products.length} products, ${written} photos written to data/samples/images/`)
if (issues.length) console.log(`${issues.length} issues`)
