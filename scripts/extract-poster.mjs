// Stock template previews are mockups: the poster sits on a backdrop with a
// shadow. This finds the poster face and crops it out, so the artwork can at
// least be assessed on its own.
import sharp from 'sharp'
import { basename } from 'node:path'

const src = process.argv[2]
const img = sharp(src)
const { width, height } = await img.metadata()
const { data, info } = await img.raw().toBuffer({ resolveWithObject: true })
const ch = info.channels
const px = (x, y) => { const i = (y * info.width + x) * ch; return [data[i], data[i+1], data[i+2]] }

// The backdrop is a flat dark grey. The poster face is bright. Scan from each
// edge for the first clearly-bright pixel along the centre lines.
const bright = (x, y) => { const [r,g,b] = px(x,y); return (r+g+b)/3 > 120 }
const midY = Math.floor(height/2), midX = Math.floor(width/2)

let left = 0;  while (left < midX && !bright(left, midY)) left++
let right = width-1; while (right > midX && !bright(right, midY)) right--
let top = 0;   while (top < midY && !bright(midX, top)) top++
let bottom = height-1; while (bottom > midY && !bright(midX, bottom)) bottom--

const w = right-left+1, h = bottom-top+1
console.log(`${basename(src)}`)
console.log(`  full     ${width}x${height}`)
console.log(`  poster   x ${left}..${right}  y ${top}..${bottom}   ${w}x${h}  ratio ${(w/h).toFixed(3)}`)
console.log(`  mockup   ${(100 - (w*h)/(width*height)*100).toFixed(0)}% of the file is backdrop, not artwork`)

const out = `data/samples/${basename(src).replace(/\.png$/, '')}-cropped.png`
await sharp(src).extract({ left, top, width: w, height: h }).toFile(out)
console.log(`  wrote    ${out}`)
