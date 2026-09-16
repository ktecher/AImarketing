// Publishing to Instagram, and the image host that exists only because Meta
// fetches images from a public URL rather than accepting bytes.
//
// Entirely offline. `fetch` is replaced with a recorder, so what is asserted is
// the REQUEST that would have been made — which is the part that is easy to get
// wrong and impossible to check by reading. Nothing here touches the network, no
// token is real, and the file is safe to run on a plane.
//
// The host each call goes to is asserted as carefully as its params. D86 moved
// this off Graph onto three Instagram hosts, and Meta really does split the
// login between two of them: a call sent to the wrong one fails with a message
// about the client secret, which sends whoever is debugging to the wrong file.
import { createHash } from 'node:crypto'

const {
  publishToInstagram, authorizeUrl, exchangeCodeForToken, longLivedToken,
  profile, cleanCode, PUBLISH_SCOPES,
} = await import('../lib/social/instagram.ts')

let failed = 0
const ok = (label, cond, detail = '') => {
  if (!cond) failed++
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `   ${detail}` : ''}`)
}

/** Whatever a real token looks like, this one must never come back out. */
const TOKEN = 'IGAA-pretend-long-lived-token-0123456789'
const IMG = (n) => `https://res.cloudinary.test/aimarketing/img${n}.png`

// ---------------------------------------------------------------------------
// The recorder
// ---------------------------------------------------------------------------

let calls = []
let respond = () => ({})

globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url))
  // A POST carries its params in a form-encoded body; a GET carries them in the
  // query string. Both are read the same way so an assertion does not have to
  // care which verb the endpoint uses.
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

// Container polling waits two seconds between attempts, and the bounded-retry
// test deliberately exhausts all ten of them. Firing the timer immediately keeps
// the asynchrony — and therefore the ordering being asserted — exactly as it is
// in production, without spending twenty real seconds to prove it.
const realSetTimeout = globalThis.setTimeout
globalThis.setTimeout = (fn, _ms, ...rest) => realSetTimeout(fn, 0, ...rest)

const threw = async (fn) => {
  try {
    await fn()
    return null
  } catch (e) {
    return e
  }
}

// ---------------------------------------------------------------------------
// The login
// ---------------------------------------------------------------------------

console.log('\n--- the dialog is a URL for a browser, not a request ---')
calls = []
const dialog = new URL(authorizeUrl({
  clientId: 'app-id-1', redirectUri: 'http://localhost:3000/api/social/instagram/callback',
  state: 'a-random-state',
}))
ok('nothing is fetched to build it', calls.length === 0, `${calls.length} requests`)
// Neither API host serves the dialog. Sending a person to graph.instagram.com is
// a 404 they cannot act on.
ok('it points at www.instagram.com', dialog.host === 'www.instagram.com', dialog.host)
ok('at the authorize path',          dialog.pathname === '/oauth/authorize', dialog.pathname)
ok('carrying the app id',            dialog.searchParams.get('client_id') === 'app-id-1')
ok('the redirect it comes back to',
   dialog.searchParams.get('redirect_uri') === 'http://localhost:3000/api/social/instagram/callback')
ok('a code, not a token, is asked for', dialog.searchParams.get('response_type') === 'code')
ok('and the state travels with it',  dialog.searchParams.get('state') === 'a-random-state')

const asked = (dialog.searchParams.get('scope') ?? '').split(',')
ok('the basic scope is asked for',   asked.includes('instagram_business_basic'), asked.join(','))
ok('and the publishing one',         asked.includes('instagram_business_content_publish'))
// A scope nobody uses is a permission the shop granted for nothing, and changing
// this list re-prompts every connected account.
ok('and nothing beyond them',        asked.length === PUBLISH_SCOPES.length, asked.join(','))
ok('no Page scope survives the move off Graph',
   !asked.some((s) => s.startsWith('pages_')), asked.join(','))

