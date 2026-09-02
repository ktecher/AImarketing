/**
 * Publishing a finished post to an Instagram professional account, and the
 * login that grants permission to do it.
 *
 * This module knows nothing about the database. It takes an account id, a
 * token, a caption and image URLs, and returns what Instagram gave back. Which
 * post these belong to, and where the token came from, is
 * `lib/social/store.ts`'s problem — keeping that out of here is what makes this
 * file testable offline and what stops a publish bug from becoming a data bug.
 *
 * ── the fact that explains the whole architecture ──
 *
 * Instagram FETCHES the image itself, from a public URL we hand it. The bytes
 * are never uploaded: `/{igUserId}/media` takes `image_url`, and Meta's servers
 * go and GET that address.
 *
 * This is the entire reason a public image host exists in this project at all.
 * A future reader looking at Cloudinary and thinking "we render these locally,
 * why are we paying to store them" will delete it and find that publishing stops
 * working — a `data:` URI is rejected, a `file://` path is rejected, and a
 * `localhost` URL is a machine Meta cannot reach. Rendered artwork is the one
 * thing in this project that has to be reachable from outside, because the
 * platform will not accept it any other way.
 *
 * Note this does not widen CLAUDE.md rule 1. What leaves is a rendered image and
 * a caption a person approved and pressed publish on — the act of publishing IS
 * sending it to Meta. Catalogue rows, customer messages and Excel contents still
 * never leave.
 *
 * ── why Instagram only, and why three hosts ──
 *
 * This was a Facebook Page integration until D86. Publishing through a Page
 * requires a Meta Business portfolio, and the shop could not create one — so the
 * whole file moved to "Instagram API with Instagram Login", which Meta ships
 * precisely for accounts that have no Page. Its own words: this setup "does not
 * require a Facebook Page to be linked to the Instagram professional account."
 *
 * That API lives on its own hosts rather than on Graph, and needs all three:
 *
 *   www.instagram.com   the login dialog — a `Location` header, never fetched
 *   api.instagram.com   the one-hour token the authorisation code buys
 *   graph.instagram.com everything else: the 60-day token, the profile, publishing
 *
 * `scripts/check-localhost.mjs` allows exactly these three inside `lib/social/`
 * and nowhere else. graph.facebook.com and www.facebook.com are no longer
 * allowed anywhere: nothing in this project talks to Graph any more.
 */

/**
 * The API version every graph.instagram.com URL is built from.
 *
 * Pinned explicitly rather than left to Meta's unversioned default, because the
 * unversioned endpoint silently follows whatever is current and a breaking
 * change then arrives as a publish failure nobody deployed. v25.0 is the version
 * Meta's own content-publishing examples used on 2026-08-31.
 *
 * Meta deprecates a version roughly every two years. When publishing starts
 * failing with "version is deprecated", this line is the fix — check the
 * changelog at developers.facebook.com/docs/graph-api/changelog.
 *
 * The two token endpoints below are deliberately NOT versioned: Meta serves
 * `/access_token` and `/refresh_access_token` off the bare host, and prefixing
 * them with a version is a 404.
 */
const API_VERSION = 'v25.0'

const GRAPH = 'https://graph.instagram.com'
const GRAPH_VERSIONED = `${GRAPH}/${API_VERSION}`

/**
 * Where the short-lived token comes from, and the only call in this file that
 * is not on graph.instagram.com.
 *
 * Meta really does split these across two hosts: the authorisation code is spent
 * at api.instagram.com and everything afterwards happens at graph.instagram.com.
 * Folding them into one host is a 404 that reads like a bad client secret.
 */
const OAUTH_TOKEN = 'https://api.instagram.com/oauth/access_token'

/**
 * The one host in this project that nothing ever fetches.
 *
 * The login dialog is not an API call — it is a string we put in a `Location`
 * header, and the PERSON'S BROWSER goes there. What travels on it is the app id,
 * the scope list and a random state, all public by construction. No catalogue
 * row, no caption, no image and no credential — which is why the checker allows
 * it and why it is worth knowing this host is a weaker exception than the other
 * two.
 */
const AUTHORIZE = 'https://www.instagram.com/oauth/authorize'

