import { readdirSync, writeFileSync, existsSync, rmSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { loadFont } from '@/lib/template/layout'
import { readForm, isResponse } from '@/lib/http'

export const runtime = 'nodejs'

const dir = () => join(process.cwd(), 'data/fonts')

/** The family name a template binds, derived from the filename. */
const familyOf = (file: string) =>
  file.replace(/\.(ttf|otf)$/i, '').replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim()

export async function GET() {
  mkdirSync(dir(), { recursive: true })
  const fonts = readdirSync(dir())
    .filter((f) => /\.(ttf|otf)$/i.test(f))
    .map((file) => ({ file, family: familyOf(file) }))
  return Response.json({ fonts })
}

/**
 * Adds a brand font.
 *
 * The file is parsed before it is kept — a font that cannot be shaped is worse
 * than no font, because it fails at render time on somebody else's batch rather
 * than here where the person who uploaded it is watching.
 */
export async function POST(req: Request) {
  const form = await readForm(req)
  if (isResponse(form)) return form
  const file = form.get('file')

  if (!(file instanceof File)) {
    return Response.json({ error: 'No file was uploaded.' }, { status: 400 })
  }
  if (!/\.(ttf|otf)$/i.test(file.name)) {
    return Response.json(
      { error: `"${file.name}" is not a font. Upload a .ttf or .otf file.` },
      { status: 400 },
    )
  }

  const buf = Buffer.from(await file.arrayBuffer())
  try {
    const f = loadFont(buf)
    if (!f.upem) throw new Error('no units-per-em')
  } catch {
    return Response.json(
      { error: `"${file.name}" could not be read as a font. It may be corrupt or a web-only format.` },
      { status: 400 },
    )
  }

  mkdirSync(dir(), { recursive: true })
  const safe = file.name.replace(/[^\w.\-]+/g, '-')
  writeFileSync(join(dir(), safe), buf)

  return Response.json({ file: safe, family: familyOf(safe) })
}

export async function DELETE(req: Request) {
  const file = new URL(req.url).searchParams.get('file') ?? ''
  // Only ever a bare filename inside the font directory.
  if (!/^[\w.\-]+\.(ttf|otf)$/i.test(file)) {
    return Response.json({ error: 'Not a font file name.' }, { status: 400 })
  }
  const p = join(dir(), file)
  if (!existsSync(p)) return Response.json({ error: 'Font not found.' }, { status: 404 })
  rmSync(p, { force: true })
  return Response.json({ deleted: file })
}
