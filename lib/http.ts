/**
 * Reading a request body without turning a malformed one into a 500.
 *
 * `req.json()` and `req.formData()` THROW on a body that is empty, truncated, or
 * not what the Content-Type promised. Unhandled in a route handler that becomes
 * a 500 with an empty response body — the caller is told nothing, and the log
 * says "unhandled rejection" rather than "someone posted junk".
 *
 * Measured across this app: six routes did exactly that.
 */
import { NextResponse } from 'next/server'

/**
 * Parsed body, or `{}` when there wasn't one.
 *
 * Defaults to unknown-valued fields rather than `any`, so a route that forgets
 * to coerce a value gets told. Every current call site already coerces with
 * String()/Number(), because a JSON body is user input either way.
 */
export async function readJson<T extends object = Record<string, unknown>>(
  req: Request,
): Promise<Partial<T>> {
  try {
    const body = await req.json()
    return body && typeof body === 'object' ? (body as Partial<T>) : {}
  } catch {
    return {}
  }
}

/** Form body, or a ready-made 400 explaining what was wrong with the request. */
export async function readForm(req: Request): Promise<FormData | NextResponse> {
  try {
    return await req.formData()
  } catch {
    return NextResponse.json(
      { error: 'That request carried no form data. Upload the file again.' },
      { status: 400 },
    )
  }
}

export const isResponse = (v: unknown): v is NextResponse => v instanceof NextResponse

/**
 * Parsed body, or a ready-made 400 — for a route where "the body was junk" and
 * "the body was fine and left the field out" mean DIFFERENT things.
 *
 * `readJson` cannot tell them apart: both come back as `{}`. Four routes read
 * an absent `skus` as "then do the whole catalogue", so `curl --data 'not json'`
 * against `/api/export` rendered all 62 designs, wrote 62 `assets` rows, and
 * answered 200. A typo is not a request to do everything.
 *
 * Same shape as `readForm`, so the same `isResponse` check: an unparseable body
 * never reaches the route's own logic, and a valid one keeps every default it
 * had — the Designs page really does omit `skus` to mean the whole sheet.
 */
export async function readJsonStrict<T extends object = Record<string, unknown>>(
  req: Request,
): Promise<Partial<T> | NextResponse> {
  try {
    const body = await req.json()
    // A bare string, number or array parses but has no fields to read, so it is
    // junk to every caller of this — not an empty object.
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('not an object')
    return body as Partial<T>
  } catch {
    return NextResponse.json(
      { error: 'That request body was not readable JSON. Send a JSON object, or nothing at all.' },
      { status: 400 },
    )
  }
}
