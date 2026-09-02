/**
 * Step one of connecting an Instagram account: send the person to Instagram to
 * say yes.
 *
 * Nothing is stored here and nothing is asked of Meta. This route builds one
 * URL, plants one cookie, and redirects — the browser does the rest. The dialog
 * URL itself is built in `lib/social/instagram.ts`, because that is the only
 * directory allowed to name a host off this machine (D83, D86).
 *
 * ── the cookie is the whole point of this route ──
 *
 * `state` is a random value put in two places at once: the URL Meta will hand
 * back, and an httpOnly cookie only this browser has. The callback compares
 * them. Without it, anyone who can make the staff browser follow a link can
 * complete an OAuth flow against an account of THEIR choosing and leave the shop
 * posting to a stranger's Instagram. It is a CSRF defence, and it is the reason
 * this is two routes rather than a single redirect.
 */

import { randomBytes } from 'node:crypto'
import { NextResponse } from 'next/server'
import { authorizeUrl } from '@/lib/social/instagram'

export const runtime = 'nodejs'

/** Where a person ends up in either outcome. Also named in the callback. */
const ACCOUNTS_SCREEN = '/social'

/**
 * The cookie the callback checks against. Named for what it is so that a person
 * looking at their own cookie jar can see it is not a session.
 */
const STATE_COOKIE = 'instagram_oauth_state'

/**
 * Ten minutes. Long enough to read a consent screen and log in, short enough
 * that an abandoned attempt is not still valid tomorrow.
 */
const STATE_TTL_SECONDS = 600

/**
 * The address Meta sends the browser back to, which must match this app's
 * registered redirect URI EXACTLY — Meta compares the string, and the code
 * exchange in the callback sends it a second time to be compared again.
 *
 * Derived from the incoming request rather than hardcoded, so a dev server on a
 * different port works without editing anything; `INSTAGRAM_REDIRECT_URI`
 * overrides it for the case that matters, which is an app registered against one
 * fixed address.
 */
const redirectUri = (req: Request): string =>
  process.env.INSTAGRAM_REDIRECT_URI ||
  new URL('/api/social/instagram/callback', req.url).toString()

/** Back to the accounts screen carrying something a person can read. */
const back = (req: Request, params: Record<string, string>) =>
  NextResponse.redirect(new URL(`${ACCOUNTS_SCREEN}?${new URLSearchParams(params)}`, req.url))

export async function GET(req: Request) {
  const clientId = process.env.INSTAGRAM_APP_ID
  if (!clientId) {
    // Not a 500. The person clicked a button in a browser, and a page saying
    // which variable is missing is worth more than an error page saying none.
    return back(req, {
      error: 'INSTAGRAM_APP_ID is not set, so this app cannot ask Instagram for permission yet. ' +
        'Add INSTAGRAM_APP_ID, INSTAGRAM_APP_SECRET and INSTAGRAM_REDIRECT_URI to .env.',
    })
  }

  const state = randomBytes(32).toString('hex')

  const res = NextResponse.redirect(
    authorizeUrl({ clientId, redirectUri: redirectUri(req), state }),
  )
  res.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'lax',
    // lax, not strict: the callback arrives as a top-level navigation FROM
    // instagram.com, and a strict cookie is not sent on a cross-site navigation
    // — the flow would fail every time with "no state cookie".
    secure: new URL(req.url).protocol === 'https:',
    path: '/api/social',
    maxAge: STATE_TTL_SECONDS,
  })
  return res
}
