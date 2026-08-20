// Brings brand artwork into data/samples as PNG.
//
// AVIF is decoded by sharp but embedding it in an SVG is a bet on every
// downstream renderer supporting it. PNG is universally safe and the artwork is
// flat colour, so it compresses well anyway.
import sharp from 'sharp'
import { basename } from 'node:path'

for (const src of process.argv.slice(2)) {
  const name = basename(src).replace(/\.[^.]+$/, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 40)
  const out = `data/samples/${name}.png`
  const info = await sharp(src).png({ quality: 92 }).toFile(out)
  console.log(`  ${out}  ${info.width}x${info.height}  ${(info.size / 1024).toFixed(0)} KB`)
}
