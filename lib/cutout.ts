/**
 * Cutting the background off a product photo.
 *
 * BiRefNet_lite, exported to ONNX by onnx-community, run through
 * onnxruntime-node on the CPU. MIT licensed, which is why it and not RMBG-2.0:
 * that one scores about five points better on its author's own benchmark and is
 * CC BY-NC, and a retailer's marketing tool is a commercial use (D100).
 *
 * ── the weights are not downloaded here ──
 *
 * `scripts/fetch-cutout-model.mjs` pulls them once, by hand, the way an Ollama
 * model is pulled. Nothing in a request path reaches the network — that is what
 * ruled out `@imgly/background-removal-node`, which fetches its model from a CDN
 * on first use, as much as its AGPL licence did.
 *
 * ── what this does and does not promise ──
 *
 * It returns a PNG with an alpha channel, at the original image's size. It does
 * NOT promise the cutout is right. A product on a white studio background is the
 * easy case and the model is very good at it; wire earbuds, router antennas and
 * jewellery chains are the hard case and no published benchmark covers them.
 * `evals/cutouts/` is the fixture that keeps that claim honest, and the answer
 * to "is it accurate" is a person looking at the before and after.
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import ort from 'onnxruntime-node'

/** Square, because the preprocessor config says 1024x1024 and not "longest edge". */
const EDGE = 1024

/** ImageNet, straight out of the model's own preprocessor_config.json. */
const MEAN = [0.485, 0.456, 0.406]
const STD = [0.229, 0.224, 0.225]

export const modelPath = () => join(process.cwd(), 'data/models/birefnet/model.onnx')

export const haveModel = () => existsSync(modelPath())

/**
 * The session, kept once it exists.
 *
 * ponytail: one resident session, ~400MB while a cutout runs and rather less
 * between. Loading takes ~850ms, so reloading per image would dominate a batch.
 * If a demo ever runs short of memory — CLAUDE.md budgets 12-15GB with Ollama
 * already resident — `release()` exists and the honest fix is calling it when
 * the screen that uses this closes, not making this cleverer.
 */
let session: ort.InferenceSession | null = null

async function loaded(): Promise<ort.InferenceSession> {
  if (session) return session
  if (!haveModel()) {
    throw new Error(
      'The background-removal model is not on this machine. Run: npm run cutout:model',
    )
  }
  session = await ort.InferenceSession.create(modelPath(), { executionProviders: ['cpu'] })
  return session
}

/** Let the model go. Nothing calls this yet; it exists so the ceiling has a fix. */
export function release(): void {
  session = null
}

/** BiRefNet emits logits, so the mask needs squashing into 0..1. */
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x))

/**
 * A product photo with its background made transparent.
 *
 * Takes and returns encoded bytes — PNG out, always, because the alpha channel
 * is the entire point and JPEG has none.
 */
export async function cutout(bytes: Buffer): Promise<Buffer> {
  const net = await loaded()

  const image = sharp(bytes)
  const meta = await image.metadata()
  const width = meta.width ?? 0
  const height = meta.height ?? 0
  if (!width || !height) throw new Error('That file could not be read as an image.')

  // Squashed to a square, not fitted inside one: the model was trained on a
  // plain resize, and letterboxing it changes the shape of everything in frame.
  const { data } = await sharp(bytes)
    .resize(EDGE, EDGE, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  // HWC bytes to CHW floats, normalised. One allocation, filled in place.
  const input = new Float32Array(3 * EDGE * EDGE)
  const plane = EDGE * EDGE
  for (let i = 0; i < plane; i++) {
    input[i] = (data[i * 3] / 255 - MEAN[0]) / STD[0]
    input[plane + i] = (data[i * 3 + 1] / 255 - MEAN[1]) / STD[1]
    input[2 * plane + i] = (data[i * 3 + 2] / 255 - MEAN[2]) / STD[2]
  }

  const out = await net.run({
    input_image: new ort.Tensor('float32', input, [1, 3, EDGE, EDGE]),
  })
  const logits = out[net.outputNames[0]].data as Float32Array

  const mask = Buffer.allocUnsafe(plane)
  for (let i = 0; i < plane; i++) mask[i] = Math.round(sigmoid(logits[i]) * 255)

  // Back to the photo's own size before it becomes an alpha channel, so the
  // cutout lines up with the pixels it is cutting.
  // `toColourspace('b-w')` is load-bearing, and so is the check under it.
  // A one-channel raw input comes back from `.raw()` as THREE channels — sharp
  // promotes it to sRGB — so `alpha[i]` then reads every third byte of an RGB
  // buffer and runs out a third of the way down. The cutout is correctly shaped
  // and striped on a three-row cycle, which reads as a model problem and is not
  // one. The length check is here because that failure is silent: every buffer
  // involved is a plausible size, and nothing throws.
  const alpha = await sharp(mask, { raw: { width: EDGE, height: EDGE, channels: 1 } })
    .resize(width, height, { fit: 'fill' })
    .toColourspace('b-w')
    .raw()
    .toBuffer()
  if (alpha.length !== width * height) {
    throw new Error(`Mask is ${alpha.length} bytes for a ${width}×${height} image; expected ${width * height}.`)
  }

  // Interleaved by hand rather than with sharp's joinChannel.
  //
  // `sharp(rgb).removeAlpha().joinChannel(buffer, { raw: {...} })` SILENTLY DOES
  // NOTHING — three channels in, three channels out, no error and no warning.
  // Reduced to eight pixels to be sure of it. The mask is computed, thrown away,
  // and the "cutout" that comes back is the original photo, which is the most
  // convincing way for this to fail: every dimension is right and only the
  // transparency everybody wanted is missing.
  const rgb = await sharp(bytes).removeAlpha().raw().toBuffer()
  const rgba = Buffer.allocUnsafe(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = rgb[i * 3]
    rgba[i * 4 + 1] = rgb[i * 3 + 1]
    rgba[i * 4 + 2] = rgb[i * 3 + 2]
    rgba[i * 4 + 3] = alpha[i]
  }
  return await sharp(rgba, { raw: { width, height, channels: 4 } }).png().toBuffer()
}
