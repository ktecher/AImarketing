/**
 * Builds and reads template SVGs.
 *
 * A template is `base.svg` plus `manifest.json`. The SVG owns GEOMETRY —
 * slots are `<rect id="slot-…">` elements — and the manifest owns POLICY: what
 * binds to what, which font, how to fit, how to format. See docs/decisions.md D13.
 *
 * That split is why a designer can nudge a box, re-export, and nothing breaks:
 * the manifest never held the coordinates in the first place.
 */

import { load } from 'cheerio'

export type SlotType = 'text' | 'image'

export type Slot = {
  /** Element id in the SVG, without the '#'. */
  id: string
  type: SlotType
  /** Column name from the product sheet. */
  bind: string
  /**
   * Literal text that replaces the bound value.
   *
   * Set on a per-product override this is a rewrite for that one poster — which
   * is how a 66-character catalogue title becomes a headline. Set on the
   * template it is a static label shown for every product.
   */
  text?: string
  font?: string
  size?: number
  minScale?: number
  maxLines?: number
  lineHeight?: number
  align?: 'start' | 'center' | 'end'
  /** 'kwd' formats as three-decimal fils. */
  format?: 'kwd'
  /** Slot is hidden when this column is empty — e.g. a SALE badge. */
  visible?: string
  /** Image fitting, mapped straight onto SVG preserveAspectRatio. */
  fit?: 'cover' | 'contain'
  fallback?: string
  colour?: string
  /** Draws a line through the text — for a was-price, never for anything else. */
  strike?: boolean
  /** Overrides the batch-wide text mode for this slot. */
  textMode?: 'auto' | 'live' | 'outline'
}

export type Manifest = {
  v: 1
  name: string
  slots: Slot[]
}

export type SlotBox = { id: string; x: number; y: number; width: number; height: number }

/** Reads slot geometry out of the SVG. The manifest never stores coordinates. */
export function readSlots(svg: string): SlotBox[] {
  const $ = load(svg, { xmlMode: true })
  const boxes: SlotBox[] = []

  $('[id^="slot-"]').each((_, el) => {
    const $el = $(el)
    const id = ($el.attr('id') ?? '').replace(/^slot-/, '')
    const num = (name: string) => Number($el.attr(name) ?? 0)
    boxes.push({ id, x: num('x'), y: num('y'), width: num('width'), height: num('height') })
  })

  return boxes
}

export type BuildTemplateArgs = {
  name: string
  width: number
  height: number
  /** Data URI or path for the background artwork. */
  background: string
  slots: SlotBox[]
}

/**
 * Emits a template SVG: artwork underneath, slot rectangles on top.
 *
 * The rects are invisible at render time but carry the geometry, and keeping
 * them in the file means the template is inspectable and hand-editable — you can
 * open it, move a rect, and the renderer follows.
 */
export function buildTemplateSvg({ name, width, height, background, slots }: BuildTemplateArgs): string {
  const rects = slots
    .map(
      (s) =>
        `  <rect id="slot-${s.id}" x="${s.x.toFixed(1)}" y="${s.y.toFixed(1)}" ` +
        `width="${s.width.toFixed(1)}" height="${s.height.toFixed(1)}" fill="none"/>`,
    )
    .join('\n')

  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <title>${name}</title>
  <image id="artwork" x="0" y="0" width="${width}" height="${height}" xlink:href="${background}" preserveAspectRatio="xMidYMid slice"/>
<g id="slots">
${rects}
</g>
</svg>`
}

/** Strips the slot rectangles from a rendered file — they are scaffolding. */

