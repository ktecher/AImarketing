/**
 * Loading templates and fonts from disk.
 *
 * Kept out of render.ts so that module stays free of I/O and remains testable
 * without a filesystem. Nothing here persists yet — templates are files on disk
 * until there is a reason for them to be rows.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { loadFont, type LoadedFont } from './layout'
import { buildTemplateSvg, type Manifest, type Slot, type SlotBox } from './svg'

const root = process.cwd()

const fontCache = new Map<string, LoadedFont>()

/** Family name as a template binds it, derived from the filename. */
export const familyOf = (file: string) =>
  file.replace(/\.(ttf|otf)$/i, '').replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim()

/**
 * Every name a font should answer to.
 *
 * A template written against "Cairo" must keep working when the file on disk is
 * `Cairo-Variable.ttf`, and a designer uploading `MyBrand-Bold.otf` should be
 * able to write either "MyBrand Bold" or "MyBrand". Aliases are cheaper than
 * asking every existing template to be rewritten.
 */
function aliasesFor(file: string): string[] {
  const full = familyOf(file)
  const withoutStyle = full.replace(/\s+(variable|vf|regular|book)$/i, '').trim()
  const firstWord = withoutStyle.split(' ')[0]
  // Longest first, so the most specific name wins if two fonts collide.
  return [...new Set([full, withoutStyle, firstWord])].filter(Boolean)
}

export function fontFiles(): string[] {
  const d = join(root, 'data/fonts')
  if (!existsSync(d)) return []
  return readdirSync(d).filter((f) => /\.(ttf|otf)$/i.test(f))
}

/**
 * Every font on disk, keyed by family.
 *
 * Read from the directory rather than a fixed list, so a font the user uploads
 * is usable the moment it lands — a hardcoded list would accept the upload and
 * then silently fail to render with it.
 */
export function fonts(): Record<string, LoadedFont> {
  const out: Record<string, LoadedFont> = {}
  for (const file of fontFiles()) {
    let f = fontCache.get(file)
    if (!f) {
      try {
        f = loadFont(readFileSync(join(root, 'data/fonts', file)))
      } catch {
        continue   // an unreadable file is skipped, not fatal to the batch
      }
      fontCache.set(file, f)
    }
    // Specific names are registered last so they win a collision.
    for (const alias of aliasesFor(file).reverse()) out[alias] = f
  }
  return out
}

/**
 * resvg takes font PATHS, not buffers. Passing buffers silently falls back to
 * system fonts, which produces output that looks right on this machine and wrong
 * everywhere else — exactly the kind of failure that survives review.
 */
export function fontDir(): string {
  return join(root, 'data/fonts')
}

export type Template = { id: string; svg: string; manifest: Manifest }

export function loadTemplate(id: string): Template | null {
  const svgPath = join(root, 'data/templates', `${id}.svg`)
  const manifestPath = join(root, 'data/templates', `${id}.json`)
  if (!existsSync(svgPath) || !existsSync(manifestPath)) return null
  return {
    id,
    svg: readFileSync(svgPath, 'utf8'),
    manifest: JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest,
  }
}

/**
 * Per-product layout overrides.
 *
 * The template owns the layout; an override is a deliberate exception for one
 * product. Stored separately from the template so it is obvious which products
 * have drifted, and so removing an override restores the template exactly.
 */
export type Override = { boxes: SlotBox[]; slots: Slot[] }

const overridePath = (id: string) => join(root, 'data/templates', `${id}.overrides.json`)

export function loadOverrides(id: string): Record<string, Override> {
  const p = overridePath(id)
  if (!existsSync(p)) return {}
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as Record<string, Override>
  } catch {
    return {}
  }
}

export function saveOverride(id: string, sku: string, override: Override | null): void {
  const all = loadOverrides(id)
  if (override) all[sku] = override
  else delete all[sku]
  writeFileSync(overridePath(id), JSON.stringify(all, null, 2))
}

/**
 * The template's own artwork and pixel size, read from its SVG once.
 *
 * Both the render route and the export route need these to rebuild a product's
 * SVG from its own boxes, and both had their own copy of these two regexes and
 * the `mine ? … : template` selection below. Identical copies, which is the
 * latent form of the fault D32/D38/D39 record: a value with one true derivation
 * computed a second time by hand, with nothing but output comparison to catch
 * the drift. One derivation, two callers.
 */
export type TemplateShape = { artwork: string; width: number; height: number }

export function templateShape(svg: string): TemplateShape {
  const artwork = /<image[^>]*id="artwork"[^>]*(?:xlink:)?href="([^"]+)"/.exec(svg)?.[1] ?? ''
  const size = /<svg[^>]*width="(\d+)"[^>]*height="(\d+)"/.exec(svg)
  return { artwork, width: size ? +size[1] : 0, height: size ? +size[2] : 0 }
}

/**
 * The SVG and manifest one product renders from.
 *
 * A product with a saved exception is rebuilt from its own boxes; everything
 * else follows the template unchanged.
 */
export function layoutFor(
  template: Template,
  shape: TemplateShape,
  override: Override | undefined,
): { svg: string; manifest: Manifest; overridden: boolean } {
  if (!override) return { svg: template.svg, manifest: template.manifest, overridden: false }
  return {
    svg: buildTemplateSvg({
      name: template.manifest.name,
      width: shape.width,
      height: shape.height,
      background: shape.artwork,
      slots: override.boxes,
    }),
    manifest: { ...template.manifest, slots: override.slots },
    overridden: true,
  }
}

/** Product photo as a data URI, so a rendered SVG is one self-contained file. */
export function productImage(sku: string): string | undefined {
  const p = join(root, 'data/samples/images', `${sku}.png`)
  if (!existsSync(p)) return undefined
  return `data:image/png;base64,${readFileSync(p).toString('base64')}`
}
