// The export is the only way copy leaves the system, so it is the last place a
// draft, a stale price, or a raw {placeholder} can escape. Built and read back,
// the same round-trip the blank-sheet test uses.
import ExcelJS from 'exceljs'
import { mkdirSync, writeFileSync, rmSync, existsSync, renameSync } from 'node:fs'

const ok = (label, cond) => { console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}`); if (!cond) process.exitCode = 1 }

// Swap the real store aside so this never reads or writes somebody's real work.
const DIR = 'data/state/content'
const STASH = 'data/state/content.testbackup'
if (existsSync(STASH)) rmSync(STASH, { recursive: true, force: true })
if (existsSync(DIR)) renameSync(DIR, STASH)
mkdirSync(DIR, { recursive: true })

// Restored on EVERY path out, not just the one where nothing goes wrong.
//
// The real store has been renamed away. For a long time the restore was the
// last statement in the file, so any throw above it — a broken fixture, an
// exceljs change, an assertion that reads a property of undefined — left the
// person's actual drafts sitting in `content.testbackup` while
// `data/state/content` held this file's two fake products. Their work would
// simply be missing from the screen.
//
// This test also runs EARLY in the `npm test` chain, so the same throw left
// every later test in the run reading a store that was not theirs either.
// A test that moves real data has to put it back whatever happens to it.
process.on('exit', () => {
  try {
    rmSync(DIR, { recursive: true, force: true })
    if (existsSync(STASH)) renameSync(STASH, DIR)
  } catch { /* nothing left to try; the stash is still on disk under its own name */ }
})

const piece = (over) => ({
  id: 'x', sku: 'ABC-1', kind: 'caption', lang: 'en', channel: 'instagram',
  text: '', checks: [], status: 'draft', source: 'model',
  model: 'gemma4:12b', prompt_version: 'content/v2', campaign_id: null,
  created_at: '2026-08-20T09:00:00.000Z', ...over,
})
writeFileSync(`${DIR}/ABC-1.json`, JSON.stringify([
  piece({ id: 'a', kind: 'caption', text: 'Yours for {price_now}, was {price_was}.',
          status: 'approved', approved_at: '2026-08-20T10:00:00.000Z' }),
  piece({ id: 'b', kind: 'caption', text: 'A DRAFT NOBODY APPROVED at {price_now}.' }),
  piece({ id: 'c', kind: 'slogan', text: 'Quietly good.', status: 'approved',
          source: 'human', approved_at: '2026-08-20T10:05:00.000Z' }),
  piece({ id: 'd', kind: 'script', text: 'Hook\nBody\nSay', status: 'approved',
          approved_at: '2026-08-20T10:06:00.000Z',
          script: { hook: 'Hook', body: 'Body', say: 'Get it for {price_now}.', avoid: ['no superlatives'] } }),
]))

const { buildCopyWorkbook } = await import('../lib/excel/copy.ts')
const PRODUCTS = { 'ABC-1': { sku: 'ABC-1', name_en: 'Long Catalogue Title, XYZ-9 - Black',
                              display_name: 'Short Name', price_now: 19.9, price_was: 40.5 } }
const at = new Date('2026-08-20T11:30:00.000Z')
const { buffer, count, products } = await buildCopyWorkbook(PRODUCTS, at)

const wb = new ExcelJS.Workbook()
await wb.xlsx.load(buffer)
const ws = wb.getWorksheet('Approved copy')
const rows = []
ws.eachRow((r, i) => { if (i > 1) rows.push(r.values.slice(1).map((v) => (v ?? '').toString())) })
const copyOf = (kind) => rows.find((r) => r[3] === kind)?.[4] ?? ''

ok('only approved pieces leave',      count === 3 && rows.length === 3)
ok('the draft did not escape',        !rows.some((r) => r[4].includes('DRAFT NOBODY APPROVED')))
ok('one product counted',             products === 1)
ok('prices filled to three decimals', copyOf('caption') === 'Yours for 19.900 KD, was 40.500 KD.')
ok('no raw placeholder survives',     !rows.some((r) => /\{[^}]+\}/.test(r[4])))
ok('the short name is used',          rows[0][1] === 'Short Name')
ok('a script is labelled in one cell', copyOf('video script').startsWith('HOOK: Hook'))
ok('a placeholder inside a script fills', copyOf('video script').includes('19.900 KD'))
ok('"do not say" is separate from copy',
   rows.find((r) => r[3] === 'video script')[5] === 'no superlatives' &&
   !copyOf('video script').includes('no superlatives'))
ok('an edited line is credited to you', rows.find((r) => r[3] === 'slogan')[7] === 'you')
ok('provenance travels',              rows[0][8] === 'gemma4:12b' && rows[0][9] === 'content/v2')
ok('approval time recorded',          rows[0][6] === '2026-08-20 10:00')

const about = wb.getWorksheet('Read me')
const text = []
about.eachRow((r) => text.push(r.values.slice(1).join(' ')))
const joined = text.join('\n')
ok('the export is dated',             joined.includes('2026-08-20 11:30'))
ok('the frozen-price warning is there', /frozen/i.test(joined) && /export again/i.test(joined))
ok('the counts are stated',           joined.includes('3 approved pieces across 1 product.'))

// The `process.on('exit')` handler above does the restoring; this just says so.
console.log('\nreal content store restored')
