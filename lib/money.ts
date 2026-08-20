/**
 * The one place a price becomes a string.
 *
 * KWD is three-decimal fils: 12.500 KD, never 12.50. Both the poster renderer
 * and the content studio print prices, and two implementations of this rule
 * drift the moment one of them is "tidied" — see CLAUDE.md rule 2.
 */
export function formatKwd(value: unknown): string {
  // Nothing is not zero. Number('') is 0 and is finite, so without this an
  // absent price prints "0.000 KD" — a figure the shop never set, on a poster.
  if (value === undefined || value === null || value === '') return ''
  const n = typeof value === 'number' ? value : Number(String(value).replace(/[^\d.]/g, ''))
  return Number.isFinite(n) ? `${n.toFixed(3)} KD` : ''
}

/**
 * Price fields nothing may bind, print, or reference — and what to use instead.
 *
 * Every product in a real catalogue can be discounted, so "the price" is
 * ambiguous: `price_kwd` is the pre-discount figure, and putting it on a poster
 * or in a caption advertises a number the customer will not be charged.
 *
 * This is the ONE list. It was three — the template palette, the renderer, and
 * nothing at all in the copy guard, which is how `{price_kwd}` reached a caption
 * as a bare "40.5" on a product selling for 19.900 KD.
 */
export const FORBIDDEN_PRICE_FIELDS: Record<string, string> = {
  price_kwd: 'price_now (what the customer pays) or price_was (the struck original)',
  sale_price_kwd: 'price_now',
  price: 'price_now',
}
