// Proves the assumption the whole template engine rests on: HarfBuzz shapes
// Arabic correctly and gives advances that account for ligatures.
import { readFileSync } from 'node:fs'
import { Blob, Face, Font, Buffer as HBBuffer, shape, versionString } from 'harfbuzzjs'

console.log(`harfbuzz ${versionString()}\n`)

const face = new Face(new Blob(readFileSync('data/fonts/Cairo-Variable.ttf')))
const font = new Font(face)
console.log(`face upem = ${face.upem}`)

function measure(text, direction) {
  const buf = new HBBuffer()
  buf.addText(text)
  buf.guessSegmentProperties()
  if (direction) buf.setDirection(direction)
  shape(font, buf)
  const glyphs = buf.getGlyphInfosAndPositions()
  const width = glyphs.reduce((s, g) => s + (g.xAdvance ?? 0), 0)
  return { count: glyphs.length, width, ids: glyphs.map(g => g.codepoint) }
}

console.log('\n--- shaping ---')
for (const [label, text] of [
  ['English',              'MacBook Pro'],
  ['Arabic simple',        'راوتر'],
  ['Arabic product name',  'ماك بوك برو 14 بوصة'],
  ['Arabic long',          'راوتر أسوس واي فاي 6 ثنائي النطاق'],
]) {
  const m = measure(text)
  console.log(`${label.padEnd(22)} chars=${String([...text].length).padStart(2)}  glyphs=${String(m.count).padStart(2)}  width=${m.width}`)
}

console.log('\n--- the ligature question (why opentype.js measures Arabic wrong) ---')
const lam = measure('ل'), alef = measure('ا'), both = measure('لا')
const naive = lam.width + alef.width
console.log(`  lam alone       glyphs=${lam.count}  width=${lam.width}`)
console.log(`  alef alone      glyphs=${alef.count}  width=${alef.width}`)
console.log(`  "لا" shaped     glyphs=${both.count}  width=${both.width}`)
console.log(`  naive sum ${naive} vs shaped ${both.width}  ->  ${(naive / both.width * 100 - 100).toFixed(0)}% overestimate`)
console.log(`  ${both.count === 1 ? 'CONFIRMED: collapses to ONE glyph. Per-character measurement is wrong.'
                                   : 'no ligature — check the font'}`)

console.log('\n--- contextual forms (same letter, different glyph by position) ---')
for (const t of ['ب', 'با', 'ابا']) {
  console.log(`  ${t.padEnd(4)} -> glyph ids [${measure(t).ids.join(', ')}]`)
}

console.log('\n--- outline mode: can we get a path? ---')
const g = measure('ب').ids[0]
const path = font.glyphToPath(g)
console.log(`  glyph ${g} path: ${path.slice(0, 70)}…  (${path.length} chars)`)
console.log(`  ${path.startsWith('M') ? 'CONFIRMED: real SVG path data — outline mode is possible.' : 'unexpected path format'}`)

console.log('\n--- English vs Arabic width for the same product ---')
const en = measure('MacBook Pro 14-inch'), ar = measure('ماك بوك برو 14 بوصة')
console.log(`  EN width ${en.width} / AR width ${ar.width}  ->  Arabic is ${(ar.width / en.width * 100 - 100).toFixed(0)}% wider`)
console.log('  (this is what auto-fit has to absorb)')
