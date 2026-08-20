// The advisor's checks. No model runs here, and none runs in v1 either —
// architecture.md: "v1 has no model and no score". Everything below is a string
// operation or a catalogue lookup, which is exactly why it can be trusted.
const { priceDrift } = await import('../lib/advisor/review.ts')
const { formatKwd } = await import('../lib/money.ts')

let failed = 0
const ok = (label, cond, detail = '') => {
  if (!cond) failed++
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `   ${detail}` : ''}`)
}

const ROW = { sku: '502037', name_en: 'Apple Pencil 1st generation', brand: 'APPLE',
              category: 'Tablet Styluses', price_now: 119.5, price_was: 149.9 }
const NOSALE = { sku: 'P1', name_en: 'Plain Thing', brand: 'B', category: 'C', price_now: 10 }

console.log('\n--- the flagship check: your caption says X, the catalogue says Y ---')
const drift = priceDrift('Get it for 129 KD today!', ROW)
ok('a wrong price is a blocker',        drift.length === 1)
ok('the blocker quotes the line',       drift[0]?.quote === '129 KD', JSON.stringify(drift[0]?.quote))
ok('it says what the catalogue holds',  drift[0]?.why.includes('119.500 KD'), drift[0]?.why)
ok('it names the was-price too',        drift[0]?.why.includes('149.900 KD'))
ok('the criterion is named, not scored', drift[0]?.criterion === 'the price matches the catalogue')

console.log('\n--- the same price written differently is NOT drift ---')
// Flagging a formatting difference as a wrong price is how a check loses the
// credibility that makes people act on it.
for (const written of ['119.500 KD', '119.5 KD', 'KD 119.500', '119.500KD', '119.500 KWD']) {
  ok(`"${written}" agrees with the catalogue`, priceDrift(`Only ${written}.`, ROW).length === 0)
}
ok('the was-price is also a price the catalogue holds',
   priceDrift('Was 149.900 KD, now 119.500 KD.', ROW).length === 0)
ok('a price with a thousands comma is read as one number',
   priceDrift('It is 1,199 KD.', { ...ROW, price_now: 1199 }).length === 0)

console.log('\n--- what is not a price ---')
ok('a bare number with no currency is not a price', priceDrift('16 GB of RAM.', ROW).length === 0)
ok('no text, no blockers',                          priceDrift('', ROW).length === 0)
ok('a product with no price cannot drift',
   priceDrift('It is 5.000 KD.', { sku: 'X', name_en: 'X' }).length === 0)
ok('a product with only a live price still checks it',
   priceDrift('It is 99.000 KD.', NOSALE).length === 1)

console.log('\n--- two wrong prices are two blockers ---')
const two = priceDrift('Was 200 KD, now 129 KD.', ROW)
ok('each wrong figure is quoted separately', two.length === 2, JSON.stringify(two.map((b) => b.quote)))

console.log('\n--- rule 4: no score, rating or grade anywhere ---')
const src = await import('node:fs').then((fs) =>
  fs.readFileSync('lib/advisor/review.ts', 'utf8') + fs.readFileSync('app/(staff)/advisor/page.tsx', 'utf8'))
// Comments may name the words to forbid them; code and UI text may not use them.
const offending = src
  .split('\n')
  .filter((l) => !/^\s*(\*|\/\/)/.test(l))
  .filter((l) => /\bscore\b|\brating\b|\bgrade\b/i.test(l))
ok('no score, rating or grade in code or UI', offending.length === 0, offending.join(' | '))

console.log('\n--- three decimals, one formatter ---')
ok('the advisor speaks fils',    formatKwd(119.5) === '119.500 KD')
ok('nothing is not zero',        formatKwd(undefined) === '')

console.log(`\n${failed ? `${failed} FAILED` : 'advisor checks hold'}`)
process.exit(failed ? 1 : 0)
