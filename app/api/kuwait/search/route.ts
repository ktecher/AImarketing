import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { NextResponse } from 'next/server'

/**
 * Looking a topic up: what Kuwait is reading about cars, or phones, or back to
 * school. Runs `scripts/search-trends.mjs` with the typed topic as its only
 * argument, and does nothing else.
 *
 * This route reads the request body, which its sibling `/api/kuwait/trends`
 * deliberately does not. That is the widening of D72's boundary the maintainer
 * asked for — you cannot ask "what about cars" without typing "cars" — and it
 * is written down in docs/decisions.md rather than left as a silent drift.
 *
 * What actually crosses: one topic string, stripped here to letters, digits and
 * spaces and capped at sixty characters, then stripped again by the script
 * itself and URL-encoded. The child process is handed that one argument and has
 * no other input, so nothing else on this machine can ride along. The request
 * code stays quarantined in scripts/, which is what keeps "what leaves" a
 * question with a one-file answer.
 */
export const runtime = 'nodejs'
const run = promisify(execFile)

/** Long enough for "back to school laptops", short enough to be a topic. */
const LIMIT = 60

export async function POST(req: Request) {
  const { topic } = (await req.json().catch(() => ({}))) as { topic?: string }
  // Stripped here as well as in the script. Two passes because they protect
  // different things: this one is the trust boundary, that one is the promise
  // that running the script by hand is equally safe.
  const clean = String(topic ?? '')
    .replace(/[^\p{L}\p{N} ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, LIMIT)

  if (!clean) {
    return NextResponse.json({ error: 'Type a topic — cars, phones, back to school.' }, { status: 400 })
  }

  try {
    const { stdout } = await run(
      process.execPath, ['scripts/search-trends.mjs', clean],
      { cwd: process.cwd(), timeout: 30_000 },
    )
    return NextResponse.json(JSON.parse(stdout))
  } catch (e) {
    const msg = e instanceof Error ? e.message : ''
    return NextResponse.json(
      {
        error: /timeout|TIMEDOUT/i.test(msg)
          ? 'The feed did not answer in time. Try again in a minute.'
          : 'Could not reach the news feed — is this machine online?',
      },
      { status: 502 },
    )
  }
}
