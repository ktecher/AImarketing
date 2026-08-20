// Everything that is not in git, in one dated folder.
//
// `data/` is gitignored on purpose — it holds a client's catalogue — so git is
// not a backup of any of it. And only two things are in Postgres; the sheet,
// the short names, the approved copy, the conversations, the templates and the
// product photos are all files.
//
//   npm run backup            -> backups/2026-08-20T15-40-00
//   npm run restore <folder>  -> puts it all back
//
// Deliberately a folder of plain files and one .sql, not an archive format.
// A backup you cannot open and read is one nobody checks, and the first time
// anybody looks at it is the day it has to work.
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

try { process.loadEnvFile('.env') } catch { /* no .env is normal on a clone */ }

/** Files, in the order they matter if somebody has to restore by hand. */
const PATHS = [
  ['data/state/last-import.json', 'the campaign sheet: which products the posters are about'],
  ['data/state/display-names.json', 'short names, written and reviewed by a person'],
  ['data/state/content', 'copy drafts and approvals'],
  ['data/state/chat', 'customer conversations, with their provenance'],
  ['data/templates', 'templates: artwork, slot geometry, per-product overrides'],
  ['data/samples', 'the uploaded sheets and the product photos'],
  ['data/fonts', 'fonts, including any brand face not in git'],
]

const KEEP = 14

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const root = join(process.cwd(), 'backups')
const into = join(root, stamp)
mkdirSync(into, { recursive: true })

const notes = [`AImarketing backup ${stamp}`, '']

// --- Postgres ---
// pg_dump from inside the container, so no client version has to match and
// nothing depends on psql being installed on whoever's machine this runs on.
try {
  const sql = execFileSync(
    'docker',
    ['compose', 'exec', '-T', 'db', 'pg_dump', '-U', 'aimarketing', '-d', 'aimarketing', '--clean', '--if-exists'],
    { cwd: process.cwd(), maxBuffer: 512 * 1024 * 1024 },
  )
  writeFileSync(join(into, 'database.sql'), sql)
  const rows = (sql.toString().match(/^COPY /gm) ?? []).length
  notes.push(`database.sql        every table (${rows} COPY blocks)`)
} catch (e) {
  notes.push('database.sql        MISSING — Postgres was not running when this ran')
  console.error('  ! could not dump the database:', e instanceof Error ? e.message.split('\n')[0] : e)
}

// --- Files ---
for (const [rel, what] of PATHS) {
  const from = join(process.cwd(), rel)
  if (!existsSync(from)) { notes.push(`${rel.padEnd(32)} (nothing to copy)`); continue }
  const to = join(into, rel)
  mkdirSync(join(to, '..'), { recursive: true })
  cpSync(from, to, { recursive: true })
  notes.push(`${rel.padEnd(32)} ${what}`)
}

notes.push('', 'Restore all of it with:', `  npm run restore backups/${stamp}`, '',
  'Or by hand: psql < database.sql, and copy the data/ folders back over.')
writeFileSync(join(into, 'README.txt'), notes.join('\n'))

// Oldest first; names sort chronologically.
const all = readdirSync(root).filter((f) => /^\d{4}-/.test(f)).sort()
for (const old of all.slice(0, Math.max(0, all.length - KEEP))) {
  rmSync(join(root, old), { recursive: true, force: true })
}

console.log(notes.join('\n'))
console.log(`\nwritten to backups/${stamp}`)
