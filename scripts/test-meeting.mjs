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

const { nextSlot, budgetOf, SLOTS, OBJECTIVES, suggestionsFor, start, save, load, all } =
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
} finally {
  process.chdir(HOME)
  rmSync(box, { recursive: true, force: true })
}

console.log(failed ? `\n${failed} failed\n` : '\nmeeting: the half that needs no model holds\n')
process.exit(failed ? 1 : 0)
