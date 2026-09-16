// The template editor's route, and the chat route's conversation id.
//
// Both are id-as-filename: `/api/templates/<id>` joins the segment straight into
// data/templates, and a chat id is the name of a file under data/state/chat.
// Next fully percent-decodes a dynamic segment before the handler sees it, so
// `..%2F..%2F…` arrives as a real `../`. Nothing here needs Postgres, Ollama or
// a server — the handlers are called directly with constructed Requests, the
// same way test-social-routes.mjs does it.
//
// The probe is a real, readable template deliberately placed OUTSIDE
// data/templates. Without it a 404 proves nothing: every id would 404 anyway.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

let failed = 0
const ok = (label, cond, detail = '') => {
  if (!cond) failed++
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `   ${detail}` : ''}`)
}

const templates = await import('../app/api/templates/[id]/route.ts')

const ctx = (id) => ({ params: Promise.resolve({ id }) })
const get = (id) => templates.GET(new Request('http://localhost/api/templates/x'), ctx(id))
const put = (id, body) => templates.PUT(
  new Request('http://localhost/api/templates/x', {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }), ctx(id))
const post = (id, body) => templates.POST(
  new Request('http://localhost/api/templates/x', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }), ctx(id))
const del = (id) => templates.DELETE(new Request('http://localhost/api/templates/x'), ctx(id))

// A well-formed save. The traversal cases must be refused on the id, not on the
// body — a 400 for a missing layout would hide whether the guard ran at all.
const SAVE = {
  boxes: [{ id: 'name', x: 0, y: 0, width: 10, height: 10 }],
  manifest: { v: 1, name: 'Overwritten by a traversal', slots: [] },
}

const PROBE = 'zz-traversal-probe'
const probeAt = join(root, 'data/state', PROBE)
const ID = `../state/${PROBE}`
const SVG = '<svg width="100" height="100"></svg>'
const JSON_ = JSON.stringify({ v: 1, name: 'Probe', slots: [] })

mkdirSync(join(root, 'data/state'), { recursive: true })
try {
  writeFileSync(`${probeAt}.svg`, SVG)
  writeFileSync(`${probeAt}.json`, JSON_)
  writeFileSync(`${probeAt}.overrides.json`, '{}')

  console.log('\n--- the traversal actually reaches something ---')
  // If this fails the three assertions below are vacuous: they would be 404ing
  // on an id that pointed at nothing in the first place.
  ok('the traversal id resolves to a real file outside data/templates',
     existsSync(join(root, 'data/templates', `${ID}.svg`)) &&
     existsSync(join(root, 'data/templates', `${ID}.json`)),
     join(root, 'data/templates', `${ID}.svg`))

  console.log('\n--- a template id is a filename, not a path ---')
  const read = await get(ID)
  ok('a traversal id reads nothing', read.status === 404,
     JSON.stringify(await read.clone().json()))

  const wrote = await put(ID, SAVE)
  ok('a traversal id refuses to write', wrote.status === 404, String(wrote.status))
  ok('and the file it aimed at is untouched',
     readFileSync(`${probeAt}.svg`, 'utf8') === SVG &&
     readFileSync(`${probeAt}.json`, 'utf8') === JSON_)

  const previewed = await post(ID, SAVE)
  ok('a traversal id previews nothing', previewed.status === 404, String(previewed.status))

  const deleted = await del(ID)
  ok('a traversal id deletes nothing', deleted.status === 404, String(deleted.status))
  ok('and all three of its files are still there',
     existsSync(`${probeAt}.svg`) && existsSync(`${probeAt}.json`) &&
     existsSync(`${probeAt}.overrides.json`))

  console.log('\n--- and an ordinary id still gets through ---')
  // A malformed body reaches the body check, which means the id guard let it
  // past. If the guard were rejecting well-formed ids this would be a 404.
  const ordinary = await put('zz-not-a-real-template', {})
  ok('a legitimate id reaches the handler', ordinary.status === 400, String(ordinary.status))
  ok('the guard runs before the body is read',
     (await put(ID, {})).status === 404)
  ok('an absolute id reads nothing', (await get('/etc/passwd')).status === 404)
  ok('the refusal reuses the existing 404, not a new error vocabulary',
     (await (await get(ID)).json()).error === (await (await del('zz-not-a-real-template')).json()).error)
} finally {
  for (const ext of ['svg', 'json', 'overrides.json']) rmSync(`${probeAt}.${ext}`, { force: true })
}

console.log('\n--- a conversation id is a credential ---')
const chat = await import('../app/api/chat/route.ts')

// GET /api/chat?id=… hands over a whole transcript with no ownership check,
// because this app has no user identity. That is only safe while the id cannot
// be guessed, so the mint is the fix.
const source = readFileSync(join(root, 'app/api/chat/route.ts'), 'utf8')
ok('a fresh conversation id is not derived from the clock',
   !source.includes('Date.now().toString(36)'))
ok('it is minted from crypto', /const id = conversationId \?\? randomUUID\(\)/.test(source))

// Existing conversations keep their old ids; 35 of them are on disk and seven
// are waiting on a person in the Inbox. Nothing may rename those.
ok('an old clock-derived id is still a valid id', /^[A-Za-z0-9_-]{1,64}$/.test('cmt1enql3'))
ok('a minted id is still a valid filename', /^[A-Za-z0-9_-]{1,64}$/.test(crypto.randomUUID()))

const asked = await chat.POST(new Request('http://localhost/api/chat', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ question: 'How much is the Apple Pencil?', conversationId: '../../../etc/passwd' }),
}))
// Returning at all is the assertion. Below the guard this ran a retrieval and a
// 300-second model call before save() threw the id back out as a 500.
ok('a traversal conversation id never reaches the model', asked.status === 404,
   JSON.stringify(await asked.clone().json()))
ok('no file was created for it',
   !existsSync(join(root, 'data/state/chat/../../../etc/passwd.json')))

console.log(`\n${failed ? `${failed} FAILED` : 'route id guards hold'}`)
process.exit(failed ? 1 : 0)
