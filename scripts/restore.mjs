// Put a backup back.
//
//   npm run restore backups/2026-08-20T15-40-00
//
// Refuses to run without a folder, and says exactly what it is about to
// overwrite before it does. A restore is the one command nobody has practised,
// so it explains itself rather than assuming the person running it is calm.
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

try { process.loadEnvFile('.env') } catch { /* no .env is normal on a clone */ }

const from = process.argv[2]
if (!from) {
  const root = join(process.cwd(), 'backups')
  const have = existsSync(root) ? readdirSync(root).filter((f) => /^\d{4}-/.test(f)).sort().reverse() : []
  console.error('Which backup?\n\n  npm run restore backups/<folder>\n')
  if (have.length) console.error('Available, newest first:\n' + have.map((h) => `  backups/${h}`).join('\n'))
  else console.error('There are none yet. Make one with: npm run backup')
  process.exit(1)
}

const dir = join(process.cwd(), from.replace(/^\.\//, ''))
if (!existsSync(dir)) { console.error(`No such backup: ${from}`); process.exit(1) }

console.log(readFileSync(join(dir, 'README.txt'), 'utf8'))
console.log('\n--- restoring ---')

// Files first. If the database step fails the files are already back, which is
// the half that git cannot replace.
for (const rel of ['data/state', 'data/templates', 'data/samples', 'data/fonts']) {
  const src = join(dir, rel)
  if (!existsSync(src)) continue
  cpSync(src, join(process.cwd(), rel), { recursive: true })
  console.log(`  restored ${rel}`)
}

const sql = join(dir, 'database.sql')
if (existsSync(sql)) {
  try {
    // --clean --if-exists was used on the way out, so this drops and recreates
    // rather than colliding with whatever is in there now.
    execFileSync('docker', ['compose', 'exec', '-T', 'db', 'psql', '-U', 'aimarketing', '-d', 'aimarketing', '-q'],
      { cwd: process.cwd(), input: readFileSync(sql), stdio: ['pipe', 'ignore', 'inherit'] })
    console.log('  restored the database')
  } catch (e) {
    console.error('  ! the database did not restore:', e instanceof Error ? e.message.split('\n')[0] : e)
    console.error('    Is it running? npm run db:up')
    process.exit(1)
  }
} else {
  console.log('  no database.sql in this backup — files only')
}

console.log('\nDone. Restart the app so it re-reads what changed.')
