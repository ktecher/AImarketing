// The feed filter. Rule 5 says never generate political or religious content;
// this is the same rule applied to what the feed SHOWS, because a marketing
// team handed a missile headline under "trending in cars" is one step from
// building on it. No network here — the filter is a pure function.
const { notForMarketing, screen } = await import('./not-for-marketing.mjs')

let failed = 0
const ok = (label, cond, detail = '') => {
  if (!cond) failed++
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `   ${detail}` : ''}`)
}
const is = (text, want) =>
  ok(`${String(want).padEnd(9)} ${text.slice(0, 56)}`, notForMarketing(text) === want,
     notForMarketing(text) === want ? '' : `got ${notForMarketing(text)}`)

console.log('\n--- English: what was actually in the feed ---')
is('Trump threatens 50% tariffs on all Canadian vehicles', 'political')
is('Accident on Kuwait motorway as Iranian missiles fly overhead', 'political')
is('Minister opens new expressway', 'political')
is('Kuwait H1 2026: Nissan Patrol #1, Haval up 200%', null)
is('Porsche unveils limited edition 911 Turbo S Sadu Edition', null)
is('NBK launches exclusive Back to School offer in collaboration with Retailer', null)
is('Sixt Launches in Kuwait', null)
// Policy news wears business clothes. "Work permit" was the day's #3 Kuwait
// trend, carrying "H-1B Workers to Lose Grace Period in White House-Approved
// Plan" — immigration policy, and nothing to build a laptop campaign on.
is('H-1B Workers to Lose Grace Period in White House-Approved Plan', 'political')
is('Some H-1B spouses could lose work permits under Trump proposal', 'political')
is('Over 1,379 flights delayed amid widespread travel disruptions', null)

console.log('\n--- Arabic, which is most of this feed ---')
// The exact trend that slipped through an English-only filter: the day's top
// Kuwait search, a cleric calling for "unity of the Islamic states" beside
// "the rulers of the Gulf". Both halves have to be caught.
is('خامنئي يدعو إلى "وحدة الدول الإسلامية ودول الخليج"', 'religious')
is('خامنئي يحث حكام الخليج على مواجهة العدو الحقيقي', 'political')
is('وزير التجارة يفتتح معرضاً جديداً', 'political')
is('الحرب في المنطقة وتأثيرها', 'political')
is('خطبة الجمعة في المسجد الكبير', 'religious')
is('عروض العودة إلى المدارس على اللابتوبات', null)
is('أسعار آيفون 17 في الكويت', null)

console.log('\n--- the season passes, the faith does not ---')
// compliance-guardrails.md draws the line between acknowledging the season and
// using the faith. Ramadan and Eid are commercial seasons the retail calendar
// plans around; dropping them would remove the most useful retail dates there are.
is('Kuwait announces Eid holiday dates', null)
is('موعد إجازة عيد الفطر في الكويت', null)
is('Ramadan offers at Kuwait malls', null)
is('Grand Mosque prayer times for Eid announced', 'religious')
is('أوقات الصلاة في عيد الفطر', 'religious')

console.log('\n--- stems that must not collide ---')
// Rejected stems, asserted so nobody adds them back: حج (pilgrimage) sits
// inside حجز booking and حجم size, and أمير sits inside أميركا.
is('حجز موعد في المعرض', null)
is('حجم الشاشة 15 بوصة', null)
is('شركة أميركية تفتتح فرعاً', null)
is('سنة الضمان على الجهاز', null)

console.log('\n--- nothing is dropped silently ---')
const items = [
  { t: 'Kuwait H1 2026: Nissan Patrol #1' },
  { t: 'Trump threatens tariffs on vehicles' },
  { t: 'خطبة الجمعة في المسجد' },
  { t: 'Sixt Launches in Kuwait' },
]
const r = screen(items, (i) => i.t)
ok('the clean ones are kept',        r.kept.length === 2, JSON.stringify(r.kept.map((i) => i.t)))
ok('and the count is reported',      r.total === 2)
ok('split by which rule caught it',  r.dropped.political === 1 && r.dropped.religious === 1,
   JSON.stringify(r.dropped))
ok('an empty feed drops nothing',    screen([], (i) => i).total === 0)

console.log(`\n${failed ? `${failed} FAILED` : 'the feed filter holds'}`)
process.exit(failed ? 1 : 0)
