/**
 * Builds the blank product sheet marketing fills in.
 *
 * The header names here are the ones `parse.ts` matches on. Generating the
 * template from the same place the parser reads means a sheet filled from this
 * download maps perfectly — header matching stops being a heuristic and becomes
 * an exact match. Change a name here and change the pattern there.
 */

import ExcelJS from 'exceljs'

type Column = {
  header: string
  width: number
  required: boolean
  note: string
  /** Formats the column as three-decimal fils. */
  money?: boolean
  /** Right-to-left reading order for Arabic columns. */
  rtl?: boolean
}

/** Column order, header text, and the guidance shown to whoever fills it in. */
const COLUMNS: Column[] = [
  { header: 'SKU',               width: 16, required: true,
    note: 'Required and unique. This is how a product is identified and updated on the next import. A repeated SKU is skipped.' },
  { header: 'Product Name (EN)', width: 34, required: false,
    note: 'English name. At least one of the two name columns must be filled.' },
  { header: 'Display Name',      width: 24, required: false,
    note: 'The short name for posters and captions — 16 to 35 characters. Leave blank and the full product name is used, which on a real catalogue averages 66 characters and does not fit a headline.' },
  { header: 'اسم المنتج',         width: 30, required: false, rtl: true,
    note: 'Arabic name. Placed on designs exactly as typed here.' },
  { header: 'Brand',             width: 16, required: false, note: 'Apple, ASUS, JBL.' },
  { header: 'Category',          width: 18, required: false, note: 'Laptops, Networking, Audio. Used for grouping and filtering.' },
  { header: 'Price (KD)',        width: 14, required: false, money: true,
    note: 'Numbers only — do not type "KD". Three decimals: 449.500, never 449.50.' },
  { header: 'Sale Price',        width: 14, required: false, money: true,
    note: 'Leave blank when there is no offer. Must be lower than Price, or the row is flagged.' },
  { header: 'Description (EN)',  width: 44, required: false, note: 'Used for copy and for answering customer questions.' },
  { header: 'الوصف',              width: 40, required: false, rtl: true, note: 'Arabic description.' },
  { header: 'Stock',             width: 10, required: false, note: 'Optional. Any column not listed here is kept, not discarded.' },
  { header: 'Warranty',          width: 14, required: false, note: 'Optional example of an extra column — it survives the import untouched.' },
]

const EXAMPLES = [
  ['MBP14-M5', 'MacBook Pro 14-inch M5', 'MacBook Pro 14', 'ماك بوك برو 14 بوصة', 'Apple', 'Laptops',
   449.5, 399.5, 'M5 chip, 16GB unified memory, 512GB SSD.', 'شريحة إم 5، ذاكرة 16 جيجابايت.', 12, '1 year'],
  ['RT-AX88U', 'ASUS RT-AX88U Wi-Fi 6 Router', 'RT-AX88U Router', 'راوتر أسوس واي فاي 6', 'ASUS', 'Networking',
   89.75, null, 'Dual-band Wi-Fi 6, 8 LAN ports.', 'واي فاي 6 ثنائي النطاق.', 40, '2 years'],
]

