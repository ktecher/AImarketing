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
