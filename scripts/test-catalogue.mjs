// The full catalogue: upsert by SKU, edits, and what an edit does to a vector.
// Needs Postgres. Skips cleanly when it is not running, because a missing
// database is a state on somebody else's machine and not a failed test.
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

await clean()
console.log(`\n${failed ? `${failed} FAILED` : 'catalogue holds'}`)
process.exit(failed ? 1 : 0)
