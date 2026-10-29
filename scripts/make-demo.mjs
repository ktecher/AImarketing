// Seeds a runnable demo: a neutral "Demo Electronics" poster template and a six-product
// sheet with illustrated photos. Real brand artwork and photos are per-retailer and not
// in this repo, so without this a fresh clone has nothing to render.
//   npm run demo:seed, then upload data/samples/demo-electronics.xlsx on the Products tab.
import { mkdirSync, existsSync } from 'node:fs'
import sharp from 'sharp'
import ExcelJS from 'exceljs'

mkdirSync('data/samples', { recursive: true })
mkdirSync('data/templates', { recursive: true })

// 1. Poster background. make-template-svg.mjs measures its slots against SAFE
//    (x73 y169 w346 h349): the white card here sits just outside that box.
const bg = `<svg xmlns="http://www.w3.org/2000/svg" width="465" height="659">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0b2a4a"/><stop offset="1" stop-color="#1c6dd0"/></linearGradient></defs>
<rect width="465" height="659" fill="url(#g)"/>
<circle cx="420" cy="60" r="110" fill="#ffffff14"/><circle cx="40" cy="610" r="140" fill="#ffffff10"/>
<text x="232" y="95" font-family="Helvetica, Arial, sans-serif" font-size="30" font-weight="700" fill="#fff" text-anchor="middle" letter-spacing="4">DEMO</text>
<text x="232" y="128" font-family="Helvetica, Arial, sans-serif" font-size="16" fill="#cfe3ff" text-anchor="middle" letter-spacing="7">ELECTRONICS</text>
<rect x="63" y="159" width="366" height="369" rx="22" fill="#ffffff"/>
<text x="232" y="592" font-family="Helvetica, Arial, sans-serif" font-size="15" fill="#cfe3ff" text-anchor="middle" letter-spacing="2">THIS WEEK ONLY  •  WHILE STOCK LASTS</text>
</svg>`
await sharp(Buffer.from(bg)).jpeg({ quality: 92 }).toFile('data/samples/brand-template.jpeg')

// 2. The template itself, through the same builder the real brand template uses.
await import('./make-template-svg.mjs')

