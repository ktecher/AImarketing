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

console.log('\n--- a person naming the product settles what retrieval guesses at ---')
// The advisor now ASKS which product a draft is for, so the answer has to
// actually change what gets checked — otherwise the question is decoration.
// It also means these run with Ollama stopped: a pinned row skips retrieval,
// so there is no embedding call in this path at all.
const pinned = await review('Grab it for only 129 KD today!', { row: ROW })
ok('the pinned row is what matched',    pinned.matched?.sku === '502037', JSON.stringify(pinned.matched))
ok('and it says the person named it',   pinned.matched?.confidence === 'sku')
ok('the price is judged against it',    pinned.blockers.some((b) => b.quote === '129 KD'))
ok('with the pinned row\u2019s price',      pinned.blockers[0]?.why.includes('119.500 KD'), pinned.blockers[0]?.why)

// The draft says nothing about this product at all. Retrieval would decline
// (correctly); a person pointing at the row overrides that, which is the whole
// point of being able to answer the question.
const elsewhere = await review('Only 5.000 KD this weekend.', { row: NOSALE })
ok('an unrelated draft still checks',   elsewhere.matched?.sku === 'P1')
ok('and the wrong price is caught',     elsewhere.blockers.some((b) => b.quote === '5.000 KD'),
   JSON.stringify(elsewhere.blockers.map((b) => b.quote)))

const right = await review('Only 10.000 KD this weekend.', { row: NOSALE })
ok('the right price raises nothing',    right.blockers.length === 0,
   JSON.stringify(right.blockers.map((b) => [b.quote, b.criterion])))

console.log('\n--- Arabic is checked, not waved through ---')
// compliance-guardrails.md: "They apply identically in Arabic and English."
// They did not. This draft — blessed offer, cheapest price in Kuwait, a price
// the catalogue does not hold, guaranteed — came back with zero blockers and
// the screen said "Nothing in this draft contradicts the catalogue."
const ar = await review('عرض مبارك! أرخص سعر بالكويت ٣٤٫٩٠٠ د.ك مضمون', { row: ROW, lang: 'ar' })
const named = (r, n) => r.blockers.some((b) => b.criterion === n)
ok('the superlative is caught in Arabic',   named(ar, 'no unsubstantiable superlative'),
   JSON.stringify(ar.blockers.map((b) => [b.quote, b.criterion])))
ok('the guarantee is caught in Arabic',     named(ar, 'no guarantee the company has not made'))
ok('the religious framing is caught',       named(ar, 'nothing religious or political'))
ok('and Arabic-Indic digits are a price',   named(ar, 'the price matches the catalogue'))
ok('so the claims verdict is not ok',       ar.verdicts['claims and compliance'] === 'problem')
ok('the Arabic limit is stated, not implied',
   ar.not_assessed.some((n) => n.includes('curated list')), JSON.stringify(ar.not_assessed))

// The currency word may LEAD in Arabic, and half of Arabic retail writes it that way.
ok('a leading currency word is still a price',
   priceDrift('د.ك 34.900 فقط', ROW).length === 1,
   JSON.stringify(priceDrift('د.ك 34.900 فقط', ROW).map((b) => b.quote)))

console.log('\n--- a draft about no product is not placed against one ---')
// Measured: eight mostly-generic words matched an Anker cable at lexical 0.500,
// and the advisor issued an authoritative "Do not publish" quoting that cable's
// price. Declining costs one question; being confidently wrong costs the reader.
const vague = await review('the fastest charger we sell — grab it for 12.000 KD')
ok('nothing is matched',            vague.matched === null, JSON.stringify(vague.matched))
ok('and no price is asserted',      !vague.blockers.some((b) => b.criterion.startsWith('the price')),
   JSON.stringify(vague.blockers.map((b) => b.quote)))
ok('the superlative still lands',    vague.blockers.some((b) => b.quote === 'fastest'))

console.log('\n--- a correct price does not buy silence on the rest ---')
// bareDigits reports the FIRST offending span and no other, so filtering the
// result afterwards let a right price consume the whole check.
const swallowed = await review('Only 119.500 KD — the first 50 customers get a free case.', { row: ROW })
ok('the invented figure is still caught', swallowed.blockers.some((b) => b.quote.includes('50')),
   JSON.stringify(swallowed.blockers.map((b) => b.quote)))
