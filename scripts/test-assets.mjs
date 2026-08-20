// Which exported designs carry a figure that has since changed.
// Needs Postgres; skips cleanly without it.
try { process.loadEnvFile('.env') } catch { /* no .env is normal on a clone */ }
const { reachable, query } = await import('../lib/db.ts')
if (!(await reachable())) {
  console.log('\n--- exported designs ---\nskipped: Postgres is not running (npm run db:up)')
  process.exit(0)
}
const { recordExport, drifted, forget } = await import('../lib/assets.ts')

let failed = 0
const ok = (label, cond, detail = '') => {
  if (!cond) failed++
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `   ${detail}` : ''}`)
}
const SKU = '__test_asset__'
const T = 'brand-poster'
const clean = () => query('delete from assets where sku=$1', [SKU])

console.log('\n--- exported designs ---')
await clean()

await recordExport([{ sku: SKU, templateId: T, bound: { price: '19.900 KD', name_en: 'A Thing' } }],
                   { formats: ['png'], width: 620 })
const [row] = await query('select * from assets where sku=$1', [SKU])
ok('the export is recorded',        row?.sku === SKU)
ok('what it painted is stored',     row.bound_values.price === '19.900 KD')
ok('the formats travel',            row.formats.includes('png'))
ok('campaign_id exists from row one', 'campaign_id' in row,
   'bolted on later it is backfilled numbers')

// Re-exporting the same design updates rather than piling up rows: the latest
// export is the one that is out there.
await recordExport([{ sku: SKU, templateId: T, bound: { price: '17.250 KD', name_en: 'A Thing' } }],
                   { formats: ['png', 'pdf'], width: 620 })
const rows = await query('select * from assets where sku=$1', [SKU])
ok('re-exporting updates, never duplicates', rows.length === 1)
ok('and replaces what was painted',  rows[0].bound_values.price === '17.250 KD')

console.log('\n--- drift is a re-render, not a price comparison ---')
// A design can go stale because a price moved, but equally because somebody
// fixed a name or shortened it. Comparing only prices reports clean on a poster
// carrying the wrong name.
const same = await drifted([{ sku: SKU, name_en: 'A Thing', price_now: 1 }], '__no_such_template__')
ok('an unknown template is skipped, not crashed', same.drift.length === 0)

console.log('\n--- forgetting ---')
await forget(SKU, T)
ok('a withdrawn design is forgotten',
   (await query('select 1 from assets where sku=$1', [SKU])).length === 0)

await clean()
console.log(`\n${failed ? `${failed} FAILED` : 'exported designs held'}`)
process.exit(failed ? 1 : 0)
