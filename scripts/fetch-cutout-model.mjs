/**
 * Pull the background-removal model, once, by hand.
 *
 * The app may not reach the internet (CLAUDE.md rule 1) and a model that
 * downloads itself on first use is a request inside a request path. This is the
 * same shape as pulling an Ollama model: a person runs it, and afterwards the
 * file is simply on disk. `data/models/` is gitignored — 224 MB is not source.
 */
import { createWriteStream, existsSync, mkdirSync, statSync } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

const REPO = 'onnx-community/BiRefNet_lite-ONNX'
const DIR = 'data/models/birefnet'
const FILES = [
  // Recorded on 2026-09-16. A mismatch means the upstream file changed, which
  // is worth knowing about before it becomes a cutout that looks subtly wrong.
  { name: 'model.onnx', from: 'onnx/model.onnx', bytes: 224005088,
    sha256: '5600024376f572a557870a5eb0afb1e5961636bef4e1e22132025467d0f03333' },
  { name: 'preprocessor_config.json', from: 'preprocessor_config.json' },
]

mkdirSync(DIR, { recursive: true })

for (const f of FILES) {
  const path = `${DIR}/${f.name}`
  if (existsSync(path) && (!f.bytes || statSync(path).size === f.bytes)) {
    console.log(`have  ${path}`)
    continue
  }
  const url = `https://huggingface.co/${REPO}/resolve/main/${f.from}`
  process.stdout.write(`get   ${path} … `)
  const res = await fetch(url)
  if (!res.ok) { console.error(`\n${url} answered ${res.status}`); process.exit(1) }
  await pipeline(Readable.fromWeb(res.body), createWriteStream(path))
  console.log(`${statSync(path).size} bytes`)
}

// Verified after writing, never assumed: a truncated download is still a file.
const model = `${DIR}/model.onnx`
const got = createHash('sha256').update(readFileSync(model)).digest('hex')
const want = FILES[0].sha256
if (got !== want) {
  console.error(`\n${model}\n  expected sha256 ${want}\n  got              ${got}`)
  process.exit(1)
}
console.log(`\nok    ${model} matches its recorded sha256`)
