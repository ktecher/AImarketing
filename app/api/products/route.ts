import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { NextResponse } from 'next/server'
import { readForm, readJson, isResponse } from '@/lib/http'
import { parseWorkbook } from '@/lib/excel/parse'
import { catalogueSize, reachable } from '@/lib/db'
import {
  add, asShopPrices, asRenderPrices, embedPending, listFiltered, matchingSkus, photoIndex, photoKey, remove,
  removeMany, sameValue, saveEdits, upsert,
  type Editable, type Filters,
} from '@/lib/catalogue'

export const runtime = 'nodejs'
// Thousands of rows, embedded in batches. The client keeps asking until done.
export const maxDuration = 600

const photoDir = () => join(process.cwd(), 'data/samples/images')
const photoPath = (sku: string) => join(photoDir(), `${sku}.png`)

/** Every SKU with a photo on disk. One directory read instead of one stat per row. */
function skusWithPhoto(): string[] {
  try {
    return readdirSync(photoDir()).filter((f) => f.endsWith('.png')).map((f) => f.slice(0, -4))
  } catch { return [] }
}

/** Which fields a person has changed since the last sheet said otherwise. */
function editedFields(row: Record<string, unknown>): string[] {
  const sheet = (row.sheet_values ?? {}) as Record<string, unknown>
  return Object.keys(sheet).filter((k) => !sameValue(row[k], sheet[k]))
}

const down = () =>
  NextResponse.json(
    { up: false, error: 'Postgres is not answering. Run: npm run db:up' },
    { status: 503 },
  )

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams
  if (!(await reachable())) return down()

  const withPhoto = skusWithPhoto()
  const hasPhoto = new Set(withPhoto)

  const filters: Filters = {
    withPhoto,
    search: q.get('q') ?? '',
    category: q.get('category') ?? undefined,
    brand: q.get('brand') ?? undefined,
    onSale: q.get('onSale') === '1',
    outOfStock: q.get('outOfStock') === '1',
    edited: q.get('edited') === '1',
    noPhoto: q.get('noPhoto') === '1',
    sort: q.get('sort') ?? undefined,
    dir: q.get('dir') === 'asc' ? 'asc' : 'desc',
    limit: Number(q.get('limit') ?? 20),
    offset: Number(q.get('offset') ?? 0),
  }

  // "Select all N" asks for the SKUs alone. The table is capped at 100 rows a
  // page, so answering this from the table would hand back 100 and let someone
  // delete a hundred believing they had chosen every match.
  if (q.get('skusOnly') === '1') {
    return NextResponse.json({ up: true, skus: await matchingSkus(filters) })
  }

  const { rows, total, categories, brands } = await listFiltered(filters)

  // Photo presence and the shop's price vocabulary are added here rather than
  // in SQL: one is the filesystem and the other is a translation the database
  // should not know about.
  const dressed = rows.map((r) => ({
    ...r,
    ...asShopPrices(r),
    has_photo: hasPhoto.has(r.sku),
    edited: editedFields(r as unknown as Record<string, unknown>),
  }))

  return NextResponse.json({
    up: true,
    rows: dressed,
    total,
    all: await catalogueSize(),
    categories,
    brands,
  })
}

/** One image, normalised the way every other path here normalises one. */
async function writePhoto(sku: string, file: File) {
  // 600px PNG, because the renderer embeds these as data URIs. Two paths
  // writing different shapes is how a poster ends up correct from one source
  // and wrong from the other.
  await sharp(Buffer.from(await file.arrayBuffer()))
    .resize(600, 600, { fit: 'inside', withoutEnlargement: true })
    .png()
    .toFile(photoPath(sku))
}

/**
 * Attach many photos in one drop.
 *
 * Same skip-and-report contract the sheet importer uses: a file that matches
 * nothing is named back, never silently ignored, and one unreadable image does
 * not stop the rest.
 */
async function addPhotos(files: File[]) {
  const index = await photoIndex()
  const attached: string[] = []
  const unmatched: string[] = []
  const failed: { file: string; reason: string }[] = []

  mkdirSync(join(process.cwd(), 'data/samples/images'), { recursive: true })

  for (const file of files) {
    if (!/\.(png|jpe?g|webp|avif|tiff?)$/i.test(file.name)) {
      failed.push({ file: file.name, reason: 'not an image' })
      continue
    }
    const sku = index.get(photoKey(file.name))
    if (!sku) { unmatched.push(file.name); continue }
    try {
      await writePhoto(sku, file)
      attached.push(sku)
    } catch (e) {
      failed.push({ file: file.name, reason: e instanceof Error ? e.message : 'could not be read' })
    }
  }

  return NextResponse.json({ attached: attached.length, skus: attached, unmatched, failed })
}

