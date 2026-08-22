/**
 * Reads a real retail product sheet.
 *
 * Real sheets are messy: headers below row 1, merged cells, blank and duplicate
 * SKUs, prices stored as text with "KD" in the string, images embedded rather
 * than referenced. The contract is SKIP AND REPORT — one bad row must never kill
 * a 200-row batch, and every skip names its row and reason.
 *
 * exceljs, not SheetJS: only exceljs exposes image anchors, which is the only
 * way to know which embedded image belongs to which row.
 */

import ExcelJS from 'exceljs'
import JSZip from 'jszip'

/**
 * Removes cell-comment relationships before exceljs sees the workbook.
 *
 * exceljs 4.4.0 looks for the comment part at `xl/comments1.xml` and keys it as
 * `../comments1.xml`. A workbook that stores it at `xl/comments/comment1.xml`
 * with an ABSOLUTE relationship target — which is what the real retailer export
 * does — matches neither, so the part is never parsed, and `reconcile` then
 * dereferences the missing entry and throws
 * "Cannot read properties of undefined (reading 'comments')" before a single
 * row is read. A 2 MB sheet failed in 27 ms with no usable message.
 *
 * Nothing here reads cell comments, so the relationship is dropped rather than
 * repaired: repairing means guessing the layout exceljs wants, and the next
 * exporter would guess differently.
 *
 * Only rewrites when such a relationship is present, so the ordinary sheet is
 * handed to exceljs byte-for-byte as it arrived.
 */
const COMMENT_REL = /<Relationship\b[^>]*\/(?:comments|vmlDrawing)"[^>]*\/>/g

export async function withoutCommentRels(data: ArrayBuffer | Buffer): Promise<ArrayBuffer | Buffer> {
  let zip
  try {
    zip = await JSZip.loadAsync(data as ArrayBuffer)
  } catch {
    return data // not a zip at all; let exceljs produce the error
  }
  const relFiles = Object.keys(zip.files).filter((n) => n.endsWith('.rels'))
  let touched = false
  for (const name of relFiles) {
    const xml = await zip.files[name].async('string')
    if (!COMMENT_REL.test(xml)) continue
    COMMENT_REL.lastIndex = 0
    zip.file(name, xml.replace(COMMENT_REL, ''))
    touched = true
  }
  if (!touched) return data
  return zip.generateAsync({ type: 'nodebuffer' })
}

export type ProductRow = {
  row: number
  sku: string
  /**
   * What the customer actually pays. Templates bind THIS, never a field called
   * "price" — see the note on priceFields below.
   */
  price_now?: number
  /** The struck-through original. Undefined when the product is not discounted. */
  price_was?: number
  on_sale?: boolean
  discount_pct?: number
  name_en?: string
  /**
   * The short name a poster and a caption use. A catalogue title is not a
   * headline — median 66 characters here against the 16-35 a Kuwaiti retail
   * poster uses. Optional: absent, everything falls back to `name_en`.
   */
  display_name?: string
  name_ar?: string
  brand?: string
  category?: string
  price_kwd?: number
  sale_price_kwd?: number
  description_en?: string
  description_ar?: string
  /** Extension of the embedded image, if the sheet carried one for this row. */
  image?: { extension: string; buffer: Buffer }
  /** Every column we did not map, kept verbatim so nothing is silently lost. */
  extra: Record<string, string>
}

export type Issue = { row: number; reason: string; severity: 'warning' | 'error' }

export type ParseResult = {
  products: ProductRow[]
  issues: Issue[]
  /** Header text exactly as it appeared. This vocabulary is the project's spine. */
  headers: string[]
  /** Which header each known field was matched to, for showing the user. */
  mapping: Record<string, string>
  sheetName: string
}

/**
 * Header matching. Deliberately generous — a real sheet says "Price", "Price
 * (KD)", "السعر", or "unit price" and all of them mean the same column.
 */
