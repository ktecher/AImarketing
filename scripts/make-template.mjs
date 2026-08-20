// Turns a piece of brand artwork into a template: artwork + slot rectangles
// placed inside the measured safe area.
//
//   tsx scripts/make-template.mjs <artwork.png> <id> "<name>" x y w h
//
// The safe area comes from measure-safe-area.mjs, never from eyeballing it.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import sharp from 'sharp'
import { buildTemplateSvg } from '../lib/template/svg.ts'
import { requiredHeight } from '../lib/template/layout.ts'

const [src, id, name, sx, sy, sw, sh] = process.argv.slice(2)
const SAFE = { x: +sx, y: +sy, w: +sw, h: +sh }
const { width: W, height: H } = await sharp(src).metadata()
mkdirSync('data/templates', { recursive: true })

// Sizes first, then the height each box needs for them. Deriving the size from
// a fraction of the box height is the bug backwards: `size = h * 0.52` with two
// lines needs 1.4x the box it was cut from, so it can never fit at ANY size.
const gap = 4
const SIZES = { nameEn: 22, nameAr: 20, was: 15, now: 32 }
const nameEnH = requiredHeight(SIZES.nameEn, 2)
const nameArH = requiredHeight(SIZES.nameAr, 1)
const wasH = requiredHeight(SIZES.was, 1)
const priceH = requiredHeight(SIZES.now, 1)
const imageH = Math.max(60, SAFE.h - nameEnH - nameArH - wasH - priceH - gap * 4)

let y = SAFE.y
const slots = [
  { id: 'image',     x: SAFE.x + Math.round(SAFE.w * 0.06), y, width: Math.round(SAFE.w * 0.88), height: imageH },
  { id: 'name_en',   x: SAFE.x, y: (y += imageH + gap),   width: SAFE.w, height: nameEnH },
  { id: 'name_ar',   x: SAFE.x, y: (y += nameEnH + gap),  width: SAFE.w, height: nameArH },
  { id: 'price_was', x: SAFE.x, y: (y += nameArH + gap),  width: SAFE.w, height: wasH },
  { id: 'price_now', x: SAFE.x, y: (y += wasH + gap),     width: SAFE.w, height: priceH },
]

const bg = readFileSync(src).toString('base64')
writeFileSync(`data/templates/${id}.svg`, buildTemplateSvg({
  name, width: W, height: H,
  background: `data:image/png;base64,${bg}`,
  slots,
}))

writeFileSync(`data/templates/${id}.json`, JSON.stringify({
  v: 1,
  name,
  slots: [
    { id: 'image',   type: 'image', bind: 'image', fit: 'contain' },
    { id: 'name_en',   type: 'text', bind: 'name_en', font: 'Cairo', size: SIZES.nameEn,
      maxLines: 2, align: 'center', colour: '#123c46' },
    { id: 'name_ar',   type: 'text', bind: 'name_ar', font: 'Cairo', size: SIZES.nameAr,
      maxLines: 1, align: 'center', colour: '#123c46' },
    { id: 'price_was', type: 'text', bind: 'price_was', font: 'Cairo', size: SIZES.was,
      format: 'kwd', maxLines: 1, align: 'center', colour: '#8a8a86', visible: 'price_was', strike: true },
    { id: 'price_now', type: 'text', bind: 'price_now', font: 'Cairo', size: SIZES.now,
      format: 'kwd', maxLines: 1, align: 'center', colour: '#e8590c' },
  ],
}, null, 2))

console.log(`${id}: ${W}x${H}, slots ${slots.map(s => `${s.id}(${s.width}x${s.height})`).join(' ')}`)
