// A short name replaces the product's identity on a poster and in a caption.
// These are the checks that make a model allowed to propose one. No model runs
// here — the guard has to hold whatever it proposes.
const { checkName, nameBlockers, POSTER_MAX } = await import('../lib/content/names.ts')

const ok = (label, cond) => { console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}`); if (!cond) process.exitCode = 1 }

const PENCIL = { sku: '502037', name_en: 'Apple Pencil 1st generation, MK0C2AM/A - White' }
const HP1 = { sku: 'HP-1', name_en: 'HP Pavilion 15 Laptop, 16GB RAM, 512GB SSD - Silver' }
const HP2 = { sku: 'HP-2', name_en: 'HP Victus 16 Laptop, 32GB RAM, 1TB SSD - Black' }

const CATALOGUE = [
  { sku: '502037', name: 'Apple Pencil' },
  { sku: 'HP-1', name: 'HP Pavilion 15' },
  { sku: 'HP-2', name: 'HP Victus 16' },
]
const failed = (cand, product, others = CATALOGUE) =>
  nameBlockers(checkName(cand, product, others)).map((c) => c.name)
const passes = (cand, product, others = CATALOGUE) => failed(cand, product, others).length === 0

ok('a good short name passes',        passes('Apple Pencil', PENCIL))
ok('model code dropped is fine',      passes('HP Pavilion 15', HP1))

// The model selects from the title. It never adds to it.
ok('an invented word fails',          failed('Apple Pencil Pro', PENCIL).includes('every word comes from the product name'))
ok('the invented word is quoted',     checkName('Apple Pencil Pro', PENCIL, CATALOGUE)
                                        .find((c) => c.name === 'every word comes from the product name').span === 'pro')
ok('digits kept from the title pass', passes('HP Pavilion 15', HP1))
ok('an invented number fails',        failed('HP Pavilion 17', HP1).includes('every word comes from the product name'))
ok('reordering is allowed',           passes('Pencil Apple', PENCIL))
ok('punctuation is not a word',       passes('Apple Pencil - White', PENCIL))

const AT_LIMIT = 'Apple Pencil 1st generation MK0C2AM'      // exactly 35
const OVER_LIMIT = 'Apple Pencil 1st generation MK0C2AM White'  // 41
ok(`exactly ${POSTER_MAX} passes`,    AT_LIMIT.length === POSTER_MAX && passes(AT_LIMIT, PENCIL))
ok(`over ${POSTER_MAX} fails`,        failed(OVER_LIMIT, PENCIL).includes(`fits a poster (${POSTER_MAX} characters)`))
ok('length is reported',              checkName(OVER_LIMIT, PENCIL, CATALOGUE)
                                        .find((c) => c.name.startsWith('fits a poster')).span === '41 characters')
ok('same length as title fails',      failed(PENCIL.name_en, PENCIL).includes('shorter than the catalogue title'))

// The measured failure that killed mechanical shortening: cutting at the first
// comma gave two different laptops the same headline.
const COLLIDED = [{ sku: 'HP-1', name: 'HP Laptop' }, { sku: 'HP-2', name: 'HP Laptop' }]
ok('a shared name fails',             failed('HP Laptop', HP2, COLLIDED).includes('not shared with another product'))
ok('the clashing SKU is named',       checkName('HP Laptop', HP2, COLLIDED)
                                        .find((c) => c.name === 'not shared with another product').span === 'HP-1')
ok('case does not hide a clash',      failed('hp laptop', HP2, COLLIDED).includes('not shared with another product'))
ok('a product may keep its own name', passes('HP Pavilion 15', HP1))
// display_name is an English column; with no English title there is nothing to
// select from, and the message has to say that rather than blame every word.
ok('no English title says so',        checkName('ماك بوك', { sku: 'AR-1' }, [])
                                        .find((c) => c.name === 'every word comes from the product name')
                                        .hint.includes('no English name'))
ok('every check is binary',           checkName('Apple Pencil', PENCIL, CATALOGUE).every((c) => typeof c.pass === 'boolean'))
ok('no check carries a score',        !JSON.stringify(checkName('Apple Pencil', PENCIL, CATALOGUE)).match(/score|rating|grade/i))

// ---------------------------------------------------------------------------
// The request body, and what an unreadable one is allowed to start
//
// `lib/http.ts` is imported by 18 routes and had no test at all. `readJson`
// answers `{}` twice over: for a body that did not parse, and for a body that
// parsed fine and left a field out. Those are different facts, and three routes
// read an absent `skus` as "then do the whole catalogue".
//
// Measured against a running build on 2026-09-03, before the fix:
//   POST /api/export      --data 'not json'  -> 200, a 13 MB ZIP of 62 designs,
//                                               X-Recorded: 62 rows written
//   POST /api/render      --data 'not json'  -> 200, 62 rasterised PNGs
//   POST /api/names       --data 'not json'  -> no response in 30s; a full
//                                               catalogue model batch had started
//
// `readJsonStrict` hands back a ready-made 400 instead, the same shape
// `readForm` already used. The handlers are called directly with constructed
// `Request` objects, the way test-social-routes.mjs does it — the guard returns
// before any of them reaches Postgres or Ollama, so this stays offline.
// ---------------------------------------------------------------------------
const { readJson, readJsonStrict, isResponse } = await import('../lib/http.ts')

const req = (body) =>
  new Request('http://localhost/x', body === undefined ? { method: 'POST' } : { method: 'POST', body })
const said = async (res) => JSON.parse(await res.clone().text()).error

const onJunk = await readJsonStrict(req('not json'))
ok('junk body is refused',            isResponse(onJunk) && onJunk.status === 400)
ok('the refusal is a sentence',       /^[A-Z].*\.$/.test(await said(onJunk)))
ok('no body at all is refused',       isResponse(await readJsonStrict(req(undefined))))
ok('a bare string is refused',        isResponse(await readJsonStrict(req('"hello"'))))
// An array parses, but there is no `skus` to read off it — junk to every caller.
ok('a JSON array is refused',         isResponse(await readJsonStrict(req('[1,2]'))))

// The other half, and the one that must not regress: a VALID body keeps every
// default it had. `{}` is exactly what the Designs page POSTs to /api/names to
// mean "suggest for the ones that need it", and omitting `skus` on /api/export
// is how it asks for the whole sheet.
const empty = await readJsonStrict(req('{}'))
ok('an empty object is allowed',      !isResponse(empty) && Object.keys(empty).length === 0)
const picked = await readJsonStrict(req('{"skus":["502037"],"width":900}'))
ok('a real body passes through',      !isResponse(picked) && picked.skus[0] === '502037' && picked.width === 900)

// The 15 routes still on `readJson` are untouched — its contract did not move.
ok('readJson still answers {} ',      Object.keys(await readJson(req('not json'))).length === 0)

const routes = {
  'names POST':  (await import('../app/api/names/route.ts')).POST,
  'names PUT':   (await import('../app/api/names/route.ts')).PUT,
  'export POST': (await import('../app/api/export/route.ts')).POST,
  'render POST': (await import('../app/api/render/route.ts')).POST,
}
for (const [label, handler] of Object.entries(routes)) {
  const res = await handler(req('not json'))
  ok(`${label} refuses junk`,         res.status === 400)
  ok(`${label} says why`,             /json/i.test(await said(res)))
}

// And past the guard, on a body that parses: the route's own logic runs. Both
// of these reach the template lookup, which is before any database call — so a
// valid body is not being refused by the new check.
for (const [label, handler] of [['export POST', routes['export POST']], ['render POST', routes['render POST']]]) {
  const res = await handler(req('{"templateId":"no-such-template"}'))
  ok(`${label} lets a valid body in`, res.status === 404 && (await said(res)) === 'Template not found.')
}