ok('and the correct price is not',        !swallowed.blockers.some((b) => b.quote.includes('119.500')))

console.log('\n--- was/now belongs to one product ---')
// The strongest-performing offer structure in electronics. It was declined as
// "two products", on every sale caption the team writes.
const sale = await review('Was 149.900 KD, now 119.500 KD.', { row: ROW })
ok('both prices are verified',      sale.blockers.length === 0,
   JSON.stringify(sale.blockers.map((b) => [b.quote, b.criterion])))
ok('and the facts verdict is ok',   sale.verdicts['facts against the catalogue'] === 'ok',
   sale.verdicts['facts against the catalogue'])
ok('nothing is said about two products',
   !sale.not_assessed.some((n) => n.includes('more than one')), JSON.stringify(sale.not_assessed))

// A genuinely unattributable pair still declines: 34.900 is not this row's.
const mixed = await review('Pencil 119.500 KD and AirPods 34.900 KD.', { row: ROW })
ok('a figure this row does not hold still declines',
   mixed.verdicts['facts against the catalogue'] === 'needs work' && mixed.blockers.length === 0,
   JSON.stringify([mixed.verdicts, mixed.blockers.map((b) => b.quote)]))

console.log('\n--- the unit written once ---')
// "was 40.500 now 19.900 KD" — the struck figure carries no unit, so it was not
// money, and the guard called the row's own pre-discount price invented.
const bare = await review('was 149.900 now 119.500 KD', { row: ROW })
ok('a bare struck price is verified, not invented', bare.blockers.length === 0,
   JSON.stringify(bare.blockers.map((b) => [b.quote, b.criterion])))

console.log('\n--- one row, and only that row, decides a price ---')
// A neighbouring retrieved row used to be folded into the known prices, so any
// figure matching any of six prices across three rows was accepted — while the
// screen said "Checked against <the one row>."
ok('a wrong price cannot be blessed by another product',
   priceDrift('Apple Pencil for 34.900 KD.', ROW).length === 1)
ok('priceDrift takes a row, not a neighbourhood', priceDrift.length === 2, String(priceDrift.length))

console.log('\n--- a price a rival product holds is a question, not a fabrication ---')
// Measured on this catalogue, money stripped from the query: the 2nd generation
// Pencil scores 0.530 and the 1st generation 0.528, and the 1st is the one that
// holds the 19.900 this draft quotes. Two thousandths of relevance, at the
// weakest match tier there is, decided that the shop's own approved price was a
// fabrication. A guard that fires on legitimate input is a bug in the guard.
const rival = await review('Best deal in Kuwait! Apple Pencil now only 19.900 KD, guaranteed cheapest.')
ok('a price the catalogue holds is never a blocker',
   !rival.blockers.some((b) => b.criterion.startsWith('the price')),
   JSON.stringify(rival.blockers.map((b) => [b.quote, b.criterion])))
ok('the facts verdict is honest, not a problem',
   rival.verdicts['facts against the catalogue'] === 'needs work',
   rival.verdicts['facts against the catalogue'])
ok('the other Pencil is offered, so the advisor can ask',
   rival.ambiguous.some((a) => a.sku === '502037'), JSON.stringify(rival.ambiguous))
ok('and the superlative still blocks', rival.blockers.some((b) => b.quote === 'Best'))
ok('and the guarantee still blocks',   rival.blockers.some((b) => b.quote === 'guaranteed'))

// The true positive, same sentence: no Pencil holds 25.000, so no rival can
// bless it and declining to judge would be the opposite failure.
const invented = await review('Best deal in Kuwait! Apple Pencil now only 25.000 KD, guaranteed cheapest.')
ok('a figure no product holds is still a blocker',
   invented.blockers.some((b) => b.quote === '25.000 KD' && b.criterion.startsWith('the price')),
   JSON.stringify(invented.blockers.map((b) => [b.quote, b.criterion])))
ok('nothing is offered to ask about',  invented.ambiguous.length === 0)
ok('and the facts verdict is problem', invented.verdicts['facts against the catalogue'] === 'problem')

console.log('\n--- rule 4: no score, rating or grade anywhere ---')
const src = await import('node:fs').then((fs) =>
  ['lib/advisor/review.ts', 'lib/advisor/converse.ts', 'app/(staff)/advisor/page.tsx']
    .map((f) => fs.readFileSync(f, 'utf8')).join('\n'))
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
