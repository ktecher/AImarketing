// The campaign brief: seven answers composed into the one field there is.
// Pure — no database, no model — so unlike the campaigns suite it always runs.
const { composeContext, OFFER_MECHANICS } = await import('../lib/brief.ts')

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

console.log(`\n${failed ? `${failed} FAILED` : 'the brief composes'}`)
process.exit(failed ? 1 : 0)
