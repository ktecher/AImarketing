import sharp from 'sharp'
const img = sharp(process.argv[2] ?? 'data/samples/brand-template.jpeg')
const { width, height } = await img.metadata()
const { data, info } = await img.raw().toBuffer({ resolveWithObject: true })
const ch = info.channels

// "Clean" = near-white. The artwork is teal and grey, so anything not near-white
// is decoration we must not print over.
const clean = (x, y) => {
  const i = (y * info.width + x) * ch
  return data[i] > 244 && data[i + 1] > 244 && data[i + 2] > 244
}

// Grow the largest all-clean rectangle from the centre outwards. Cheap and
// exact enough — the artwork is a border, so the usable area is one rectangle.
let top = Math.floor(info.height / 2), bottom = top
let left = Math.floor(info.width / 2), right = left
const rowClean = (y, x0, x1) => { for (let x = x0; x <= x1; x++) if (!clean(x, y)) return false; return true }
const colClean = (x, y0, y1) => { for (let y = y0; y <= y1; y++) if (!clean(x, y)) return false; return true }

let grew = true
while (grew) {
  grew = false
  if (top > 0 && rowClean(top - 1, left, right)) { top--; grew = true }
  if (bottom < info.height - 1 && rowClean(bottom + 1, left, right)) { bottom++; grew = true }
  if (left > 0 && colClean(left - 1, top, bottom)) { left--; grew = true }
  if (right < info.width - 1 && colClean(right + 1, top, bottom)) { right++; grew = true }
}

const pct = (v, of) => ((v / of) * 100).toFixed(1)
console.log(`image        ${width} x ${height}  (A4 ratio is 0.707, this is ${(width/height).toFixed(3)})`)
console.log(`safe area    x ${left}..${right}   y ${top}..${bottom}`)
console.log(`             ${right-left+1} x ${bottom-top+1} px`)
console.log(`as fractions x ${pct(left,info.width)}%..${pct(right,info.width)}%   y ${pct(top,info.height)}%..${pct(bottom,info.height)}%`)
console.log(`\nprint check  A4 at 300dpi needs 2480 x 3508 — this is ${pct(width,2480)}% of that`)