/** An Instagram failure, carrying a message that has been scrubbed of the token. */
export class InstagramError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InstagramError'
  }
}

export type PublishResult = {
  platformPostId: string
  permalinkUrl: string
}

/**
 * A message with the access token removed.
 *
 * Meta quotes the offending request back inside some error bodies, and a
 * long-lived token is a standing permission to post as the shop: once it reaches
 * a log file or a staff screen, the remedy is revoking and reconnecting the
 * account, not editing a string. The scrub sits at the single point where a
 * response becomes an Error, so no call site can forget it.
 */
const withoutToken = (message: string, ...secrets: (string | undefined)[]) =>
  secrets.reduce<string>(
    (m, s) => (s ? m.split(s).join('[token redacted]') : m),
    message,
  )

/**
 * Instagram's own error message, or a description of the HTTP failure.
 *
 * Never the URL and never the params: the token travels in both, and a thrown
 * error is the most likely thing in this file to end up somewhere it is read.
 *
 * Two error shapes, because the two hosts disagree. graph.instagram.com answers
 * with `{error: {message}}`; api.instagram.com answers the token exchange with a
 * flat `{error_message}`. Reading only the first turns a wrong client secret
 * into "request failed (400)".
 */
function failure(
  json: { error?: { message?: string }; error_message?: string } | null,
  status: number,
  ...secrets: (string | undefined)[]
) {
  return new InstagramError(
    withoutToken(
      json?.error?.message ?? json?.error_message ?? `Instagram request failed (${status}).`,
      ...secrets,
    ),
  )
}

/** POST form-encoded params to an absolute URL and parse the JSON response. */
async function postForm<T>(url: string, params: Record<string, string>): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  })
  const json = (await res.json().catch(() => null)) as
    (T & { error?: { message?: string }; error_message?: string }) | null
  if (!res.ok || !json || json.error || json.error_message) {
    throw failure(json, res.status, params.access_token, params.client_secret)
  }
  return json
}

/** GET an absolute URL with query params and parse the JSON response. */
async function get<T>(url: string, params: Record<string, string>): Promise<T> {
  const res = await fetch(`${url}?${new URLSearchParams(params)}`)
  const json = (await res.json().catch(() => null)) as
    (T & { error?: { message?: string }; error_message?: string }) | null
  if (!res.ok || !json || json.error || json.error_message) {
    throw failure(json, res.status, params.access_token, params.client_secret)
  }
  return json
}

/* ── Connecting an account ────────────────────────────────────────────────
 * Where the token comes from: the OAuth code flow, and the one read that turns
 * "somebody logged in" into a row we can post as.
 *
 * Same rule as the publishing half — this module knows nothing about the
 * database. It returns what Instagram said; storing it, encrypting it and
 * deciding what an id looks like is `lib/social/store.ts`'s problem.
 */

/**
 * What publishing needs, and nothing beyond it.
 *
 * Both scopes are read off the consent screen by a person. `instagram_business_basic`
 * is what makes `/me` answer at all; `instagram_business_content_publish` is the
 * one that posts.
 *
 * Adding a third is a decision, not a convenience: a scope nobody uses is a
 * permission the shop granted for nothing, and changing this list re-prompts
 * every connected account. `instagram_business_manage_insights` belongs here the
 * day the campaign report actually reads insights, and not before.
 */
export const PUBLISH_SCOPES = [
  'instagram_business_basic',
  'instagram_business_content_publish',
] as const

/**
 * Where to send somebody to grant this app permission to post as their account.
 *
 * `enable_fb_login` is deliberately not sent. Meta's default is whatever the app
 * dashboard is configured for, and this app is configured for Instagram login —
 * which is the entire reason for D86. If the dialog ever starts offering
 * "continue with Facebook" and that path dead-ends on a missing business
 * portfolio, `enable_fb_login: '0'` here is the fix.
 */
export function authorizeUrl({
  clientId,
  redirectUri,
  state,
}: {
  clientId: string
  redirectUri: string
  state: string
}): string {
  return `${AUTHORIZE}?${new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
    response_type: 'code',
    scope: PUBLISH_SCOPES.join(','),
  })}`
}

