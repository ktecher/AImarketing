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
  if (typeof value === 'number') return Number.isFinite(value) ? `${value.toFixed(3)} KD` : ''

  const cleaned = String(value).replace(/[^\d.]/g, '')

  // Nothing is not zero, part two. The guard above catches undefined, null and
  // '' — but everything else went through `Number(cleaned)`, and `Number('')`
  // is 0 and is finite, so "N/A", "Call for price", "—" and an exceljs formula
  // object all printed "0.000 KD": a figure the shop never set, on a poster,
  // looking exactly like a real one.
  //
  // Empty rather than a number, so `formatKwd(v) || String(v)` in
  // lib/template/render.ts falls through and paints the raw cell text instead.
  // "Call for price" on a poster is visibly wrong and someone fixes it; a
  // confident "0.000 KD" is invisibly wrong and someone prints two hundred of
  // them. Rule 2's whole point is that a figure nobody set must never appear.
  //
  if (!cleaned || !/\d/.test(cleaned)) return ''

  // A negative is refused rather than printed. `-` is stripped by the clean
  // above, so "-5" printed "5.000 KD": a data error silently turned into a
  // plausible price with the sign gone. There is no such thing as a negative
  // price in a catalogue, so this is always a broken cell, and the same
  // reasoning applies as above — better the raw text shows and somebody fixes
  // the sheet than a confident figure nobody set goes on a poster.
  if (/^\s*-/.test(String(value))) return ''

  const n = Number(cleaned)
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
