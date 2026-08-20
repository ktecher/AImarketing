/**
 * Text layout. The hardest code in the project, and deliberately PURE — no I/O,
 * no database, no imports from sibling modules. That is what makes it testable,
 * and text-layout regressions are invisible until you are looking at 200 bad
 * posts.
 *
 * Why HarfBuzz rather than opentype.js: measured on this machine, the Arabic
 * ligature `لا` collapses two characters into ONE glyph, 644 units wide. Summing
 * the two characters gives 935 — a 45% overestimate. Per-character measurement
 * shrinks text that would have fit. Shaping and measuring are the same operation.
 */

import { Blob, Direction, Face, Font, Buffer as HBBuffer, shape } from 'harfbuzzjs'
import bidiFactory from 'bidi-js'

const bidi = bidiFactory()

/** Arabic, Arabic Supplement/Extended, and the Presentation Forms blocks. */
const ARABIC = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/

/** First strong character decides paragraph direction, per the bidi algorithm. */
const STRONG_RTL = /[֑-߿יִ-﷽ﹰ-﻿]/
const STRONG_LTR = /[A-Za-zÀ-ʸͰ-֏]/

export function hasArabic(text: string): boolean {
  return ARABIC.test(text)
}

export function baseDirection(text: string): 'rtl' | 'ltr' {
  for (const ch of text) {
    if (STRONG_RTL.test(ch)) return 'rtl'
    if (STRONG_LTR.test(ch)) return 'ltr'
  }
  return 'ltr'
}

/**
 * Isolate numeric runs so they do not reorder inside Arabic text.
 *
 * A price or a model number sitting in an Arabic run is bidi-neutral, and
 * without isolation it lands in the wrong place — "MacBook Pro 14 بوصة" is the
 * normal case in Kuwaiti retail copy, not an edge case. U+2068 FIRST STRONG
 * ISOLATE / U+2069 POP DIRECTIONAL ISOLATE is the correct pairing: it tells the
 * bidi algorithm to treat the run as a self-contained unit.
 *
 * This is the bug that shows up on demo day rather than in a spike.
 */
export function isolateNumbers(text: string): string {
  if (!hasArabic(text)) return text
  return text.replace(NUMERIC_TOKEN, (m) => `⁨${m}⁩`)
}

/**
 * A whole alphanumeric token, not the digits inside one.
 *
 * Isolating only the digit run splits a model number and the two halves then
 * reorder against each other: "14-fk0016ne" rendered as "0016nefk-14" and
 * "M4 Pro" as "4 ProM", both on real posters. The token has to be isolated
 * entire — leading letters, internal separators and a trailing unit — or the
 * isolate marks cause the exact corruption they exist to prevent.
 *
 * Leading `[A-Za-z]*` cannot swallow a neighbouring word: it only matches when
 * a digit follows, so "Windows 11" isolates "11" and leaves "Windows" alone.
 *
 * The trailing unit — the "KD" in "449.500 KD" — needs the lookahead. Without
 * it "برو 3 MFHP4ZE/A" matched "3 MFHP" as one token and left "4ZE/A" as
 * another, splitting the model number in a new place rather than the old one.
 * A unit is a word that does NOT run on into more alphanumerics.
 */
const NUMERIC_TOKEN =
  /[A-Za-z]*\d[A-Za-z\d]*(?:[.,/-][A-Za-z\d]+)*(?:\s*[A-Za-z%]+(?![A-Za-z\d]))?/g

export type LoadedFont = {
  readonly font: Font
  readonly face: Face
  /** Font design units per em — 1000 or 2048 typically. All metrics are in these. */
  readonly upem: number
  readonly ascender: number
  readonly descender: number
}

export function loadFont(data: Uint8Array): LoadedFont {
  const face = new Face(new Blob(data))
  const font = new Font(face)
  const { ascender, descender } = font.hExtents()
  return { font, face, upem: face.upem, ascender, descender }
}

export type ShapedGlyph = {
  id: number
  xAdvance: number
  xOffset: number
  yOffset: number
  cluster: number
}

export type Shaped = {
  glyphs: ShapedGlyph[]
  /** Advance width in font design units. Divide by upem, multiply by size. */
  width: number
}

