// The loop: an id stamped on a design, a caption and a conversation, and the
// report that reads all three back. Needs Postgres, and skips cleanly when it is
// not running — a missing database is a state on somebody else's machine.
//
// Next loads .env for the app; a plain node script does not. Without this the
// suite connects to whatever is on the default port and SKIPS, which is how
// seventeen assertions once stopped running while the total still looked fine.
try { process.loadEnvFile('.env') } catch { /* no .env is normal on a clone */ }

import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const { reachable, query } = await import('../lib/db.ts')
if (!(await reachable())) {
  console.log('\n--- campaigns ---\nskipped: Postgres is not running (npm run db:up)')
  process.exit(0)
}
if (!(await query(`select to_regclass('campaigns') as t`))[0].t) {
  console.log('\n--- campaigns ---\nskipped: no campaigns table (npm run db:migrate)')
  process.exit(0)
}

const { create, current, get, list, report, setContext, shelf } = await import('../lib/campaigns.ts')
const chat = await import('../lib/chat/store.ts')
const studio = await import('../lib/content/studio.ts')

let failed = 0
const ok = (label, cond, detail = '') => {
  if (!cond) failed++
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `   ${detail}` : ''}`)
}

// Everything this suite writes carries this prefix, and everything carrying it
// is deleted at the end — including on a failure, or a half-finished run leaves
// rows in the real inbox and the real report.
//
// It has to survive slugging: `create()` lowercases and strips anything that is
// not a letter or a digit, so a marker of underscores arrives as something else
// and the cleanup misses it. Underscores are also LIKE wildcards, which is the
// same bug twice.
const MARK = 'zztest'
const SKU = 'zztest-sku'
const CONVOS = ['zztest-convo-a', 'zztest-convo-b']

const clean = async () => {
  await query(`delete from assets where sku = $1 or campaign_id like $2`, [SKU, `${MARK}%`])
  await query(`delete from campaigns where id like $1`, [`${MARK}%`])
  for (const p of [
    ...CONVOS.map((id) => join(process.cwd(), 'data/state/chat', `${id}.json`)),
    join(process.cwd(), 'data/state/content', `${SKU}.json`),
  ]) if (existsSync(p)) rmSync(p)
}

const provenance = (over = {}) => ({
  retrieved_ids: [], cited_ids: [], model: 'test', prompt_version: 'test', escalated: false, ...over,
})

try {
  await clean()

  console.log('\n--- four columns, and no fifth ---')
  const cols = (await query(
    `select column_name from information_schema.columns where table_name = 'campaigns' order by ordinal_position`,
  )).map((r) => r.column_name)
  // CLAUDE.md: "Campaigns are four columns. Guard this against your future self
  // — it grows into scheduling, budgets, statuses and approval workflows, and
  // that is a CRM." The schema is the guard; this is the alarm on it.
  ok('exactly four columns', cols.length === 4, cols.join(', '))
  ok('and they are the four', String(cols) === 'id,name,context,created_at', cols.join(', '))

  console.log('\n--- creating one ---')
  const a = await create(`${MARK} Back to School`, 'free bag with every laptop')
  ok('the id reads',              a.id === `${MARK}-back-to-school`, a.id)
  ok('the context is kept',       a.context === 'free bag with every laptop')
  ok('an empty name is refused',  await create('   ').then(() => false, () => true))

  const b = await create(`${MARK} Back to School`)
  ok('a reused name does not collide', b.id !== a.id, `${a.id} vs ${b.id}`)
  ok('and the second is suffixed',     b.id === `${a.id}-2`, b.id)

  console.log('\n--- the newest one is the current one ---')
  ok('current is the newest',     (await current()) === b.id, String(await current()))
  ok('newest first in the list',  (await list())[0].id === b.id)

  await setContext(a.id, 'the offer changed')
  ok('context is editable',       (await get(a.id)).context === 'the offer changed')

  console.log('\n--- membership is derived, never stored ---')
  await query(
    `insert into assets (sku, template_id, bound_values, formats, campaign_id)
     values ($1, 'zztest-template', '{}'::jsonb, '{png}', $2)`,
    [SKU, a.id],
  )
  studio.save(SKU, [{
    id: 'p1', sku: SKU, kind: 'caption', lang: 'en', channel: 'instagram',
    text: 'a draft', checks: [], status: 'approved', source: 'model',
    model: 'test', prompt_version: 'test', campaign_id: a.id, created_at: new Date().toISOString(),
  }])

  let r = await report(a.id)
  ok('a design makes a product promoted', r.promoted.length === 1 && r.promoted[0].sku === SKU)
  ok('the design is counted',             r.promoted[0].designs === 1)
  ok('so is the approved copy',           r.promoted[0].approved === 1 && r.promoted[0].drafts === 1)
  ok('nothing was asked yet',             r.promoted[0].asked === 0)
  // A campaign's report must never pick up another campaign's work.
  ok('another campaign sees none of it',  (await report(b.id)).promoted.length === 0)

  console.log('\n--- the return leg ---')
  const c = chat.start(CONVOS[0], a.id)
  chat.append(c, { sender: 'customer', text: 'how much is it?' })
  chat.append(c, { sender: 'bot', text: 'It is 19.900 KD.',
                   provenance: provenance({ retrieved_ids: [SKU, 'zztest-ranked-near'], cited_ids: [SKU] }) })
  chat.append(c, { sender: 'customer', text: 'do you deliver to Salmiya on Fridays?' })
  chat.append(c, { sender: 'bot', text: 'passing you to someone',
                   provenance: provenance({ escalated: true, reason: 'nothing-retrieved' }) })
  chat.save(c)

  r = await report(a.id)
  ok('the conversation is counted',           r.conversations === 1)
  ok('a cited product counts as asked about', r.promoted[0].asked === 1)
  // retrieved_ids holds whatever ranked near the words used, for every question.
  // Counting those would report interest in the catalogue's ranking rather than
  // the customer's, so the row that was merely retrieved must appear nowhere.
  ok('a merely retrieved product does not',   !r.unpromoted.some((p) => p.sku === 'zztest-ranked-near'))
  ok('the unanswerable question is kept',     r.unanswered.length === 1)
  ok('with the CUSTOMER words, not the bot apology',
     r.unanswered[0].question === 'do you deliver to Salmiya on Fridays?', r.unanswered[0].question)
  ok('and a reason a person can read',
     r.unanswered[0].why === 'nothing in the catalogue matched', r.unanswered[0].why)

  console.log('\n--- asked about, but not promoted ---')
  // A real SKU, so the name lookup has something to find. An empty catalogue is
  // a legitimate state, and the two assertions below say so rather than failing.
  const other = (await query(`select sku, coalesce(display_name, name_en) as name from products
                              where name_en is not null limit 1`))[0]
  if (!other) {
    console.log('    (catalogue is empty — the unpromoted assertions need a product)')
  } else {
    const d = chat.start(CONVOS[1], a.id)
    chat.append(d, { sender: 'bot', text: 'that one is 9.900 KD',
                     provenance: provenance({ retrieved_ids: [other.sku], cited_ids: [other.sku] }) })
    chat.save(d)
    r = await report(a.id)
    ok('a product nobody promoted shows separately',
       r.unpromoted.length === 1 && r.unpromoted[0].sku === other.sku, JSON.stringify(r.unpromoted))
    ok('and it is named from the catalogue',
       r.unpromoted[0].name === other.name, r.unpromoted[0].name)
    ok('the promoted product stays promoted', r.promoted.length === 1 && r.promoted[0].sku === SKU)
  }

  console.log('\n--- a miss is a miss, and it says so out loud ---')
  // The defect the maintainer reported. Told "I want to run a campaign about
  // the Pura 20" — a phone this shop has never stocked — retrieval returned
  // four confident rows (two Anker cables at 0.667, scored on "the" matching
  // "the exterior of bio based cables" and "20" matching "90 20 000 bend
  // lifespan"), the empty branch was unreachable, and an empty shelf printed as
  // an ABSENT LINE anyway. The planner, told nothing, wrote a complete 3000 KD
  // three-way split for "Pura 20 Night Vision" and flagged none of it.
  //
  // Runs offline: with no embedder, retrieve() falls back to the lexical pass,
  // which is the half that was scoring on noise.
  const missed = await shelf('the Pura 20')
  ok('a product we do not stock does not match', missed.matched === false)
  ok('and the model is TOLD nothing matched, not handed a blank',
     /NOTHING IN THE CATALOGUE MATCHES/.test(missed.text), missed.text.slice(0, 60))
  ok('with an instruction not to plan around it',
     /do not plan|do not invent/i.test(missed.text))
  ok('nonsense matches nothing either', (await shelf('zzzqqq nonexistent widget')).matched === false)
  ok('and a brand we do not carry',      (await shelf('Huawei phone')).matched === false)

  // The other half, and the half that made it feel unhelpful for products we DO
  // stock: a real product must still come back, named, so the planner can
  // answer "which models do we have".
  const real = (await query(`select sku, coalesce(display_name, name_en) as name from products
                             where name_en is not null limit 1`))[0]
  if (!real) {
    console.log('    (catalogue is empty — the matching assertions need a product)')
  } else {
    const hit = await shelf(real.name)
    ok('a product we DO stock matches', hit.matched === true, real.name)
    ok('and is named in the block the model reads', hit.text.includes(real.name), hit.text.slice(0, 120))
    ok('under a header that tells the planner to name it',
       /Name them/.test(hit.text), hit.text.split('\n')[1])
    // Names and categories only — a figure the model has seen is a figure it
    // paraphrases into advice, and advice gets pasted into captions.
    const priced = (await query(`select price_now from products where sku = $1`, [real.sku]))[0]
    ok('and no price reaches the model',
       !priced?.price_now || !hit.text.includes(String(priced.price_now)), String(priced?.price_now))
  }

  // Several queries, one shelf: the meeting passes the opening idea AND the
  // newest turn, so a product named in turn three is searched for at all. The
  // opener is never dropped, which is what keeps the shelf from swinging.
  if (real) {
    const both = await shelf('the Pura 20', real.name)
    ok('a later turn can put a product on a shelf the opener missed',
       both.matched === true && both.text.includes(real.name), both.text.slice(0, 80))
  }
  // And an answer that names no product contributes nothing rather than noise —
  // the reason merging is safe. This was the whole argument for freezing the
  // query to turn one.
  ok('answering the budget question adds nothing to the shelf',
     (await shelf('3000 KD')).matched === false)

  console.log('\n--- an id nobody made ---')
  ok('no campaign, no report', (await report('zztest-no-such-campaign')) === null)
} finally {
  await clean()
}

console.log(failed ? `\n${failed} failed` : '\ncampaigns: the loop closes')
process.exit(failed ? 1 : 0)