/** The short-lived token, and the account id it belongs to. */
export type CodeExchange = {
  /** Lives about an hour. Useless on its own — see `longLivedToken`. */
  token: string
  /** The id `/{id}/media` is addressed with. Meta returns it here, so no lookup. */
  userId: string
}

/**
 * The code from the callback, exchanged for a short-lived token.
 *
 * `redirectUri` is sent again even though nothing is being redirected: Meta
 * compares it against the one the code was issued for and rejects a mismatch.
 * That is the check that stops a code stolen from a log being spent elsewhere,
 * so it must be the SAME value `authorizeUrl` was given, character for
 * character — a trailing slash is a different URI.
 *
 * This is a POST, unlike every other call here. api.instagram.com rejects the
 * exchange as a GET, and the rejection reads like a bad secret.
 */
export async function exchangeCodeForToken({
  clientId,
  clientSecret,
  redirectUri,
  code,
}: {
  clientId: string
  clientSecret: string
  redirectUri: string
  code: string
}): Promise<CodeExchange> {
  const body = await postForm<{ access_token: string; user_id: number | string }>(OAUTH_TOKEN, {
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
    code,
  })
  return { token: body.access_token, userId: String(body.user_id) }
}

/**
 * Meta appends `#_` to the redirect it sends the browser back to, and browsers
 * hand the fragment on in some flows rather than dropping it. It is not part of
 * the code, and a code with it still attached is rejected as invalid — which
 * reads exactly like a replayed or expired code and sends whoever is debugging
 * to the state check instead.
 *
 * Meta's own docs say to strip it. This is that.
 */
export const cleanCode = (code: string): string => code.replace(/#_$/, '')

/**
 * A one-hour token exchanged for a sixty-day one.
 *
 * Not optional. Skipping it gives a connection that works during the demo and is
 * dead by the afternoon, which is the worst shape a bug can take.
 *
 * Note the ceiling this leaves: sixty days, and then publishing starts failing
 * with Meta saying the token expired. Instagram tokens can be refreshed
 * (`grant_type=ig_refresh_token` at `/refresh_access_token`) but nothing in this
 * app runs on a timer to do it, so the remedy is a person pressing Connect
 * again. The Social screen says so.
 * ponytail: manual reconnect every 60 days; add a refresh call when something
 * scheduled exists to run it.
 */
export async function longLivedToken({
  clientSecret,
  token,
}: {
  clientSecret: string
  token: string
}): Promise<string> {
  const { access_token } = await get<{ access_token: string }>(`${GRAPH}/access_token`, {
    grant_type: 'ig_exchange_token',
    client_secret: clientSecret,
    access_token: token,
  })
  return access_token
}

/** The account a token belongs to, as a row can describe it. */
export type Profile = {
  /** What `/{id}/media` is addressed with. */
  userId: string
  /** `retailerkw`, without the @. Empty when Instagram would not say. */
  username: string
}

/**
 * Who this token posts as.
 *
 * Asked for rather than assumed, because the id from the code exchange has no
 * name attached and a picker showing `17841400000000000` is a picker nobody can
 * use. `user_id` is requested alongside `username` and preferred over the
 * caller's copy: they are the same value, and asking is what proves the token
 * works before a row is written claiming it does.
 */
export async function profile(token: string): Promise<Profile> {
  const me = await get<{ user_id?: number | string; id?: number | string; username?: string }>(
    `${GRAPH_VERSIONED}/me`,
    { fields: 'user_id,username', access_token: token },
  )
  return {
    // `user_id` is the publishing id. `id` is the app-scoped one and is NOT
    // interchangeable — addressing /media with it is a "does not exist" error.
    userId: String(me.user_id ?? me.id ?? ''),
    username: me.username ?? '',
  }
}

/* ── Publishing ───────────────────────────────────────────────────────────── */

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Wait for a media container to become publishable.
 *
 * Creating a container is asynchronous — Meta has to fetch the image from the
 * URL we gave it, and that takes as long as it takes. `media_publish` on a
 * container that has not reached FINISHED either fails outright or publishes a
 * broken post, which is the worse of the two because nobody sees it until a
 * customer does.
 *
 * The retry is bounded on purpose. An unbounded poll against a container that
 * will never finish is a request that hangs until something else times out, and
 * "the publish button did nothing" is the least diagnosable failure there is.
 */
async function waitForContainerReady(
  containerId: string,
  token: string,
  { attempts = 10, delayMs = 2000 }: { attempts?: number; delayMs?: number } = {},
): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    const { status_code } = await get<{ status_code: string }>(`${GRAPH_VERSIONED}/${containerId}`, {
      fields: 'status_code',
      access_token: token,
    })
    if (status_code === 'FINISHED') return
    // ERROR and EXPIRED are terminal: Meta could not fetch or process the image,
    // and waiting longer cannot change that.
    if (status_code === 'ERROR' || status_code === 'EXPIRED') {
      throw new InstagramError(
        `Instagram media container is not publishable (status: ${status_code}).`,
      )
    }
    await sleep(delayMs)
  }
  throw new InstagramError('Timed out waiting for the Instagram media container to be ready.')
}

