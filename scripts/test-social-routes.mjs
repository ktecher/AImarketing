// The four routes publishing runs through: the OAuth handshake, the account
// list, and the publish itself.
//
// Entirely offline. `fetch` is replaced with a recorder that answers as Instagram
// and Cloudinary would, so what is asserted is the REQUEST that would have been
// made and the ROW that would have been written — the two things that are
// impossible to check by reading and expensive to get wrong. No token here is
// real, no credential here is real, and the file is safe to run on a plane.
//
// The handlers are called directly with constructed `Request` objects rather
// than through a server. That is why the callback reads its cookie from the raw
// header instead of `next/headers`: a state check that can only be exercised by
// booting Next is a state check nobody exercises.
//
// Next loads .env for the app; a plain node script does not. Without this the
// suite connects to whatever is on the default port and SKIPS, which is how
// seventeen assertions once stopped running while the total still looked fine.
try { process.loadEnvFile('.env') } catch { /* no .env is normal on a clone */ }

// Invented credentials, set before anything imports a module that reads them.
// Every one of these is also a needle: the last section asserts that none of
// them appears in any response body this suite collected.
const KEY = Buffer.alloc(32, 7).toString('base64')
process.env.APP_ENCRYPTION_KEY = KEY
process.env.INSTAGRAM_APP_ID = 'zztest-app-id'
process.env.INSTAGRAM_APP_SECRET = 'zztestInstagramAppSecretNeverInAResponse'
process.env.INSTAGRAM_REDIRECT_URI = 'http://localhost:3000/api/social/instagram/callback'
process.env.CLOUDINARY_CLOUD_NAME = 'zztest-cloud'
process.env.CLOUDINARY_API_KEY = 'zztest-cloud-key'
process.env.CLOUDINARY_API_SECRET = 'zztestCloudinarySecretNeverInAResponse'

// Two accounts, because Instagram Login grants exactly one per consent (D86) and
// the failure that matters most — one account's token dead while another's is
// fine — needs two of them to be visible at all.
const IG1 = 'zztestig1'
const IG2 = 'zztestig2'
const IG1_ID = `instagram:${IG1}`
const IG2_ID = `instagram:${IG2}`
const TOKEN_SHORT = 'zztest-short-lived-token'
const TOKEN_LONG = `IGAA${'longLivedZ'.repeat(12)}ZZ`
const TOKEN_LONG_2 = `IGAA${'secondAcctZ'.repeat(10)}ZZ`
const PNG = 'data:image/png;base64,aGVsbG8ta3V3YWl0'

let failed = 0
const ok = (label, cond, detail = '') => {
  if (!cond) failed++
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `   ${detail}` : ''}`)
}

// ---------------------------------------------------------------------------
// The recorder
// ---------------------------------------------------------------------------

let calls = []
/** Set per section: given a recorded call, the body Instagram or Cloudinary returns. */
let respond = () => ({})

globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url))
  const params = init.body
    ? Object.fromEntries(
        init.body instanceof FormData
          ? [...init.body.entries()].map(([k, v]) => [k, typeof v === 'string' ? v : '<bytes>'])
          : new URLSearchParams(init.body),
      )
    : Object.fromEntries(u.searchParams)
  const call = { host: u.host, path: u.pathname, method: init.method ?? 'GET', params }
  calls.push(call)
  const r = respond(call) ?? {}
  return { ok: r.ok !== false, status: r.status ?? 200, json: async () => r.body ?? {} }
}

// Instagram's container polling waits two seconds between attempts. Firing the
// timer immediately keeps the asynchrony, and therefore the ordering being
// asserted, without spending real seconds to prove it.
const realSetTimeout = globalThis.setTimeout
globalThis.setTimeout = (fn, _ms, ...rest) => realSetTimeout(fn, 0, ...rest)

/** Every response body this suite produced, for the secrets sweep at the end. */
const bodies = []
const bodyOf = async (res) => {
  const text = await res.clone().text()
  bodies.push(text)
  return text
}
/** A redirect's target, recorded for the sweep the same way a JSON body is. */
const locationOf = (res) => {
  const loc = res.headers.get('location') ?? ''
  bodies.push(loc)
  return new URL(loc, 'http://localhost:3000')
}

const GET = (path, { cookie } = {}) =>
  new Request(`http://localhost:3000${path}`, { headers: cookie ? { cookie } : {} })
