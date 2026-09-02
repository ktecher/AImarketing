/**
 * Putting a rendered image somewhere Meta can fetch it from.
 *
 * Meta does not accept image bytes — it takes a public URL and goes and gets the
 * image itself (see the note at the top of `meta.ts`). Rendered artwork lives on
 * this machine, which Meta cannot reach, so publishing needs exactly one thing
 * from the outside world: a host that will serve a PNG over HTTPS.
 *
 * That is the whole job of this module. It is a signed POST and a signed DELETE,
 * written against Cloudinary's REST API with `fetch`, because the `cloudinary`
 * SDK is a dependency, a bundle, and an update treadmill in exchange for two
 * form posts. No database knowledge: it takes bytes, returns a URL, and forgets.
 *
 * THE API SECRET NEVER LEAVES THIS FILE. It is not returned, not logged, and not
 * put in an error message — it goes into a SHA-1 digest and nowhere else. A
 * leaked Cloudinary secret lets anyone upload to and delete from this account.
 */

import { createHash } from 'node:crypto'

const UPLOAD_BASE = 'https://api.cloudinary.com/v1_1'

/** Where uploads land, so the account stays browsable when it fills up. */
const DEFAULT_FOLDER = 'aimarketing'

/**
 * One credential, or an error naming the variable that is missing.
 *
 * The source this was ported from asserted these with `!` and let a missing one
 * surface as a Cloudinary "unknown api_key" four calls later. Naming the
 * variable is the difference between a two-minute fix and an afternoon.
 */
function credential(name: 'CLOUDINARY_CLOUD_NAME' | 'CLOUDINARY_API_KEY' | 'CLOUDINARY_API_SECRET'): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(
      `${name} is not set. Publishing needs CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and ` +
        'CLOUDINARY_API_SECRET in .env.local before an image can be handed to Meta.',
    )
  }
  return value
}

/**
 * Cloudinary's signature over the request params.
 *
 * The scheme is fixed by Cloudinary: sort the signed params by key, join them as
 * `k=v` with `&`, append the API secret, SHA-1, hex. Only the params Cloudinary
 * counts as signed go in — `file`, `api_key`, `cloud_name`, `resource_type` and
 * the signature itself are excluded, and including one of them produces a
 * signature mismatch with no hint as to which extra field caused it.
 */
function sign(params: Record<string, string>): string {
  const toSign = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&')
  return createHash('sha1')
    .update(toSign + credential('CLOUDINARY_API_SECRET'))
    .digest('hex')
}

/** Cloudinary counts timestamps in whole seconds, and rejects a stale one. */
const now = () => Math.floor(Date.now() / 1000).toString()

/**
 * Upload an image and return the URL Meta will fetch it from.
 *
 * `url` is Cloudinary's `secure_url` — the HTTPS one. Meta refuses plain HTTP,
 * so the insecure variant Cloudinary also returns is never the right field.
 */
export async function upload(
  bytes: Uint8Array | Blob,
  opts: { folder?: string } = {},
): Promise<{ url: string; publicId: string }> {
  const folder = opts.folder ?? DEFAULT_FOLDER
  const timestamp = now()

  const body = new FormData()
  body.append('file', bytes instanceof Blob ? bytes : new Blob([bytes as BlobPart]))
  body.append('api_key', credential('CLOUDINARY_API_KEY'))
  body.append('timestamp', timestamp)
  body.append('signature', sign({ folder, timestamp }))
  body.append('folder', folder)

  const res = await fetch(`${UPLOAD_BASE}/${credential('CLOUDINARY_CLOUD_NAME')}/image/upload`, {
    method: 'POST',
    body,
  })
  if (!res.ok) throw new Error(`Cloudinary upload failed (HTTP ${res.status}).`)

  const result = (await res.json()) as { public_id?: string; secure_url?: string }
  // A 200 with the wrong shape is still a failure, and returning a partial
  // result here would hand Meta an `undefined` URL and blame the publish.
  if (!result.public_id || !result.secure_url) {
    throw new Error('Cloudinary upload returned an unexpected response.')
  }
  return { url: result.secure_url, publicId: result.public_id }
}

/**
 * Delete an uploaded image.
 *
 * "not found" is success: this runs as cleanup after a publish, and an asset
 * already gone is the state we were asking for. Treating it as an error would
 * make a retried cleanup fail louder than the thing it is cleaning up after.
 */
export async function remove(publicId: string): Promise<void> {
  const timestamp = now()

  const body = new FormData()
  body.append('public_id', publicId)
  body.append('api_key', credential('CLOUDINARY_API_KEY'))
  body.append('timestamp', timestamp)
  body.append('signature', sign({ public_id: publicId, timestamp }))

  const res = await fetch(`${UPLOAD_BASE}/${credential('CLOUDINARY_CLOUD_NAME')}/image/destroy`, {
    method: 'POST',
    body,
  })
  if (!res.ok) throw new Error(`Cloudinary delete failed (HTTP ${res.status}).`)

  const result = (await res.json()) as { result?: string }
  if (result.result && result.result !== 'ok' && result.result !== 'not found') {
    throw new Error(`Cloudinary delete returned "${result.result}".`)
  }
}
