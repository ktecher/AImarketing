// The checks between what the model says and what the customer reads.
//
// No model runs here. These are the parts that must hold whatever it writes —
// hard rule 2 (it never emits a number) and hard rule 3 (never state a fact
// that is not in a retrieved row). Both are enforced in TypeScript, so both are
// testable without inference.
const { fillFacts, bareNumber, citedSkus, factSheet, ESCALATION, AskSchema } = await import('../lib/chat/answer.ts')
const { isGrounded } = await import('../lib/ai/generate.ts')
const { start, append } = await import('../lib/chat/store.ts')

let failed = 0
const ok = (label, cond, detail = '') => {
  if (!cond) failed++
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `   ${detail}` : ''}`)
}

const PENCIL = { sku: '502037', name_en: 'Apple Pencil 1st generation', display_name: 'Apple Pencil',
                 brand: 'APPLE', category: 'Tablet Styluses', price_now: 19.9, price_was: 40.5,
                 description_en: 'Bluetooth Wireless Connectivity' }
const PLAIN  = { sku: 'P1', name_en: 'Plain Thing', brand: 'B', category: 'C', price_now: 10 }
const rows = new Map([['502037', PENCIL], ['P1', PLAIN]])

console.log('\n--- the model never emits a figure ---')
ok('a price token fills through the one formatter',
   fillFacts('It is {price_now:502037}.', rows).filled === 'It is 19.900 KD.')
ok('three decimals, always',
   fillFacts('{price_was:502037}', rows).filled === '40.500 KD')
ok('a discount is derived from the two prices',
   fillFacts('{discount_pct:502037}', rows).filled === '51%')
ok('no discount leaves the token unresolved',
   fillFacts('{discount_pct:P1}', rows).unresolved.length === 1)
ok('an absent price is unresolved, never zero',
   fillFacts('{price_was:P1}', rows).unresolved.length === 1,
   JSON.stringify(fillFacts('{price_was:P1}', rows)))
ok('a token for an unretrieved product does not fill',
   fillFacts('{price_now:999999}', rows).unresolved.length === 1)
ok('a non-price field fills from the row',
   fillFacts('The {display_name:502037} is here.', rows).filled === 'The Apple Pencil is here.')

console.log('\n--- a digit the model typed itself ---')
ok('a bare price is caught',            bareNumber('It costs 19.900 KD') === '19.900')
ok('a bare quantity is caught',         Boolean(bareNumber('It has 16GB of RAM')))
ok('a token is not a bare number',      bareNumber('It costs {price_now:502037}') === undefined)
ok('text with no digits passes',        bareNumber('It is in stock') === undefined)
ok('a digit beside a token is caught',  bareNumber('{price_now:502037} for 2 units') === '2')

// A figure in a retrieved product's own name is the answer, not an invention.
// Blocking these blocked every reply the model produced on the real catalogue.
ok('a digit in a retrieved name is allowed',
   bareNumber('The Apple Pencil 1st generation is {price_now:502037}.', rows) === undefined,
   JSON.stringify(bareNumber('The Apple Pencil 1st generation is {price_now:502037}.', rows)))
ok('a model number in a retrieved name is allowed',
   bareNumber('The Airpods 4 is here.', new Map([['659512', { sku: '659512',
     name_en: 'Apple Airpods 4 - White', brand: 'APPLE', category: 'Earbuds' }]])) === undefined)
ok('a figure NOT in any retrieved name is still caught',
   bareNumber('We have 12 left in stock.', rows) === '12')
ok('an invented price is still caught',
   bareNumber('It is 25.000 KD.', rows) === '25.000')
ok('with no rows, every digit is suspect',
   bareNumber('The Airpods 4 is here.') === '4')
// The model names the product it means by its SKU. That SKU is the key the row
// was retrieved by, so it is grounded by definition — blocking it escalated an
// otherwise correct answer on the real catalogue.
ok('a retrieved SKU written inline is allowed',
   bareNumber('The Apple Pencil (SKU 502037) is {price_now:502037}.', rows) === undefined,
   JSON.stringify(bareNumber('The Apple Pencil (SKU 502037) is {price_now:502037}.', rows)))
ok('a SKU that was NOT retrieved is still caught',
   bareNumber('See SKU 999999 instead.', rows) === '999999')

console.log('\n--- cited SKUs must be a subset of what was retrieved ---')
ok('a cited SKU that was retrieved passes',
   isGrounded(citedSkus('{price_now:502037}'), ['502037', 'P1']))
ok('a SKU that was never retrieved fails',
   !isGrounded(citedSkus('{price_now:888888}'), ['502037']))
ok('every SKU is checked, not just the first',
   !isGrounded(citedSkus('{price_now:502037} and {price_now:888888}'), ['502037']))
ok('citing nothing is grounded',        isGrounded(citedSkus('We are open until six.'), ['502037']))
ok('the same SKU twice is one citation', citedSkus('{price_now:502037} {price_was:502037}').length === 1)

console.log('\n--- the fact sheet ---')
const sheet = factSheet([{ sku: '502037', row: PENCIL, score: 1, why: 'sku' }])
ok('the sheet names the price field',   sheet.includes('write {price_now:502037}'))
ok('the sheet never carries the figure', !sheet.includes('19.9') && !sheet.includes('40.5'),
   'showing a model a number it may not repeat is asking it to paraphrase one')
ok('a spare sheet column is not offered', !sheet.includes('Monthly Installment'))
ok('the identity fields are offered',   sheet.includes('Apple Pencil'))
const plainSheet = factSheet([{ sku: 'P1', row: PLAIN, score: 1, why: 'sku' }])
ok('no was-price means no was token',   !plainSheet.includes('price_was'))
ok('no discount means no discount token', !plainSheet.includes('discount_pct'))

console.log('\n--- escalation ---')
ok('the escalation names a person, not an apology', /someone|person/i.test(ESCALATION))
ok('the escalation carries no figure',  bareNumber(ESCALATION) === undefined)

console.log('\n--- the request a browser actually sends ---')
// The widget has no conversation id until the server gives it one, and JSON
// writes that as null. `.optional()` rejects null, so every first message came
// back "Type a question first" — blaming the customer for a field they never
// touched.
ok('a first message with a null conversation id is accepted',
   AskSchema.safeParse({ question: 'how much', conversationId: null }).success)
ok('a follow-up with an id is accepted',
   AskSchema.safeParse({ question: 'how much', conversationId: 'c123' }).success)
ok('no id at all is accepted',
   AskSchema.safeParse({ question: 'how much' }).success)
ok('an empty question is still refused',
   !AskSchema.safeParse({ question: '   ', conversationId: null }).success)

console.log('\n--- provenance is recorded from the first message ---')
let c = start('t1')
c = append(c, { sender: 'customer', text: 'how much' })
c = append(c, { sender: 'bot', text: 'x', provenance: {
  retrieved_ids: ['502037'], cited_ids: ['502037'], model: 'gemma4:12b',
  prompt_version: 'chat/v1', escalated: false } })
ok('a human message carries no provenance', c.messages[0].provenance === undefined)
ok('a bot message records what it retrieved',
   c.messages[1].provenance.retrieved_ids[0] === '502037')
ok('a bot message records the model and prompt',
   c.messages[1].provenance.model === 'gemma4:12b' && c.messages[1].provenance.prompt_version === 'chat/v1')
ok('sender is one of the three',
   ['customer', 'bot', 'rep'].includes(c.messages[0].sender))
ok('a conversation is not escalated by default', c.escalated_at === null)

c = append(c, { sender: 'bot', text: ESCALATION, provenance: {
  retrieved_ids: [], cited_ids: [], model: 'gemma4:12b', prompt_version: 'chat/v1',
  escalated: true, reason: 'nothing-retrieved' } })
ok('a failed answer queues the conversation', Boolean(c.escalated_at))
const firstEscalation = c.escalated_at
c = append(c, { sender: 'bot', text: ESCALATION, provenance: {
  retrieved_ids: [], cited_ids: [], model: 'gemma4:12b', prompt_version: 'chat/v1',
  escalated: true, reason: 'ungrounded-sku' } })
ok('a second failure does not move it down the queue', c.escalated_at === firstEscalation)
ok('the reason is named, not vague', c.messages[3].provenance.reason === 'ungrounded-sku')

console.log(`\n${failed ? `${failed} FAILED` : 'chat guards hold'}`)
process.exit(failed ? 1 : 0)
