// The full catalogue: upsert by SKU, edits, and what an edit does to a vector.
// Needs Postgres. Skips cleanly when it is not running, because a missing
// database is a state on somebody else's machine and not a failed test.
// Next loads .env for the app; a plain node script does not. Without this the
// suite connected to whatever is on the default port, failed to authenticate,
// and SKIPPED — seventeen assertions quietly stopped running and the total
// still looked fine.
try { process.loadEnvFile('.env') } catch { /* no .env is normal on a clone */ }

const { reachable, query } = await import('../lib/db.ts')
if (!(await reachable())) {
  console.log('\n--- catalogue ---\nskipped: Postgres is not running (brew services start postgresql@17)')
  process.exit(0)
}
const { upsert, edit, list, searchText } = await import('../lib/catalogue.ts')

let failed = 0
const ok = (label, cond, detail = '') => {
  if (!cond) failed++
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `   ${detail}` : ''}`)
}
const SKU = '__test_sku__'
const one = async () => (await query(`select * from products where sku=$1`, [SKU]))[0]
const clean = () => query(`delete from products where sku=$1`, [SKU])

console.log('\n--- the full catalogue ---')
await clean()

await upsert([{ row: 2, sku: SKU, name_en: 'Test Widget', brand: 'B', category: 'C',
                price_now: 12.5, price_was: 20, extra: { 'Category Path': 'A > B > Widgets' } }])
let r = await one()
ok('a sheet row is written',            r?.sku === SKU)
ok('price is stored as three-decimal fils', r.price_now === '12.500', r?.price_now)
ok('the category path is kept',         r.category_path === 'A > B > Widgets')
ok('in stock unless told otherwise',    r.in_stock === true)
ok('a fresh row has no vector yet',     r.embedding === null)

// Upsert by SKU: a second sheet UPDATES, it does not duplicate.
await upsert([{ row: 2, sku: SKU, name_en: 'Test Widget v2', brand: 'B', category: 'C', price_now: 13 }])
const dupes = await query(`select count(*)::int as n from products where sku=$1`, [SKU])
ok('a re-import updates, never duplicates', dupes[0].n === 1)
r = await one()
ok('the sheet wins on a re-import',      r.name_en === 'Test Widget v2')

console.log('\n--- a person edits it ---')
await edit(SKU, { price_now: 9.995 }, 'Farouk')
r = await one()
ok('a price edit lands',                 r.price_now === '9.995', r.price_now)
ok('the edit is attributed',             r.updated_by === 'Farouk')
ok('and marked as a human change',       r.source === 'human')

await edit(SKU, { in_stock: false }, 'Farouk')
ok('out of stock is recorded',           (await one()).in_stock === false)

console.log('\n--- an edit and the vector ---')
// A price is never part of the embedded text, so changing one must not throw
// away a vector that took minutes to compute across thousands of rows.
await query(`update products set embedding='{0.1,0.2}', embedded_at=now() where sku=$1`, [SKU])
await edit(SKU, { price_now: 11 }, 'Farouk')
ok('a price edit keeps the vector',      (await one()).embedding !== null)
await edit(SKU, { name_en: 'Something else entirely' }, 'Farouk')
ok('a name edit drops it for re-reading', (await one()).embedding === null,
   'a stale vector answers questions about a product that no longer exists')

console.log('\n--- search ---')
const found = await list({ search: 'Something else entirely' })
ok('an edited name is searchable',       found.rows.some((x) => x.sku === SKU))
ok('a search that matches nothing is empty',
   (await list({ search: '__nothing_matches_this__' })).rows.length === 0)

console.log('\n--- the text that gets embedded ---')
const t = searchText({ sku: 'X1', name_en: 'A Thing', brand: 'B', category_path: 'A > B > C' })
ok('identity and the tree are in it',    t.includes('A Thing') && t.includes('A > B > C'))
ok('a price is not',                     !/\d+\.\d{3}/.test(t),
   'embedding a price means re-embedding the catalogue on every sale')

console.log('\n--- one representation of a price, on every path ---')
// Postgres was always consistent. The break was `to_jsonb(products)`, which
// makes price_now a JSON NUMBER: JSON.parse hands JavaScript 5.5 while the same
// price from sheet_values arrives as the string "5.500". Every untouched row
// compared unequal to itself, and a re-import claimed to have overwritten 119
// corrections nobody had made. The fix is one representation, not a comparison
// that tolerates two.
const { canonicalPrice, sameValue } = await import('../lib/catalogue.ts')

ok('a price is always three decimals', canonicalPrice(5.5) === '5.500')
ok('a string price too',              canonicalPrice('5.5') === '5.500')
ok('and one already formatted',       canonicalPrice('5.500') === '5.500')
ok('nothing is empty, never 0.000',   canonicalPrice(null) === '' && canonicalPrice('') === '')

await clean()
await upsert([{ row: 2, sku: SKU, name_en: 'Canon', brand: 'B', category: 'C', price_now: 5.5, price_was: 20.9 }])
const [canon] = await query(
  `select price_now::text as col,
          sheet_values->>'price_now' as sheet,
          (jsonb_build_object('p', price_now::text))->>'p' as built
     from products where sku=$1`, [SKU])
ok('the column, sheet_values and a built object agree',
   canon.col === canon.sheet && canon.sheet === canon.built,
   JSON.stringify(canon))
ok('and that agreement is exact, not tolerated',
   sameValue(canon.col, canon.sheet) && canon.col === '5.500')

// The trap, kept as an assertion so nobody reintroduces it.
const [loose] = await query(`select (to_jsonb(products))->'price_now' as n from products where sku=$1`, [SKU])
ok('to_jsonb still returns a number — this is why it is not used',
   typeof loose.n === 'number' && String(loose.n) === '5.5')

// --- designing a product that is in no sheet ---------------------------------
//
// The Designs tab used to render only what a sheet said. Exporting a one-row
// spreadsheet to make one post is a chore with no purpose, so a SKU can now be
// named directly and resolved from the catalogue.
console.log('\n--- a design taken straight from the catalogue ---')
const { productsFor, catalogueProducts } = await import('../lib/template/columns.ts')

await clean()
await upsert([{ row: 2, sku: SKU, name_en: 'Straight From Catalogue', brand: 'B',
                category: 'C', price_now: 12.5, price_was: 20 }])

const [only] = await catalogueProducts([SKU])
ok('a catalogue row becomes a design row',  only?.sku === SKU)
// Templates decide "is this discounted" by comparing these two. numeric(10,3)
// arrives from pg as a string, and "20" < "9" is true, so a string here prints
// a discount badge on a product that has none.
ok('prices arrive as numbers, not strings',
   typeof only?.price_now === 'number' && typeof only?.price_was === 'number',
   `${typeof only?.price_now}/${typeof only?.price_was}`)
ok('the short name falls back to the title', only?.display_name === 'Straight From Catalogue')

const resolved = await productsFor([SKU, '__no_such_sku__'])
ok('a SKU nothing has heard of is dropped, not rendered blank', resolved.length === 1)

const ordered = await productsFor(['__no_such_sku__', SKU])
ok('the caller\'s order is kept', ordered[0]?.sku === SKU)

// No SKUs means the imported sheet — and when there is no sheet, the catalogue.
//
// It used to mean the sheet and nothing else, which read as "no products" on a
// workspace whose catalogue never came from one: the content studio said "No
// products loaded" over sixty-two rows, and the advisor and the name editor
// were equally blind. An EMPTY list still means nothing, because "resolve these
// zero SKUs" must not turn into "render the whole shop".
const whole = await productsFor()
const sheetRows = (await import('../lib/template/columns.ts')).importedProducts()
ok('no SKUs means the sheet when there is one',
   sheetRows.length === 0 || whole.length === sheetRows.length)
ok('and the catalogue when there is not',
   sheetRows.length > 0 || whole.some((p) => String(p.sku) === SKU),
   `sheet ${sheetRows.length}, resolved ${whole.length}`)
ok('an empty list still means nothing', (await catalogueProducts([])).length === 0)

await clean()
console.log(`\n${failed ? `${failed} FAILED` : 'catalogue holds'}`)
process.exit(failed ? 1 : 0)