console.log('\n--- Meta’s trailing #_ is not part of the code ---')
// A code carrying it is rejected as invalid, which reads exactly like a replayed
// code and sends whoever is debugging to the state check instead.
ok('it is stripped',        cleanCode('AQB123#_') === 'AQB123')
ok('a clean code is left alone', cleanCode('AQB123') === 'AQB123')
ok('and a # inside one is kept', cleanCode('AQ#B123') === 'AQ#B123')

console.log('\n--- the code is spent at api.instagram.com, as a POST ---')
calls = []
respond = () => ({ body: { access_token: 'short-lived', user_id: 17841400000000000, permissions: [] } })
const short = await exchangeCodeForToken({
  clientId: 'app-id-1', clientSecret: 'app-secret-1',
  redirectUri: 'http://localhost:3000/api/social/instagram/callback', code: 'the-code',
})
const exchange = calls[0]
ok('on the oauth host',      exchange.host === 'api.instagram.com', exchange.host)
ok('at the token path',      exchange.path === '/oauth/access_token', exchange.path)
// The same call as a GET is rejected in a way that reads like a bad secret.
ok('as a POST',              exchange.method === 'POST', exchange.method)
ok('with the code',          exchange.params.code === 'the-code')
ok('and grant_type',         exchange.params.grant_type === 'authorization_code')
// Meta compares it against the one the code was issued for. It is the check that
// stops a code stolen from a log being spent elsewhere.
ok('and the redirect_uri again for Meta to compare',
   exchange.params.redirect_uri === 'http://localhost:3000/api/social/instagram/callback')
ok('the token comes back',   short.token === 'short-lived')
// Numeric in the JSON, and a number silently becomes "1.78414e+16" in a URL.
ok('and the id as a string', short.userId === '17841400000000000', short.userId)

console.log('\n--- and immediately traded for a sixty-day one ---')
calls = []
respond = () => ({ body: { access_token: 'long-lived', expires_in: 5184000 } })
const long = await longLivedToken({ clientSecret: 'app-secret-1', token: 'short-lived' })
const trade = calls[0]
// A different host from the exchange above. Meta really does split them.
ok('on the graph host',   trade.host === 'graph.instagram.com', trade.host)
ok('unversioned',         trade.path === '/access_token', trade.path)
ok('with the ig grant',   trade.params.grant_type === 'ig_exchange_token', trade.params.grant_type)
ok('spending the short token', trade.params.access_token === 'short-lived')
ok('and a long one comes back', long === 'long-lived')

