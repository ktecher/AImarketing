// Builds a deliberately messy product sheet for testing the importer.
// Mirrors what real retail exports actually do wrong: a title block above the
// header, prices as text, a duplicate SKU, a missing name, blank rows, and
// embedded images anchored to some rows but not others.
import ExcelJS from 'exceljs'

const wb = new ExcelJS.Workbook()
const ws = wb.addWorksheet('Products')

ws.addRow(['KTech Electronics — Product Master'])   // title block, not a header
ws.addRow(['Exported 2026-08-19'])
ws.addRow([])
ws.addRow(['SKU', 'Product Name (EN)', 'اسم المنتج', 'Brand', 'Category',
           'Price (KD)', 'Sale Price', 'Warranty', 'Stock'])

const rows = [
  ['MBP14-M5',   'MacBook Pro 14-inch M5',    'ماك بوك برو 14 بوصة',       'Apple',   'Laptops',  449.5,      399.5, '1 year', 12],
  ['RT-AX88U',   'ASUS RT-AX88U Wi-Fi 6',     'راوتر أسوس واي فاي 6',       'ASUS',    'Networking', 'KD 89.750', '',   '2 years', 40],
  ['GX-1000',    'Gaming Mouse GX-1000',      'ماوس ألعاب جي إكس 1000',     'Logitech','Accessories', 18,        14.5, '1 year', 200],
  ['MBP14-M5',   'MacBook Pro 14-inch (dup)', 'مكرر',                       'Apple',   'Laptops',  449.5,      '',    '',       0],
  ['NOPRICE-1',  'Mystery Item',              'منتج بدون سعر',              'Generic', 'Misc',     '',         '',    '',       3],
  ['',           'Row With No SKU',           'بدون رمز',                   'Generic', 'Misc',     10,         '',    '',       1],
  ['BADSALE-1',  'Bad Sale Price',            'سعر عرض خاطئ',               'Generic', 'Misc',     20,         25,    '',       5],
  ['NONAME-1',   '',                          '',                            'Generic', 'Misc',     30,         '',    '',       7],
]
for (const r of rows) ws.addRow(r)
ws.addRow([])
ws.addRow(['SPK-BT9', 'Bluetooth Speaker BT-9', 'سماعة بلوتوث', 'JBL', 'Audio', 24.9, 19.9, '1 year', 60])

// A 1x1 PNG, anchored to the first two product rows only — so the importer has
// to report the rest as missing rather than silently rendering a blank box.
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64')
for (const row of [5, 6]) {
  const id = wb.addImage({ buffer: png, extension: 'png' })
  ws.addImage(id, { tl: { col: 9, row: row - 1 }, ext: { width: 40, height: 40 } })
}

await wb.xlsx.writeFile('data/samples/fixture-messy.xlsx')
console.log('wrote data/samples/fixture-messy.xlsx')