const PATTERNS: Record<string, RegExp> = {
  sku: /^(sku|code|item\s*(code|no|number)|model\s*(no|number)?|part\s*(no|number)|رمز|كود)$/i,
  // Word boundaries matter here. A bare /ar/ matches "Warranty" and silently
  // steals the column; a bare /en/ would match half the sheet.
  // Matched before name_en: "Display Name" would otherwise be claimed by the
  // name_en pattern, and the sheet would silently lose its short names.
  display_name: /^(display|short|poster|headline)\s*(name|title)$|^اسم\s*مختصر$/i,
  name_en: /\b(en|eng|english)\b|^(product\s*)?(name|title)$|^product$/i,
  name_ar: /\b(ar|arabic)\b|عرب|^الاسم|^اسم/i,
  brand: /^(brand|manufacturer|make|الماركة|العلامة)$/i,
  category: /^(category|type|department|group|الفئة|القسم)$/i,
  price_kwd: /^(price|unit\s*price|retail|rrp|list\s*price)\s*\(?(kd|kwd)?\)?$|^السعر$/i,
  sale_price_kwd: /(sale|offer|discount|special|promo).*(price)?|^(price)?.*(sale|offer)|^سعر\s*العرض/i,
  description_en: /^(description|details|specs?|features)\b(?!.*\b(ar|arabic)\b)/i,
  description_ar: /^(description|details|الوصف)\b.*\b(ar|arabic)\b|^الوصف/i,
}

/** Prices arrive as "12.500", "12.500 KD", "KD 12.500", "1,250.000" or a number. */
function parsePrice(v: unknown): number | undefined {
  if (v === null || v === undefined || v === '') return undefined
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined
  const cleaned = String(v).replace(/[^\d.,-]/g, '').replace(/,/g, '')
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : undefined
}

function cellText(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    // exceljs returns objects for rich text, hyperlinks, and formula results
    if (typeof o.text === 'string') return o.text.trim()
    if (typeof o.result === 'string' || typeof o.result === 'number') return String(o.result).trim()
    if (Array.isArray(o.richText)) return o.richText.map((r) => (r as { text: string }).text).join('').trim()
    return ''
  }
  return String(v).trim()
}

/**
 * Real exports often carry a title block, a logo, or blank rows before the
 * header. Find the first row that looks like headers rather than assuming row 1.
 */
function findHeaderRow(sheet: ExcelJS.Worksheet): number {
  const limit = Math.min(sheet.rowCount, 20)
  let best = 1
  let bestScore = 0

  for (let r = 1; r <= limit; r++) {
    const values = (sheet.getRow(r).values as unknown[]).slice(1).map(cellText)
    const filled = values.filter(Boolean)
    if (filled.length < 2) continue
    // Headers are short, mostly non-numeric labels.
    const looksLikeHeader = filled.filter((v) => v.length < 40 && !/^\d+([.,]\d+)?$/.test(v)).length
    const score = looksLikeHeader + filled.length
    if (score > bestScore) { bestScore = score; best = r }
  }
  return best
}

