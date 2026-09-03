// Runnable check for the importer. Asserts the messy fixture is handled the way
// the contract says: skip and report, never abort.
import { readFileSync } from 'node:fs'
import { register } from 'node:module'
register('data:text/javascript,export async function resolve(s,c,n){return n(s,c)}', import.meta.url)
const { parseWorkbook } = await import('../lib/excel/parse.ts')
const { formatKwd } = await import('../lib/money.ts')

const r = await parseWorkbook(readFileSync('data/samples/fixture-messy.xlsx'))
const err = (sku) => r.issues.find(i => i.reason.includes(sku))
const ok = (label, cond) => { console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}`); if (!cond) process.exitCode = 1 }

console.log(`\nheader found on row ${r.products[0]?.row - 1 || '?'}, sheet "${r.sheetName}"`)
console.log(`mapping: ${JSON.stringify(r.mapping, null, 0)}\n`)

ok('header block above the table was skipped', r.headers[0] === 'SKU')
ok('Arabic column mapped',                     r.mapping.name_ar === 'اسم المنتج')
ok('good rows survived',                       r.products.length === 6)
ok('duplicate SKU rejected',                   !!err('Duplicate SKU'))
ok('row with no SKU rejected',                 !!r.issues.find(i => i.reason.includes('No SKU')))
ok('row with no name rejected',                !!err('NONAME-1'))
ok('missing price warned, row kept',           !!err('NOPRICE-1') && r.products.some(p => p.sku === 'NOPRICE-1'))
ok('text price "KD 89.750" parsed',            r.products.find(p => p.sku === 'RT-AX88U')?.price_kwd === 89.75)
ok('sale >= price warned',                     !!err('BADSALE-1'))
ok('blank row did not end the sheet',          r.products.some(p => p.sku === 'SPK-BT9'))
ok('embedded images matched to rows',          r.products.filter(p => p.image).length === 2)
ok('unmapped column kept verbatim',            r.products[0]?.extra['Warranty'] === '1 year')
ok('English name column mapped',               r.mapping.name_en === 'Product Name (EN)')
ok('"Warranty" not stolen by the Arabic rule',  r.mapping.name_ar !== 'Warranty')
ok('fils formatting is three decimals',        formatKwd(449.5) === '449.500 KD')
ok('never two decimals',                       formatKwd(12.5) !== '12.50 KD')

console.log(`\n${r.products.length} products, ${r.issues.length} issues`)
for (const i of r.issues) console.log(`  [${i.severity}] row ${i.row}: ${i.reason}`)

// --- cell comments must not stop the import -----------------------------------
//
// The real retailer export stores comments at xl/comments/comment1.xml and points
// at them with an ABSOLUTE relationship target. exceljs 4.4.0 looks for
// xl/comments1.xml and keys it relatively, so it matched neither, never parsed
// the part, then dereferenced the missing entry — a 2 MB sheet died in 27 ms
// with "Cannot read properties of undefined (reading 'comments')" and no row
// was ever read.
//
// Built here rather than committed: the sheet that exposed it is real catalogue
// data and gitignored.
console.log('\n--- a sheet carrying cell comments ---')
const JSZip = (await import('jszip')).default
const zip = await JSZip.loadAsync(readFileSync('data/samples/fixture-messy.xlsx'))

zip.file('xl/comments/comment1.xml',
  '<?xml version="1.0" encoding="UTF-8"?>' +
  '<comments xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<authors><author>someone</author></authors>' +
  '<commentList><comment ref="A1" authorId="0"><text><t>a note</t></text></comment></commentList>' +
  '</comments>')

const relsPath = 'xl/worksheets/_rels/sheet1.xml.rels'
const existing = zip.files[relsPath] ? await zip.files[relsPath].async('string') : null
const rel = '<Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments"' +
  ' Target="/xl/comments/comment1.xml" Id="comments" />'
zip.file(relsPath, existing
  ? existing.replace('</Relationships>', rel + '</Relationships>')
  : '<?xml version="1.0" encoding="UTF-8"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    rel + '</Relationships>')

let commented, threw = null
try {
  commented = await parseWorkbook(await zip.generateAsync({ type: 'nodebuffer' }))
} catch (e) { threw = e }

ok('a sheet with cell comments still imports', threw === null)
if (threw) console.log(`      threw: ${threw.message}`)
ok('and reads exactly the same products', commented?.products.length === r.products.length)
ok('comments do not disturb image matching',
  commented?.products.filter((p) => p.image).length === r.products.filter((p) => p.image).length)

// --- a price cell that is not a number must be REPORTED, not silently zeroed ---
//
// `Number('')` is 0 and is finite, so a cell reading "N/A" or "TBC" used to
// parse as a price of zero. Both warnings then went silent — `price "…" is not
// a number` needs undefined, and `has no price` needs an empty cell — and this
// file's contract is that every skip names its row and its reason.
//
// The sale column was the worst of it: a word there gave price_now 0 against a
// real price_was, so `on_sale` was true and a poster printed "0.000 KD" struck
// through with the real price and badged -100%, with nothing reported anywhere.
{
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Products')
  ws.addRow(['SKU', 'Name (EN)', 'Price (KD)', 'Sale Price'])
  ws.addRow(['P-PLAIN', 'Plain', 449.5, null])
  ws.addRow(['P-WORD',  'Word',  'N/A', null])
  ws.addRow(['P-SALE',  'Sale',  449.5, 'No offer'])
  const rich = ws.addRow(['P-RICH', 'Rich', null, null])
  rich.getCell(3).value = { richText: [{ text: '449.5' }] }
  const form = ws.addRow(['P-FORM', 'Formula', null, null])
  form.getCell(3).value = { formula: 'A1*2', result: 449.5 }

  const out = await parseWorkbook(Buffer.from(await wb.xlsx.writeBuffer()))
  const by = (sku) => out.products.find((p) => p.sku === sku)

  ok('a plain price still parses',      by('P-PLAIN')?.price_kwd === 449.5)
  ok('a word is not a price of zero',   by('P-WORD')?.price_kwd === undefined)
  ok('and the row says why',
     out.issues.some((i) => /P-WORD/.test(i.reason) && /not a number/.test(i.reason)))
  // The one that reached a poster: a word in the sale column made the product
  // look 100% off.
  ok('a word in the sale column does not zero the price', by('P-SALE')?.price_now === 449.5)
  ok('and does not put it on sale',     by('P-SALE')?.on_sale !== true)
  // exceljs hands back objects for these; the raw cell stringified to
  // "[object Object]" and stripped to nothing, so a valid price became zero.
  ok('a rich-text price parses',        by('P-RICH')?.price_kwd === 449.5)
  ok('a formula price parses',          by('P-FORM')?.price_kwd === 449.5)
  ok('and none of them print a figure nobody set',
     [by('P-WORD')].every((p) => formatKwd(p?.price_now) === ''))
}
