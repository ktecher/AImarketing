import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { templateFromArtwork } from '@/lib/template/artwork'
import { readForm, isResponse } from '@/lib/http'

export const runtime = 'nodejs'
export const maxDuration = 120

const dir = () => join(process.cwd(), 'data/templates')

/** A filename safe for disk and stable enough to use as an id. */
function slugify(name: string): string {
  return name.toLowerCase().replace(/\.[^.]+$/, '').replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '').slice(0, 40) || 'template'
}

/** Uploads brand artwork and turns it into an editable template. */
export async function POST(req: Request) {
  const form = await readForm(req)
  if (isResponse(form)) return form
  const file = form.get('file')
  const rawName = String(form.get('name') ?? '').trim()

  if (!(file instanceof File)) {
    return Response.json({ error: 'No file was uploaded.' }, { status: 400 })
  }
  if (!/\.(png|jpe?g|webp|avif|tiff?)$/i.test(file.name)) {
    return Response.json(
      { error: `"${file.name}" is not an image. Upload the artwork as PNG, JPG, WebP or AVIF.` },
      { status: 400 },
    )
  }

  const name = rawName || file.name.replace(/\.[^.]+$/, '')
  mkdirSync(dir(), { recursive: true })

  let id = slugify(name)
  // Never overwrite somebody else's template because two files share a name.
  let n = 2
  while (existsSync(join(dir(), `${id}.svg`))) id = `${slugify(name)}-${n++}`

  try {
    const built = await templateFromArtwork(Buffer.from(await file.arrayBuffer()), name)
    writeFileSync(join(dir(), `${id}.svg`), built.svg)
    writeFileSync(join(dir(), `${id}.json`), JSON.stringify(built.manifest, null, 2))

    return Response.json({
      id, name,
      width: built.width, height: built.height,
      safe: built.safe,
      warning: built.warning,
      slots: built.manifest.slots.map((s) => s.id),
    })
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : 'That artwork could not be turned into a template.' },
      { status: 400 },
    )
  }
}

export async function GET() {
  const dir = join(process.cwd(), 'data/templates')
  const templates = readdirSync(dir)
    // .overrides.json sits beside the manifest; treating it as one looks for a
    // matching .overrides.svg that does not exist and takes the whole page down.
    .filter((f) => f.endsWith('.json') && !f.endsWith('.overrides.json'))
    .map((f) => {
      const id = f.replace(/\.json$/, '')
      const manifest = JSON.parse(readFileSync(join(dir, f), 'utf8'))
      const svg = readFileSync(join(dir, `${id}.svg`), 'utf8')
      const size = /width="(\d+)" height="(\d+)"/.exec(svg)
      return {
        id,
        name: manifest.name as string,
        slots: (manifest.slots as { id: string }[]).map((s) => s.id),
        width: size ? Number(size[1]) : 0,
        height: size ? Number(size[2]) : 0,
      }
    })
  return Response.json({ templates })
}
