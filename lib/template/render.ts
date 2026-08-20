/**
 * Puts a product row into a template and returns a finished SVG.
 *
 * This is where the three halves meet: geometry from the SVG, policy from the
 * manifest, and text layout from layout.ts. It stays deliberately dumb — every
 * hard decision was already made in one of those three.
 */

import { load } from 'cheerio'
import { requiredHeight, type LoadedFont } from './layout'
import { readSlots, type Manifest, type Slot } from './svg'
import { renderText, type TextMode } from './render-text'
import { formatKwd, FORBIDDEN_PRICE_FIELDS } from '../money'

export type ProductValues = Record<string, string | number | undefined>

export type SlotReport = {
  slot: string
  /** The box is too short for its own size and line count — fix the template. */
  boxTooShort?: { need: number; have: number }
  /** Text had to be cut to fit — the design is wrong and someone must look. */
  truncated?: boolean
  /** Font was reduced below nominal to fit. */
  shrunkTo?: number
  /** Bound column had no value. */
  empty?: boolean
  /** Image slot with no image. */
  missingImage?: boolean
  /**
   * The slot carries literal text AND a binding, so every product prints the
   * same words and the column is ignored. Saved on a template rather than on
   * one product this stamps one row's text across the whole catalogue.
   */
  literalText?: { printing: string; insteadOf: string }
}

export type RenderResult = {
  svg: string
  /** Faults in the template itself — identical for every product. */
  templateFaults: SlotReport[]
  /** What each slot actually printed, so an editor can show and rewrite it. */
  resolved: Record<string, string>
  /** Everything that needed attention. A silent bad design is the failure mode. */
  report: SlotReport[]
}

/**
 * Fields a template must never bind.
 *
 * Every product in a real catalogue can be discounted, and a template binding
 * the regular price of a discounted product advertises a number the customer
 * will not be charged. There is no safe default here, so there is no fallback —
 * binding one of these is an error, and `price_now` / `price_was` are the only
 * price fields a template can see.
 */
const FORBIDDEN_BINDS = FORBIDDEN_PRICE_FIELDS

export class TemplateBindError extends Error {}

