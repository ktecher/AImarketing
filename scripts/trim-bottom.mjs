// Crops a strip off the bottom — for removing burned-in placeholder bars.
import sharp from 'sharp'
const [src, out, strip] = process.argv.slice(2)
const { width, height } = await sharp(src).metadata()
await sharp(src).extract({ left: 0, top: 0, width, height: height - Number(strip) }).toFile(out)
const m = await sharp(out).metadata()
console.log(`${out}  ${m.width}x${m.height}  ratio ${(m.width / m.height).toFixed(3)}`)
