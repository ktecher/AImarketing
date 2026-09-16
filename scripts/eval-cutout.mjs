/**
 * Does the background removal actually work on THIS catalogue?
 *
 * Not `npm test`, for the same reason the chat eval is not: it needs the model,
 * it takes ~5s per image, and an eval that skips silently passes silently. It
 * refuses rather than skips.
 *
 * There is no pass/fail number here on purpose. A cutout is judged by looking at
 * it — CLAUDE.md rule 4's instinct applied to images: a single score would get
 * screenshotted and quoted, and it would be the least informative thing
 * produced. What this prints is how much of each image survived, and what it
 * writes is a sheet on magenta, where a bad alpha channel is impossible to miss
 * and invisible against white.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { cutout, haveModel } from '../lib/cutout.ts'

if (!haveModel()) {
  console.error('The model is not on this machine. Run: npm run cutout:model')
  process.exit(1)
}

const { cases } = JSON.parse(readFileSync('evals/cutouts.json', 'utf8'))
const outDir = join(process.cwd(), 'renders')
mkdirSync(outDir, { recursive: true })

const TILE = 300
const tiles = []
let ran = 0

for (const c of cases) {
  const src = join(process.cwd(), `data/samples/images/${c.sku}.png`)
  if (!existsSync(src)) { console.log(`skip  ${c.sku}  no photo on this machine`); continue }

  const t = Date.now()
  const png = await cutout(readFileSync(src))
  const ms = Date.now() - t

  // Alpha read by decoding, not via extractChannel — that returned a COLOUR
  // channel here and made a failed cutout look like a 98%-opaque success.
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  let opaque = 0, edge = 0
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] > 250) opaque++
    else if (data[i] > 8) edge++
  }
  const px = info.width * info.height
  console.log(
    `${c.sku}  ${String(ms).padStart(5)}ms  ` +
    `kept ${((100 * opaque) / px).toFixed(0)}%  soft edge ${((100 * edge) / px).toFixed(1)}%  ` +
    `[${c.expect}] ${c.what}`,
  )
  ran++

  tiles.push(await sharp({
    create: { width: TILE, height: TILE, channels: 4, background: { r: 255, g: 0, b: 255, alpha: 1 } },
  }).composite([{ input: await sharp(png).resize(TILE, TILE, { fit: 'inside' }).toBuffer() }]).png().toBuffer())
}

if (!ran) { console.error('\nNo fixture images on this machine — nothing was evaluated.'); process.exit(1) }

const sheet = join(outDir, 'cutouts.png')
writeFileSync(sheet, await sharp({
  create: { width: TILE * tiles.length, height: TILE, channels: 3, background: { r: 18, g: 18, b: 18 } },
}).composite(tiles.map((input, i) => ({ input, left: i * TILE, top: 0 }))).png().toBuffer())

console.log(`\n${ran} of ${cases.length} cases. Sheet: ${sheet}`)
console.log('Look at it. "kept 98%" on a product that fills a tenth of the frame is a failed cutout.')
