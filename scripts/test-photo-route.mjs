// The product-photo route: the third way out of this machine (D99).
//
// Entirely offline. `fetch` is replaced, so what is asserted is the REQUEST the
// route would have made and the answer it gives back for one it refuses. The
// model is never loaded — a cutout is five seconds of CPU and belongs in
// `npm run eval:cutout`, not in a suite that has to stay in seconds.
//
// The guards here are the whole point of the route. It fetches an address a
// person typed, which is the loosest exception rule 1 has, so every refusal is
// asserted by its own case rather than inferred from one.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'

let failed = 0
const ok = (label, cond, detail = '') => {
  if (!cond) failed++
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `   ${detail}` : ''}`)
}

const route = await import('../app/api/products/photo/route.ts')

const post = (body) => route.POST(new Request('http://localhost/api/products/photo', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}))
const json = async (res) => [res.status, await res.json().catch(() => ({}))]

/** A real PNG, because every check downstream decodes rather than trusts. */
const png = async (w, h) => await sharp({
  create: { width: w, height: h, channels: 3, background: { r: 10, g: 120, b: 200 } },
}).png().toBuffer()

const BIG = await png(1400, 1400)
const SMALL = await png(120, 120)

let served = { status: 200, type: 'image/png', body: BIG }
const calls = []
globalThis.fetch = async (url) => {
  calls.push(String(url))
  return {
    ok: served.status >= 200 && served.status < 300,
    status: served.status,
    headers: { get: (k) => (k.toLowerCase() === 'content-type' ? served.type : null) },
    arrayBuffer: async () => served.body,
  }
}

console.log('\n--- a SKU names a file here, so it may not be a path ---')
for (const sku of ['../../etc/passwd', 'a/b', '', 'x'.repeat(65)]) {
  const [status, d] = await json(await post({ sku, url: 'http://example.test/a.png' }))
  ok(`refused ${JSON.stringify(sku.slice(0, 18))}`, status === 400 && /usable SKU/.test(d.error ?? ''), String(status))
}
ok('and nothing was fetched for any of them', calls.length === 0, `${calls.length} requests`)

console.log('\n--- an address that is not the web ---')
for (const [url, expect] of [
  ['file:///etc/passwd', /not a web address/i],
  ['ftp://example.test/a.png', /not a web address/i],
  ['http://127.0.0.1:5434/', /this machine or this network/i],
  ['http://localhost:11434/a.png', /this machine or this network/i],
  ['http://192.168.1.4/a.png', /this machine or this network/i],
  ['http://10.0.0.9/a.png', /this machine or this network/i],
  ['http://172.16.3.2/a.png', /this machine or this network/i],
]) {
  const [status, d] = await json(await post({ sku: 'TEST-1', url }))
  ok(`refused ${url}`, status === 400 && expect.test(d.error ?? ''), d.error)
}
// The refusal has to happen BEFORE the request, or the guard is decoration.
ok('and still nothing was fetched', calls.length === 0, `${calls.length} requests`)

console.log('\n--- what came back has to be a photograph ---')
served = { status: 404, type: 'text/html', body: Buffer.alloc(0) }
let [status, d] = await json(await post({ sku: 'TEST-1', url: 'http://example.test/a.png' }))
ok('a 404 is reported with its status', status === 400 && /answered 404/.test(d.error ?? ''), d.error)

served = { status: 200, type: 'text/html', body: Buffer.from('<html>') }
;[status, d] = await json(await post({ sku: 'TEST-1', url: 'http://example.test/a.png' }))
ok('html is refused by type', status === 400 && /text\/html/.test(d.error ?? ''), d.error)

// An icon is exactly what a broken page serves, and it passes an `image/*` test.
served = { status: 200, type: 'image/svg+xml', body: Buffer.from('<svg/>') }
;[status, d] = await json(await post({ sku: 'TEST-1', url: 'http://example.test/a.svg' }))
ok('svg is refused although it is an image', status === 400 && /svg/.test(d.error ?? ''), d.error)

served = { status: 200, type: 'image/png', body: Buffer.from('not actually a png') }
;[status, d] = await json(await post({ sku: 'TEST-1', url: 'http://example.test/a.png' }))
ok('bytes that do not decode are refused', status === 400 && /could not be read/.test(d.error ?? ''), d.error)

console.log('\n--- size is judged by the decoder, never by the headers ---')
served = { status: 200, type: 'image/png', body: SMALL }
;[status, d] = await json(await post({ sku: 'TEST-1', url: 'http://example.test/a.png' }))
ok('a 120px image is refused', status === 400 && /120×120/.test(d.error ?? ''), d.error)
ok('and the refusal says what the poster needs', /at least 600/.test(d.error ?? ''), d.error)

served = { status: 200, type: 'image/png', body: BIG }
;[status, d] = await json(await post({ sku: 'TEST-1', url: 'http://example.test/a.png' }))
ok('a 1400px image is accepted', status === 200, String(status))
ok('with its real dimensions', d.width === 1400 && d.height === 1400, `${d.width}×${d.height}`)
ok('and is called HQ above 1200', d.hq === true, String(d.hq))
ok('the host it came from is named', d.from === 'example.test', d.from)
ok('the bytes come back for the screen', /^data:image\/png;base64,/.test(d.dataUrl ?? ''))

// The whole reason a candidate travels as bytes: the same url answered
// differently minutes apart when Meta's CDN did it (D98). Re-fetching at save
// time would store something nobody looked at.
console.log('\n--- nothing is stored by fetching ---')
const photo = join(process.cwd(), 'data/samples/images/TEST-1.png')
ok('no file was written for the candidate', !existsSync(photo))

console.log('\n--- saving stores the bytes the screen showed ---')
mkdirSync(join(process.cwd(), 'data/samples/images'), { recursive: true })
try {
  ;[status, d] = await json(await post({ sku: 'TEST-1', dataUrl: `data:image/png;base64,${BIG.toString('base64')}` }))
  ok('the save reports what is now stored', status === 200 && d.saved === true, String(status))
  ok('normalised to 600px, like every other path', d.width === 600 && d.height === 600, `${d.width}×${d.height}`)
  ok('and the file is really there', existsSync(photo))

  const before = calls.length
  ;[status, d] = await json(await post({ sku: 'TEST-1', dataUrl: 'data:image/png;base64,' }))
  ok('an empty image is refused', status === 400 && /empty/.test(d.error ?? ''), d.error)
  ok('and saving never fetches anything', calls.length === before, `${calls.length - before} requests`)
} finally {
  // From a finally, not the last line: a throw above would otherwise leave a
  // fake product's photo sitting in the real catalogue directory.
  rmSync(photo, { force: true })
}
ok('the test cleans up after itself', !existsSync(photo))

console.log('\n--- a cut request is not a save request ---')
// Both carry a dataUrl. Whichever branch is written first wins, and if saving
// wins, asking to remove a background silently stores the untouched image.
const src = readFileSync(join(process.cwd(), 'scripts/test-photo-route.mjs'), 'utf8')
const cutAt = src.indexOf('body.cut')
ok('this test knows which order to expect', cutAt > 0)
const routeSrc = readFileSync(join(process.cwd(), 'app/api/products/photo/route.ts'), 'utf8')
ok('the route checks cut before dataUrl',
   routeSrc.indexOf('if (body.cut)') < routeSrc.indexOf('if (body.dataUrl)'),
   `${routeSrc.indexOf('if (body.cut)')} < ${routeSrc.indexOf('if (body.dataUrl)')}`)

console.log(failed ? `\n${failed} failed` : '\nproduct photo route: the guards hold')
process.exit(failed ? 1 : 0)
