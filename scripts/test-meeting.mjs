// The campaign meeting: the parts that hold without a model running.
//
// `reply()` and `plan()` need Ollama and are judged by holding a real meeting —
// see the spec. What is tested here is everything the model does NOT decide,
// which is deliberately most of the load-bearing logic: which question comes
// next, what the person's budget parses to, and whether the transcript survives
// a round trip through disk.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { nextSlot, budgetOf, SLOTS, OBJECTIVES, suggestionsFor, start, save, load, all, remove, figuresIn, mergeSave, craft, LOYALTY_ONLY } =
  await import('../lib/meeting.ts')

let failed = 0
const ok = (label, cond, detail = '') => {
  if (!cond) failed++
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `   ${detail}` : ''}`)
}

console.log('\n--- which question comes next is a fact, not a judgement ---')
// Decided in TypeScript for the reason converse.ts computes its own missing()
// list: a model asked to notice what it has not been told sometimes notices and
// sometimes confidently proceeds, and the second one plans on nothing.
ok('an empty meeting asks what is being pushed', nextSlot({}) === 'pushing', String(nextSlot({})))
ok('then what is special about it',
   nextSlot({ pushing: 'laptops' }) === 'special',
   String(nextSlot({ pushing: 'laptops' })))
ok('a blank answer does not count as answered',
   nextSlot({ pushing: '   ' }) === 'pushing')
ok('it skips what it already knows',
   nextSlot({ pushing: 'laptops', special: 'battery lasts a full day' }) === 'objective')

const everything = Object.fromEntries(SLOTS.map((s) => [s, 'answered']))
ok('nothing left to ask returns null', nextSlot(everything) === null, String(nextSlot(everything)))

// constraints is a catch-all and only makes sense once something is on the
// table. Asking for it on its own turn gets a blank look.
const allButConstraints = Object.fromEntries(SLOTS.filter((s) => s !== 'constraints').map((s) => [s, 'answered']))
ok('constraints is never asked for on its own', nextSlot(allButConstraints) === null, String(nextSlot(allButConstraints)))

console.log('\n--- the budget is the person\'s figure, and only theirs ---')
ok('a bare number',            budgetOf({ budget: '500' }) === 500)
ok('with a currency',          budgetOf({ budget: '500 KD' }) === 500)
ok('with a thousands comma',   budgetOf({ budget: '1,500 KD' }) === 1500, String(budgetOf({ budget: '1,500 KD' })))
ok('with fils',                budgetOf({ budget: '750.500' }) === 750.5)
ok('inside a sentence',        budgetOf({ budget: 'about 2000 dinar I think' }) === 2000)

// Returning a default here would be a budget nobody set, split into line items
// that look exactly as authoritative as a real one.
// Arabic-Indic numerals. `\d` is ASCII-only in JavaScript, so this returned
// null, plan() got total=null, and the screen said "No budget figure was given,
// so there is nothing to split" about a budget two panels away — the whole
// spend feature vanishing, silently, for anyone typing in Arabic.
ok('an Arabic-Indic budget',   budgetOf({ budget: '٣٠٠٠ د.ك' }) === 3000, String(budgetOf({ budget: '٣٠٠٠ د.ك' })))
ok('with the Arabic decimal mark',
   budgetOf({ budget: '٧٥٠٫٥٠٠' }) === 750.5, String(budgetOf({ budget: '٧٥٠٫٥٠٠' })))
ok('inside an Arabic sentence',
   budgetOf({ budget: 'الميزانية ٢٠٠٠ دينار' }) === 2000, String(budgetOf({ budget: 'الميزانية ٢٠٠٠ دينار' })))
ok('Arabic words with no figure is still null', budgetOf({ budget: 'لا أعرف بعد' }) === null)

ok('nothing typed is null',    budgetOf({}) === null)
ok('words only is null',       budgetOf({ budget: 'not sure yet' }) === null)
ok('zero is null',             budgetOf({ budget: '0' }) === null)
ok('zero KD is null',          budgetOf({ budget: '0 KD' }) === null)

console.log('\n--- suggested answers are derived, never generated ---')
// A suggestion the model invented is a suggestion that can be wrong, sitting
// under a button a person presses without reading twice.
const objectives = await suggestionsFor('objective', 'laptops')
ok('objectives are the closed list',
   objectives.length === OBJECTIVES.length && objectives.every((o) => OBJECTIVES.includes(o)),
   JSON.stringify(objectives))

const offers = await suggestionsFor('offer', 'laptops')
ok('offers are the closed list', offers.includes('Was/now') && offers.includes('No offer — new arrivals'))

// There is no closed list of reasons a phone is worth buying, and offering
// three would narrow the one answer that matters most to whichever three a
// machine thought of first.
ok('what is special gets no suggestions', (await suggestionsFor('special', 'laptops')).length === 0)
ok('the budget gets no suggestions',      (await suggestionsFor('budget', 'laptops')).length === 0)

console.log('\n--- what counts as a figure the model made up ---')
// Rule 2's guard. Every false positive here trains the reader to scroll past the
// warning, and the real one arrives looking identical.
const CATALOGUE = { name_en: 'Apple AirPods 4 Apple MacBook Pro M4 Samsung Galaxy S26 Ultra Lenovo IdeaPad Slim 3' }

ok('a loose price is caught',
   figuresIn('it should sell for 129 KD', CATALOGUE, '').includes('129'))
ok('a percentage is caught',
   figuresIn('take 40% off the range', CATALOGUE, '').includes('40%'))

// "Apple AirPods 4" is what the product is CALLED. The bare 4 can never be
// vouched for on its own, so it is checked with the word before it.
ok('a model number in a real product name is not invented',
   figuresIn('lead with the Apple AirPods 4 on Snapchat', CATALOGUE, '').length === 0,
   JSON.stringify(figuresIn('lead with the Apple AirPods 4 on Snapchat', CATALOGUE, '')))
ok('and it still catches a loose number in the same sentence',
   figuresIn('the Apple AirPods 4 at 45 KD', CATALOGUE, '').join() === '45',
   JSON.stringify(figuresIn('the Apple AirPods 4 at 45 KD', CATALOGUE, '')))

// A token carrying a letter, straight out of the identity text.
ok('M4 is not invented', figuresIn('the MacBook Pro M4 is the hero', CATALOGUE, '').length === 0)

// The same digit, with nothing behind it, is not a product name.
ok('a bare 4 on its own is still caught',
   figuresIn('run it for 4 weeks', CATALOGUE, '').includes('4'))

// The person's own words, repeated back.
ok('a figure the person typed is theirs',
   figuresIn('so your 3000 KD goes furthest on Snapchat', CATALOGUE, 'budget is 3000 KD').length === 0)

// The exemption must be an EXACT token, never a substring of the transcript.
// The budget slot exists to make somebody type a long number, so a containment
// test hands the model a free pass on almost every short figure for the rest of
// the meeting — 3, 30, 300 and 000 are all inside "3000". This is the guard the
// "figures nobody gave it" banner is built on.
ok('an invented 300 is NOT excused by their 3000',
   figuresIn('Put 300 KD into photography and 50 into print.', CATALOGUE, 'budget is 3000 KD').join() === '300,50',
   JSON.stringify(figuresIn('Put 300 KD into photography and 50 into print.', CATALOGUE, 'budget is 3000 KD')))
ok('nor is an invented 30',
   figuresIn('Spend 30 on influencers.', CATALOGUE, 'budget is 3000 KD').includes('30'))
ok('but their exact figure is still theirs',
   figuresIn('your 3000 KD', CATALOGUE, 'we have 3000 KD to spend').length === 0)

// A digit inside a product name WE handed the planner. Once the prompt started
// telling it to name the rows, one honest answer listing four laptops reported
// 24, 14, 13.3 and 15.6 as figures nobody gave it — out of "24 GB", "14 inch
// OLED", "13.3”" and "15.6"". Four false positives in a turn is how a reader
// learns to skip the real one.
const SHELF = 'Laptops: HP OmniBook 3 Laptop, AMD Ryzen AI 7 350, 24 GB, 1TB SSD, 14 inch OLED\n' +
              'Laptops: Asus Vivobook 15 Laptop, Intel Core 7, 15.6", 512GB SSD, 16GB RAM'
ok('a spec figure copied out of a shelf row is not invented',
   figuresIn('lead with the HP OmniBook 3, 24 GB and a 14 inch OLED screen', CATALOGUE, '', SHELF).length === 0,
   JSON.stringify(figuresIn('lead with the HP OmniBook 3, 24 GB and a 14 inch OLED screen', CATALOGUE, '', SHELF)))
ok('and one with an odd screen size too',
   figuresIn('the Asus Vivobook 15 Laptop, Intel Core 7, 15.6", 512GB SSD', CATALOGUE, '', SHELF).length === 0,
   JSON.stringify(figuresIn('the Asus Vivobook 15 Laptop, Intel Core 7, 15.6", 512GB SSD', CATALOGUE, '', SHELF)))
// The exemption is a BIGRAM against the shelf, not a bag of its numbers. "14"
// is all over those rows, and "run it for 14 days" is still a figure nobody set.
ok('but an invented duration built from the same digit is caught',
   figuresIn('run it for 14 days', CATALOGUE, '', SHELF).includes('14'),
   JSON.stringify(figuresIn('run it for 14 days', CATALOGUE, '', SHELF)))
ok('and an invented price is caught beside a copied spec',
   figuresIn('the Asus Vivobook 15 Laptop with 24 GB at 199 KD', CATALOGUE, '', SHELF).join() === '199',
   JSON.stringify(figuresIn('the Asus Vivobook 15 Laptop with 24 GB at 199 KD', CATALOGUE, '', SHELF)))
ok('with no shelf, nothing is excused by it',
   figuresIn('a 14 inch OLED screen', CATALOGUE, '').includes('14'))

// Arabic is the majority case in this shop's copy, and `\d` never saw it. A
// planner writing «خصم ٥٠٪ على الفئة» — fifty percent off, invented — got no
// banner at all, because /\d/.test('٥٠٪') is false where /\p{Nd}/u.test is true.
ok('an Arabic-Indic percentage is caught',
   figuresIn('خصم ٥٠٪ على الفئة', CATALOGUE, '').includes('٥٠٪'),
   JSON.stringify(figuresIn('خصم ٥٠٪ على الفئة', CATALOGUE, '')))
ok('and an Arabic-Indic price',
   figuresIn('السعر ١٢٩ د.ك', CATALOGUE, '').includes('١٢٩'),
   JSON.stringify(figuresIn('السعر ١٢٩ د.ك', CATALOGUE, '')))
ok('an Arabic figure the person typed is theirs',
   figuresIn('ميزانيتك ٣٠٠٠ تكفي', CATALOGUE, 'الميزانية ٣٠٠٠ د.ك').length === 0,
   JSON.stringify(figuresIn('ميزانيتك ٣٠٠٠ تكفي', CATALOGUE, 'الميزانية ٣٠٠٠ د.ك')))
// The same number in the other script is the same number. Reporting it as
// invented is the warning crying wolf, which is the failure the exemption is for.
ok('their ASCII figure excuses the model writing it in Arabic',
   figuresIn('نضع ٣٠٠٠ على سناب شات', CATALOGUE, 'budget is 3000 KD').length === 0,
   JSON.stringify(figuresIn('نضع ٣٠٠٠ على سناب شات', CATALOGUE, 'budget is 3000 KD')))
ok('and an invented Arabic figure is still caught beside it',
   figuresIn('نضع ٣٠٠ على التصوير', CATALOGUE, 'budget is 3000 KD').includes('٣٠٠'),
   JSON.stringify(figuresIn('نضع ٣٠٠ على التصوير', CATALOGUE, 'budget is 3000 KD')))

console.log('\n--- the transcript survives the tab being closed ---')
const HOME = process.cwd()
const box = mkdtempSync(join(tmpdir(), 'meeting-'))
process.chdir(box)
try {
  const m = start('test-meeting-1')
  m.turns.push({ role: 'you', text: 'we want to push the new phone', at: new Date().toISOString() })
  m.known.pushing = 'the new phone'
  save(m)

  const back = load('test-meeting-1')
  ok('a meeting round-trips through disk', JSON.stringify(back) === JSON.stringify(m))
  ok('and is listed', all().length === 1 && all()[0].id === 'test-meeting-1')

  // Ids are filenames. A traversal here reads or writes anywhere on disk.
  ok('a traversal id reads nothing', load('../../../etc/passwd') === null)
  ok('an absolute id reads nothing', load('/etc/passwd') === null)
  let threw = false
  try { save({ ...m, id: '../escape' }) } catch { threw = true }
  ok('a traversal id refuses to write', threw)

  ok('a meeting that was never started is null', load('never-existed') === null)

  console.log('\n--- throwing a meeting away ---')
  ok('a traversal id deletes nothing', remove('../../../etc/passwd') === false)
  // A double-click must report honestly rather than claiming to have removed
  // something twice.
  ok('deleting nothing says so', remove('never-existed') === false)
  ok('it deletes', remove('test-meeting-1') === true)
  ok('and is gone', load('test-meeting-1') === null)
  ok('and is off the list', all().length === 0)

  // The one case where the transcript is the record of how something real got
  // built. Postgres does not know this file exists, so nothing else would stop
  // the campaign's own brief being thrown away.
  const made = start('test-meeting-2')
  made.campaign_id = 'back-to-school-laptops'
  save(made)
  let refused = false
  try { remove('test-meeting-2') } catch { refused = true }
  ok('a meeting that made a campaign refuses to be deleted', refused)
  ok('and is still there', load('test-meeting-2') !== null)

  console.log('\n--- a slow write does not revert a fast one ---')
  // Writing the plan is two model calls and about a minute. A turn sent during
  // it used to be reverted by the plan's own save, or the other way round,
  // because both wrote a whole object loaded before the other existed. The
  // screen kept showing both from React state, so nothing looked wrong until
  // Create re-read the file and said "Write the plan first" about a plan that
  // was on screen.
  const slow = start('test-meeting-3')
  slow.turns.push({ role: 'you', text: 'first', at: new Date().toISOString() })
  save(slow)

  // Someone else's write lands while `slow` is still in flight.
  const meanwhile = load('test-meeting-3')
  meanwhile.turns.push({ role: 'planner', text: 'second', at: new Date().toISOString() })
  meanwhile.known.pushing = 'earbuds'
  save(meanwhile)

  // The in-flight request now saves ITS field, from its own stale copy.
  const merged = mergeSave(slow, { plan: { name: 'A plan' } })
  ok('the plan landed', merged.plan?.name === 'A plan')
  ok('and the turn written meanwhile survived', merged.turns.length === 2, String(merged.turns.length))
  ok('as did the slot it filled', merged.known.pushing === 'earbuds', String(merged.known.pushing))
  ok('and it is what is on disk', load('test-meeting-3').turns.length === 2)
} finally {
  process.chdir(HOME)
  rmSync(box, { recursive: true, force: true })
}

console.log('\n--- an audience of people who already buy here is noticed ---')
// Fires the one craft lesson that has to land on a turn rather than sit in the
// background. A guard that fires on a legitimate answer is worse than no guard,
// so the negatives matter more than the positives here.
for (const yes of ['loyal customers', 'our loyal customers', 'Existing customers',
                   'repeat buyers', 'our customers', 'existing customer base']) {
  ok(`fires on "${yes}"`, LOYALTY_ONLY.test(yes))
}
for (const no of ['loyal customers and students', 'students starting the year',
                  'parents buying for a first laptop', 'customers who have never bought a laptop',
                  'young professionals', '']) {
  ok(`stays quiet on "${no}"`, !LOYALTY_ONLY.test(no))
}

console.log('\n--- the craft file reaches the prompt, and its figures do not ---')
// craft() slices knowledge/kuwait/evergreen/campaign-craft.md at two string
// markers: the first section heading, and `## Provenance`. Rename either and the
// slice silently becomes empty or silently grows to include the evidence half —
// which is where the numbers live, and rule 2 says the planner never writes one.
// So both directions are asserted, because a string marker is exactly the kind of
// thing a later edit moves without noticing.
const CRAFT = craft()
ok('the craft knowledge is not empty', CRAFT.length > 500, `${CRAFT.length} chars`)
ok('it carries the buying-situation lesson', /buying situation/i.test(CRAFT))
ok('and it stops before the provenance', !/Provenance|alexmurrell/i.test(CRAFT))
const digits = CRAFT.match(/\d/g)
ok('no digit reaches the prompt', digits === null, digits ? digits.join('') : '')

console.log(failed ? `\n${failed} failed\n` : '\nmeeting: the half that needs no model holds\n')
process.exit(failed ? 1 : 0)