/** Resolves a slot's value to the string that will be painted. */
export function formatValue(value: string | number | undefined, slot: Slot): string {
  if (value === undefined || value === '') return slot.fallback ?? ''
  if (slot.type === 'text' && FORBIDDEN_BINDS[slot.bind]) {
    throw new TemplateBindError(
      `Slot "${slot.id}" binds "${slot.bind}". Use ${FORBIDDEN_BINDS[slot.bind]} instead — ` +
        `binding the regular price of a discounted product puts the wrong number on the poster.`,
    )
  }
  if (slot.format === 'kwd') return formatKwd(value) || String(value)
  return String(value)
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function renderProduct(
  templateSvg: string,
  manifest: Manifest,
  rawValues: ProductValues,
  fonts: Record<string, LoadedFont>,
  opts: { mode?: TextMode; images?: Record<string, string> } = {},
): RenderResult {
  // Derived at render time rather than carried in the sheet, so a badge can
  // never disagree with the two prices printed beside it.
  const values: ProductValues = { ...rawValues }
  // Derived from the two prices that will be printed, and any incoming label or
  // percentage is discarded. Accepting either lets a badge disagree with the
  // numbers beside it — including a sheet's own stale "Discount %" column.
  delete values.discount_label
  const now = Number(values.price_now)
  const was = Number(values.price_was)
  if (Number.isFinite(now) && Number.isFinite(was) && was > now && now >= 0) {
    values.discount_pct = Math.round((1 - now / was) * 100)
    values.discount_label = `-${values.discount_pct}%`
  } else {
    delete values.discount_pct
  }

  // The short name falls back to the catalogue title HERE, not in whatever
  // loaded the row. A batch script that reads a sheet straight off disk, a
  // designer's one-off, and the app all bind the same slot; a fallback that
  // lives in one loader renders an empty box for every other caller.
  if (!values.display_name) values.display_name = values.name_en

  const boxes = new Map(readSlots(templateSvg).map((b) => [b.id, b]))
  const report: SlotReport[] = []
  const painted: string[] = []
  const resolved: Record<string, string> = {}
  const templateFaults: SlotReport[] = []

  for (const slot of manifest.slots) {
    const box = boxes.get(slot.id)
    if (!box) continue

    // A slot can be conditional — the SALE badge disappears when there is no
    // sale price, rather than printing an empty box.
    if (slot.visible && !values[slot.visible]) continue

    if (slot.type === 'image') {
      const href = opts.images?.[slot.bind]
      if (!href) {
        report.push({ slot: slot.id, missingImage: true })
        // Visible placeholder, never a silently blank design.
        painted.push(
          `<g><rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" ` +
            `fill="#f2f2f0" stroke="#d8d8d4" stroke-dasharray="6 4"/>` +
            `<text x="${box.x + box.width / 2}" y="${box.y + box.height / 2}" text-anchor="middle" ` +
            `font-family="sans-serif" font-size="14" fill="#9a9a96">IMAGE MISSING</text></g>`,
        )
        continue
      }
      const fit = slot.fit === 'contain' ? 'xMidYMid meet' : 'xMidYMid slice'
      painted.push(
        `<image x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" ` +
          `preserveAspectRatio="${fit}" href="${esc(href)}"/>`,
      )
      continue
    }

    // A literal always wins over the binding, and is never reformatted — if
    // somebody typed it, it is what they meant.
    const text = slot.text?.trim() ? slot.text : formatValue(values[slot.bind], slot)

    // But "somebody typed it" is only safe when they knew the scope. The editor
    // pre-fills that box with the PREVIEW product's own value, so saving the
    // template rather than the product silently stamps one row's text onto all
    // of them — sixty posters carried one laptop's Arabic name this way, every
    // slot filled and every check passing. It is a template fault, not a
    // per-product one, and there is no reset for it as there is for overrides.
    if (slot.text?.trim() && slot.bind) {
      templateFaults.push({
        slot: slot.id,
        literalText: { printing: slot.text.trim(), insteadOf: slot.bind },
      })
    }
    resolved[slot.id] = text
    if (!text) {
      report.push({ slot: slot.id, empty: true })
      continue
    }

    const font = fonts[slot.font ?? 'Cairo'] ?? Object.values(fonts)[0]
    const nominal = slot.size ?? 32

    const { svg, fitted, lastLine } = renderText(text, font, {
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      size: nominal,
      minScale: slot.minScale,
      maxLines: slot.maxLines ?? 1,
      lineHeight: slot.lineHeight,
      fontFamily: slot.font ?? 'Cairo',
      align: slot.align,
    }, slot.textMode ?? opts.mode ?? 'auto')

    // A box that cannot hold its stated line count is a fault in the TEMPLATE,
    // not in this product. Reported per product it would flag all 200 and bury
    // the real per-product truncations, so it goes in its own list.
    const need = requiredHeight(nominal, slot.maxLines ?? 1, slot.lineHeight)
    if (box.height < need) {
      templateFaults.push({ slot: slot.id, boxTooShort: { need, have: Math.round(box.height) } })
    }

    if (fitted.truncated) report.push({ slot: slot.id, truncated: true })
    else if (fitted.size < nominal) report.push({ slot: slot.id, shrunkTo: Number(fitted.size.toFixed(1)) })

    let extra = ''
    if (slot.strike && lastLine) {
      // Drawn, because resvg does not honour text-decoration — and positioned
      // from where the text was ACTUALLY painted. Re-deriving the range from
      // `align` alone puts the line 110px away from an RTL price, which is the
      // un-struck was-price bug all over again.
      const y = lastLine.y - lastLine.size * 0.3
      extra =
        `<line x1="${lastLine.x1.toFixed(1)}" y1="${y.toFixed(1)}" ` +
        `x2="${lastLine.x2.toFixed(1)}" y2="${y.toFixed(1)}" ` +
        `stroke="${slot.colour ?? '#1a1a19'}" stroke-width="${Math.max(1, lastLine.size * 0.06).toFixed(1)}"/>`
    }

    painted.push(`<g fill="${slot.colour ?? '#1a1a19'}">${svg}${extra}</g>`)
  }

  // Drop the scaffolding rects, then paint the content over the artwork.
  const $ = load(templateSvg, { xmlMode: true })
  $('#slots').remove()
  const base = $.xml()
  // A function replacement, because a literal "$&" or "$'" in a product name
  // is a substitution pattern in the string form and corrupts the document.
  const svg = base.replace(/<\/svg>\s*$/, () => `${painted.join('\n')}\n</svg>`)

  return { svg, report, resolved, templateFaults }
}
