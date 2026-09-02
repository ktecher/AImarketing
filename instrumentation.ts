/**
 * Server start. The only thing here is the scheduler's clock (D89).
 *
 * Deliberately thin: this file sits outside app/, lib/ and db/, which is
 * everything `scripts/check-localhost.mjs` reads — so a `fetch` written here
 * would not be seen by the check that exists to make sure nothing leaves this
 * machine. Nothing but a timer belongs in it, and the timer's work lives in
 * lib/social/scheduler.ts where the check can see it.
 */

export async function register(): Promise<void> {
  // Next also runs `register` for the edge runtime, where setInterval and a
  // Postgres client do not belong.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const { startSweeping } = await import('@/lib/social/scheduler')
  startSweeping()
}