console.log('\n--- who the token posts as ---')
calls = []
respond = () => ({ body: { user_id: 17841400000000000, id: '999-app-scoped', username: 'retailerkw' } })
const me = await profile(TOKEN)
ok('read from /me',       calls[0].path.endsWith('/me'), calls[0].path)
ok('on the graph host',   calls[0].host === 'graph.instagram.com', calls[0].host)
ok('with the version pinned', /\/v\d+\.\d+\//.test(calls[0].path), calls[0].path)
ok('asking for both fields', calls[0].params.fields === 'user_id,username', calls[0].params.fields)
// `id` is the app-scoped one and addressing /media with it is a "does not exist".
ok('user_id wins over id', me.userId === '17841400000000000', me.userId)
ok('and the handle comes back', me.username === 'retailerkw')

// ---------------------------------------------------------------------------
// Publishing
// ---------------------------------------------------------------------------

console.log('\n--- Instagram rejects text-only posts, and says so before any request ---')
calls = []
respond = () => ({})
const noImage = await threw(() =>
  publishToInstagram({ igUserId: 'IG', token: TOKEN, caption: 'Just words', imageUrls: [] }))
ok('it throws', noImage !== null)
ok('and names the reason', /text-only/i.test(noImage?.message ?? ''), noImage?.message)
ok('without asking Meta first', calls.length === 0, String(calls.length))

console.log('\n--- Instagram: one image is a container, then a publish ---')
calls = []
respond = (c) => {
  if (c.params.fields === 'status_code') return { body: { status_code: 'FINISHED' } }
  if (c.params.fields === 'permalink') return { body: { permalink: 'https://ig.test/p/AAA' } }
  if (c.path.endsWith('/media_publish')) return { body: { id: 'MEDIA_1' } }
  return { body: { id: 'CONTAINER_1' } }
}
const igOne = await publishToInstagram({
  igUserId: 'IG', token: TOKEN, caption: 'One', imageUrls: [IMG(1)],
})
const container = calls[0]
ok('a container is created first', container.path.endsWith('/IG/media'), container.path)
ok('on the graph host',           container.host === 'graph.instagram.com', container.host)
ok('with the version pinned',     container.path.startsWith('/v'), container.path)
ok('from a public image url',     container.params.image_url === IMG(1))
ok('with the caption on it',      container.params.caption === 'One')
// Every publishing call is a POST; a GET to /media creates nothing and returns
// an empty edge, which reads as "Instagram accepted it and did nothing".
ok('every publishing call is a POST',
   calls.filter((c) => c.path.endsWith('/media') || c.path.endsWith('/media_publish'))
        .every((c) => c.method === 'POST'))
// Nothing in this project talks to Graph any more.
ok('no call goes to facebook.com', !calls.some((c) => c.host.endsWith('facebook.com')),
   calls.map((c) => c.host).join(','))
const publishCall = calls.find((c) => c.path.endsWith('/media_publish'))
ok('then media_publish is called', !!publishCall)
ok('with that container as creation_id', publishCall?.params.creation_id === 'CONTAINER_1', publishCall?.params.creation_id)
ok('the media id comes back', igOne.platformPostId === 'MEDIA_1')
ok('and the permalink is resolved', igOne.permalinkUrl === 'https://ig.test/p/AAA')

console.log('\n--- Instagram: several images are a CAROUSEL of children ---')
calls = []
let child = 0
respond = (c) => {
  if (c.params.fields === 'status_code') return { body: { status_code: 'FINISHED' } }
  if (c.params.fields === 'permalink') return { body: { permalink: 'https://ig.test/p/BBB' } }
  if (c.path.endsWith('/media_publish')) return { body: { id: 'MEDIA_2' } }
  if (c.params.media_type === 'CAROUSEL') return { body: { id: 'PARENT' } }
  return { body: { id: `child${++child}` } }
}
await publishToInstagram({
  igUserId: 'IG', token: TOKEN, caption: 'Two', imageUrls: [IMG(1), IMG(2)],
})
const children = calls.filter((c) => c.params.is_carousel_item === 'true')
ok('one child container per image', children.length === 2, String(children.length))
ok('each marked a carousel item', children.every((c) => c.params.is_carousel_item === 'true'))
// A caption on a carousel item is silently discarded, so it must be on the parent.
ok('no caption on a child', children.every((c) => c.params.caption === undefined))
const waits = calls.filter((c) => c.params.fields === 'status_code')
ok('every child is waited for, and the parent too', waits.length === 3, String(waits.length))
const parent = calls.find((c) => c.params.media_type === 'CAROUSEL')
ok('the parent references both children in order', parent?.params.children === 'child1,child2', parent?.params.children)
ok('and carries the caption', parent?.params.caption === 'Two')

console.log('\n--- a container that will never be ready is not published ---')
for (const status of ['ERROR', 'EXPIRED']) {
  calls = []
  respond = (c) =>
    c.params.fields === 'status_code'
      ? { body: { status_code: status } }
      : { body: { id: 'CONTAINER_X' } }
  const err = await threw(() =>
    publishToInstagram({ igUserId: 'IG', token: TOKEN, caption: 'x', imageUrls: [IMG(1)] }))
  ok(`a ${status} container throws`, err !== null)
  ok(`  and says ${status}`, (err?.message ?? '').includes(status), err?.message)
  // Publishing an unready container yields a broken post nobody sees until a
  // customer does. Not publishing at all is the correct failure.
  ok('  and nothing is published', !calls.some((c) => c.path.endsWith('/media_publish')))
}

console.log('\n--- polling gives up rather than hanging forever ---')
calls = []
respond = (c) =>
  c.params.fields === 'status_code'
    ? { body: { status_code: 'IN_PROGRESS' } }
    : { body: { id: 'CONTAINER_Y' } }
const stuck = await threw(() =>
  publishToInstagram({ igUserId: 'IG', token: TOKEN, caption: 'x', imageUrls: [IMG(1)] }))
ok('it throws', stuck !== null)
ok('saying it timed out', /timed out/i.test(stuck?.message ?? ''), stuck?.message)
ok('after a bounded number of attempts',
   calls.filter((c) => c.params.fields === 'status_code').length === 10,
   String(calls.filter((c) => c.params.fields === 'status_code').length))
ok('and never publishes', !calls.some((c) => c.path.endsWith('/media_publish')))

console.log('\n--- a published post survives a permalink lookup that fails ---')
// By that point the post IS published. Propagating the failure makes the caller
// retry and publish the same thing twice.
calls = []
respond = (c) => {
  if (c.params.fields === 'status_code') return { body: { status_code: 'FINISHED' } }
  if (c.params.fields === 'permalink') return { ok: false, status: 500, body: {} }
  if (c.path.endsWith('/media_publish')) return { body: { id: 'MEDIA_3' } }
  return { body: { id: 'CONTAINER_3' } }
}
const noLink = await publishToInstagram({
  igUserId: 'IG', token: TOKEN, caption: 'x', imageUrls: [IMG(1)],
})
ok('the post id still comes back', noLink.platformPostId === 'MEDIA_3')
ok('with an empty link rather than a throw', noLink.permalinkUrl === '')

console.log('\n--- the token never comes back out in an error ---')
// Meta quotes the offending request back inside some error bodies. A token that
// reaches a log file or a staff screen has to be revoked, not edited — so the
// worst case is asserted directly: Meta hands us the token in its message.
calls = []
respond = () => ({
  ok: false,
  status: 400,
  body: { error: { message: `Invalid OAuth access token: ${TOKEN} cannot be parsed.` } },
})
const leaked = await threw(() =>
  publishToInstagram({ igUserId: 'IG', token: TOKEN, caption: 'x', imageUrls: [IMG(1)] }))
ok('the call fails', leaked !== null)
ok('the token is NOT in the message', !(leaked?.message ?? '').includes(TOKEN), leaked?.message)
ok('it is redacted, not silently dropped', (leaked?.message ?? '').includes('[token redacted]'), leaked?.message)

console.log('\n--- nor the client secret, which only the login sends ---')
calls = []
respond = () => ({
  ok: false, status: 400,
  body: { error_message: 'Invalid client_secret=app-secret-1', error_type: 'OAuthException' },
})
const secretLeak = await threw(() => exchangeCodeForToken({
  clientId: 'app-id-1', clientSecret: 'app-secret-1',
  redirectUri: 'http://localhost/cb', code: 'c',
}))
ok('the exchange fails', secretLeak !== null)
ok('the secret is redacted', !(secretLeak?.message ?? '').includes('app-secret-1'), secretLeak?.message)
// api.instagram.com answers with a flat `error_message`, not `{error:{message}}`.
// Reading only the nested shape turns a wrong secret into "request failed (400)".
ok('and the flat error shape is still read',
   /invalid client_secret/i.test(secretLeak?.message ?? ''), secretLeak?.message)

console.log('\n--- an Instagram error reaches the person who pressed publish ---')
calls = []
respond = () => ({
  ok: false,
  status: 403,
  body: { error: { message: '(#200) The user lacks instagram_business_content_publish.' } },
})
const denied = await threw(() =>
  publishToInstagram({ igUserId: 'IG', token: TOKEN, caption: 'x', imageUrls: [IMG(1)] }))
ok('the message is what surfaces',
   denied?.message === '(#200) The user lacks instagram_business_content_publish.', denied?.message)
ok('it is an InstagramError', denied?.name === 'InstagramError', denied?.name)

// ---------------------------------------------------------------------------
// Meta could not fetch the image
//
// The error it sends for this names the wrong thing: `message` reads "Only photo
// or video can be accepted as media type." while `error_user_msg` says the URI
// could not be fetched. Measured against the live API on 2026-09-16 — the same
// URL was accepted and then refused minutes apart, both with
// `is_transient: false`, which is why this is retried and why the real reason
// has to survive as far as the screen.
// ---------------------------------------------------------------------------

const FETCH_FAILED = {
  ok: false,
  status: 400,
  body: {
    error: {
      message: 'Only photo or video can be accepted as media type.',
      type: 'OAuthException',
      code: 9004,
      error_subcode: 2207052,
      is_transient: false,
      error_user_msg: 'Could not retrieve media from this URI: https://res.cloudinary.test/x.png.',
    },
  },
}

console.log('\n--- the reason Meta actually gave survives to the message ---')
calls = []
respond = () => FETCH_FAILED
const fetchFail = await threw(() =>
  publishToInstagram({ igUserId: 'IG', token: TOKEN, caption: 'x', imageUrls: [IMG(1)] }))
// Without this, the screen says "media type" and the next person spends the
// afternoon re-encoding a PNG that was never the problem.
ok('the real cause is in it',
   /could not retrieve media/i.test(fetchFail?.message ?? ''), fetchFail?.message)
ok('Meta’s own wording is kept too',
   /only photo or video/i.test(fetchFail?.message ?? ''))
ok('and the subcode, which is greppable',
   /9004\/2207052/.test(fetchFail?.message ?? ''))
ok('the codes are on the error, not only in prose',
   fetchFail?.code === 9004 && fetchFail?.subcode === 2207052,
   `${fetchFail?.code}/${fetchFail?.subcode}`)
ok('no token rides along',
   !(fetchFail?.message ?? '').includes(TOKEN))

console.log('\n--- a failed fetch is retried, a refusal is not ---')
calls = []
respond = () => FETCH_FAILED
await threw(() =>
  publishToInstagram({ igUserId: 'IG', token: TOKEN, caption: 'x', imageUrls: [IMG(1)] }))
const creates = calls.filter((c) => c.path.endsWith('/media') && c.method === 'POST')
ok('the container is attempted three times', creates.length === 3, `${creates.length}`)
ok('and every attempt carries the same image', creates.every((c) => c.params.image_url === IMG(1)))

calls = []
let attempt = 0
// Meta refused once, then fetched it. This is the case the retry exists for, and
// the post must go out rather than be reported as failed.
respond = (c) => {
  if (c.path.endsWith('/media') && c.method === 'POST') {
    attempt++
    return attempt === 1 ? FETCH_FAILED : { body: { id: 'container-1' } }
  }
  if (c.path.endsWith('/media_publish')) return { body: { id: 'post-1' } }
  if (c.params.fields === 'status_code') return { body: { status_code: 'FINISHED' } }
  return { body: { permalink: 'https://www.instagram.com/p/abc/' } }
}
const recovered = await publishToInstagram({
  igUserId: 'IG', token: TOKEN, caption: 'x', imageUrls: [IMG(1)],
})
ok('a second attempt publishes', recovered?.platformPostId === 'post-1', recovered?.platformPostId)
ok('after exactly two container attempts',
   calls.filter((c) => c.path.endsWith('/media') && c.method === 'POST').length === 2)

calls = []
// A revoked permission fails the same way three times over, and three times the
// wait before anybody is told. Only the fetch failure is worth repeating.
respond = () => ({
  ok: false, status: 403,
  body: { error: { message: '(#200) The user lacks instagram_business_content_publish.', code: 200 } },
})
await threw(() =>
  publishToInstagram({ igUserId: 'IG', token: TOKEN, caption: 'x', imageUrls: [IMG(1)] }))
ok('a permission error is attempted once, not three times',
   calls.filter((c) => c.path.endsWith('/media') && c.method === 'POST').length === 1)

// ---------------------------------------------------------------------------
// Cloudinary — the public image host Instagram fetches from
// ---------------------------------------------------------------------------

const { upload, remove } = await import('../lib/social/cloudinary.ts')

const SECRET = 'pretend-api-secret'
process.env.CLOUDINARY_CLOUD_NAME = 'testcloud'
process.env.CLOUDINARY_API_KEY = '123456789'
process.env.CLOUDINARY_API_SECRET = SECRET

const sha1 = (s) => createHash('sha1').update(s).digest('hex')

console.log('\n--- Cloudinary: an upload is signed over the right params ---')
calls = []
respond = () => ({ body: { public_id: 'aimarketing/abc', secure_url: 'https://res.test/abc.png' } })
const up = await upload(new Uint8Array([1, 2, 3]), { folder: 'aimarketing' })
ok('it returns the https url', up.url === 'https://res.test/abc.png')
ok('and the public id', up.publicId === 'aimarketing/abc')
const uc = calls[0]
ok('posting to the cloud’s upload endpoint', uc.path === '/v1_1/testcloud/image/upload', uc.path)
ok('the bytes are the file field', uc.params.file === '<bytes>')
// Cloudinary signs `folder` and `timestamp` only. An extra field in the digest
// produces a mismatch with no hint as to which one caused it.
ok('the signature covers folder and timestamp',
   uc.params.signature === sha1(`folder=aimarketing&timestamp=${uc.params.timestamp}` + SECRET),
   uc.params.signature)
ok('the api key is sent', uc.params.api_key === '123456789')
ok('the SECRET is not sent in any field',
   !Object.values(uc.params).some((v) => String(v).includes(SECRET)), JSON.stringify(uc.params))

console.log('\n--- Cloudinary: a delete is signed over the public id ---')
calls = []
respond = () => ({ body: { result: 'ok' } })
await remove('aimarketing/abc')
const dc = calls[0]
ok('posting to the destroy endpoint', dc.path === '/v1_1/testcloud/image/destroy', dc.path)
ok('the signature covers public_id and timestamp',
   dc.params.signature === sha1(`public_id=aimarketing/abc&timestamp=${dc.params.timestamp}${SECRET}`),
   dc.params.signature)
ok('the SECRET is not sent in any field',
   !Object.values(dc.params).some((v) => String(v).includes(SECRET)))

// Cleanup runs after a publish. An asset already gone is the state we asked for.
calls = []
respond = () => ({ body: { result: 'not found' } })
ok('an already-deleted asset is not an error', (await threw(() => remove('gone'))) === null)

console.log('\n--- a missing credential names itself ---')
// The code this was ported from asserted these with `!`, and a missing one
// surfaced as Cloudinary's "unknown api_key" several calls later.
delete process.env.CLOUDINARY_API_SECRET
const noSecret = await threw(() => upload(new Uint8Array([1])))
ok('a missing secret throws', noSecret !== null)
ok('naming the variable', (noSecret?.message ?? '').includes('CLOUDINARY_API_SECRET'), noSecret?.message)
ok('and never quoting a secret value', !(noSecret?.message ?? '').includes(SECRET))
process.env.CLOUDINARY_API_SECRET = SECRET

delete process.env.CLOUDINARY_CLOUD_NAME
const noCloud = await threw(() => upload(new Uint8Array([1])))
ok('a missing cloud name throws', noCloud !== null)
ok('naming the variable', (noCloud?.message ?? '').includes('CLOUDINARY_CLOUD_NAME'), noCloud?.message)
process.env.CLOUDINARY_CLOUD_NAME = 'testcloud'

console.log(`\n${failed ? `${failed} FAILED` : 'instagram and cloudinary checks hold'}`)
process.exit(failed ? 1 : 0)