export async function buildTemplate(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'AImarketing'
  wb.created = new Date()

  // ---- Sheet 1: the sheet they fill in -----------------------------------
  const ws = wb.addWorksheet('Products', { views: [{ state: 'frozen', ySplit: 1 }] })

  ws.columns = COLUMNS.map((c) => ({ header: c.header, width: c.width }))

  const head = ws.getRow(1)
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1B5E4A' } }
  head.alignment = { vertical: 'middle' }
  head.height = 26

  COLUMNS.forEach((c, i) => {
    const cell = head.getCell(i + 1)
    // Excel shows this on hover — the guidance travels with the file.
    cell.note = `${c.required ? 'REQUIRED\n\n' : ''}${c.note}`
    if (c.required) cell.font = { bold: true, color: { argb: 'FFFFF3B0' } }
  })

  for (const row of EXAMPLES) ws.addRow(row)

  // Grey the examples so it is obvious they are samples to delete.
  for (let r = 2; r <= 1 + EXAMPLES.length; r++) {
    const row = ws.getRow(r)
    row.font = { italic: true, color: { argb: 'FF999999' } }
    COLUMNS.forEach((c, i) => {
      const cell = row.getCell(i + 1)
      if (c.money) cell.numFmt = '0.000'
      if (c.rtl) cell.alignment = { horizontal: 'right', readingOrder: 'rtl' }
    })
  }

  // Pre-format the empty rows so a price typed into row 12 still shows as fils
  // and Arabic still reads right-to-left.
  for (let r = 2 + EXAMPLES.length; r <= 400; r++) {
    const row = ws.getRow(r)
    COLUMNS.forEach((c, i) => {
      const cell = row.getCell(i + 1)
      if (c.money) cell.numFmt = '0.000'
      if (c.rtl) cell.alignment = { horizontal: 'right', readingOrder: 'rtl' }
    })
  }

  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: COLUMNS.length } }

  // ---- Sheet 2: how to fill it in ----------------------------------------
  const help = wb.addWorksheet('How to fill this in')
  help.columns = [{ width: 26 }, { width: 96 }]

  const title = (text: string) => {
    const r = help.addRow([text, ''])
    r.font = { bold: true, size: 13 }
    r.height = 24
  }
  const line = (a: string, b: string) => {
    const r = help.addRow([a, b])
    r.getCell(1).font = { bold: true }
    r.getCell(2).alignment = { wrapText: true, vertical: 'top' }
    r.height = Math.max(18, Math.ceil(b.length / 90) * 15)
  }

  title('Filling in this sheet')
  help.addRow([])
  line('One row per product', 'Delete the two grey example rows before you start. Blank rows in the middle are fine — they are skipped, not treated as the end of the sheet.')
  line('Do not move the header', 'The header must stay on row 1 and the names must stay as they are. They are what the system matches on.')
  line('Extra columns are fine', 'Add any column you like. Anything not listed is kept with the product, not thrown away.')
  help.addRow([])

  title('The two that must be right')
  help.addRow([])
  line('SKU', 'Required, and unique. It is how a product is recognised on the next import, so a corrected price updates the right row instead of creating a second one. A repeated SKU is skipped and reported.')
  line('A name', 'English or Arabic — at least one. A row with neither is skipped.')
  help.addRow([])

  title('Prices')
  help.addRow([])
  line('Numbers only', 'Type 449.5, not "449.500 KD". The currency is added when the design is made.')
  line('Three decimals', 'The dinar is 1000 fils, so prices show as 449.500. A price written as 449.50 reads as a mistake to a Kuwaiti customer. This column is already formatted — just type the number.')
  line('Sale Price', 'Leave blank when there is no offer. If it is not lower than Price, the row is flagged so it can be checked.')
  help.addRow([])

  title('Images')
  help.addRow([])
  line('Paste into the row', 'Insert the product photo into any cell on the product\'s own row. The system reads the position and matches the image to that product.')
  line('One per product', 'A product with no image is not rejected — it is listed so you can see which ones are missing before anything is printed.')
  help.addRow([])

  title('Arabic')
  help.addRow([])
  line('Type it normally', 'Arabic goes on the design exactly as typed here, including spacing. Product and model names stay in English inside Arabic text — that is normal and correct.')
  line('Numbers inside Arabic', 'Leave numbers as Western digits (14, 512). They are placed correctly on the design.')
  help.addRow([])

  title('After you upload')
  help.addRow([])
  line('Check the column list', 'The import screen shows which column it read as which field. Check that first — everything else is built on it.')
  line('Nothing is hidden', 'Every skipped row is listed with its row number and the reason. Nothing fails silently.')
  line('Re-uploading is safe', 'Upload a corrected sheet any time. Products are matched by SKU and updated, not duplicated.')

  help.getRow(1).font = { bold: true, size: 13 }

  return Buffer.from(await wb.xlsx.writeBuffer() as ArrayBuffer)
}
