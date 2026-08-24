import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { NextResponse } from 'next/server'

/**
 * The refresh button behind the Kuwait tab. Runs `scripts/pull-trends.mjs` —
 * it does not fetch anything itself, and the distinction is the whole design:
 *
 * Rule 1 quarantines every outbound request into scripts/ a person runs. A
 * click is a person running the tool — the marketing team is not a terminal
 * audience — so this route may EXECUTE the script, and nothing more. The
 * boundary that keeps the guarantee structural:
 *
 *   - executed unchanged, by fixed path, with NO arguments;
 *   - nothing from the request reaches it — the body is never read;
 *   - the script itself takes no input, sends a constant URL with no query
 *     beyond `geo=KW`, and writes one local file.
 *
 * So there is no path, even a contrived one, by which a catalogue row or a
 * customer message can ride along. check-localhost still holds over app/:
 * no HTTP client, no external URL literal — the request code lives in the
 * script, reviewable in one place.
 */
export const runtime = 'nodejs'
const run = promisify(execFile)

/**
 * Single-flight: a double-click must not race two pulls into one file write.
 * Both callers get the one result.
 */
let inFlight: Promise<{ trends: number }> | null = null

async function pull(): Promise<{ trends: number }> {
  const { stdout } = await run(
    process.execPath, ['scripts/pull-trends.mjs'],
    { cwd: process.cwd(), timeout: 30_000 },
  )
  // "pull-trends: 10 trends written to ..." — the script's own report.
  return { trends: Number(stdout.match(/(\d+) trends written/)?.[1] ?? 0) }
}

export async function POST() {
  try {
    inFlight ??= pull()
    const result = await inFlight
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    const msg = e instanceof Error ? e.message : ''
    return NextResponse.json(
      {
        error: /timeout|TIMEDOUT/i.test(msg)
          ? 'The feed did not answer in time. Try again in a minute.'
          : 'Could not reach the trends feed — is this machine online?',
      },
      { status: 502 },
    )
  } finally {
    inFlight = null
  }
}
