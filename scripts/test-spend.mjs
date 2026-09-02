// The budget split: model weight words in, TypeScript's fils out.
// Pure — no database, no model — so unlike the campaigns suite it always runs.
const { split, LINE_ITEMS } = await import('../lib/spend.ts')

let failed = 0
const ok = (label, cond, detail = '') => {
  if (!cond) failed++
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `   ${detail}` : ''}`)
}

const line = (item, weight, why = 'because') => ({ item, weight, why })

const FULL_PLAN = [
  line('Boosting', 'dominant', 'Snapchat reaches nearly half the country'),
  line('Photography and production', 'moderate'),
  line('Influencer', 'small'),
  line('Print and OOH', 'small'),
  line('Event', 'minimal'),
  line('Contingency', 'minimal'),
]

console.log('\n--- parts sum exactly to the total, in fils, across a table of totals ---')
const TOTALS = [1000, 999.999, 7, 333.333, 250, 12.5, 1]
const PLANS = [
  FULL_PLAN,
  [line('Boosting', 'dominant'), line('Contingency', 'minimal')],
  [line('Boosting', 'large'), line('Influencer', 'large'), line('Event', 'large')],
]
for (const total of TOTALS) {
  for (const plan of PLANS) {
    const parts = split(total, plan)
    const sum = parts.reduce((s, p) => s + p.fils, 0)
    ok(`total ${total} across ${plan.length} lines sums exactly`,
       sum === Math.round(total * 1000),
       `sum=${sum} expected=${Math.round(total * 1000)}`)
  }
}

console.log('\n--- a NaN total is rejected, not allocated ---')
// The one that fails silently: NaN fails both `> 0` and `<= 0`, so a bare
// range check lets it through and it flows on as a number.
let threwOnNaN = false
try { split(NaN, FULL_PLAN) } catch { threwOnNaN = true }
ok('NaN total throws', threwOnNaN)

console.log('\n--- 0, negative, and Infinity totals are rejected ---')
let threwOnZero = false
try { split(0, FULL_PLAN) } catch { threwOnZero = true }
ok('0 total throws', threwOnZero)

let threwOnNegative = false
try { split(-50, FULL_PLAN) } catch { threwOnNegative = true }
ok('negative total throws', threwOnNegative)

let threwOnInfinity = false
try { split(Infinity, FULL_PLAN) } catch { threwOnInfinity = true }
ok('Infinity total throws', threwOnInfinity)

console.log('\n--- an empty lines array is rejected ---')
let threwOnEmpty = false
try { split(500, []) } catch { threwOnEmpty = true }
ok('empty lines array throws', threwOnEmpty)

console.log('\n--- one line gets the entire budget ---')
const oneLine = split(250, [line('Boosting', 'dominant')])
ok('single line carries the whole total in fils', oneLine[0].fils === 250000, String(oneLine[0].fils))
ok('single line text matches', oneLine[0].text === '250.000 KD', oneLine[0].text)

console.log('\n--- the remainder lands on the largest line, not on Contingency ---')
// Contingency last and minimal — if the remainder fell on "the last line"
// instead of "the largest line" this would silently pass on the wrong line.
const remainderPlan = [
  line('Boosting', 'dominant'),
  line('Photography and production', 'moderate'),
  line('Contingency', 'minimal'),
]
// 100 KWD = 100000 fils, shares 8:3:1 over 12 -> 66666.67, 25000, 8333.33
// rounds to 66667, 25000, 8333 = 100000 exactly with no remainder by luck,
// so pick a total that actually leaves a remainder to move.
const remainderParts = split(100.001, remainderPlan)
const contingency = remainderParts.find((p) => p.item === 'Contingency')
const boosting = remainderParts.find((p) => p.item === 'Boosting')
const sum = remainderParts.reduce((s, p) => s + p.fils, 0)
ok('parts still sum exactly with a remainder present', sum === 100001, String(sum))
// Unrounded shares of 100001 fils over 8:3:1 are 66667.33 / 25000.25 / 8333.42,
// which round to 66667 / 25000 / 8333 — one fils short of the total. That one
// fils belongs on Boosting (the largest share), not on Contingency (last and
// smallest) even though Contingency is the line most plans put last.
ok('Contingency keeps its plain rounded share, unmoved',
   contingency.fils === 8333, String(contingency.fils))
ok('the remainder lands on Boosting, the largest line',
   boosting.fils === 66668, String(boosting.fils))

console.log('\n--- every text output matches the three-decimal KD format ---')
for (const total of TOTALS) {
  for (const p of split(total, FULL_PLAN)) {
    ok(`"${p.text}" is three-decimal KD`, /^\d+\.\d{3} KD$/.test(p.text), p.text)
  }
}

console.log('\n--- duplicate items both survive ---')
const dupePlan = [
  line('Boosting', 'large', 'the launch push'),
  line('Boosting', 'small', 'a retargeting flight'),
  line('Contingency', 'minimal'),
]
const dupeParts = split(300, dupePlan)
ok('two Boosting lines both come back', dupeParts.filter((p) => p.item === 'Boosting').length === 2)
ok('their reasons are kept distinct',
   dupeParts.filter((p) => p.item === 'Boosting').map((p) => p.why).join('|') ===
   'the launch push|a retargeting flight')

console.log('\n--- the line items are the ones the spec names ---')
ok('six line items', LINE_ITEMS.length === 6, String(LINE_ITEMS.length))
ok('Contingency is one of them', LINE_ITEMS.includes('Contingency'))

console.log(`\n${failed ? `${failed} FAILED` : 'the budget splits'}`)
process.exit(failed ? 1 : 0)
