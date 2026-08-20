import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadFont, type LoadedFont } from '@/lib/template/layout'
import { renderText, type TextMode } from '@/lib/template/render-text'
import { readJson } from '@/lib/http'

export const runtime = 'nodejs'

const FONTS: Record<string, string> = {
  Cairo: 'Cairo-Variable.ttf',
  Tajawal: 'Tajawal-Regular.ttf',
  'Noto Naskh Arabic': 'NotoNaskhArabic-Variable.ttf',
}

// Fonts are parsed once and reused — loading a 600KB face per keystroke is
// pointless, and this endpoint is called on every edit.
const cache = new Map<string, LoadedFont>()
function font(name: string): LoadedFont {
  const file = FONTS[name] ?? FONTS.Cairo
  let f = cache.get(file)
  if (!f) {
    f = loadFont(readFileSync(join(process.cwd(), 'data/fonts', file)))
    cache.set(file, f)
  }
  return f
}

export async function POST(req: Request) {
  const { text, width, height, size, maxLines, mode, fontName, minScale } = await readJson(req)

  const f = font(String(fontName ?? 'Cairo'))
  const box = {
    x: 20, y: 20,
    width: Number(width) || 400,
    height: Number(height) || 200,
    size: Number(size) || 48,
    maxLines: Number(maxLines) || 2,
    minScale: Number(minScale) || 0.65,
    fontFamily: String(fontName ?? 'Cairo'),
  }

  const { svg, fitted, mode: resolved } = renderText(String(text ?? ''), f, box, (mode ?? 'auto') as TextMode)

  return Response.json({
    svg:
      `<svg xmlns="http://www.w3.org/2000/svg" width="${box.width + 40}" height="${box.height + 40}" ` +
      `viewBox="0 0 ${box.width + 40} ${box.height + 40}">` +
      `<rect x="20" y="20" width="${box.width}" height="${box.height}" fill="none" ` +
      `stroke="#c9c9c4" stroke-width="1" stroke-dasharray="4 3"/>` +
      `<g fill="currentColor">${svg}</g></svg>`,
    fitted: {
      lines: fitted.lines,
      size: Number(fitted.size.toFixed(2)),
      truncated: fitted.truncated,
      widest: Number(fitted.widest.toFixed(1)),
      direction: fitted.direction,
    },
    mode: resolved,
    shrunk: fitted.size < box.size,
  })
}
