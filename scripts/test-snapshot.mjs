// The copy a destructive route takes before it removes anything.
import { mkdirSync, writeFileSync, existsSync, readdirSync, rmSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
const { snapshot } = await import('../lib/snapshot.ts')

let failed = 0
const ok = (name, cond, detail = '') => {
  if (!cond) failed++
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${detail ? `   ${detail}` : ''}`)
}
console.log('--- snapshot before a destructive route ---')

const TRASH = join(process.cwd(), 'data/.trash')
const SANDBOX = 'data/.trash-fixture'
const abs = join(process.cwd(), SANDBOX)
rmSync(abs, { recursive: true, force: true })
mkdirSync(join(abs, 'nested'), { recursive: true })
writeFileSync(join(abs, 'one.json'), '{"sku":"X1"}')
writeFileSync(join(abs, 'nested', 'two.txt'), 'photo')

const before = existsSync(TRASH) ? readdirSync(TRASH).length : 0

const dir = snapshot('test-one', [SANDBOX])
ok('a snapshot is written', Boolean(dir) && existsSync(dir))
ok('the file content survives',
   readFileSync(join(dir, SANDBOX, 'one.json'), 'utf8') === '{"sku":"X1"}')
ok('a directory is copied whole',
   existsSync(join(dir, SANDBOX, 'nested', 'two.txt')))

// A path that is not there must not fail the delete the user asked for.
ok('a missing path is skipped, not thrown',
   snapshot('test-missing', ['data/does-not-exist.json']) === null)
ok('nothing present means no folder',
   readdirSync(TRASH).filter((f) => f.includes('test-missing')).length === 0)

// A mix: the present path is saved and the absent one ignored.
const mixed = snapshot('test-mixed', ['data/nope.json', SANDBOX])
ok('a present path is still saved beside an absent one',
   Boolean(mixed) && existsSync(join(mixed, SANDBOX, 'one.json')))

// Two snapshots in the same run must not collide.
ok('two snapshots are distinct folders', dir !== mixed)

// Only ten are kept, so a repeated clear cannot fill the disk.
for (let i = 0; i < 12; i++) snapshot(`test-prune-${String(i).padStart(2, '0')}`, [SANDBOX])
ok('old snapshots are pruned', readdirSync(TRASH).length <= 10,
   `${readdirSync(TRASH).length} kept`)
ok('the newest survives pruning',
   readdirSync(TRASH).some((f) => f.endsWith('test-prune-11')))

rmSync(abs, { recursive: true, force: true })
for (const f of readdirSync(TRASH).filter((f) => f.includes('-test-'))) {
  rmSync(join(TRASH, f), { recursive: true, force: true })
}
console.log(`\n${failed ? `${failed} FAILED` : 'snapshot store restored'}`)
process.exit(failed ? 1 : 0)
