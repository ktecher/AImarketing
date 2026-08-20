// The advisor's checks. No model runs here, and none runs in v1 either —
// architecture.md: "v1 has no model and no score". Everything below is a string
// operation or a catalogue lookup, which is exactly why it can be trusted.
const { priceDrift, moneyFigures } = await import('../lib/advisor/review.ts')
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

console.log('\n--- two figures in one draft are not attributable ---')
// This assertion used to expect two blockers. It was wrong: two prices means
// two products, retrieval returns one, and asserting against the wrong row is
// how a correct price gets flagged. Declining is the honest answer, and the
// reason is printed in not_assessed rather than swallowed.
const two = priceDrift('Was 200 KD, now 129 KD.', ROW)
ok('nothing is asserted about either', two.length === 0, JSON.stringify(two.map((b) => b.quote)))

console.log('\n--- a draft carrying two prices is two products ---')
// Retrieval returns one product. The Apple Pencil's CORRECT 19.900 was reported
// as drift because the draft also named the AirPods and the AirPods won the
// match. A check that flags a correct price is one people learn to click past,
// and then the wrong price gets through too.
ok('two prices are counted as two',   moneyFigures('19.900 KD and 34.900 KD').length === 2)
ok('the same price twice is one',     moneyFigures('25.000 KD, yes 25.000 KD').length === 1)
ok('a formatting difference is one',  moneyFigures('119.5 KD is 119.500 KD').length === 1)
ok('two prices: nothing is asserted',
   priceDrift('Pencil 19.900 KD and AirPods 34.900 KD.', ROW).length === 0)
ok('two prices: not even a wrong one is asserted',
   priceDrift('Pencil 19.900 KD and AirPods 99.000 KD.', ROW).length === 0)
ok('one price is still judged',
   priceDrift('Pencil 129 KD.', ROW).length === 1)

console.log('\n--- the same wrong price twice is one problem ---')
ok('a repeated wrong price is reported once',
   priceDrift('Only 129 KD! Yes, 129 KD.', ROW).length === 1,
   JSON.stringify(priceDrift('Only 129 KD! Yes, 129 KD.', ROW).map((b) => b.quote)))

console.log('\n--- a price the catalogue agrees with is verified, not invented ---')
// The copy guard exists to stop a MODEL writing a figure. A person reviewing
// their own draft has every right to type the correct price, and calling that
// an invented number is the check crying wolf on the one thing it got right.
const { review } = await import('../lib/advisor/review.ts')
const clean = await review('Grab the Apple Pencil 1st generation for only 19.900 KD.')
ok('a correct price raises nothing',   clean.blockers.length === 0,
   JSON.stringify(clean.blockers.map((b) => [b.quote, b.criterion])))
ok('and the facts verdict is ok',      clean.verdicts['facts against the catalogue'] === 'ok')

console.log('\n--- a claim is checked even when no product matched ---')
// Gating claim safety behind a product match meant a caption the retriever
// could not place got no safety check at all — the worst case to be silent in.
const noProduct = await review('Happy weekend! We are the best shop in Kuwait, guaranteed.')
ok('no product matched',               noProduct.matched === null)
ok('the superlative is still caught',  noProduct.blockers.some((b) => b.quote === 'best'))
ok('the guarantee is still caught',    noProduct.blockers.some((b) => b.quote === 'guaranteed'))
ok('claims verdict is problem',        noProduct.verdicts['claims and compliance'] === 'problem')
ok('facts verdict is honest, not ok',  noProduct.verdicts['facts against the catalogue'] === 'needs work')

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
