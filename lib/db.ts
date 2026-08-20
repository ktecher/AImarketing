/**
 * The one place that talks to Postgres.
 *
 * Same shape as lib/ai/generate.ts and for the same reason: one file, one
 * connection, one place a query can originate. `DATABASE_URL` is asserted to be
 * local at module load — the catalogue is competitive information and the
 * localhost rule covers where it is stored as much as where it is sent.
 */

import { Pool } from 'pg'

// Matches docker-compose.yml, so a clone works with no .env at all:
// `docker compose up -d && npm run db:migrate` and the app connects. Set
// DATABASE_URL for anything else — a Homebrew Postgres on trust auth, or a
// different port where 5432 is already taken.
const DSN =
  process.env.DATABASE_URL ?? 'postgresql://aimarketing:aimarketing@127.0.0.1:5432/aimarketing'

function assertLocal(url: string): void {
  let host: string
  try {
    host = new URL(url).hostname || 'localhost'
  } catch {
    throw new Error(`DATABASE_URL is not a valid URL: ${url}`)
  }
  const local =
    host === '' || host === 'localhost' || host === '127.0.0.1' ||
    host === '::1' || host === '[::1]' || host.endsWith('.localhost')
  if (!local) {
    throw new Error(
      `Refusing to start: DATABASE_URL points at "${host}", which is not this machine.\n` +
        'The product catalogue is competitive information and does not leave localhost — see CLAUDE.md.',
    )
  }
}
assertLocal(DSN)

/**
 * One pool for the process. Next dev reloads modules on every edit, so it is
 * stashed on globalThis — otherwise each reload opens a new pool and Postgres
 * runs out of connections after an afternoon of editing.
 */
const g = globalThis as unknown as { __aimarketingPool?: Pool }

export const pool: Pool =
  g.__aimarketingPool ??
  (g.__aimarketingPool = new Pool({ connectionString: DSN, max: 8, idleTimeoutMillis: 30_000 }))

export async function query<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const res = await pool.query(text, params as never[])
  return res.rows as T[]
}

/** Whether the catalogue table exists and holds anything. */
export async function catalogueSize(): Promise<number> {
  try {
    const [row] = await query<{ n: string }>('select count(*)::text as n from products')
    return Number(row?.n ?? 0)
  } catch {
    // No database, no migration, or Postgres is not running. Every caller falls
    // back to the campaign sheet, so this is a state and not an error.
    return 0
  }
}

/** True when Postgres is reachable at all, for telling "empty" from "absent". */
export async function reachable(): Promise<boolean> {
  try {
    await query('select 1')
    return true
  } catch {
    return false
  }
}