export async function POST(req: Request) {
  if (!(await reachable())) return down()
  const type = req.headers.get('content-type') ?? ''

  if (type.includes('application/json')) {
    const body = (await readJson(req)) as Record<string, unknown>

    // Embedding is driven from the client so a few thousand rows do not sit
    // inside one request a browser will give up on.
    if (body.action === 'embed') {
      try {
        return NextResponse.json(await embedPending())
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Could not embed.'
        return NextResponse.json(
          { error: /fetch failed|ECONNREFUSED/i.test(msg) ? 'Ollama is not answering on localhost. Run: brew services start ollama' : msg },
          { status: 500 },
        )
      }
    }

    if (body.action === 'add') {
      const r = body.row as Record<string, string>
      if (!r?.sku?.trim() || !r?.name_en?.trim()) {
        return NextResponse.json({ error: 'A SKU and a name are needed.' }, { status: 400 })
      }
      const price = Number(String(r.price ?? '').replace(/[^\d.]/g, ''))
      if (!Number.isFinite(price) || price < 0) {
        return NextResponse.json({ error: `"${r.price}" is not a price.` }, { status: 400 })
      }
      const sale = String(r.sale_price ?? '').trim()
        ? Number(String(r.sale_price).replace(/[^\d.]/g, '')) : null
      const made = await add(
        { ...r, sku: r.sku.trim(), name_en: r.name_en.trim(), price, sale_price: sale },
        'a colleague',
      )
      if (!made) return NextResponse.json({ error: `${r.sku} is already in the catalogue.` }, { status: 409 })
      return NextResponse.json({ row: made })
    }

    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
  }

  const form = await readForm(req)
  if (isResponse(form)) return form

  // Many photos at once, matched to products by filename. Adding several
  // hundred one at a time is not a workflow, and the catalogue sheet does not
  // have to carry the images for them to arrive together.
  const photos = form.getAll('photos').filter((f): f is File => f instanceof File)
  if (photos.length) return await addPhotos(photos)

  // A replacement photo for one product.
  const sku = String(form.get('sku') ?? '').trim()
  const file = form.get('file')
  if (!(file instanceof File)) return NextResponse.json({ error: 'No file was uploaded.' }, { status: 400 })

  if (sku) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(sku)) {
      return NextResponse.json({ error: 'That is not a SKU.' }, { status: 400 })
    }
    if (!/\.(png|jpe?g|webp|avif|tiff?)$/i.test(file.name)) {
      return NextResponse.json({ error: `"${file.name}" is not an image.` }, { status: 400 })
    }
    try {
      mkdirSync(join(process.cwd(), 'data/samples/images'), { recursive: true })
      await writePhoto(sku, file)
      return NextResponse.json({ replaced: sku })
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : 'That image could not be read.' },
        { status: 400 },
      )
    }
  }

  // Otherwise: the whole catalogue as a sheet.
  if (!/\.xlsx?$/i.test(file.name)) {
    return NextResponse.json(
      { error: `"${file.name}" is not an Excel file. Export the sheet as .xlsx and try again.` },
      { status: 400 },
    )
  }
  try {
    const { products, issues } = await parseWorkbook(await file.arrayBuffer())
    const { written, overwrote, restored } = await upsert(products)
    return NextResponse.json({
      written,
      total: await catalogueSize(),
      errors: issues.filter((i) => i.severity === 'error').length,
      warnings: issues.filter((i) => i.severity === 'warning').length,
      overwrote,
      restored,
    })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Could not read that workbook.' },
      { status: 500 },
    )
  }
}

/**
 * Save a page of staged edits.
 *
 * Nothing in the table writes on its own — a person edits freely and presses
 * Save once. All of it lands or none of it does.
 */
export async function PUT(req: Request) {
  if (!(await reachable())) return down()
  const { changes, by } = (await readJson(req)) as {
    changes?: { sku: string; patch: Record<string, string | boolean | null> }[]
    by?: string
  }
  if (!changes?.length) return NextResponse.json({ error: 'Nothing to save.' }, { status: 400 })

  const clean: { sku: string; patch: Partial<Record<Editable, string | number | boolean | null>> }[] = []
  for (const c of changes) {
    if (!c?.sku) continue
    const patch: Record<string, string | number | boolean | null> = {}

    // Price and sale price arrive in shop language and have to become the two
    // fields the renderer binds. Both are sent together or neither makes sense.
    if ('price' in c.patch || 'sale_price' in c.patch) {
      const num = (v: unknown) => {
        const t = String(v ?? '').trim()
        if (!t) return null
        const n = Number(t.replace(/[^\d.]/g, ''))
        return Number.isFinite(n) && n >= 0 ? n : NaN
      }
      const price = num(c.patch.price)
      const sale = num(c.patch.sale_price)
      if (Number.isNaN(price) || Number.isNaN(sale)) {
        return NextResponse.json({ error: `"${c.patch.price ?? c.patch.sale_price}" is not a price.` }, { status: 400 })
      }
      Object.assign(patch, asRenderPrices(price, sale))
    }
    for (const k of ['name_en', 'name_ar', 'display_name', 'category'] as const) {
      if (k in c.patch) patch[k] = String(c.patch[k] ?? '') || null
    }
    if ('in_stock' in c.patch) patch.in_stock = Boolean(c.patch.in_stock)

    if (Object.keys(patch).length) clean.push({ sku: c.sku, patch })
  }

  try {
    const { saved } = await saveEdits(clean, (by ?? '').trim() || 'a colleague')
    return NextResponse.json({ saved })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not save.' }, { status: 500 })
  }
}

/** Delete a product. What it already produced is kept. */
export async function DELETE(req: Request) {
  if (!(await reachable())) return down()
  const { sku, skus } = (await readJson(req)) as { sku?: string; skus?: string[] }

  // Many. One statement, so a hundred either all go or none do.
  if (skus?.length) {
    const gone = await removeMany(skus.filter((s) => typeof s === 'string' && s.trim()))
    // The photos go with them; nothing else does. Posters already exported and
    // conversations that cited them record what actually happened.
    for (const s of gone) rmSync(photoPath(s), { force: true })
    return NextResponse.json({ deleted: gone.length, skus: gone })
  }

  if (!sku) return NextResponse.json({ error: 'Which product?' }, { status: 400 })

  const gone = await remove(sku)
  if (!gone) return NextResponse.json({ error: 'No such product.' }, { status: 404 })
  rmSync(photoPath(sku), { force: true })
  return NextResponse.json({ deleted: sku })
}
