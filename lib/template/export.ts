/**
 * What marketing actually receives.
 *
 * Four formats, because a retail marketing team uses each of them for a
 * different job:
 *   PNG  — social posts and anything on screen. The default.
 *   JPG  — WhatsApp and email, where file size matters more than transparency.
 *          WhatsApp is the real sharing channel in Kuwait.
 *   SVG  — the designer's editable file. Arabic ships as outlined paths so it
 *          survives whatever Illustrator setup they have.
 *   PDF  — approvals and the print house.
 */

import { Resvg } from '@resvg/resvg-js'
import sharp from 'sharp'
import PDFDocument from 'pdfkit'

export type Format = 'png' | 'jpg' | 'svg' | 'pdf'

export const FORMATS: { id: Format; label: string; use: string }[] = [
  { id: 'png', label: 'PNG', use: 'social posts, presentations, anything on screen' },
  { id: 'jpg', label: 'JPG', use: 'WhatsApp and email — smaller files' },
  { id: 'svg', label: 'SVG', use: 'editable in Illustrator or Figma' },
  { id: 'pdf', label: 'PDF', use: 'approvals and the print house' },
]

export function renderPng(svg: string, fontDir: string, width: number): Buffer {
  return new Resvg(svg, {
    fitTo: { mode: 'width', value: width },
    font: { fontDirs: [fontDir], defaultFontFamily: 'Cairo', loadSystemFonts: false },
  })
    .render()
    .asPng()
}

export async function toJpg(png: Buffer): Promise<Buffer> {
  // Flattened onto white: JPEG has no transparency, and an unflattened alpha
  // channel turns into black edges.
  return sharp(png).flatten({ background: '#ffffff' }).jpeg({ quality: 90 }).toBuffer()
}

/**
 * A single-page PDF the size of the design.
 *
 * The page carries the rendered image rather than vector artwork, which is
 * honest for this input: the brand artwork is itself a raster file, so a vector
 * PDF would gain nothing. It is RGB, so it is a proof and an approval artifact,
 * not a print master — a print house wanting CMYK needs a conversion step.
 */
export async function toPdf(png: Buffer, widthPt: number, heightPt: number): Promise<Buffer> {
  const doc = new PDFDocument({ size: [widthPt, heightPt], margin: 0 })
  const chunks: Buffer[] = []
  doc.on('data', (c: Buffer) => chunks.push(c))
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))))
  doc.image(png, 0, 0, { width: widthPt, height: heightPt })
  doc.end()
  return done
}

/** Filenames a person can sort: SKU first, then a trimmed name. */
export function safeName(sku: string, name: string, ext: string): string {
  const slug = name.replace(/[^\w؀-ۿ -]+/g, '').trim().replace(/\s+/g, '-').slice(0, 48)
  return `${sku}${slug ? `-${slug}` : ''}.${ext}`
}