export async function parseWorkbook(data: ArrayBuffer | Buffer): Promise<ParseResult> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(await withoutCommentRels(data) as ArrayBuffer)

  const sheet = wb.worksheets[0]
  if (!sheet) throw new Error('The workbook has no sheets.')

  const headerRow = findHeaderRow(sheet)
  const headers = (sheet.getRow(headerRow).values as unknown[]).slice(1).map(cellText)

  // Map known fields to column indices. First match wins so a sheet with both
  // "Price" and "Sale Price" does not assign the same column twice.
  const colOf: Record<string, number> = {}
  const mapping: Record<string, string> = {}
  const taken = new Set<number>()
  for (const [field, pattern] of Object.entries(PATTERNS)) {
    const i = headers.findIndex((h, idx) => h && !taken.has(idx) && pattern.test(h))
    if (i >= 0) { colOf[field] = i + 1; mapping[field] = headers[i]; taken.add(i) }
  }

  // Image anchors. exceljs gives a top-left cell per image; nativeRow is
  // zero-based, so +1 lands on the sheet's own row numbering.
  const imagesByRow = new Map<number, { extension: string; buffer: Buffer }>()
  for (const img of sheet.getImages()) {
    const media = wb.model.media?.find((m) => String((m as { index?: number }).index) === String(img.imageId))
    if (!media) continue
    const row = Math.round(img.range.tl.nativeRow) + 1
    // exceljs's Media type is looser than its runtime shape; go through unknown.
    const m = media as unknown as { extension: string; buffer: Buffer }
    imagesByRow.set(row, { extension: m.extension, buffer: m.buffer })
  }

  const products: ProductRow[] = []
  const issues: Issue[] = []
  const seenSku = new Map<string, number>()

  for (let r = headerRow + 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r)
    const cell = (field: string) => (colOf[field] ? cellText(row.getCell(colOf[field]).value) : '')

    const allBlank = (row.values as unknown[]).slice(1).every((v) => !cellText(v))
    if (allBlank) continue

    const sku = cell('sku')
    if (!sku) {
      issues.push({ row: r, reason: 'No SKU — cannot identify or update this product', severity: 'error' })
      continue
    }
    const dup = seenSku.get(sku)
    if (dup) {
      issues.push({ row: r, reason: `Duplicate SKU "${sku}", first seen on row ${dup}`, severity: 'error' })
      continue
    }
    seenSku.set(sku, r)

    const name_en = cell('name_en')
    const name_ar = cell('name_ar')
    if (!name_en && !name_ar) {
      issues.push({ row: r, reason: `SKU "${sku}" has no name in either language`, severity: 'error' })
      continue
    }

    const rawPrice = cell('price_kwd')
    const price_kwd = parsePrice(colOf.price_kwd ? row.getCell(colOf.price_kwd).value : undefined)
    if (rawPrice && price_kwd === undefined) {
      issues.push({ row: r, reason: `SKU "${sku}": price "${rawPrice}" is not a number`, severity: 'warning' })
    }
    if (!rawPrice) {
      issues.push({ row: r, reason: `SKU "${sku}" has no price`, severity: 'warning' })
    }

    const sale = parsePrice(colOf.sale_price_kwd ? row.getCell(colOf.sale_price_kwd).value : undefined)
    if (sale !== undefined && price_kwd !== undefined && sale >= price_kwd) {
      issues.push({ row: r, reason: `SKU "${sku}": sale price is not below the regular price`, severity: 'warning' })
    }

    const image = imagesByRow.get(r)
    if (!image) {
      issues.push({ row: r, reason: `SKU "${sku}" has no embedded image`, severity: 'warning' })
    }

    const extra: Record<string, string> = {}
    headers.forEach((h, idx) => {
      if (!h || taken.has(idx)) return
      const v = cellText(row.getCell(idx + 1).value)
      if (v) extra[h] = v
    })

    // A sheet says "Price" and "Sale Price"; a poster needs "what it costs" and
    // "what it cost before". Deriving them here means a template can never bind
    // the regular price of a discounted product and advertise a number the
    // customer will not be charged.
    const onSale = sale !== undefined && price_kwd !== undefined && sale < price_kwd
    const now = onSale ? sale : price_kwd
    const was = onSale ? price_kwd : undefined

    products.push({
      row: r, sku,
      price_now: now,
      price_was: was,
      on_sale: onSale,
      discount_pct: onSale && was ? Math.round((1 - (now as number) / was) * 100) : undefined,
      name_en: name_en || undefined,
      display_name: cell('display_name') || undefined,
      name_ar: name_ar || undefined,
      brand: cell('brand') || undefined,
      category: cell('category') || undefined,
      price_kwd, sale_price_kwd: sale,
      description_en: cell('description_en') || undefined,
      description_ar: cell('description_ar') || undefined,
      image, extra,
    })
  }

  return { products, issues, headers, mapping, sheetName: sheet.name }
}
