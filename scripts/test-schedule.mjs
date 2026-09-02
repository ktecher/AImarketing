// Posting later, and admitting when later never came (D89).
//
// This is the only code in the project that acts with nobody watching, so the
// assertions are about the two ways that goes wrong rather than the way it goes
// right: a post that fires when it should no longer fire, and a post that
// silently never fires at all.
//
// Offline. `fetch` is replaced, so nothing reaches Instagram. Needs Postgres,
// because what is being tested is mostly what the table does.
try { process.loadEnvFile('.env') } catch { /* no .env is normal on a clone */ }

const TEST_KEY = Buffer.alloc(32, 7).toString('base64')
process.env.APP_ENCRYPTION_KEY = TEST_KEY

let failed = 0
const ok = (label, cond, detail = '') => {
  if (!cond) failed++
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `   ${detail}` : ''}`)
}

// ---------------------------------------------------------------------------
// Instagram, stubbed. Container polling is immediate.
// ---------------------------------------------------------------------------
let calls = []
let respond = () => ({})
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url))
  const params = init.body
    ? Object.fromEntries(new URLSearchParams(init.body))
    : Object.fromEntries(u.searchParams)
  const call = { host: u.host, path: u.pathname, method: init.method ?? 'GET', params }
  calls.push(call)
  const r = respond(call) ?? {}
  return { ok: r.ok !== false, status: r.status ?? 200, json: async () => r.body ?? {} }
}
const realSetTimeout = globalThis.setTimeout
globalThis.setTimeout = (fn, _ms, ...rest) => realSetTimeout(fn, 0, ...rest)

const sendsFine = (c) => {
  if (c.params.fields === 'status_code') return { body: { status_code: 'FINISHED' } }
  if (c.params.fields === 'permalink') return { body: { permalink: 'https://ig.test/p/S' } }
  if (c.path.endsWith('/media_publish')) return { body: { id: 'MEDIA_SCHED' } }
  return { body: { id: 'CONTAINER_S' } }
}

const { reachable, query } = await import('../lib/db.ts')
const store = await import('../lib/social/store.ts')
const { sweep, sendNow, GRACE_MS } = await import('../lib/social/scheduler.ts')

if (!(await reachable())) {
  console.log('\nskipped: Postgres is not running (npm run db:up)')
  process.exit(0)
}

const MARK = 'zzsched'
const ID = `instagram:${MARK}-acct`
const clean = async () => {
  await query('delete from social_accounts where external_id like $1', [`${MARK}%`])
  await query('delete from social_posts where exists (select 1 from unnest(skus) s where s like $1)', [`${MARK}%`])
}

/** A row already rendered and uploaded, due `minutesAgo` in the past (or future). */
const scheduleAt = (minutesAgo, sku) => store.startPost({
  accountId: ID, caption: 'later', skus: [`${MARK}-${sku}`],
  imageUrls: ['https://res.cloudinary.test/x.png'], imagePublicIds: ['x'],
  scheduledAt: new Date(Date.now() - minutesAgo * 60_000),
})

try {
  await clean()
  await store.connect({
    platform: 'instagram', external_id: `${MARK}-acct`, name: 'Sched Test', token: 'IGAA-fake-token',
  })

  console.log('\n--- scheduling writes a row and sends nothing ---')
  calls = []
  const later = await scheduleAt(-60, 'future')
  ok('the status is scheduled',    later.status === 'scheduled', later.status)
  ok('with the time it is due',    later.scheduled_at !== null)
  ok('and no time it went out',    later.posted_at === null)
  // The whole safety of the feature: nothing is public until the sweep decides.
  ok('nothing reached Instagram',  calls.length === 0, `${calls.length} requests`)
  ok('the images are already up',  later.image_urls.length === 1)

  console.log('\n--- a post that is not due yet is left alone ---')
  calls = []
  respond = sendsFine
  let r = await sweep()
  ok('nothing is sent',            r.sent === 0, JSON.stringify(r))
  ok('nothing is missed',          r.missed === 0, JSON.stringify(r))
  ok('and Instagram is untouched', calls.length === 0)
  ok('it is still waiting',        (await store.upcoming()).some((p) => p.id === later.id))

  console.log('\n--- a post that is due goes out ---')
  calls = []
  const now = await scheduleAt(1, 'due')
  r = await sweep()
  ok('one is sent',                r.sent === 1, JSON.stringify(r))
  const sent = (await store.posts({ sku: `${MARK}-due` }))[0]
  ok('the row says posted',        sent.status === 'posted', sent.status)
  ok('with the platform id',       sent.platform_post_id === 'MEDIA_SCHED')
  ok('and a time it went out',     sent.posted_at !== null)
  ok('the image was NOT re-rendered — the stored URL was used',
     calls.find((c) => c.path.endsWith('/media'))?.params.image_url === 'https://res.cloudinary.test/x.png')
  ok('and the one not due yet is still waiting',
     (await store.upcoming()).some((p) => p.id === later.id))

  console.log('\n--- a post whose moment passed is missed, never sent late ---')
  // The reason this feature is safe to have at all: a laptop that was shut must
  // not wake up and put a "tonight only" offer in front of customers.
  calls = []
  const stale = await scheduleAt(GRACE_MS / 60_000 + 5, 'stale')
  r = await sweep()
  ok('it is counted as missed',    r.missed === 1, JSON.stringify(r))
  ok('and it was NOT sent',        r.sent === 0, JSON.stringify(r))
  ok('nothing reached Instagram',  !calls.some((c) => c.path.endsWith('/media_publish')),
     JSON.stringify(calls.map((c) => c.path)))
  const missedRow = (await store.posts({ sku: `${MARK}-stale` }))[0]
  ok('the row says missed',        missedRow.status === 'missed', missedRow.status)
  ok('and says why in a sentence', /time passed/i.test(missedRow.error ?? ''), missedRow.error ?? '')
  // The work is kept, not thrown away — a person may still want it out.
  ok('the caption survives',       missedRow.caption === 'later')
  ok('and so do the images',       missedRow.image_urls.length === 1)

  console.log('\n--- just inside the window still goes ---')
  calls = []
  const edge = await scheduleAt(GRACE_MS / 60_000 - 5, 'edge')
  r = await sweep()
  ok('it is sent, not missed',     r.sent === 1 && r.missed === 0, JSON.stringify(r))
  ok('the row says posted',        (await store.posts({ sku: `${MARK}-edge` }))[0].status === 'posted')

  console.log('\n--- two sweeps cannot send the same post twice ---')
  // The realistic version of this is a slow upload and the next tick arriving,
  // or a sweep racing somebody pressing "Post it now". Postgres decides.
  calls = []
  await scheduleAt(1, 'race')
  const [a, b] = await Promise.all([sweep(), sweep()])
  ok('exactly one sweep sent it',  a.sent + b.sent === 1, JSON.stringify([a, b]))
  ok('and Instagram was asked once',
     calls.filter((c) => c.path.endsWith('/media_publish')).length === 1,
     String(calls.filter((c) => c.path.endsWith('/media_publish')).length))

  console.log('\n--- a missed post can still be sent by hand ---')
  calls = []
  ok('sendNow publishes it',       (await sendNow(missedRow.id)) === true)
  ok('and the row is posted now',  (await store.posts({ sku: `${MARK}-stale` }))[0].status === 'posted')
  ok('twice is refused',           (await sendNow(missedRow.id)) === false)

  console.log('\n--- a failure while nobody is watching is recorded, not lost ---')
  calls = []
  respond = () => ({ ok: false, status: 401, body: { error: { message: 'Error validating access token: the session has expired' } } })
  await scheduleAt(1, 'broken')
  r = await sweep()
  ok('it is counted as failed',    r.failed === 1 && r.sent === 0, JSON.stringify(r))
  const broke = (await store.posts({ sku: `${MARK}-broken` }))[0]
  ok('the row says failed',        broke.status === 'failed', broke.status)
  ok('with the platform’s reason', /session has expired/i.test(broke.error ?? ''), broke.error ?? '')
  ok('and no time it went out',    broke.posted_at === null)

  console.log('\n--- cancelling ---')
  respond = sendsFine
  // The public ids come back so the caller can delete the images: this row was
  // the only thing that knew which uploads belonged to it.
  const orphans = await store.unschedule(later.id)
  ok('a waiting post can be dropped',  Array.isArray(orphans), JSON.stringify(orphans))
  ok('and hands back its images',      orphans?.length === 1, JSON.stringify(orphans))
  ok('and is gone from the queue',     !(await store.upcoming()).some((p) => p.id === later.id))
  // A post that is already public cannot be unpublished from here, and a button
  // offering to would be a button that lies. Null, not [] — nothing was dropped.
  ok('a posted one cannot be dropped', (await store.unschedule(sent.id)) === null)
  ok('and is still in the history',    (await store.posts({ sku: `${MARK}-due` })).length === 1)

  // A publish that threw — an expired token is the ordinary way, sixty days
  // after connecting — used to leave a row nothing could act on: `claim` and
  // `unschedule` both matched only scheduled and missed, and the screen offered
  // its buttons on the same two. The row stayed forever and its uploaded images
  // stayed on a paid host forever, with only that row able to name them.
  const freed = await store.unschedule(broke.id)
  ok('a failed post can be dropped',   Array.isArray(freed), JSON.stringify(freed))
  ok('and hands back its images',      freed?.length === 1, JSON.stringify(freed))
  ok('and is gone from the history',   (await store.posts({ sku: `${MARK}-broken` })).length === 0)
} finally {
  await clean()
}

console.log(failed ? `\n${failed} failed` : '\nschedule: nothing fires late and nothing fires twice')
process.exit(failed ? 1 : 0)
