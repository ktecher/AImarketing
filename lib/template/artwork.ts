/**
 * Turning a piece of brand artwork into a template.
 *
 * Marketing supplies a background — a JPEG, a PNG, an AVIF exported from
 * wherever. What comes back is a template SVG with slot rectangles placed inside
 * the artwork's usable area, ready to be moved around in the editor.
 */

import sharp from 'sharp'
import { buildTemplateSvg, type Manifest, type SlotBox } from './svg'
import { requiredHeight } from './layout'

export type SafeArea = { x: number; y: number; width: number; height: number }

/**
 * The largest rectangle of near-white space, grown outward from the centre.
 *
 * Brand artwork is almost always a decorated border around a clear middle, so
 * one rectangle is enough. Measuring beats eyeballing: placement by eye has put
 * text over the decoration every time it has been tried.
 */
export async function measureSafeArea(png: Buffer): Promise<SafeArea> {
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true })
  const { width: w, height: h, channels: ch } = info

  const clean = (x: number, y: number) => {
    const i = (y * w + x) * ch
    return data[i] > 244 && data[i + 1] > 244 && data[i + 2] > 244
  }
  const rowClean = (y: number, x0: number, x1: number) => {
    for (let x = x0; x <= x1; x++) if (!clean(x, y)) return false
    return true
  }
  const colClean = (x: number, y0: number, y1: number) => {
    for (let y = y0; y <= y1; y++) if (!clean(x, y)) return false
    return true
  }

  let top = Math.floor(h / 2), bottom = top, left = Math.floor(w / 2), right = left
  if (!clean(left, top)) {
    // A dark or busy centre means there is no clear area to find; fall back to a
    // generous inset rather than pretending to have measured something.
    return { x: Math.round(w * 0.1), y: Math.round(h * 0.1), width: Math.round(w * 0.8), height: Math.round(h * 0.8) }
  }

  let grew = true
  while (grew) {
    grew = false
    if (top > 0 && rowClean(top - 1, left, right)) { top--; grew = true }
    if (bottom < h - 1 && rowClean(bottom + 1, left, right)) { bottom++; grew = true }
    if (left > 0 && colClean(left - 1, top, bottom)) { left--; grew = true }
    if (right < w - 1 && colClean(right + 1, top, bottom)) { right++; grew = true }
  }

  return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 }
}

const SIZES = { nameEn: 22, nameAr: 20, was: 15, now: 32 }

/** A sensible starting layout. The editor exists so it does not have to be right. */
export function defaultSlots(safe: SafeArea): { boxes: SlotBox[]; manifest: Manifest['slots'] } {
  const gap = 4
  const heights = {
    nameEn: requiredHeight(SIZES.nameEn, 2),
    nameAr: requiredHeight(SIZES.nameAr, 2),
    was: requiredHeight(SIZES.was, 1),
    now: requiredHeight(SIZES.now, 1),
  }
  const textTotal = heights.nameEn + heights.nameAr + heights.was + heights.now + gap * 3
  const imageH = Math.max(60, safe.height - textTotal - gap)

  let y = safe.y
  const box = (id: string, height: number, inset = 0): SlotBox => {
    const b = { id, x: safe.x + inset, y, width: safe.width - inset * 2, height }
    y += height + gap
    return b
  }

  const boxes = [
    box('image', imageH, Math.round(safe.width * 0.06)),
    box('name_en', heights.nameEn),
    box('name_ar', heights.nameAr),
    box('price_was', heights.was),
    box('price_now', heights.now),
  ]

  return {
    boxes,
    manifest: [
      { id: 'image', type: 'image', bind: 'image', fit: 'contain' },
      { id: 'name_en', type: 'text', bind: 'name_en', font: 'Cairo', size: SIZES.nameEn,
        maxLines: 2, align: 'center', colour: '#1a1a19' },
      // Two lines: measured on a real Kuwaiti catalogue, Arabic names run longer
      // than their English equivalents, not shorter.
      { id: 'name_ar', type: 'text', bind: 'name_ar', font: 'Cairo', size: SIZES.nameAr,
        maxLines: 2, align: 'center', colour: '#1a1a19' },
      { id: 'price_was', type: 'text', bind: 'price_was', format: 'kwd', font: 'Cairo',
        size: SIZES.was, maxLines: 1, align: 'center', colour: '#8a8a86',
        visible: 'price_was', strike: true },
      { id: 'price_now', type: 'text', bind: 'price_now', format: 'kwd', font: 'Cairo',
        size: SIZES.now, maxLines: 1, align: 'center', colour: '#0f8a86' },
    ],
  }
}

export type BuiltTemplate = {
  svg: string
  manifest: Manifest
  width: number
  height: number
  safe: SafeArea
  /** Set when the upload is too small to print well. */
  warning?: string
}

export async function templateFromArtwork(file: Buffer, name: string): Promise<BuiltTemplate> {
  // Everything becomes PNG: AVIF and WebP decode fine here but embedding them in
  // an SVG is a bet on every downstream renderer supporting them.
  const png = await sharp(file).png().toBuffer()
  const { width = 0, height = 0 } = await sharp(png).metadata()
  if (!width || !height) throw new Error('That file could not be read as an image.')

  const safe = await measureSafeArea(png)
  const { boxes, manifest } = defaultSlots(safe)

  // A4 at 300dpi is 2480px wide. Anything much under that prints soft.
  const warning = width < 1200
    ? `The artwork is ${width}×${height}. That is fine on screen, but roughly ` +
      `${Math.round((width / 2480) * 100)}% of the resolution A4 needs at 300dpi, so it will print soft.`
    : undefined

  return {
    svg: buildTemplateSvg({
      name, width, height,
      background: `data:image/png;base64,${png.toString('base64')}`,
      slots: boxes,
    }),
    manifest: { v: 1, name, slots: manifest },
    width, height, safe, warning,
  }
}