/** Shapes ONE directional run. Callers must split by direction first — see below. */
export function shapeRun(text: string, f: LoadedFont, direction: 'rtl' | 'ltr'): Shaped {
  const buf = new HBBuffer()
  buf.addText(text)
  buf.guessSegmentProperties()
  buf.setDirection(direction === 'rtl' ? Direction.RTL : Direction.LTR)
  shape(f.font, buf)

  const raw = buf.getGlyphInfosAndPositions()
  const glyphs: ShapedGlyph[] = raw.map((g) => ({
    id: g.codepoint,
    xAdvance: g.xAdvance ?? 0,
    xOffset: g.xOffset ?? 0,
    yOffset: g.yOffset ?? 0,
    cluster: g.cluster,
  }))
  return { glyphs, width: glyphs.reduce((s, g) => s + g.xAdvance, 0) }
}

export type BidiRun = { text: string; direction: 'rtl' | 'ltr' }

/** Isolate marks inform the bidi algorithm; they must not reach the shaper. */
const ISOLATES = /[\u2066-\u2069\u202A-\u202E]/g

/**
 * Split text into directional runs, in VISUAL order (left to right).
 *
 * This is the step that was missing and it is not optional: HarfBuzz does not
 * implement the bidi algorithm. It shapes a single run in a single direction.
 * Hand it a whole mixed line as RTL and the digits come out reversed — "14"
 * renders as "41", "449.500" as "005.944".
 *
 * So: resolve embedding levels, apply the reorder segments to get visual order,
 * group runs of equal level, and hand each run to the shaper in logical order
 * with its own direction.
 */
export function bidiRuns(text: string): BidiRun[] {
  if (!text) return []

  const levelsResult = bidi.getEmbeddingLevels(text)
  const { levels } = levelsResult

  const order = Array.from({ length: text.length }, (_, i) => i)
  for (const [start, end] of bidi.getReorderSegments(text, levelsResult)) {
    for (let i = start, j = end; i < j; i++, j--) {
      const t = order[i]; order[i] = order[j]; order[j] = t
    }
  }

  const groups: { level: number; indices: number[] }[] = []
  for (const idx of order) {
    const level = levels[idx]
    const last = groups[groups.length - 1]
    if (last && last.level === level) last.indices.push(idx)
    else groups.push({ level, indices: [idx] })
  }

  return groups
    .map((g) => {
      // Shaping needs logical order; the run's visual position is already fixed
      // by where it sits in this array.
      const logical = [...g.indices].sort((a, b) => a - b)
      const runText = logical.map((i) => text[i]).join('').replace(ISOLATES, '')
      return { text: runText, direction: (g.level % 2 === 1 ? 'rtl' : 'ltr') as 'rtl' | 'ltr' }
    })
    .filter((r) => r.text.length > 0)
}

export type ShapedLine = {
  runs: (BidiRun & { shaped: Shaped })[]
  /** Total advance width in font design units. */
  width: number
}

/** Shape a whole line: split by direction, shape each run, keep visual order. */
export function shapeLine(text: string, f: LoadedFont): ShapedLine {
  const runs = bidiRuns(text).map((r) => ({ ...r, shaped: shapeRun(r.text, f, r.direction) }))
  return { runs, width: runs.reduce((s, r) => s + r.shaped.width, 0) }
}

/** Width of a string at a given point size, in the same units as the SVG. */
export function measure(text: string, f: LoadedFont, size: number): number {
  if (!text) return 0
  return (shapeLine(text, f).width / f.upem) * size
}

export type Box = {
  width: number
  height?: number
  /** Nominal size. Auto-fit may reduce it, never increase it. */
  size: number
  /** Floor for shrinking, as a fraction of nominal. Below this, truncate. */
  minScale?: number
  maxLines?: number
  /** Multiple of size. 1.35 suits Arabic, which has taller ascenders. */
  lineHeight?: number
}

/**
 * The height a box must have to hold `lines` lines at `size`.
 *
 * Setting this by hand has produced the same bug twice: a box shorter than this
 * can never hold its stated line count, so every long value silently truncates
 * while short sample values look fine. Derive it, never type it.
 */
export function requiredHeight(size: number, lines = 1, lineHeight = 1.35): number {
  return Math.ceil(size * lineHeight * lines) + 6
}



export type Fitted = {
  lines: string[]
  /** The size that actually fits — at or below the nominal. */
  size: number
  /** True when text had to be cut. Always surfaced in the batch report. */
  truncated: boolean
  /** Widest line, for centring and for detecting near-misses. */
  widest: number
  direction: 'rtl' | 'ltr'
}

/**
 * Greedy word wrap at a fixed size. Wrapping comes BEFORE shrinking — never
 * shrink a line that could have been two.
 */
function wrapAt(text: string, f: LoadedFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  if (!words.length) return []

  const lines: string[] = []
  let line = ''

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word
    if (measure(candidate, f, size) <= maxWidth || !line) {
      line = candidate
    } else {
      lines.push(line)
      line = word
    }
  }
  if (line) lines.push(line)
  return lines
}

