// The template and the parser must agree. If a header here stops matching a
// pattern there, a sheet filled from our own download imports wrong — the worst
// possible failure, because it looks like the user's fault.
import { writeFileSync } from 'node:fs'
const { buildTemplate } = await import('../lib/excel/template.ts')
const { parseWorkbook } = await import('../lib/excel/parse.ts')

const buf = await buildTemplate()
writeFileSync('data/samples/product-sheet-template.xlsx', buf)

const r = await parseWorkbook(buf)
const ok = (label, cond) => { console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}`); if (!cond) process.exitCode = 1 }

const EXPECT = ['sku','name_en','display_name','name_ar','brand','category','price_kwd','sale_price_kwd','description_en','description_ar']

console.log(`\nmapping: ${JSON.stringify(r.mapping, null, 0)}\n`)
for (const f of EXPECT) ok(`${f} maps to "${r.mapping[f] ?? '—'}"`, Boolean(r.mapping[f]))

ok('header found on row 1',            r.headers[0] === 'SKU')
ok('both example rows parse',          r.products.length === 2)
ok('no errors on our own template',    r.issues.filter(i => i.severity === 'error').length === 0)
ok('price read as a number',           r.products[0].price_kwd === 449.5)
ok('blank sale price stays undefined', r.products[1].sale_price_kwd === undefined)
ok('Arabic preserved',                 r.products[0].name_ar === 'ماك بوك برو 14 بوصة')
// "Display Name" must not be claimed by the name_en pattern, which matches a bare
// "Name" and would silently swallow the column the whole feature depends on.
ok('display name read, not stolen',    r.products[0].display_name === 'MacBook Pro 14' &&
                                       r.products[0].name_en === 'MacBook Pro 14-inch M5')
ok('extra column kept',                r.products[0].extra['Warranty'] === '1 year')
ok('Stock kept as extra',              Boolean(r.products[0].extra['Stock']))

const unmapped = r.headers.filter(h => h && !Object.values(r.mapping).includes(h))
ok(`only Stock/Warranty unmapped (${unmapped.join(', ')})`,
   unmapped.every(h => ['Stock','Warranty'].includes(h)))

console.log(`\nwrote data/samples/product-sheet-template.xlsx (${(buf.length/1024).toFixed(1)} KB)`)
