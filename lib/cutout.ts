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
 * The PROMISE is cached, not the resolved session. Caching the result means two
 * simultaneous first cutouts both see `null`, both call `create()`, and the
 * loser is assigned over and leaked for the life of the process — ~224MB of
 * weights nothing can reach. `??=` on a promise makes the second caller wait
 * for the first load instead of starting another.
 *
 * ponytail: one resident session. Measured RSS for an end-to-end cutout is
 * ~3.8GB at peak, an order of magnitude above what a 224MB model suggests —
 * the 1024x1024 float32 tensors and sharp's own buffers dominate, and ORT's
 * arenas do not hand it all back. That matters against the 12-15GB CLAUDE.md
 * budgets with Ollama already resident, so `release()` is the fix and it is
 * worth calling before a demo rather than after one goes wrong.
 */
let session: Promise<ort.InferenceSession> | null = null

function loaded(): Promise<ort.InferenceSession> {
  if (!haveModel()) {
    return Promise.reject(new Error(
      'The background-removal model is not on this machine. Run: npm run cutout:model',
    ))
  }
  // A rejected load must not be cached, or one failure makes every later call
  // fail with the same stale error.
  session ??= ort.InferenceSession.create(modelPath(), { executionProviders: ['cpu'] })
    .catch((e) => { session = null; throw e })
  return session
}

/**
 * Let the model go, for real.
 *
 * `session = null` alone frees NOTHING: it drops a JS handle while the native
 * ORT session and its weights stay alive until the wrapper is finalised, which
 * is not something you can schedule. Measured: dropping the reference and
 * forcing GC twice recovered 0 bytes; awaiting the session's own `release()`
 * recovered ~257MB. The native call is the whole function.
 */
export async function release(): Promise<void> {
  const pending = session
  session = null
  try { await (await pending)?.release() } catch { /* already gone is fine */ }
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