/**
 * Fit text into a box: wrap, then binary-search the size down, then truncate.
 *
 * Six iterations resolves any practical range, and the search is on size rather
 * than a linear walk because each step re-wraps — a smaller size can fit more
 * words per line and change the line count entirely.
 */
export function fitText(text: string, f: LoadedFont, box: Box): Fitted {
  const clean = isolateNumbers(text.trim())
  const direction = baseDirection(clean)
  const maxLines = box.maxLines ?? 1
  const minSize = box.size * (box.minScale ?? 0.65)

  const fitsAt = (size: number) => {
    const lines = wrapAt(clean, f, size, box.width)
    const widest = Math.max(0, ...lines.map((l) => measure(l, f, size)))
    // The same helper the template builders use, so the two cannot disagree
    // about what "fits" means.
    const tall = box.height ? requiredHeight(size, lines.length, box.lineHeight) > box.height : false
    return { lines, widest, ok: lines.length <= maxLines && widest <= box.width && !tall }
  }

  const full = fitsAt(box.size)
  if (full.ok) {
    return { lines: full.lines, size: box.size, truncated: false, widest: full.widest, direction }
  }

  // The floor is a legitimate answer. Testing only strictly-interior midpoints
  // means text that fits exactly at minScale is truncated anyway.
  const atFloor = fitsAt(minSize)
  let best: { lines: string[]; size: number; widest: number } | null = atFloor.ok
    ? { lines: atFloor.lines, size: minSize, widest: atFloor.widest }
    : null
  if (!best) {
    const lines = wrapAt(clean, f, minSize, box.width).slice(0, maxLines)
    if (lines.length) {
      let last = lines[lines.length - 1]
      while (last.length > 1 && measure(`${last}…`, f, minSize) > box.width) last = last.slice(0, -1)
      lines[lines.length - 1] = `${last}…`
    }
    const widest = Math.max(0, ...lines.map((l) => measure(l, f, minSize)))
    return { lines, size: minSize, truncated: true, widest, direction }
  }

  let lo = minSize
  let hi = box.size

  for (let i = 0; i < 6; i++) {
    const mid = (lo + hi) / 2
    const r = fitsAt(mid)
    if (r.ok) { best = { lines: r.lines, size: mid, widest: r.widest }; lo = mid }
    else hi = mid
  }

  return { ...best, truncated: false, direction }
}

export type UniformFit = {
  /** The size to use for every value in the batch. */
  size: number
  /** Values that cannot fit even at the floor size, and will be cut. */
  wontFit: string[]
}

/**
 * The smallest size that fits EVERY value, for a slot rendered across a batch.
 *
 * Per-row shrinking makes 200 posts look broken when they sit in a grid at
 * different type sizes, so one size is chosen for all of them.
 *
 * It returns `wontFit` rather than just a number because the floor is a real
 * floor: when a value cannot fit even at minScale, the honest answer is "this
 * one will be cut", not a size that quietly truncates it. Those names go
 * straight into the batch report.
 */
export function uniformSize(values: string[], f: LoadedFont, box: Box): UniformFit {
  let smallest = box.size
  const wontFit: string[] = []

  for (const v of values) {
    const fitted = fitText(v, f, box)
    if (fitted.truncated) wontFit.push(v)
    else if (fitted.size < smallest) smallest = fitted.size
  }
  return { size: smallest, wontFit }
}

/**
 * Convert shaped text to SVG path data.
 *
 * This is outline mode: the Arabic is no longer text, so it cannot be edited,
 * searched, or restyled — but it is immune to whether the designer's Illustrator
 * has the Middle Eastern composer enabled, which is off by default. See
 * docs/decisions.md D14 for why this is the default path for Arabic.
 */
export function outlinePath(text: string, f: LoadedFont, size: number): string {
  const scale = size / f.upem
  const parts: string[] = []
  let x = 0

  // Run by run, left to right in visual order. Each run's glyphs are already in
  // visual order within itself, because the shaper was told its direction.
  for (const run of shapeLine(text, f).runs) {
    for (const g of run.shaped.glyphs) {
      const d = f.font.glyphToPath(g.id)
      if (d) {
        const tx = (x + g.xOffset) * scale
        const ty = g.yOffset * scale
        // Font space is y-up, SVG user space is y-down.
        parts.push(
          `<path transform="translate(${tx.toFixed(2)} ${ty.toFixed(2)}) ` +
          `scale(${scale.toFixed(5)} ${(-scale).toFixed(5)})" d="${d}"/>`,
        )
      }
      x += g.xAdvance
    }
  }
  return parts.join('')
}
