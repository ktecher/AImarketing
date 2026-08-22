#!/usr/bin/env node
/**
 * Puts the product photos on disk into a product sheet, the way an export that
 * carried its own images would.
 *
 * The scraped catalogue arrives as one folder per product — an `info.md` and an
 * `image.jpg` — while the sheet is a flat list of rows. Nothing joins them: the
 * sheet's SKU column holds MANUFACTURER model numbers, and the folders are named
 * after URL slugs. `info.md` is what carries both, so it is the join.
 *
 * Images are ANCHORED TO ROWS rather than written as filenames in a column.
 * Both work — lib/excel/parse.ts reads either — but every folder here calls its
 * photo `image.jpg`, and a filename claimed by sixty products matches none of
 * them. An anchored image belongs to its row and cannot be ambiguous.
 *
 *   node scripts/attach-images.mjs <sheet.xlsx> <folder-root> <out.xlsx>
 *
 * Writes a new file. The sheet it reads is never modified.
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import ExcelJS from 'exceljs'
import { withoutCommentRels } from '../lib/excel/parse.ts'

const [sheetPath, imagesRoot, outPath] = process.argv.slice(2)
if (!sheetPath || !imagesRoot || !outPath) {
  console.error('usage: node scripts/attach-images.mjs <sheet.xlsx> <folder-root> <out.xlsx>')
  process.exit(1)
}

/** Match on identifiers, not on prose: punctuation and case vary between sources. */
const key = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '')
const words = (s) => String(s ?? '').toLowerCase().replace(/[‘’“”"'`]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()

const field = (md, label) => (md.match(new RegExp(`\\*\\*${label}:\\*\\*\\s*(.+)`)) ?? [])[1]?.trim()

/** Every product folder under the root, two levels deep: <group>/<product>/. */
function products(root) {
  const out = []
  for (const group of readdirSync(root)) {
    if (group.startsWith('.')) continue
    const groupDir = join(root, group)
    if (!statSync(groupDir).isDirectory()) continue
    for (const dir of readdirSync(groupDir)) {
      if (dir.startsWith('.')) continue
      const folder = join(groupDir, dir)
      const info = join(folder, 'info.md')
      const image = join(folder, 'image.jpg')
      if (!existsSync(info) || !existsSync(image)) continue
      const md = readFileSync(info, 'utf8')
      out.push({
        folder,
        image,
        name: field(md, 'Product name'),
        article: field(md, 'SKU / Article number'),
        model: field(md, 'Model number'),
      })
    }
  }
  return out
}

const found = products(imagesRoot)
console.log(`${found.length} product folders with a photo`)

const wb = new ExcelJS.Workbook()
await wb.xlsx.load(await withoutCommentRels(readFileSync(sheetPath)))
const ws = wb.worksheets[0]
if (!ws) { console.error('that workbook has no sheets'); process.exit(1) }

const headers = ws.getRow(1).values.slice(1).map((v) => (v && typeof v === 'object' ? (v.text ?? '') : v ?? ''))
const col = (name) => headers.findIndex((h) => String(h).trim().toLowerCase() === name) + 1
const skuCol = col('sku')
const nameCol = headers.findIndex((h) => /product name|name \(en\)/i.test(String(h))) + 1
if (!skuCol) { console.error('no SKU column in that sheet'); process.exit(1) }

// Row lookups. Model number first: it is an identifier, and two products can
// share a name where they cannot share a code.
const byModel = new Map()
const byName = new Map()
const text = (r, c) => {
  const v = ws.getRow(r).getCell(c).value
  return v && typeof v === 'object' ? (v.text ?? v.result ?? '') : (v ?? '')
}
for (let r = 2; r <= ws.rowCount; r++) {
  const sku = key(text(r, skuCol))
  if (sku && !byModel.has(sku)) byModel.set(sku, r)
  if (nameCol) {
    const n = words(text(r, nameCol))
    if (n && !byName.has(n)) byName.set(n, r)
  }
}

// One column past the data, which is where a sheet that carried its own images
// put them. A header so a person opening the file knows what the column is;
// the importer reads the anchor, not the header.
const imageCol = headers.length + 1
ws.getCell(1, imageCol).value = 'Image'
ws.getColumn(imageCol).width = 10

const attached = []
const unmatched = []
for (const p of found) {
  const row = byModel.get(key(p.model)) ?? byModel.get(key(p.article)) ?? byName.get(words(p.name))
  if (!row) { unmatched.push(p); continue }

  const id = wb.addImage({ buffer: readFileSync(p.image), extension: 'jpeg' })
  ws.addImage(id, {
    tl: { col: imageCol - 1, row: row - 1 },
    ext: { width: 54, height: 54 },
  })
  ws.getRow(row).height = 46
  attached.push({ row, name: p.name })
}

await wb.xlsx.writeFile(outPath)

console.log(`\n${attached.length} photos attached to ${outPath}`)
console.log(`${ws.rowCount - 1} rows in the sheet, ${ws.rowCount - 1 - attached.length} still without a photo`)
if (unmatched.length) {
  console.log(`\n${unmatched.length} folders matched no row in this sheet:`)
  for (const p of unmatched) console.log(`  ${p.article}  ${String(p.name).slice(0, 68)}`)
}
