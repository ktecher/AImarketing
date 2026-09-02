/**
 * Step two: Instagram sends the browser back here, and this is where a token is
 * born.
 *
 * Four exchanges, in order, and every one of them must succeed before anything
 * is written:
 *
 *   1. the `state` in the URL is compared against the cookie set at step one
 *   2. the `code` is exchanged for a one-hour token at api.instagram.com
 *   3. that token is exchanged for a sixty-day one — skip this and the whole
 *      connection is dead in an hour (see `longLivedToken`)
 *   4. `/me` says which account it posts as, and that becomes one row
 *
 * One row, not two. Before D86 this connected a Facebook Page and, if one was
 * linked, its Instagram account alongside. Instagram Login grants exactly one
 * account per consent, which is the trade this project made to stop needing a
 * Page at all.
 *
 * ── the state check is the entire defence of this endpoint ──
 *
 * This route accepts a `code` from anyone who can make the staff browser land on
 * it, and it turns that code into a standing permission to post as whatever
 * account issued it. Without the state check, a link in an email is enough to
 * make the shop's publish button post to a stranger's account — and nothing on
 * screen would look wrong, because a connection that succeeded IS what a
 * successful connection looks like.
 *
 * So: no cookie, no connection. Mismatch, no connection. Compared in constant
 * time, over digests so that two different lengths do not throw instead of
 * returning false.
 *
 * A person who cancels is NOT an error. Meta hands back `error` and
 * `error_description` on the same redirect, and it is by far the most common way
 * this route is reached other than success — it gets a sentence, not a 500.
 */

import { createHash, timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { connect } from '@/lib/social/store'
import { cleanCode, exchangeCodeForToken, longLivedToken, profile } from '@/lib/social/instagram'

export const runtime = 'nodejs'
// Three round trips before anything is written. Nothing here polls, so this is a
// network allowance rather than a work allowance.
export const maxDuration = 60

/** Must match the screen and the cookie that `../start/route.ts` sets. */
const ACCOUNTS_SCREEN = '/social'
const STATE_COOKIE = 'instagram_oauth_state'

/**
 * One cookie out of the request header.
 *
 * Read from the raw header rather than through `next/headers`, so that this
 * handler is a plain function of a plain `Request` and the test suite can call
 * it with one — `cookies()` needs a Next request context that a node script
 * does not have, and a route that can only be exercised by starting a server is
 * a route whose state check never gets tested.
 */
function cookie(req: Request, name: string): string {
  for (const part of (req.headers.get('cookie') ?? '').split(';')) {
    const at = part.indexOf('=')
    if (at > 0 && part.slice(0, at).trim() === name) return decodeURIComponent(part.slice(at + 1).trim())
  }
  return ''
}

/**
 * Constant-time equality for two values that are both secrets-by-position.
 *
 * Over SHA-256 digests rather than the raw strings, because `timingSafeEqual`
 * THROWS on inputs of different lengths — and a comparison that throws on a
 * length mismatch has already leaked the length, as well as turning a rejection
 * into a 500. Digests are always 32 bytes, so the comparison is the only thing
 * that can vary.
 */
function sameState(a: string, b: string): boolean {
  if (!a || !b) return false
  const digest = (s: string) => createHash('sha256').update(s).digest()
  return timingSafeEqual(digest(a), digest(b))
}

/**
 * Back to the accounts screen, and always without the state cookie.
 *
 * Cleared on every path, success and failure alike: a state that has been used
 * once must not be replayable, and one left behind after a cancelled attempt is
 * a valid state sitting in the browser for ten minutes.
 */
function back(req: Request, params: Record<string, string>) {
  const res = NextResponse.redirect(new URL(`${ACCOUNTS_SCREEN}?${new URLSearchParams(params)}`, req.url))
  res.cookies.set(STATE_COOKIE, '', { httpOnly: true, path: '/api/social', maxAge: 0 })
  return res
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const params = url.searchParams

  // Meta's own words for "the person pressed Cancel", and the reason this is
  // handled first: it arrives with no `code` at all, so every check below would
  // otherwise report something misleading about a request that is simply a no.
  const error = params.get('error')
  if (error) {
    const described = params.get('error_description') ?? ''
    return back(req, {
      cancelled: error === 'access_denied' ? '1' : '',
      error: described || `Instagram refused the connection (${error}).`,
    })
  }

  const state = params.get('state') ?? ''
  const expected = cookie(req, STATE_COOKIE)
  if (!expected) {
    return back(req, {
      error: 'That connection attempt has expired or was started in another browser. ' +
        'Press Connect again and finish in the same window.',
    })
  }
  if (!sameState(state, expected)) {
    // Deliberately not "invalid state": the person reading this did not type a
    // state and cannot fix one. What they can do is start again from here, and
    // if it keeps happening somebody should be told.
    return back(req, {
      error: 'That connection did not come back from where it was sent. Nothing was connected. ' +
        'Start again from this page.',
    })
  }

  // `#_` is Meta's, not the code's, and a code carrying it is rejected as
  // invalid — which reads exactly like a replayed code.
  const code = cleanCode(params.get('code') ?? '')
  if (!code) return back(req, { error: 'Instagram sent no authorisation code back. Press Connect again.' })

  const clientId = process.env.INSTAGRAM_APP_ID
  const clientSecret = process.env.INSTAGRAM_APP_SECRET
  if (!clientId || !clientSecret) {
    return back(req, {
      error: 'INSTAGRAM_APP_ID and INSTAGRAM_APP_SECRET must both be set in .env before an account can be connected.',
    })
  }

  // Must be the same string `start` sent, character for character, or Meta
  // rejects the exchange.
  const uri = process.env.INSTAGRAM_REDIRECT_URI ||
    new URL('/api/social/instagram/callback', req.url).toString()

  try {
    const short = await exchangeCodeForToken({ clientId, clientSecret, redirectUri: uri, code })
    const long = await longLivedToken({ clientSecret, token: short.token })

    // Asked for rather than taken from the exchange: it is the call that proves
    // the long-lived token works, and it is the only way to get a name a person
    // can recognise in the picker.
    const me = await profile(long)
    const igUserId = me.userId || short.userId
    if (!igUserId) {
      return back(req, {
        error: 'Instagram did not say which account that login was for, so nothing was connected. ' +
          'Check the account is a Business or Creator account, then press Connect again.',
      })
    }

    const account = await connect({
      platform: 'instagram',
      external_id: igUserId,
      name: me.username ? `@${me.username}` : `Instagram (${igUserId})`,
      token: long,
    })

    return back(req, { connected: '1', names: account.name })
  } catch (e) {
    // `InstagramError` messages are already scrubbed of the token and the client
    // secret at the point the response became an Error. Anything else is ours —
    // a database that is down, a missing APP_ENCRYPTION_KEY — and those messages
    // name variables, never values.
    return back(req, {
      error: e instanceof Error ? e.message : 'Could not finish connecting that account.',
    })
  }
}
