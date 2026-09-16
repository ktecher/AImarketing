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

// Image is deliberately unmapped: it names a FILE, and an unmapped column is
// kept verbatim in `extra`, which is exactly where the bulk photo matcher reads
// it. Mapping it would need a column the schema does not have, for no gain.
const unmapped = r.headers.filter(h => h && !Object.values(r.mapping).includes(h))
ok(`only Stock/Warranty/Image unmapped (${unmapped.join(', ')})`,
   unmapped.every(h => ['Stock','Warranty','Image'].includes(h)))
ok('the Image filename survives into extra',
   r.products[0].extra['Image'] === 'macbook-pro-14-m5.jpg')

console.log(`\nwrote data/samples/product-sheet-template.xlsx (${(buf.length/1024).toFixed(1)} KB)`)

// --- The shipped templates, checked against the traps that already fired ---
//
// Both of these regressed silently in real use: the poster's name slot was
// rebuilt bound to name_en, discarding every short name across 29 of 60
// designs, and a literal typed into the editor was saved on the template
// rather than on one product, printing one laptop's Arabic name on all 60.
// Nothing failed either time, which is why they are assertions now.
const { readFileSync: read, existsSync: has, readdirSync: list } = await import('node:fs')

for (const f of list('data/templates').filter((f) => f.endsWith('.json') && !f.includes('.overrides.'))) {
  const m = JSON.parse(read(`data/templates/${f}`, 'utf8'))
  const name = m.slots.find((s) => s.id === 'name_en')

  ok(`${f}: the English name slot binds display_name, not name_en`,
     !name || name.bind === 'display_name')

  // A literal on a TEMPLATE slot applies to every product in the catalogue.
  // On a per-product override it is the whole point; here it is never right.
  for (const s of m.slots) {
    ok(`${f}: ${s.id} has no literal text stamped on it`, !(s.text && s.text.trim()))
  }

  // `price` is never bound: every product can be discounted, and a poster
  // carrying the pre-discount figure advertises a price nobody will be charged.
  for (const s of m.slots) {
    ok(`${f}: ${s.id} does not bind price_kwd`, s.bind !== 'price_kwd' && s.bind !== 'price')
  }
}

// The rebuild script and the committed manifest must not drift: the script is
// what HANDOFF tells the next person to run.
const script = read('scripts/make-template-svg.mjs', 'utf8')
ok('the rebuild script binds display_name too', /bind:\s*'display_name'/.test(script))
ok('the rebuild script binds no price_kwd', !/bind:\s*'price_kwd'/.test(script))

// --- The price must never be cut (CLAUDE.md rule 2) ---
//
// 62 of 62 brand-poster designs shipped a price reading "19.900 KD…" and every
// assertion in this suite was green. The fault was the box HEIGHT, not the
// width: the price slot was 23px tall for a 32pt single line needing 50, so
// fitText reached its floor with the box still too short and ellipsised a
// figure that was 36 points NARROWER than its own box. An ellipsis on a price
// is a number the shop is not charging, which is the whole of rule 2.
const { loadFont, requiredHeight } = await import('../lib/template/layout.ts')
const { renderProduct } = await import('../lib/template/render.ts')
const { readSlots } = await import('../lib/template/svg.ts')

const FONT = 'data/fonts/Cairo-Variable.ttf'
if (!has(FONT)) {
  console.error(`\nMissing ${FONT}. Font files are not committed — ` +
    `see data/fonts/LICENCE-NOTES.md for which families to download.\n`)
  process.exit(1)
}
const cairo = { Cairo: loadFont(read(FONT)) }

// Sized for the widest figure the catalogue actually holds, not for the one
// product somebody happened to open:
//   select max(price_now), max(price_was) from products  ->  899.900 / 1129.900
const PRICED = [
  { sku: '502037', display_name: 'Apple Pencil 1st generation', name_ar: 'قلم آبل الجيل الأول',
    price_now: 19.9, price_was: 40.5 },
  { sku: 'WIDEST', display_name: 'Widest price in the catalogue', name_ar: 'أغلى سعر في الكتالوج',
    price_now: 1129.9, price_was: 1199.9 },
]

for (const file of list('data/templates').filter((f) => f.endsWith('.json') && !f.includes('.overrides.'))) {
  const id = file.replace(/\.json$/, '')
  if (!has(`data/templates/${id}.svg`)) continue
  const m = JSON.parse(read(`data/templates/${id}.json`, 'utf8'))
  const svg = read(`data/templates/${id}.svg`, 'utf8')
  const boxes = new Map(readSlots(svg).map((b) => [b.id, b]))

  // A box shorter than its own line count can never hold its value at any size
  // the fitter can reach, so every long one is cut while the short sample in
  // front of you looks fine. Derived from the helper, never typed.
  for (const s of m.slots.filter((s) => s.type === 'text')) {
    const box = boxes.get(s.id)
    if (!box) continue
    const need = requiredHeight(s.size ?? 32, s.maxLines ?? 1, s.lineHeight)
    ok(`${id}: the ${s.id} box holds ${s.size ?? 32}pt (needs ${need}, has ${box.height})`,
       box.height >= need)
  }

  for (const p of PRICED) {
    const { report } = renderProduct(svg, m, p, cairo, { mode: 'auto', images: {} })
    const cut = report.filter((r) => r.truncated).map((r) => r.slot)
    ok(`${id}: ${p.price_now.toFixed(3)} KD prints in full, uncut`,
       !cut.includes('price'))
    ok(`${id}: nothing else is cut either at ${p.price_now.toFixed(3)} KD`,
       cut.length === 0)
  }
}
