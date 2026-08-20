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