const POST = (path, body) =>
  new Request(`http://localhost:3000${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
const DEL = (path) => new Request(`http://localhost:3000${path}`, { method: 'DELETE' })

const { reachable, query } = await import('../lib/db.ts')
const start = await import('../app/api/social/instagram/start/route.ts')
const callback = await import('../app/api/social/instagram/callback/route.ts')
const accountsRoute = await import('../app/api/social/accounts/route.ts')
const publish = await import('../app/api/social/publish/route.ts')

/** A fresh state and its cookie: `start` is the only thing that mints one. */
async function handshake() {
  const res = await start.GET(GET('/api/social/instagram/start'))
  const state = locationOf(res).searchParams.get('state') ?? ''
  return { res, state, cookie: `instagram_oauth_state=${state}` }
}

// ---------------------------------------------------------------------------
// Starting the handshake
// ---------------------------------------------------------------------------

console.log('\n--- the dialog, and the cookie that guards the way back ---')
calls = []
const started = await start.GET(GET('/api/social/instagram/start'))
const dialog = locationOf(started)

ok('nothing is fetched to build it',  calls.length === 0, `${calls.length} requests`)
ok('it redirects',                    started.status >= 300 && started.status < 400, String(started.status))
// Neither API host serves the login dialog; www.instagram.com does.
ok('to the Instagram login dialog',   dialog.host === 'www.instagram.com', dialog.host)
ok('at the authorize path',           dialog.pathname === '/oauth/authorize', dialog.pathname)
ok('and the app id',                  dialog.searchParams.get('client_id') === 'zztest-app-id')
ok('and the redirect it will come back to',
   dialog.searchParams.get('redirect_uri') === process.env.INSTAGRAM_REDIRECT_URI)

const SCOPES = ['instagram_business_basic', 'instagram_business_content_publish']
const asked = (dialog.searchParams.get('scope') ?? '').split(',')
ok('every scope publishing needs is asked for',
   SCOPES.every((s) => asked.includes(s)), asked.join(','))
ok('and nothing beyond them',         asked.length === SCOPES.length, asked.join(','))
// D86: nothing in this project talks to Graph, so nothing asks for a Page.
ok('no Page scope is asked for',      !asked.some((s) => s.startsWith('pages_')), asked.join(','))

const setCookie = started.headers.get('set-cookie') ?? ''
const STATE = dialog.searchParams.get('state') ?? ''
ok('a state travels in the URL',      STATE.length >= 32, `${STATE.length} chars`)
ok('and the same one is planted as a cookie', setCookie.includes(STATE), setCookie.slice(0, 60))

// lax, not strict: the callback arrives as a top-level navigation FROM
// instagram.com and a strict cookie is not sent on a cross-site navigation.
ok('the cookie is httpOnly',          /httponly/i.test(setCookie), setCookie)
ok('and sameSite=lax, not strict',    /samesite=lax/i.test(setCookie), setCookie)
ok('and it expires',                  /max-age=\d+/i.test(setCookie), setCookie)

const COOKIE = `instagram_oauth_state=${STATE}`

// ---------------------------------------------------------------------------
// Coming back
// ---------------------------------------------------------------------------

console.log('\n--- the state check is the whole defence of the callback ---')

const dbUp = await reachable()
const accountsNow = async () =>
  dbUp ? (await query('select count(*)::text as n from social_accounts'))[0].n : '0'

calls = []
const before = await accountsNow()

calls = []
const noCookie = await callback.GET(GET(`/api/social/instagram/callback?code=stolen&state=${STATE}`))
const noCookieAt = locationOf(noCookie)
ok('no state cookie, no connection', Boolean(noCookieAt.searchParams.get('error')),
   noCookieAt.searchParams.get('error') ?? '')
ok('and the code is never exchanged', calls.length === 0, `${calls.length} requests`)

calls = []
const wrongState = await callback.GET(
  GET('/api/social/instagram/callback?code=stolen&state=a-state-from-somewhere-else', { cookie: COOKIE }),
)
const wrongAt = locationOf(wrongState)
ok('a mismatched state is rejected', Boolean(wrongAt.searchParams.get('error')),
   wrongAt.searchParams.get('error') ?? '')
ok('nothing is exchanged for it',    calls.length === 0, `${calls.length} requests`)
ok('and it says so in words a person can act on',
   /start again/i.test(wrongAt.searchParams.get('error') ?? ''))
ok('nothing new is in the database', (await accountsNow()) === before,
   `${before} then ${await accountsNow()}`)

// A state of a different LENGTH must be rejected rather than throwing:
// `timingSafeEqual` throws on mismatched lengths, which is a 500 instead of a no.
calls = []
const shortState = await callback.GET(
  GET('/api/social/instagram/callback?code=stolen&state=x', { cookie: COOKIE }),
)
ok('a shorter state is refused, not a crash',
   Boolean(locationOf(shortState).searchParams.get('error')))
ok('and still nothing is exchanged',  calls.length === 0)
ok('an empty state is refused too',
   Boolean(locationOf(await callback.GET(GET('/api/social/instagram/callback?code=c&state=', { cookie: COOKIE })))
     .searchParams.get('error')))

console.log('\n--- a person who says no is not an error ---')
calls = []
const cancelled = await callback.GET(GET(
  '/api/social/instagram/callback?error=access_denied&error_reason=user_denied&error_description=Permissions+error.',
  { cookie: COOKIE },
))
const cancelAt = locationOf(cancelled)
ok('it is a redirect, not a 500',   cancelled.status >= 300 && cancelled.status < 400, String(cancelled.status))
ok('and it is marked as a cancel',  cancelAt.searchParams.get('cancelled') === '1')
ok('with Meta’s own words kept',    cancelAt.searchParams.get('error') === 'Permissions error.',
   cancelAt.searchParams.get('error') ?? '')
ok('and nothing was asked of Instagram', calls.length === 0)

// ---------------------------------------------------------------------------
// Everything below writes rows
// ---------------------------------------------------------------------------

const skip = async (why) => {
  console.log(`\n--- connecting, listing and publishing ---\nskipped: ${why}`)
  console.log(failed ? `\n${failed} failed` : '\nsocial routes: the handshake holds')
  process.exit(failed ? 1 : 0)
}
if (!dbUp) await skip('Postgres is not running (npm run db:up)')
if (!(await query(`select to_regclass('social_accounts') as t`))[0].t) {
  await skip('no social tables (npm run db:migrate)')
}

const MARK = 'zztest'
const CAMPAIGN = `${MARK}-routes`
const clean = async () => {
  await query('delete from social_accounts where external_id like $1', [`${MARK}%`])
  await query('delete from campaigns where id like $1', [`${MARK}%`])
}

/** Answers the three login calls as Instagram would, for one account. */
const loginAs = (userId, username, longToken) => (c) => {
  if (c.host === 'api.instagram.com') return { body: { access_token: TOKEN_SHORT, user_id: userId } }
  if (c.path === '/access_token') return { body: { access_token: longToken, expires_in: 5184000 } }
  if (c.path.endsWith('/me')) return { body: { user_id: userId, id: 'app-scoped-x', username } }
  return {}
}

try {
  await clean()

  console.log('\n--- a real handshake, all the way to one row ---')
  calls = []
  respond = loginAs(IG1, 'zztestshop', TOKEN_LONG)

  const done = await callback.GET(
    GET(`/api/social/instagram/callback?code=a-real-looking-code&state=${STATE}`, { cookie: COOKIE }),
  )
  const doneAt = locationOf(done)
  ok('it lands back on the accounts screen', doneAt.pathname === '/social', doneAt.pathname)
  // One, not two. Instagram Login grants exactly one account per consent — the
  // trade this project made to stop needing a Facebook Page at all.
  ok('one account is connected',             doneAt.searchParams.get('connected') === '1',
     doneAt.searchParams.get('connected') ?? '(none)')
  ok('named by its handle',                  doneAt.searchParams.get('names') === '@zztestshop',
     doneAt.searchParams.get('names') ?? '')

  const exchange = calls.find((c) => c.host === 'api.instagram.com')
  ok('the code is spent at api.instagram.com', !!exchange, calls.map((c) => c.host).join(','))
  // The same call as a GET is rejected in a way that reads like a bad secret.
  ok('as a POST',                        exchange?.method === 'POST', exchange?.method)
  ok('with the code',                    exchange?.params.code === 'a-real-looking-code')
  ok('and the redirect_uri sent again for Meta to compare',
     exchange?.params.redirect_uri === process.env.INSTAGRAM_REDIRECT_URI)

  // The short-lived token dies in about an hour — a connection that works during
  // the demo and is dead by the afternoon.
  const trade = calls.find((c) => c.path === '/access_token' && c.host === 'graph.instagram.com')
  ok('then traded for a sixty-day token', trade?.params.grant_type === 'ig_exchange_token',
     JSON.stringify(trade?.params ?? {}))
  ok('spending the short one',           trade?.params.access_token === TOKEN_SHORT)
  ok('and it is the LONG token /me is read with',
     calls.find((c) => c.path.endsWith('/me'))?.params.access_token === TOKEN_LONG)
  ok('no call went to facebook.com',     !calls.some((c) => c.host.endsWith('facebook.com')),
     calls.map((c) => c.host).join(','))

  const store = await import('../lib/social/store.ts')
  ok('the account is a row',
     (await store.accounts()).some((a) => a.id === IG1_ID),
     (await store.accounts()).map((a) => a.id).join(', '))
  ok('with the long-lived token, which is what publishes it',
     (await store.tokenFor(IG1_ID)) === TOKEN_LONG)
  ok('and the token is encrypted at rest',
     !(await query('select token_cipher from social_accounts where id = $1', [IG1_ID]))[0]
        .token_cipher.includes(TOKEN_LONG.slice(0, 16)))

  console.log('\n--- a second account is a second consent ---')
  const second = await handshake()
  calls = []
  respond = loginAs(IG2, 'zztestshop2', TOKEN_LONG_2)
  const done2 = await callback.GET(
    GET(`/api/social/instagram/callback?code=another-code&state=${second.state}`, { cookie: second.cookie }),
  )
  ok('it connects too', locationOf(done2).searchParams.get('connected') === '1')
  ok('as its own row',  (await store.accounts()).some((a) => a.id === IG2_ID))
  ok('with its own token', (await store.tokenFor(IG2_ID)) === TOKEN_LONG_2)

  console.log('\n--- the account list never carries a token ---')
  const listed = await accountsRoute.GET()
  const listedBody = await bodyOf(listed)
  // Both of the two this suite connected, not a total: another screen's fixture
  // accounts may be sitting in the same table, and asserting the count would
  // fail on somebody else's data rather than on this route's behaviour.
  const ids = JSON.parse(listedBody).accounts.map((a) => a.id)
  ok('both accounts are listed',  ids.includes(IG1_ID) && ids.includes(IG2_ID), ids.join(', '))
  ok('and no token is in the body', !listedBody.includes(TOKEN_LONG.slice(0, 16)))
  const cipher = (await query('select token_cipher from social_accounts where id = $1', [IG1_ID]))[0].token_cipher
  ok('nor the ciphertext',          !listedBody.includes(cipher.slice(0, 16)))

  console.log('\n--- what publishing refuses before it spends anything ---')
  calls = []
  const noAccounts = await publish.POST(POST('/api/social/publish', { accountIds: [], caption: 'hello' }))
  ok('no accounts is a 400',      noAccounts.status === 400, String(noAccounts.status))
  ok('and says what to do',       /pick at least one/i.test(await bodyOf(noAccounts)))

  const blank = await publish.POST(POST('/api/social/publish', { accountIds: [IG1_ID], caption: '   ' }))
  ok('a blank caption is a 400',  blank.status === 400, String(blank.status))
  ok('and says what to do',       /caption/i.test(await bodyOf(blank)))
  ok('neither reached the network', calls.length === 0, `${calls.length} requests`)

  // Instagram has no endpoint for a text-only post, so this cannot be made to
  // work by retrying. Finding out AFTER the image is on a paid host is the
  // expensive version of the same answer.
  calls = []
  const noImage = await publish.POST(POST('/api/social/publish', {
    accountIds: [IG1_ID], caption: 'a caption with no picture',
  }))
  ok('no image is a 400',                noImage.status === 400, String(noImage.status))
  ok('and says why in one sentence',     /will not accept/i.test(await bodyOf(noImage)))
  ok('and NOTHING was uploaded first',
     !calls.some((c) => c.host === 'api.cloudinary.com'), JSON.stringify(calls.map((c) => c.host)))
  ok('and no row was written for it',
     (await store.posts({ campaignId: CAMPAIGN })).length === 0)

  console.log('\n--- one account failing does not take the other with it ---')
  await query(`insert into campaigns (id, name) values ($1, 'zztest routes campaign')`, [CAMPAIGN])
  ok('the campaign to stamp is the newest', (await (await import('../lib/campaigns.ts')).current()) === CAMPAIGN)

  calls = []
  respond = (c) => {
    if (c.host === 'api.cloudinary.com') {
      return { body: { public_id: 'zztest/media-1', secure_url: 'https://res.cloudinary.test/zztest/media-1.png' } }
    }
    // The second account's token has expired — the realistic failure once a
    // connection is sixty days old — and Meta quotes the token back the way it
    // really does, which is what the scrub exists for.
    if (c.path.endsWith(`/${IG2}/media`)) {
      return { ok: false, status: 401, body: { error: {
        message: `Error validating access token: the session has expired (access_token=${TOKEN_LONG_2})`,
      } } }
    }
    if (c.params.fields === 'status_code') return { body: { status_code: 'FINISHED' } }
    if (c.params.fields === 'permalink') return { body: { permalink: 'https://ig.test/p/ZZZ' } }
    if (c.path.endsWith('/media_publish')) return { body: { id: 'MEDIA_9001' } }
    return { body: { id: 'CONTAINER_1' } }
  }

  const both = await publish.POST(POST('/api/social/publish', {
    accountIds: [IG1_ID, IG2_ID], caption: 'Back to school — laptops', skus: [`${MARK}-sku`],
    imageDataUrls: [PNG],
  }))
  const out = JSON.parse(await bodyOf(both))

  ok('the request itself succeeds',   both.status === 200, String(both.status))
  ok('one of the two went out',       out.published === 1, JSON.stringify(out.results?.map((r) => r.ok)))
  const first = out.results.find((r) => r.accountId === IG1_ID)
  const dead = out.results.find((r) => r.accountId === IG2_ID)
  ok('the screen is told the first worked', first?.ok === true)
  ok('with the media id',                   first?.platformPostId === 'MEDIA_9001', first?.platformPostId)
  ok('and a link',                          first?.permalinkUrl === 'https://ig.test/p/ZZZ')
  ok('and told the second did not',         dead?.ok === false)
  ok('with the platform’s own reason',      /session has expired/i.test(dead?.error ?? ''), dead?.error ?? '')
  // A long-lived token is a standing grant to post as the shop. Meta quotes the
  // request back inside some error bodies, and a result array is read on a
  // screen and pasted into a chat.
  ok('and the token scrubbed out of it',    !JSON.stringify(out).includes(TOKEN_LONG_2.slice(0, 16)))

  // Two accounts posting the same poster fetch the same URL; uploading per
  // account pays twice for one image.
  ok('the image was uploaded exactly once',
     calls.filter((c) => c.host === 'api.cloudinary.com').length === 1)
  ok('and Instagram was handed a URL, never the bytes',
     calls.find((c) => c.path.endsWith(`/${IG1}/media`))?.params.image_url
       === 'https://res.cloudinary.test/zztest/media-1.png')

  console.log('\n--- and both outcomes are in the history ---')
  const rows = await store.posts({ campaignId: CAMPAIGN })
  ok('two attempts were recorded',   rows.length === 2, String(rows.length))
  const posted = rows.find((r) => r.account_id === IG1_ID)
  const broke = rows.find((r) => r.account_id === IG2_ID)
  ok('the one that went out is posted', posted?.status === 'posted', posted?.status)
  ok('with the platform post id',       posted?.platform_post_id === 'MEDIA_9001')
  ok('and a time it went out',          posted?.posted_at !== null)
  ok('the one that did not is failed',  broke?.status === 'failed', broke?.status)
  ok('with the reason kept',            /session has expired/i.test(broke?.error ?? ''), broke?.error ?? '')
  ok('and no token in the stored reason', !(broke?.error ?? '').includes(TOKEN_LONG_2.slice(0, 16)))
  ok('and no time it went out',         broke?.posted_at === null)
  // The whole point of the loop: a report can say which of the promoted
  // products actually reached a customer.
  ok('both carry the current campaign', rows.every((r) => r.campaign_id === CAMPAIGN))
  ok('and the SKU they were about',     rows.every((r) => r.skus.join() === `${MARK}-sku`),
     JSON.stringify(rows.map((r) => r.skus)))
  ok('only what went out is counted',
     (await store.postedFor(CAMPAIGN)).get(`${MARK}-sku`) === 1)

  console.log('\n--- a carousel is one post carrying several products ---')
  // Three products, one caption, one post. The route renders each design, uploads
  // each once, and Instagram gets ONE media_publish — the failure this guards
  // against is three separate posts under a button that promised one.
  calls = []
  let child = 0
  respond = (c) => {
    if (c.host === 'api.cloudinary.com') {
      return { body: { public_id: `zztest/carousel-${++child}`, secure_url: `https://res.cloudinary.test/zztest/carousel-${child}.png` } }
    }
    if (c.params.fields === 'status_code') return { body: { status_code: 'FINISHED' } }
    if (c.params.fields === 'permalink') return { body: { permalink: 'https://ig.test/p/CAR' } }
    if (c.path.endsWith('/media_publish')) return { body: { id: 'MEDIA_CAROUSEL' } }
    if (c.params.media_type === 'CAROUSEL') return { body: { id: 'PARENT' } }
    return { body: { id: `container${child}` } }
  }

  const CAR = [`${MARK}-sku`, `${MARK}-sku-2`, `${MARK}-sku-3`]
  const carousel = await publish.POST(POST('/api/social/publish', {
    accountIds: [IG2_ID], caption: 'Three in one', skus: CAR,
    imageDataUrls: [PNG, PNG, PNG],
  }))
  const carOut = JSON.parse(await bodyOf(carousel))
  ok('the carousel publishes',        carOut.published === 1, JSON.stringify(carOut.results?.map((r) => r.ok)))
  ok('as ONE post, not three',        calls.filter((c) => c.path.endsWith('/media_publish')).length === 1,
     String(calls.filter((c) => c.path.endsWith('/media_publish')).length))
  ok('with three child containers',   calls.filter((c) => c.params.is_carousel_item === 'true').length === 3)
  // The caption belongs to the parent; on a child it is silently discarded.
  ok('the caption is on the parent',  calls.find((c) => c.params.media_type === 'CAROUSEL')?.params.caption === 'Three in one')
  ok('and on no child',               calls.filter((c) => c.params.is_carousel_item === 'true').every((c) => c.params.caption === undefined))
  ok('three images were uploaded',    calls.filter((c) => c.host === 'api.cloudinary.com').length === 3)

  const carRow = (await store.posts({ campaignId: CAMPAIGN })).find((r) => r.platform_post_id === 'MEDIA_CAROUSEL')
  ok('one row, not three',            Boolean(carRow), 'no row with that platform id')
  ok('carrying all three products',   carRow?.skus.join() === CAR.join(), JSON.stringify(carRow?.skus))
  // The whole reason the column is a list: a carousel promoted every product in it.
  const carCounts = await store.postedFor(CAMPAIGN)
  ok('every product in it is counted', CAR.every((one) => (carCounts.get(one) ?? 0) >= 1),
     JSON.stringify([...carCounts]))

  // Eleven is refused before anything is rendered or uploaded, not after.
  calls = []
  const tooMany = await publish.POST(POST('/api/social/publish', {
    accountIds: [IG2_ID], caption: 'too many',
    skus: Array.from({ length: 11 }, (_, i) => `${MARK}-over-${i}`), templateId: 'brand-poster',
  }))
  ok('more than ten is a 400',        tooMany.status === 400, String(tooMany.status))
  ok('and nothing was uploaded',      !calls.some((c) => c.host === 'api.cloudinary.com'))
  console.log('\n--- disconnecting ---')
  ok('an id nobody connected is a 404',
     (await accountsRoute.DELETE(DEL('/api/social/accounts?id=instagram:zztest-nobody'))).status === 404)
  ok('asking without an id is a 400',
     (await accountsRoute.DELETE(DEL('/api/social/accounts'))).status === 400)
  ok('the account goes',
     (await accountsRoute.DELETE(DEL(`/api/social/accounts?id=${IG1_ID}`))).status === 200)
  ok('and its history goes with it',
     (await query('select 1 from social_posts where account_id = $1', [IG1_ID])).length === 0)
} finally {
  await clean()
}

// ---------------------------------------------------------------------------

console.log('\n--- no response carried a secret ---')
// Every body and every redirect target this suite produced, swept for each
// invented credential. A token that reaches a screen or a log is remedied by
// revoking it and reconnecting, not by editing a string — so the assertion is
// on the responses themselves rather than on anyone's care.
const all = bodies.join('\n')
for (const [what, needle] of [
  ['a long-lived token', TOKEN_LONG.slice(0, 16)],
  ['the second account’s token', TOKEN_LONG_2.slice(0, 16)],
  ['the short-lived token', TOKEN_SHORT],
  ['the Instagram app secret', process.env.INSTAGRAM_APP_SECRET],
  ['the Cloudinary secret', process.env.CLOUDINARY_API_SECRET],
  ['the encryption key', KEY],
]) {
  ok(`no response body contains ${what}`, !all.includes(needle))
}

console.log(failed ? `\n${failed} failed` : '\nsocial routes: the handshake holds and the failures are per account')
process.exit(failed ? 1 : 0)