// 3. Product sheet: one illustrated photo per row, in the columns the importer reads.
const art = {
  laptop: '<rect x="150" y="170" width="300" height="190" rx="14" fill="#1d2b44"/><rect x="164" y="184" width="272" height="162" rx="6" fill="#4f8cff"/><path d="M110 372h380l-26 28H136z" fill="#9fb3d1"/>',
  phone: '<rect x="215" y="100" width="170" height="340" rx="28" fill="#1d2b44"/><rect x="226" y="118" width="148" height="300" rx="16" fill="#6ee7b7"/><circle cx="300" cy="108" r="5" fill="#0d1626"/>',
  router: '<rect x="130" y="290" width="340" height="70" rx="14" fill="#1d2b44"/><path d="M170 290 150 170M300 290V150M430 290l20-120" stroke="#1d2b44" stroke-width="14" stroke-linecap="round"/><circle cx="170" cy="325" r="6" fill="#6ee7b7"/><circle cx="195" cy="325" r="6" fill="#6ee7b7"/>',
  headphones: '<path d="M170 330V290a130 130 0 0 1 260 0v40" fill="none" stroke="#1d2b44" stroke-width="22"/><rect x="140" y="300" width="64" height="120" rx="28" fill="#ff7a59"/><rect x="396" y="300" width="64" height="120" rx="28" fill="#ff7a59"/>',
  tv: '<rect x="90" y="150" width="420" height="250" rx="12" fill="#1d2b44"/><rect x="104" y="164" width="392" height="222" rx="4" fill="#a78bfa"/><rect x="240" y="410" width="120" height="14" rx="5" fill="#9fb3d1"/>',
  watch: '<rect x="245" y="100" width="110" height="80" rx="18" fill="#9fb3d1"/><rect x="245" y="420" width="110" height="80" rx="18" fill="#9fb3d1"/><rect x="205" y="170" width="190" height="260" rx="52" fill="#1d2b44"/><rect x="220" y="186" width="160" height="228" rx="40" fill="#fbbf24"/>',
}
// sku, name, short name, Arabic name, brand, category, price, sale, EN copy, AR copy, stock, warranty, art, tint
const rows = [
  ['LT-AIR13', 'Nova Air 13 Laptop', 'Nova Air 13', 'لابتوب نوفا إير 13', 'Nova', 'Laptops', 329.5, 289.5, 'Thin 13-inch laptop, 16GB memory, 512GB SSD, all-day battery.', 'لابتوب رفيع 13 بوصة، ذاكرة 16 جيجابايت، تخزين 512 جيجابايت.', 18, '1 year', 'laptop', '#e8f0ff'],
  ['PH-X5', 'Orbit X5 Smartphone', 'Orbit X5', 'هاتف أوربت إكس 5', 'Orbit', 'Phones', 219.0, '', '6.5-inch OLED, 128GB, dual camera, 5G.', 'شاشة أوليد 6.5 بوصة، 128 جيجابايت، كاميرا مزدوجة، 5G.', 42, '1 year', 'phone', '#e6fbf3'],
  ['RT-W6', 'Wavelink Wi-Fi 6 Router', 'Wavelink W6', 'راوتر ويف لينك واي فاي 6', 'Wavelink', 'Networking', 54.75, 44.75, 'Dual-band Wi-Fi 6 router, 4 LAN ports.', 'راوتر واي فاي 6 ثنائي النطاق، 4 منافذ.', 60, '2 years', 'router', '#eef2f7'],
  ['HP-ANC', 'Echo ANC Wireless Headphones', 'Echo ANC', 'سماعات إيكو لاسلكية', 'Echo', 'Audio', 79.9, 64.9, 'Active noise cancelling, 40-hour battery.', 'عزل ضوضاء فعال، بطارية 40 ساعة.', 25, '1 year', 'headphones', '#fff0eb'],
  ['TV-55Q', 'Lumen 55-inch QLED TV', 'Lumen 55 QLED', 'تلفزيون لومن 55 بوصة', 'Lumen', 'TVs', 249.0, 219.0, '4K QLED, 120Hz, built-in streaming apps.', 'شاشة 4K كيو ليد، 120 هرتز، تطبيقات بث مدمجة.', 9, '2 years', 'tv', '#f1ecff'],
  ['WT-FIT2', 'Pulse Fit 2 Smartwatch', 'Pulse Fit 2', 'ساعة بالس فِت 2', 'Pulse', 'Wearables', 39.5, '', 'Heart-rate, sleep tracking, 7-day battery.', 'قياس نبض وتتبع نوم، بطارية 7 أيام.', 33, '1 year', 'watch', '#fff7dd'],
]
const wb = new ExcelJS.Workbook()
const ws = wb.addWorksheet('Products')
ws.addRow(['SKU', 'Product Name (EN)', 'Display Name', 'اسم المنتج', 'Brand', 'Category', 'Price (KD)', 'Sale Price', 'Description (EN)', 'الوصف', 'Stock', 'Warranty', 'Image'])
for (const [i, r] of rows.entries()) {
  ws.addRow([...r.slice(0, 12), ''])
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><rect width="600" height="600" fill="${r[13]}"/><ellipse cx="300" cy="500" rx="190" ry="22" fill="#00000014"/>${art[r[12]]}</svg>`
  const id = wb.addImage({ buffer: await sharp(Buffer.from(svg)).png().toBuffer(), extension: 'png' })
  ws.addImage(id, { tl: { col: 12, row: i + 1 }, ext: { width: 60, height: 60 } })
}
await wb.xlsx.writeFile('data/samples/demo-electronics.xlsx')

for (const f of ['data/templates/brand-poster.json', 'data/templates/brand-poster.svg', 'data/samples/demo-electronics.xlsx']) {
  if (!existsSync(f)) throw new Error(`demo seed did not produce ${f}`)
}
console.log(`demo      ${rows.length} products -> data/samples/demo-electronics.xlsx`)
