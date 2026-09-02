// Publishing: the encrypted token, and one row per publish attempt. Needs
// Postgres for the store half; the crypto half needs nothing and still runs.
//
// Next loads .env for the app; a plain node script does not. Without this the
// suite connects to whatever is on the default port and SKIPS, which is how
// seventeen assertions once stopped running while the total still looked fine.
try { process.loadEnvFile('.env') } catch { /* no .env is normal on a clone */ }

// A fixed, invented key rather than whatever .env holds: these assertions are
// about the algorithm, and a suite that passes or fails depending on a machine's
// configuration is not testing the thing it claims to test. Set before anything
// imports the module, though `key()` reads per call so ordering is not fragile.
const TEST_KEY = Buffer.alloc(32, 7).toString('base64')
process.env.APP_ENCRYPTION_KEY = TEST_KEY

const { reachable, query } = await import('../lib/db.ts')
const { encrypt, decrypt } = await import('../lib/social/tokens.ts')

let failed = 0
const ok = (label, cond, detail = '') => {
  if (!cond) failed++
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `   ${detail}` : ''}`)
}

/** The message of whatever `fn` throws, or '' if it did not throw. */
const threw = (fn) => { try { fn(); return '' } catch (e) { return e.message } }

// A token shaped like the real thing: Instagram's long-lived tokens are long
// opaque strings, and a three-character secret would not exercise the padding.
const TOKEN = `EAAG${'k9Zx3Qm'.repeat(20)}ZDZD`
const messages = []

console.log('\n--- the token survives the round trip ---')
const cipher = encrypt(TOKEN)
ok('a token comes back exactly',   decrypt(cipher) === TOKEN)
ok('and the stored form is not it', !cipher.includes(TOKEN.slice(0, 16)), cipher.slice(0, 24))

// A reused IV with a reused key breaks GCM completely, and it is the one
// mistake that leaves everything still apparently working.
ok('the same token encrypts differently twice', encrypt(TOKEN) !== encrypt(TOKEN))

console.log('\n--- tampering fails loudly, never quietly ---')
// GCM authenticates: an edited ciphertext must fail rather than decrypt to
// plausible bytes. A token mangled into a different token is a request that
// fails at Meta with an unreadable error, and the tampering is the real news.
const bytes = Buffer.from(cipher, 'base64')
bytes[bytes.length - 1] ^= 0x01
messages.push(threw(() => decrypt(bytes.toString('base64'))))
ok('a flipped byte is refused',      messages.at(-1) !== '')
ok('and the message says what to do', /reconnect/i.test(messages.at(-1)), messages.at(-1))

const tag = Buffer.from(cipher, 'base64')
tag[13] ^= 0x01
messages.push(threw(() => decrypt(tag.toString('base64'))))
ok('an edited auth tag is refused',  messages.at(-1) !== '')

messages.push(threw(() => decrypt(Buffer.from('short').toString('base64'))))
ok('a truncated value is refused',   messages.at(-1) !== '')

// Encrypted under a different key, which is what a rotated APP_ENCRYPTION_KEY
// looks like from here.
process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64')
messages.push(threw(() => decrypt(cipher)))
ok('another key cannot read it',     messages.at(-1) !== '')
process.env.APP_ENCRYPTION_KEY = TEST_KEY

console.log('\n--- a key that is missing or wrong says so ---')
delete process.env.APP_ENCRYPTION_KEY
messages.push(threw(() => encrypt(TOKEN)))
ok('a missing key throws',            messages.at(-1) !== '')
ok('and names the variable',          messages.at(-1).includes('APP_ENCRYPTION_KEY'))
ok('and says how to make one',        messages.at(-1).includes('randomBytes(32)'), messages.at(-1))

const SHORT_KEY = Buffer.alloc(16, 3).toString('base64')
process.env.APP_ENCRYPTION_KEY = SHORT_KEY
messages.push(threw(() => encrypt(TOKEN)))
ok('a 16-byte key throws',            messages.at(-1) !== '')
ok('and says how many bytes it got',  /16 bytes/.test(messages.at(-1)), messages.at(-1))
process.env.APP_ENCRYPTION_KEY = TEST_KEY

// The whole point of encrypting it is that it never travels. An error goes to a
// log, a log gets pasted into a chat.
console.log('\n--- no error carries the secret ---')
ok('no thrown message contains the token',
   !messages.some((m) => m.includes(TOKEN.slice(0, 12))))
ok('no thrown message contains a key',
   !messages.some((m) => m.includes(TEST_KEY) || m.includes(SHORT_KEY)))
ok('nor the ciphertext',
   !messages.some((m) => m.includes(cipher.slice(0, 16))))

if (!(await reachable())) {
  console.log('\n--- accounts and posts ---\nskipped: Postgres is not running (npm run db:up)')
  console.log(failed ? `\n${failed} failed` : '\nsocial: the token holds')
  process.exit(failed ? 1 : 0)
}
if (!(await query(`select to_regclass('social_accounts') as t`))[0].t) {
  console.log('\n--- accounts and posts ---\nskipped: no social tables (npm run db:migrate)')
  console.log(failed ? `\n${failed} failed` : '\nsocial: the token holds')
  process.exit(failed ? 1 : 0)
}

const store = await import('../lib/social/store.ts')

// Everything this suite writes carries this prefix, and everything carrying it
// is deleted at the end — including on a failure, or a half-finished run leaves
// a fake account in the account picker. It has to survive campaign slugging, and
// underscores are LIKE wildcards, so letters only.
const MARK = 'zztest'
const PAGE = `${MARK}-page`
const ID = `instagram:${PAGE}`

const clean = async () => {
  await query('delete from social_accounts where external_id like $1', [`${MARK}%`])
  await query('delete from social_posts where exists (select 1 from unnest(skus) s where s like $1)', [`${MARK}%`])
  await query('delete from campaigns where id like $1', [`${MARK}%`])
}

try {
  await clean()

  console.log('\n--- the schema, and nothing else ---')
  const cols = (await query(
    `select column_name from information_schema.columns
      where table_name = 'social_posts' order by ordinal_position`,
  )).map((r) => r.column_name)
  // This used to assert the OPPOSITE — that no scheduled_at existed — because a
  // scheduled post is a promise a sleeping laptop cannot keep. D89 added it, so
  // the alarm moved rather than went: the column is allowed to exist only
  // alongside the status that admits when the promise was broken.
  //
  // Delete 'missed' from the constraint and this fails, which is the point. A
  // schedule with nowhere to record "its time passed and nothing sent it" is the
  // version that quietly lies, and it is one migration away at all times.
  const statuses = (await query(
    `select pg_get_constraintdef(oid) def from pg_constraint
       where conname = 'social_posts_status_check'`,
  ))[0]?.def ?? ''
  ok('scheduled_at came with a runner',  cols.includes('scheduled_at'), cols.join(', '))
  ok('and with somewhere to say it was missed',
     statuses.includes("'missed'") && statuses.includes("'scheduled'"), statuses)
  // Rule 4: you cannot hallucinate into a field that does not exist.
  ok('no score, rating or grade',
     !cols.some((c) => /score|rating|grade/.test(c)), cols.join(', '))
  ok('the media ids are kept for deletion later', cols.includes('image_public_ids'))

  console.log('\n--- connecting ---')
  const a = await store.connect({
    platform: 'instagram', external_id: PAGE, name: 'Test Electronics', token: TOKEN,
  })
  ok('the id is derived from the platform and page', a.id === ID, a.id)
  ok('it is listed',            (await store.accounts()).some((x) => x.id === ID))
  // A listing must not be able to serialise a token into a screen or an API
  // response, so the column is never selected there.
  ok('and the listing carries no token',
     !JSON.stringify(await store.accounts()).includes(TOKEN.slice(0, 12)))
  ok('the token comes back decrypted', (await store.tokenFor(ID)) === TOKEN)
  ok('an unconnected account has none', (await store.tokenFor('instagram:zztest-nobody')) === null)

  // Tokens expire and get re-issued; reconnecting is how a fresh one is stored,
  // and it must not leave two rows posting to the same account.
  await store.connect({
    platform: 'instagram', external_id: PAGE, name: 'Test Electronics KW', token: `${TOKEN}-second`,
  })
  const listed = (await store.accounts()).filter((x) => x.id === ID)
  ok('reconnecting updates rather than duplicating', listed.length === 1)
  ok('the name is refreshed',   listed[0].name === 'Test Electronics KW')
  ok('and so is the token',     (await store.tokenFor(ID)) === `${TOKEN}-second`)

  // Checked with the account present, so what refuses it is the status check
  // and not the foreign key.
  //
  // The invented status here used to be 'scheduled', which D89 then made real —
  // so the test that guarded the constraint was passing for the wrong reason
  // until the constraint changed under it. 'queued' is invented on purpose: if a
  // queue is ever added, this failing is the correct first sign.
  const bad = await query(
    `insert into social_posts (id, account_id, caption, status)
     values ('zztest-bad', $1, 'x', 'queued')`, [ID],
  ).then(() => true, () => false)
  ok('a sixth status is refused by the database', bad === false)

  console.log('\n--- a publish, and how it ended ---')
  await query(`insert into campaigns (id, name) values ($1, 'zztest campaign')`, [`${MARK}-social`])

  const good = await store.startPost({
    accountId: ID, caption: 'a caption', skus: [`${MARK}-sku-a`], campaignId: `${MARK}-social`,
    imageUrls: ['/data/exports/a.png'], imagePublicIds: ['media-1'],
  })
  // Written before the request leaves, so a crash mid-publish leaves evidence
  // rather than no trace of a post that may well have gone out.
  ok('it starts as publishing',  good.status === 'publishing')
  ok('nothing is posted_at yet', good.posted_at === null)
  ok('the media ids travel',     good.image_public_ids[0] === 'media-1')
  // A single-product post is a one-element list. There is no second shape (D88).
  ok('the products are a list',  Array.isArray(good.skus) && good.skus.length === 1, JSON.stringify(good.skus))

  await store.succeeded(good.id, '123_456', '/permalink/123')
  const [posted] = await store.posts({ sku: `${MARK}-sku-a` })
  ok('success lands',            posted.status === 'posted')
  ok('with the platform id',     posted.platform_post_id === '123_456')
  // The moment it went out, not the moment somebody pressed the button.
  ok('and a time it went out',   posted.posted_at !== null)

  const bust = await store.startPost({
    accountId: ID, caption: 'another', skus: [`${MARK}-sku-b`], campaignId: `${MARK}-social`,
  })
  await store.failed(bust.id, '(#10) requires pages_manage_posts')
  const [broken] = await store.posts({ sku: `${MARK}-sku-b` })
  ok('failure lands',            broken.status === 'failed')
  // "It failed" sends a person to Meta's dashboard; the platform's own words
  // tell them what to fix.
  ok('with the reason kept',     broken.error === '(#10) requires pages_manage_posts')
  ok('and no time it went out',  broken.posted_at === null)

  console.log('\n--- history, and what the report counts ---')
  const all = await store.posts({ campaignId: `${MARK}-social` })
  ok('both attempts are history', all.length === 2)
  ok('newest first',              all[0].id === bust.id, all.map((p) => p.status).join(', '))
  ok('another campaign sees none', (await store.posts({ campaignId: 'zztest-no-such' })).length === 0)

  // A product whose only publish failed was not promoted, so a report that
  // counted it would say something that is not true.
  const counts = await store.postedFor(`${MARK}-social`)
  ok('only what went out is counted', counts.get(`${MARK}-sku-a`) === 1, JSON.stringify([...counts]))
  ok('a failed publish counts as none', counts.get(`${MARK}-sku-b`) === undefined)

  console.log('\n--- a carousel is one post about several products ---')
  // Every SKU in it was promoted by it, and the same product on two slides is
  // still one post — without the DISTINCT that row is counted twice, which is a
  // wrong number rather than a missing one.
  const many = await store.startPost({
    accountId: ID, caption: 'five in one', campaignId: `${MARK}-social`,
    skus: [`${MARK}-sku-a`, `${MARK}-sku-c`, `${MARK}-sku-a`],
    imageUrls: ['/a.png', '/b.png', '/c.png'],
  })
  await store.succeeded(many.id, 'CAROUSEL_1', '/permalink/carousel')
  const after = await store.postedFor(`${MARK}-social`)
  ok('a new product in it is counted',   after.get(`${MARK}-sku-c`) === 1, JSON.stringify([...after]))
  // sku-a was in the earlier single post AND in this carousel: two posts.
  ok('a repeat across posts adds up',    after.get(`${MARK}-sku-a`) === 2, JSON.stringify([...after]))
  ok('but twice in ONE carousel counts once',
     after.get(`${MARK}-sku-a`) !== 3, JSON.stringify([...after]))
  // Membership, not equality — the filter has to look inside the array.
  ok('and it is found by any product in it',
     (await store.posts({ sku: `${MARK}-sku-c` })).some((p) => p.id === many.id))

  console.log('\n--- disconnecting takes the history with it ---')
  // The opposite of deleting a campaign, and deliberately: nothing can re-read a
  // permalink or delete an uploaded image once the token is gone.
  ok('the account goes',   (await store.disconnect(ID)) === true)
  ok('and its posts go',   (await query('select 1 from social_posts where account_id = $1', [ID])).length === 0)
  ok('disconnecting twice is not a crash', (await store.disconnect(ID)) === false)
} finally {
  await clean()
}

console.log(failed ? `\n${failed} failed` : '\nsocial: the token holds and the history is honest')
process.exit(failed ? 1 : 0)
