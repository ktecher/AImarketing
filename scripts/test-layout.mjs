// Layout regressions are invisible until you are looking at 200 bad posts.
// These assertions are the substitute for looking.
import { readFileSync } from 'node:fs'
const L = await import('../lib/template/layout.ts')

const cairo = L.loadFont(readFileSync('data/fonts/Cairo-Variable.ttf'))
let failed = 0
const ok = (label, cond, detail = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? '   ' + detail : ''}`)
  if (!cond) failed++
}

console.log('\n--- detection ---')
ok('Arabic detected',            L.hasArabic('راوتر'))
ok('English is not Arabic',      !L.hasArabic('MacBook Pro'))
ok('code-switched is Arabic',    L.hasArabic('MacBook Pro 14 بوصة'))
ok('Arabic-first is rtl',        L.baseDirection('ماك بوك برو') === 'rtl')
ok('English-first is ltr',       L.baseDirection('MacBook Pro 14 بوصة') === 'ltr')
ok('digits alone do not decide', L.baseDirection('14 بوصة') === 'rtl')

console.log('\n--- bidi isolation (the demo-day bug) ---')
const iso = L.isolateNumbers('ماك بوك برو 14 بوصة')
ok('number wrapped in isolates', iso.includes('⁨') && iso.includes('⁩'), JSON.stringify(iso))
ok('price with decimals isolated as one run',
   (L.isolateNumbers('السعر 449.500 دينار').match(/⁨/g) || []).length === 1)
ok('pure English left alone',    L.isolateNumbers('MacBook Pro 14') === 'MacBook Pro 14')

console.log('\n--- bidi runs: digits must NOT reverse (caught visually, not by assertion) ---')
// HarfBuzz does not implement the bidi algorithm. Handing it a whole mixed line
// as RTL rendered "14" as "41" and "449.500" as "005.944" on screen while every
// assertion passed. These are the checks that would have caught it.
const runs = L.bidiRuns('ماك بوك برو 14 بوصة')
ok('mixed text splits into runs', runs.length >= 3, JSON.stringify(runs.map(r => r.text)))
const digitRun = runs.find(r => /\d/.test(r.text))
ok('the digit run exists',            Boolean(digitRun))
ok('digits keep source order',        digitRun?.text.includes('14'), JSON.stringify(digitRun?.text))
ok('digit run is ltr',               digitRun?.direction === 'ltr')
ok('Arabic runs are rtl',            runs.filter(r => L.hasArabic(r.text)).every(r => r.direction === 'rtl'))

const priced = L.bidiRuns('ماك بوك برو 14 بوصة — 449.500 دينار')
const price = priced.find(r => r.text.includes('449'))
ok('a decimal price stays intact',   price?.text.includes('449.500'), JSON.stringify(price?.text))
ok('price is not reversed',          !priced.some(r => r.text.includes('005.944')))

// Visual order: in an RTL paragraph the Arabic head sits on the RIGHT, so it is
// the LAST run left-to-right.
const rtlFirst = L.bidiRuns('بوصة 14')
ok('rtl paragraph puts Arabic last in visual order',
   rtlFirst[rtlFirst.length - 1].direction === 'rtl',
   JSON.stringify(rtlFirst.map(r => r.text)))

// Pure runs must be left completely alone.
ok('pure English is one ltr run',
   L.bidiRuns('MacBook Pro 14').length === 1 && L.bidiRuns('MacBook Pro 14')[0].direction === 'ltr')
ok('isolate marks never reach the shaper',
   !L.bidiRuns(L.isolateNumbers('ماك 14 بوصة')).some(r => /[\u2066-\u2069]/.test(r.text)))

// Outlined output must contain a path per glyph across every run.
const mixedPath = L.outlinePath('ماك 14', cairo, 48)
ok('outline covers all runs', (mixedPath.match(/<path/g) || []).length >= 5,
   `${(mixedPath.match(/<path/g) || []).length} paths`)

console.log('\n--- measurement respects ligatures ---')
const lam = L.measure('ل', cairo, 100)
const alef = L.measure('ا', cairo, 100)
const both = L.measure('لا', cairo, 100)
ok('ligature narrower than the sum of its parts', both < lam + alef,
   `${both.toFixed(1)} < ${(lam + alef).toFixed(1)}`)
ok('overestimate would be >40%', (lam + alef) / both > 1.4,
   `${(((lam + alef) / both - 1) * 100).toFixed(0)}%`)
ok('measurement scales linearly with size',
   Math.abs(L.measure('راوتر', cairo, 200) - 2 * L.measure('راوتر', cairo, 100)) < 0.01)
ok('empty string measures zero', L.measure('', cairo, 48) === 0)

console.log('\n--- fitting ---')
const short = L.fitText('MacBook Pro', cairo, { width: 400, size: 48 })
ok('short text keeps nominal size', short.size === 48 && !short.truncated)

const wrapped = L.fitText('ASUS RT-AX88U Wi-Fi 6 Dual Band Gigabit Router', cairo,
                          { width: 300, size: 40, maxLines: 3 })
// Wrapping comes first; a small shrink to land inside maxLines is correct.
ok('long text wraps rather than collapsing to one small line',
   wrapped.lines.length > 1 && wrapped.size > 40 * 0.95,
   `${wrapped.lines.length} lines at ${wrapped.size.toFixed(1)}`)
ok('every wrapped line fits the box',
   wrapped.lines.every(l => L.measure(l, cairo, wrapped.size) <= 300))

const squeezed = L.fitText('ASUS RT-AX88U Wi-Fi 6 Dual Band Gigabit Router', cairo,
                           { width: 300, size: 40, maxLines: 1 })
ok('single-line box shrinks instead', squeezed.size < 40 && squeezed.lines.length === 1,
   `size ${squeezed.size.toFixed(1)}`)
ok('shrunk text actually fits', squeezed.widest <= 300)

const impossible = L.fitText('ASUS RT-AX88U Wi-Fi 6 Dual Band Gigabit Router Extreme Edition',
                             cairo, { width: 80, size: 40, maxLines: 1, minScale: 0.65 })
ok('impossible text is truncated, not overflowing', impossible.truncated)
ok('truncation is reported for the batch report', impossible.truncated === true)
ok('truncated text still fits the box', impossible.widest <= 80, `${impossible.widest.toFixed(1)} <= 80`)
ok('truncation is visible to a reader', impossible.lines[0].endsWith('…'))
ok('never shrinks below the floor', impossible.size >= 40 * 0.65 - 0.01)

const arabicFit = L.fitText('راوتر أسوس واي فاي 6 ثنائي النطاق', cairo,
                            { width: 300, size: 40, maxLines: 2 })
ok('Arabic fits and reports rtl', arabicFit.direction === 'rtl' && !arabicFit.truncated)

console.log('\n--- uniform batch sizing ---')
// All three fit, but the middle one needs a smaller size — every design in the
// batch then uses that size so the grid reads as one set.
// Measured against a 260-wide box at nominal 44 (floor 28.6): these need
// 88.9, 39.7 and 34.7 respectively, so all three fit and the last one sets the size.
const names = ['iPhone', 'Sony WH-1000', 'JBL Flip 6 Speaker']
const uniform = L.uniformSize(names, cairo, { width: 260, size: 44, maxLines: 1 })
ok('uniform size is driven by the longest', uniform.size < 44, `${uniform.size.toFixed(1)}`)
ok('nothing truncated when all values fit', uniform.wontFit.length === 0)

// A value that cannot fit at all is named rather than quietly cut.
// This one needs size 12.3 to fit — far below the floor, so it cannot be shown
// in full and is named rather than quietly cut.
const withImpossible = L.uniformSize(
  [...names, 'MacBook Pro 14-inch M5 Chip Space Black Edition'], cairo,
  { width: 260, size: 44, maxLines: 1 })
ok('values that cannot fit are named, not silently cut',
   withImpossible.wontFit.length === 1 && withImpossible.wontFit[0].startsWith('MacBook'),
   JSON.stringify(withImpossible.wontFit))
ok('every value fits at the uniform size',
   names.every(n => L.measure(n, cairo, uniform.size) <= 260))

const roomy = L.uniformSize(names, cairo, { width: 600, size: 44, maxLines: 1 })
ok('nothing flagged when the box is roomy', roomy.wontFit.length === 0)

console.log('\n--- outline mode ---')
const path = L.outlinePath('راوتر', cairo, 48)
ok('outline produces path elements', path.includes('<path') && path.includes(' d="M'))
ok('one path per glyph', (path.match(/<path/g) || []).length === 5, `${(path.match(/<path/g)||[]).length} paths`)
ok('y is flipped for SVG space', path.includes('scale(') && /scale\([\d.]+ -[\d.]+\)/.test(path))

console.log(failed ? `\n${failed} FAILED\n` : '\nall passed\n')
process.exitCode = failed ? 1 : 0
