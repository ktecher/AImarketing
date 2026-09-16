// The campaign brief: seven answers composed into the one field there is.
// Pure — no database, no model — so unlike the campaigns suite it always runs.
const { composeContext, OFFER_MECHANICS, pushingFrom } = await import('../lib/brief.ts')
const { whereInTheYear } = await import('../lib/campaigns.ts')

let failed = 0
const ok = (label, cond, detail = '') => {
  if (!cond) failed++
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `   ${detail}` : ''}`)
}

const FULL = {
  pushing: 'laptops and tablets',
  audience: 'students, and the parents actually paying',
  offer: 'Was/now',
  offerDetail: 'up to 40% off selected laptops',
  say: 'a laptop that lasts the whole degree, not the first term',
  channels: ['Snapchat', 'Instagram'],
  runs: 'through the first week of September',
  notes: 'laptops and tablets for students going back in September',
}

console.log('\n--- the whole brief, in the order a person answered it ---')
const full = composeContext(FULL)
ok('every answer is labelled',  full.split('\n').length === 7, JSON.stringify(full.split('\n').length))
ok('pushing leads',             full.startsWith('Pushing: laptops and tablets'))
ok('the mechanic and the specifics join on one line',
   full.includes('Offer: Was/now — up to 40% off selected laptops'),
   full.split('\n').find((l) => l.startsWith('Offer')))
ok('channels are one line',     full.includes('Channels: Snapchat, Instagram'))
ok('notes come last',           full.trim().endsWith(FULL.notes))

console.log('\n--- a figure the PERSON typed survives ---')
// Rule 2 forbids the MODEL emitting a number. A marketer stating their own
// offer is the opposite case, and dropping it would silently lose the campaign.
ok('the offer keeps its figure', full.includes('40%'))

console.log('\n--- an unanswered question leaves no trace ---')
// A line reading "For:" with nothing after it teaches the reader that the
// labels mean nothing, and the studio then reads a blank as an instruction.
const sparse = composeContext({
  ...FULL, audience: '', offerDetail: '', runs: '', notes: '', channels: [],
})
ok('empty answers are omitted, not blanked', !/:\s*$/m.test(sparse), JSON.stringify(sparse))
ok('and what was answered stays',            sparse.includes('Pushing: laptops and tablets'))
ok('a mechanic with no specifics still reads', sparse.includes('Offer: Was/now'),
   sparse.split('\n').find((l) => l.startsWith('Offer')))
ok('nothing answered is an empty string',
   composeContext({ pushing: '', audience: '', offer: '', offerDetail: '', say: '', channels: [], runs: '', notes: '' }) === '')

console.log('\n--- whitespace is not an answer ---')
ok('a field of spaces is omitted',
   !composeContext({ ...FULL, pushing: '   ' }).includes('Pushing:'))

console.log('\n--- the mechanics are the ones the market actually has ---')
// knowledge/kuwait/evergreen/pricing-and-offers.md names five, plus the honest
// sixth for a campaign that is only new stock.
ok('five mechanics and a no-offer',   OFFER_MECHANICS.length === 6, String(OFFER_MECHANICS.length))
ok('was/now is there — the strongest performer in electronics',
   OFFER_MECHANICS.includes('Was/now'))
ok('instalments, which are everywhere in Gulf retail',
   OFFER_MECHANICS.includes('Instalments'))

console.log('\n--- the meeting\'s three fields are optional and backward-compatible ---')
// Every caller before the meeting existed passes a Brief without these three
// fields; the composed context must be byte-identical to before this change.
ok('no meeting fields composes exactly as before',
   composeContext(FULL) === full)

console.log('\n--- each new field appears as its labelled line when set ---')
const withMeeting = composeContext({
  ...FULL, objective: 'Sell it', spend: '250.000 KD boosting', measure: 'click-throughs on the Snapchat ad',
})
ok('objective appears, near the top', withMeeting.startsWith('Objective: Sell it'))
ok('spend appears',                  withMeeting.includes('Spend: 250.000 KD boosting'))
ok('measure appears',                withMeeting.includes('Measure: click-throughs on the Snapchat ad'))
ok('spend and measure land before notes',
   withMeeting.indexOf('Spend:') < withMeeting.indexOf('Notes:') &&
   withMeeting.indexOf('Measure:') < withMeeting.indexOf('Notes:'))

console.log('\n--- an empty meeting field omits the line, no blank label ---')
const blankMeeting = composeContext({ ...FULL, objective: '', spend: '', measure: '' })
ok('no meeting labels appear at all', !/^(Objective|Spend|Measure):/m.test(blankMeeting), blankMeeting)


console.log('\n--- reading the Pushing line back out ---')
// Without the split the Designs screen designs the whole catalogue: "sixty-two
// posters nobody asked for", which is the failure this function's own docstring
// names.
ok('an English list splits',
   pushingFrom('Pushing: laptops, tablets, headphones').length === 3,
   JSON.stringify(pushingFrom('Pushing: laptops, tablets, headphones')))
ok('the Oxford comma leaves no "and"',
   pushingFrom('Pushing: laptops, keyboards, and backpacks')[2] === 'backpacks',
   JSON.stringify(pushingFrom('Pushing: laptops, keyboards, and backpacks')))

// Arabic writes its comma as ، (U+060C). Split on the ASCII comma alone, this
// line came back as ONE twenty-four-character term matching no product — and a
// single term is a perfectly ordinary answer, so nothing looked wrong.
const AR = 'Pushing: لابتوبات، تابلت، سماعات'
ok('an Arabic list splits on the Arabic comma',
   pushingFrom(AR).length === 3, JSON.stringify(pushingFrom(AR)))
ok('and each term is the word, not the whole line',
   pushingFrom(AR)[0] === 'لابتوبات', JSON.stringify(pushingFrom(AR)[0]))
ok('a mixed list splits on both',
   pushingFrom('Pushing: laptops، tablets, سماعات').length === 3,
   JSON.stringify(pushingFrom('Pushing: laptops، tablets, سماعات')))
ok('no Pushing line is no terms', pushingFrom('For: students') .length === 0)

console.log('\n--- the retail calendar is read in Kuwait time ---')
// This read UTC while the date printed beside it in the prompt was local, so
// for the three hours after midnight — Kuwait is UTC+3 — the model was told
// "TODAY IS 25 February" and, on the next line, that the season was Hala
// Febrayer. Two contradictory sentences about the same day.
//
// Pinned to Asia/Kuwait rather than the machine's zone: the answer is about the
// Kuwaiti retail year and must not change because a laptop travelled.
const at = (iso) => whereInTheYear(new Date(iso))
ok('just past midnight in Kuwait on National Day',
   /National Day/.test(at('2027-02-24T22:00:00Z')), at('2027-02-24T22:00:00Z').slice(0, 40))
ok('and the same instant is NOT read as the day before',
   !/Hala Febrayer/.test(at('2027-02-24T22:00:00Z')))
ok('midday on the 24th is still Hala Febrayer',
   /Hala Febrayer/.test(at('2027-02-24T09:00:00Z')))
// formatToParts, not format().split('/') — en-GB writes the day first, and
// destructuring [month, day] silently reversed them. 25 February parsed as
// month 25 and returned an empty season.
ok('September is back to school',  /Back to School/.test(at('2026-09-03T10:00:00Z')))
ok('November is Black Friday',     /Black Friday/.test(at('2026-11-20T10:00:00Z')))
ok('a quiet month says nothing',   at('2026-04-15T10:00:00Z') === '')

console.log(`\n${failed ? `${failed} FAILED` : 'the brief composes'}`)
process.exit(failed ? 1 : 0)
