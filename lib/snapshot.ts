/**
 * A copy of what a destructive route is about to remove.
 *
 * `DELETE /api/import` clears the catalogue, the photos and every layout
 * exception; `DELETE /api/templates/[id]` removes a template and its overrides.
 * Both are correct for a single-user localhost app and both are unauthenticated
 * one-liners. A stray curl during testing deleted a template here and there was
 * nothing to restore from — the state directories are gitignored precisely
 * because they hold real catalogue data, so version control is not the answer.
 *
 * This is not undo. It is a copy on disk with a timestamp, which is enough to
 * get the work back by hand and cheap enough that nobody has to remember it.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'

const TRASH = () => join(process.cwd(), 'data/.trash')

/** How many snapshots to keep. Each clear copies the photo folder. */
const KEEP = 10

/**
 * Copy `paths` (relative to the project root) into a dated folder.
 *
 * Missing paths are skipped rather than failing: a snapshot is a courtesy, and
 * refusing to delete because there was nothing to back up would be worse than
 * the problem it solves. Returns the folder, or null when nothing existed.
 */
export function snapshot(label: string, paths: string[]): string | null {
  const present = paths.filter((p) => existsSync(join(process.cwd(), p)))
  if (!present.length) return null

  // Colons are legal on macOS but confuse Finder and every shell completion.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const into = join(TRASH(), `${stamp}-${label}`)

  try {
    for (const rel of present) {
      const from = join(process.cwd(), rel)
      const to = join(into, rel)
      mkdirSync(join(to, '..'), { recursive: true })
      cpSync(from, to, { recursive: true })
    }
  } catch {
    // A snapshot that cannot be written must not block the delete the user
    // asked for. They get told it is missing; they do not get a failed button.
    return null
  }

  prune()
  return into
}

/** Oldest first, drop everything past KEEP. Names sort chronologically. */
function prune(): void {
  const root = TRASH()
  if (!existsSync(root)) return
  try {
    const dirs = readdirSync(root)
      .filter((f) => !f.startsWith('.') && statSync(join(root, f)).isDirectory())
      .sort()
    for (const old of dirs.slice(0, Math.max(0, dirs.length - KEEP))) {
      rmSync(join(root, old), { recursive: true, force: true })
    }
  } catch { /* pruning is housekeeping, never a reason to fail a request */ }
}
