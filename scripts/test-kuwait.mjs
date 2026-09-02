// lib/kuwait.ts: the one read function over knowledge/kuwait/. Pure fs reads,
// no database, no model — always runs, like test-brief.mjs.
import { writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
const { readKnowledge } = await import('../lib/kuwait.ts')

let failed = 0
const ok = (label, cond, detail = '') => {
  if (!cond) failed++
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `   ${detail}` : ''}`)
}

console.log('\n--- a real timely file, with real frontmatter ---')
const trends = readKnowledge('timely/trending-searches.md')
ok('reads', trends !== null)
ok('last_verified matches the file', trends?.last_verified === '2026-09-01', trends?.last_verified)
ok('source matches the file',
   trends?.source === 'https://trends.google.com/trending/rss?geo=KW', trends?.source)
// Not "no '---' anywhere" — the body's own markdown table row is
// `|---|---|---|`, a legitimate '---' that isn't a frontmatter fence.
ok('the fences are stripped', !trends?.text.startsWith('---'))
ok('the body remains', trends?.text.includes('Trending searches in Kuwait'))

console.log('\n--- a real evergreen file, with no frontmatter ---')
const channels = readKnowledge('evergreen/channels-and-platforms.md')
ok('reads', channels !== null)
ok('last_verified is null, not the whole result null', channels?.last_verified === null)
ok('source is null too', channels?.source === null)
ok('the body still comes through', channels?.text.includes('Channels in Kuwait'))

console.log('\n--- a missing file ---')
ok('returns null, does not throw', readKnowledge('timely/does-not-exist.md') === null)

console.log('\n--- path traversal is refused ---')
ok('../../../etc/passwd',            readKnowledge('../../../etc/passwd') === null)
ok('/etc/passwd (absolute)',          readKnowledge('/etc/passwd') === null)
ok('timely/../../../etc/passwd',      readKnowledge('timely/../../../etc/passwd') === null)

console.log('\n--- a fixture with no frontmatter, made for this test ---')
// Belt and suspenders alongside the real evergreen file above: this fixture
// pins the shape (no leading "---" at all) rather than relying on channels-
// and-platforms.md staying frontmatter-free forever.
const fixtureDir = join(process.cwd(), 'knowledge/kuwait/evergreen')
const fixtureName = '__test-kuwait-fixture.md'
mkdirSync(fixtureDir, { recursive: true })
writeFileSync(join(fixtureDir, fixtureName), '# No frontmatter here\n\nJust a body.\n')
try {
  const fixture = readKnowledge(`evergreen/${fixtureName}`)
  ok('note, not null',        fixture !== null)
  ok('last_verified is null', fixture?.last_verified === null)
  ok('body intact',           fixture?.text.includes('Just a body.'))
} finally {
  rmSync(join(fixtureDir, fixtureName))
}

console.log(`\n${failed ? `${failed} FAILED` : 'lib/kuwait.ts reads what it should and refuses what it should not'}`)
process.exit(failed ? 1 : 0)
