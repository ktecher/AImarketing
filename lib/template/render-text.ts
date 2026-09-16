/**
 * Turns fitted text into SVG. Kept out of layout.ts so that module stays pure —
 * this one knows about SVG, layout.ts knows only about glyphs and widths.
 */

import type { LoadedFont, Fitted } from './layout'
import { fitText, measure, outlinePath, hasArabic, type Box } from './layout'

export type TextMode = 'live' | 'outline' | 'auto'
export type Align = 'start' | 'center' | 'end'

export const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * Auto mode outlines anything containing Arabic and leaves Latin as live text.
 *
 * The designer keeps editable English — the copy they actually tweak — while the
 * Arabic is immune to whether their Illustrator has the Middle Eastern composer
 * enabled, which is off by default. See docs/decisions.md D14.
 */
export function resolveMode(text: string, mode: TextMode): 'live' | 'outline' {
  if (mode !== 'auto') return mode
  return hasArabic(text) ? 'outline' : 'live'
}

export type RenderedText = {
  svg: string
  fitted: Fitted
  mode: 'live' | 'outline'
  /**
   * Where the last line was actually painted.
   *
   * Anything drawing over the text — a strike-through — must take its range
   * from here rather than re-deriving it from `align`, because the anchor also
   * depends on the resolved direction and two derivations drift apart.
   */
  lastLine?: { x1: number; x2: number; y: number; size: number }
}

export function renderText(
  text: string,
  f: LoadedFont,
  box: Box & { x: number; y: number; fontFamily?: string; align?: Align },
  mode: TextMode = 'auto',
): RenderedText {
  const fitted = fitText(text, f, box)
  const resolved = resolveMode(text, mode)
  const lineHeight = fitted.size * (box.lineHeight ?? 1.35)
  const rtl = fitted.direction === 'rtl'

  // 'start' and 'end' follow the reading direction: start is the right edge for
  // Arabic and the left edge for English. 'center' is direction-independent.
  const align: Align = box.align ?? 'start'

  let lastLine: RenderedText['lastLine']

  const parts = fitted.lines.map((line, i) => {
    const y = box.y + fitted.size + i * lineHeight
    const w = measure(line, f, fitted.size)

    let anchorX: number
    let anchor: 'start' | 'middle' | 'end'
    if (align === 'center') {
      anchorX = box.x + box.width / 2
      anchor = 'middle'
    } else if ((align === 'start') === rtl) {
      anchorX = box.x + box.width
      anchor = 'end'
    } else {
      anchorX = box.x
      anchor = 'start'
    }

    const originForLine =
      anchor === 'middle' ? anchorX - w / 2 : anchor === 'end' ? anchorX - w : anchorX
    lastLine = { x1: originForLine, x2: originForLine + w, y, size: fitted.size }

    if (resolved === 'live') {
      return (
        `<text x="${anchorX.toFixed(1)}" y="${y.toFixed(1)}" font-family="${esc(box.fontFamily ?? 'Cairo')}" ` +
        `font-size="${fitted.size.toFixed(1)}" direction="${fitted.direction}" ` +
        `text-anchor="${anchor}" xml:space="preserve">${esc(line)}</text>`
      )
    }

    // Outlined paths are laid out left to right from the shaped advances, so the
    // origin is shifted to produce the same visual alignment as text-anchor.
    return (
      `<g transform="translate(${originForLine.toFixed(1)} ${y.toFixed(1)})" data-text="${esc(line)}">` +
      `${outlinePath(line, f, fitted.size)}</g>`
    )
  })

  return { svg: parts.join(''), fitted, mode: resolved, lastLine }
}