/**
 * The post's public link, asked for rather than built.
 *
 * `media_publish` returns an id and nothing else, so it takes a second GET.
 * Building `instagram.com/p/{id}` by hand would save the call, but the id is not
 * the shortcode a permalink uses — there is no way to derive one from the other.
 *
 * A failure here returns '' and is NOT propagated. By this point the post IS
 * published: Instagram has it and the customer can see it. Wrapping the publish
 * and this lookup in one try turns a successful post into a reported failure,
 * the caller retries, and the same thing is published twice. The caller gets the
 * post id and decides what to show in place of a link.
 */
async function permalinkOf(postId: string, token: string): Promise<string> {
  try {
    const result = await get<{ permalink?: string }>(`${GRAPH_VERSIONED}/${postId}`, {
      fields: 'permalink',
      access_token: token,
    })
    return result.permalink ?? ''
  } catch {
    return ''
  }
}

/**
 * Publish to an Instagram professional account.
 *
 * Instagram REJECTS text-only posts — there is no endpoint for one, and no
 * amount of retrying makes it work. Failing here, before any network call, is
 * how a person finds that out at the moment they can still do something about
 * it rather than after an image has been uploaded to a paid host.
 *
 *   - one image   → a media container, then `media_publish`
 *   - many images → a carousel-item container per image, each waited for, then
 *     a CAROUSEL parent referencing the children, then `media_publish`
 */
export async function publishToInstagram({
  igUserId,
  token,
  caption,
  imageUrls,
}: {
  igUserId: string
  token: string
  caption: string
  imageUrls: string[]
}): Promise<PublishResult> {
  if (imageUrls.length === 0) {
    throw new InstagramError(
      'Instagram requires at least one image; text-only posts are not supported.',
    )
  }

  let creationId: string
  if (imageUrls.length === 1) {
    const container = await postForm<{ id: string }>(`${GRAPH_VERSIONED}/${igUserId}/media`, {
      image_url: imageUrls[0],
      caption,
      access_token: token,
    })
    creationId = container.id
  } else {
    // Each child is waited for before the parent is built. A child that is still
    // fetching its image is accepted into `children` and then fails the whole
    // carousel at publish time, which reads as "the post failed" rather than
    // "image three could not be downloaded".
    //
    // Sequential, not Promise.all: a carousel is ordered, and the order the team
    // arranged the images in is the order the customer sees them in.
    const childIds: string[] = []
    for (const url of imageUrls) {
      const child = await postForm<{ id: string }>(`${GRAPH_VERSIONED}/${igUserId}/media`, {
        image_url: url,
        is_carousel_item: 'true',
        access_token: token,
      })
      await waitForContainerReady(child.id, token)
      childIds.push(child.id)
    }
    // The caption belongs to the parent. A caption on a carousel item is silently
    // discarded, so a post published that way loses its copy entirely.
    const parent = await postForm<{ id: string }>(`${GRAPH_VERSIONED}/${igUserId}/media`, {
      media_type: 'CAROUSEL',
      children: childIds.join(','),
      caption,
      access_token: token,
    })
    creationId = parent.id
  }

  await waitForContainerReady(creationId, token)

  const published = await postForm<{ id: string }>(`${GRAPH_VERSIONED}/${igUserId}/media_publish`, {
    creation_id: creationId,
    access_token: token,
  })

  return {
    platformPostId: published.id,
    permalinkUrl: await permalinkOf(published.id, token),
  }
}
