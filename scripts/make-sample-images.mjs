// Stand-in product photos until the real ones arrive. Deliberately plain: the
// point is to prove the image slot, not to look like a product shot.
import sharp from 'sharp'
import { mkdirSync } from 'node:fs'
mkdirSync('data/samples/images', { recursive: true })

const ITEMS = [
  { sku: 'MBP14-M5', label: 'laptop',  w: 520, h: 340, body: '#3a3f45', accent: '#8a9099' },
  { sku: 'RT-AX88U', label: 'router',  w: 520, h: 340, body: '#22262b', accent: '#0f8a86' },
  { sku: 'SPK-BT9',  label: 'speaker', w: 520, h: 340, body: '#1d4e57', accent: '#7fd4cf' },
]

const shapes = {
  laptop: (a) => `<rect x="120" y="70" width="280" height="170" rx="8" fill="${a.body}"/>
    <rect x="134" y="84" width="252" height="142" rx="4" fill="${a.accent}" opacity=".35"/>
    <path d="M90 250 h340 l24 26 h-388 z" fill="${a.body}"/>`,
  router: (a) => `<rect x="150" y="150" width="220" height="90" rx="10" fill="${a.body}"/>
    <rect x="176" y="176" width="60" height="8" rx="4" fill="${a.accent}"/>
    <path d="M190 150 l-26 -74 M330 150 l26 -74 M260 150 v-84" stroke="${a.body}" stroke-width="11" stroke-linecap="round"/>`,
  speaker: (a) => `<rect x="180" y="80" width="160" height="190" rx="76" fill="${a.body}"/>
    <circle cx="260" cy="175" r="54" fill="${a.accent}" opacity=".5"/>
    <circle cx="260" cy="175" r="26" fill="${a.body}"/>`,
}

for (const it of ITEMS) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${it.w}" height="${it.h}">
    <rect width="100%" height="100%" fill="#ffffff"/>${shapes[it.label](it)}</svg>`
  await sharp(Buffer.from(svg)).png().toFile(`data/samples/images/${it.sku}.png`)
  console.log(`  data/samples/images/${it.sku}.png`)
}
