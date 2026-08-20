// Builds a template from the brand artwork, placing slots inside the measured
// safe area so nothing can ever sit on top of the decoration.
import { readFileSync, writeFileSync } from 'node:fs'
const { buildTemplateSvg } = await import('../lib/template/svg.ts')
const { requiredHeight } = await import('../lib/template/layout.ts')

const W = 465, H = 659                      // the artwork's own pixel size
const SAFE = { x: 73, y: 169, w: 346, h: 349 }   // measured, not guessed

const bg = readFileSync('data/samples/brand-template.jpeg').toString('base64')

// Poster layout inside the safe area: photo on top, then names, then price.
const pad = 8
// Heights are derived from the line count, not guessed. A box shorter than
// maxLines * size * lineHeight can never hold that many lines, and every long
// name silently truncates — which is exactly what the first real catalogue did.
// The helper, not a copy of it — the next change to the formula would otherwise
// desynchronise the two silently.
const fit = (size, lines) => requiredHeight(size, lines)

const nameEnSize = 22, nameArSize = 18, priceSize = 32, wasSize = 15
const slots = [
  { id: 'image',   x: SAFE.x + 14, y: SAFE.y + pad, width: SAFE.w - 28, height: 108 },
  { id: 'name_en', x: SAFE.x, y: SAFE.y + 124, width: SAFE.w, height: fit(nameEnSize, 2) },
  { id: 'name_ar', x: SAFE.x, y: SAFE.y + 124 + fit(nameEnSize, 2) + 4, width: SAFE.w, height: fit(nameArSize, 2) },
  { id: 'was',     x: SAFE.x, y: SAFE.y + 124 + fit(nameEnSize, 2) + fit(nameArSize, 2) + 10, width: SAFE.w, height: fit(wasSize, 1) },
  { id: 'price',   x: SAFE.x, y: SAFE.y + 124 + fit(nameEnSize, 2) + fit(nameArSize, 2) + 10 + fit(wasSize, 1), width: SAFE.w, height: fit(priceSize, 1) },
  { id: 'discount', x: SAFE.x + SAFE.w - 74, y: SAFE.y + 2, width: 72, height: fit(18, 1) },
]

const svg = buildTemplateSvg({
  name: 'Brand poster A4',
  width: W, height: H,
  background: `data:image/jpeg;base64,${bg}`,
  slots,
})
writeFileSync('data/templates/brand-poster.svg', svg)

const manifest = {
  v: 1,
  name: 'Brand poster A4',
  slots: [
    { id: 'image',   type: 'image', bind: 'image', fit: 'contain' },
    // display_name, not name_en: a catalogue title is not a headline, and the
    // renderer falls back to the title when no short name is set (D47). Binding
    // name_en here silently throws away every short name the poster relies on.
    { id: 'name_en', type: 'text',  bind: 'display_name', font: 'Cairo', size: nameEnSize,
      maxLines: 2, align: 'center', colour: '#123c46' },
    { id: 'name_ar', type: 'text',  bind: 'name_ar', font: 'Cairo', size: nameArSize,
      maxLines: 2, align: 'center', colour: '#123c46' },
    { id: 'was',     type: 'text',  bind: 'price_was', format: 'kwd', font: 'Cairo',
      size: wasSize, maxLines: 1, align: 'center', colour: '#8a8a86',
      visible: 'price_was', strike: true },
    { id: 'price',   type: 'text',  bind: 'price_now', format: 'kwd', font: 'Cairo',
      size: priceSize, maxLines: 1, align: 'center', colour: '#0f8a86' },
    { id: 'discount', type: 'text', bind: 'discount_label', font: 'Cairo',
      size: 18, maxLines: 1, align: 'end', colour: '#c0392b', visible: 'discount_pct' },
  ],
}
writeFileSync('data/templates/brand-poster.json', JSON.stringify(manifest, null, 2))

console.log(`template  data/templates/brand-poster.svg  (${(svg.length / 1024).toFixed(0)} KB with artwork embedded)`)
console.log(`manifest  data/templates/brand-poster.json`)
console.log(`slots     ${slots.map(s => s.id).join(', ')}`)
