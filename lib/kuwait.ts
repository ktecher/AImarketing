/**
 * The one read function CLAUDE.md's Layout section permits:
 * "`lib/kuwait` does not exist; it is markdown plus one read function."
 * No directory, no module, no abstraction over knowledge/kuwait/ — a caller
 * that wants a second file calls this again.
 *
 * Frontmatter is hand-parsed rather than pulled in as a YAML dependency: every
 * real file here is two or three flat `key: value` lines between `---` fences
 * (see knowledge/kuwait/timely/README.md), and a parser for that shape is a
 * regex, not a library.
 */

import { readFileSync, realpathSync } from 'node:fs'
import { resolve } from 'node:path'

export type KuwaitNote = {
  /** The body, frontmatter stripped. */
  text: string
  /** From frontmatter. Null when the file has none — evergreen files may not. */
  last_verified: string | null
  source: string | null
}

const ROOT = resolve(process.cwd(), 'knowledge/kuwait')

/**
 * `file` becomes a filesystem path, so confinement is not optional. Resolve it
 * against ROOT and check the RESOLVED path is still inside ROOT — string-
 * matching for `..` is not enough, because
 * `timely/../../../etc/passwd` contains no `..` segment that survives naively
 * and still walks out of the directory once resolved. realpathSync also
 * refuses a symlink that points back outside, which a plain path check cannot
 * see at all.
 */
function resolveInside(file: string): string | null {
  const candidate = resolve(ROOT, file)
  if (candidate !== ROOT && !candidate.startsWith(ROOT + '/')) return null
  try {
    const real = realpathSync(candidate)
    if (real !== ROOT && !real.startsWith(ROOT + '/')) return null
    return real
  } catch {
    // Missing file: resolveInside's job is path safety, not existence.
    // readKnowledge below is what turns "does not exist" into null.
    return candidate
  }
}

export function readKnowledge(file: string): KuwaitNote | null {
  const path = resolveInside(file)
  if (!path) return null

  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    // Missing or unreadable. A plan without a trends section is still a plan.
    return null
  }

  const fm = raw.match(/^---\n([\s\S]*?)\n---\n?/)
  if (!fm) {
    // Exists, no frontmatter: a real result, not an absent one. Evergreen
    // files carry no last_verified at all — that is the null case, distinct
    // from "this file does not exist."
    return { text: raw, last_verified: null, source: null }
  }

  const field = (key: string): string | null => {
    const m = fm[1].match(new RegExp(`^${key}:\\s*(.*)$`, 'm'))
    return m ? m[1].trim() || null : null
  }

  return {
    text: raw.slice(fm[0].length),
    last_verified: field('last_verified'),
    source: field('source'),
  }
}
