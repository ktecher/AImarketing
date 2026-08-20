/**
 * The approved copy, as a spreadsheet marketing can actually work from.
 *
 * Excel rather than a ZIP of text files: this is the tool the team already has
 * open, a caption is one cell they can copy, and the whole set sorts and filters
 * without anything being installed.
 *
 * Only APPROVED pieces leave. That is the studio's entire gate — a draft is a
 * suggestion, and a suggestion in a file that looks like a deliverable will be
 * posted by somebody eventually.
 */

import ExcelJS from 'exceljs'
import { fill } from '@/lib/content/guard'
import { allPieces, type Piece } from '@/lib/content/studio'

type Row = { piece: Piece; values: Record<string, unknown> }

const COLUMNS = [
  { header: 'SKU', width: 14, note: 'Which product this belongs to.' },
  { header: 'Product', width: 30, note: 'The short name, or the full title if nobody has shortened it.' },
  { header: 'Channel', width: 12, note: 'The channel this was written for. Register differs; do not move a Snapchat hook onto Instagram without reading it.' },
  { header: 'Type', width: 11, note: 'Slogan, caption, hashtags, or video script.' },
  { header: 'Copy', width: 70, note: 'Ready to post. Prices are the catalogue prices AS OF THE EXPORT DATE on the cover sheet — re-export if they have moved.' },
  { header: 'Do not say', width: 40, note: 'Guidance for whoever is on camera. This is not copy and does not get posted.' },
  { header: 'Approved', width: 18, note: 'When a person approved this line.' },
  { header: 'Written by', width: 14, note: '"model" or "you" — a line you edited is recorded as yours.' },
  { header: 'Model', width: 16, note: 'Which local model produced it.' },
  { header: 'Prompt', width: 13, note: 'Prompt version, so an odd line can be traced to how it was asked for.' },
]

/** How a script reads in one cell. Labelled, because the fields are not obvious. */
function scriptBody(p: Piece): string {
  if (!p.script) return p.text
  return [`HOOK: ${p.script.hook}`, '', p.script.body, '', `SAY: ${p.script.say}`].join('\n')
}

const stamp = (iso?: string) => (iso ? iso.slice(0, 16).replace('T', ' ') : '')

/**
 * @param products the catalogue, keyed by SKU, for substituting placeholders
 * @param at export time — passed in rather than read here, so the caller owns
 *   the clock and this stays testable
 */
export async function buildCopyWorkbook(
  products: Record<string, Record<string, unknown>>,
  at: Date,
): Promise<{ buffer: Buffer; count: number; products: number }> {
  const rows: Row[] = allPieces()
    .filter((p) => p.status === 'approved')
    .map((p) => ({ piece: p, values: products[p.sku] ?? {} }))
    // Grouped by product, then by type, so one product's set reads together.
    .sort(
      (a, b) =>
        a.piece.sku.localeCompare(b.piece.sku) ||
        a.piece.kind.localeCompare(b.piece.kind) ||
        a.piece.id.localeCompare(b.piece.id),
    )

  const wb = new ExcelJS.Workbook()
  wb.creator = 'AImarketing'
  wb.created = at

  const ws = wb.addWorksheet('Approved copy', { views: [{ state: 'frozen', ySplit: 1 }] })
  ws.columns = COLUMNS.map((c) => ({ header: c.header, width: c.width }))

  const head = ws.getRow(1)
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1B5E4A' } }
  head.alignment = { vertical: 'middle' }
  head.height = 26
  COLUMNS.forEach((c, i) => { head.getCell(i + 1).note = c.note })

  for (const { piece, values } of rows) {
    const row = ws.addRow([
      piece.sku,
      String(values.display_name ?? values.name_en ?? ''),
      piece.channel,
      piece.kind === 'script' ? 'video script' : piece.kind,
      // Filled here, not stored filled. What leaves is postable; what stays
      // keeps its placeholders and survives the next price change.
      fill(piece.kind === 'script' ? scriptBody(piece) : piece.text, values),
      piece.script?.avoid.join('\n') ?? '',
      stamp(piece.approved_at),
      piece.source === 'human' ? 'you' : 'model',
      piece.model,
      piece.prompt_version,
    ])
    row.alignment = { wrapText: true, vertical: 'top' }
    row.getCell(1).alignment = { vertical: 'top' }
  }

  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: COLUMNS.length } }

  // ---- Cover sheet: what this is, and the one thing that can go stale -----
  const about = wb.addWorksheet('Read me')
  about.columns = [{ width: 24 }, { width: 96 }]
  const line = (a: string, b: string) => {
    const r = about.addRow([a, b])
    r.getCell(1).font = { bold: true }
    r.getCell(2).alignment = { wrapText: true, vertical: 'top' }
    r.height = Math.max(18, Math.ceil(b.length / 92) * 15)
  }
  const title = (t: string) => {
    const r = about.addRow([t, ''])
    r.font = { bold: true, size: 13 }
    r.height = 24
  }

  title('Approved copy')
  about.addRow([])
  line('Exported', stamp(at.toISOString()))
  const skus = new Set(rows.map((r) => r.piece.sku)).size
  line(
    'What is in here',
    `${rows.length} approved ${rows.length === 1 ? 'piece' : 'pieces'} across ` +
      `${skus} ${skus === 1 ? 'product' : 'products'}. Drafts are not included — only lines a person approved.`,
  )
  line(
    'Prices are frozen',
    'Inside the system a caption stores {price_now} and the price is filled in when it is read, so it can never go stale. ' +
      'The moment it is exported, that stops being true: the figures in this file are the catalogue prices as of the export ' +
      'time above. If prices move, export again rather than editing this file.',
  )
  line('English only', 'Arabic copy is not generated. Kuwaiti dialect from a model reads as translated, which is worse than English here — see docs/decisions.md D7.')
  line('Video scripts', 'The "Do not say" column is guidance for whoever is on camera. It is not copy and does not get posted.')
  line('Nothing left the machine', 'Every line here was written by a model running on this computer. No catalogue row and no draft reached an outside service.')

  return {
    buffer: Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer),
    count: rows.length,
    products: new Set(rows.map((r) => r.piece.sku)).size,
  }
}
