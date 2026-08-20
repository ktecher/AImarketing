import { writeFileSync, mkdirSync, existsSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { NextResponse } from 'next/server'
import { readForm, isResponse } from '@/lib/http'
import { parseWorkbook } from '@/lib/excel/parse'

export const runtime = 'nodejs'
export const maxDuration = 120

/**
 * Clears the imported catalogue so a different set of products can be loaded.
 *
 * Removes the products, the photos extracted from the sheet, and the per-product
 * layout exceptions — those are keyed by SKU and would otherwise be orphaned,
 * silently re-attaching themselves if a future sheet reused a SKU.
 *
 * Templates are NOT touched. The layout work survives; only the catalogue goes.
 */
export async function DELETE() {
  const removed = { products: 0, photos: 0, overrides: 0 }

  const state = join(process.cwd(), 'data/state/last-import.json')
  if (existsSync(state)) {
    try {
      const prev = JSON.parse(readFileSync(state, 'utf8')) as { products?: unknown[] }
      removed.products = prev.products?.length ?? 0
    } catch { /* unreadable state is still state to clear */ }
    rmSync(state, { force: true })
  }

  const photos = join(process.cwd(), 'data/samples/images')
  if (existsSync(photos)) {
    removed.photos = readdirSync(photos).filter((f) => !f.startsWith('.')).length
    rmSync(photos, { recursive: true, force: true })
  }

  const templates = join(process.cwd(), 'data/templates')
  if (existsSync(templates)) {
    for (const f of readdirSync(templates).filter((f) => f.endsWith('.overrides.json'))) {
      try {
        removed.overrides += Object.keys(JSON.parse(readFileSync(join(templates, f), 'utf8'))).length
      } catch { /* count is a courtesy, not a requirement */ }
      rmSync(join(templates, f), { force: true })
    }
  }

  return NextResponse.json({ cleared: true, removed })
}

/** What is currently loaded, for the catalogue strip. */
export async function GET() {
  const state = join(process.cwd(), 'data/state/last-import.json')
  if (!existsSync(state)) return NextResponse.json({ loaded: false })
  try {
    const d = JSON.parse(readFileSync(state, 'utf8')) as {
      fileName: string; at: string; mapping: Record<string, string>
      columns: string[]; products?: unknown[]
    }
    return NextResponse.json({
      loaded: true,
      fileName: d.fileName,
      at: d.at,
      products: d.products?.length ?? 0,
      mapping: d.mapping,
      columns: d.columns,
    })
  } catch {
    return NextResponse.json({ loaded: false })
  }
}

export async function POST(req: Request) {
  const form = await readForm(req)
  if (isResponse(form)) return form
  const file = form.get('file')

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No file was uploaded.' }, { status: 400 })
  }
  if (!/\.xlsx?$/i.test(file.name)) {
    return NextResponse.json(
      { error: `"${file.name}" is not an Excel file. Export the sheet as .xlsx and try again.` },
      { status: 400 },
    )
  }

  try {
    const { products, issues, headers, mapping, sheetName } = await parseWorkbook(
      await file.arrayBuffer(),
    )

    // Remember the sheet's shape so the template editor can offer the real
    // column names and preview against a real product rather than invented
    // placeholders. Just the vocabulary and one row — not the catalogue.
    try {
      mkdirSync(join(process.cwd(), 'data/state'), { recursive: true })
      const sample = products[0]
      // Longest name first: if the layout survives that, it survives the rest.
      const byLength = [...products].sort(
        (a, b) => (b.name_en ?? '').length - (a.name_en ?? '').length,
      )
      const previewSet = [...new Set([byLength[0], products[0], ...products])]
        .filter(Boolean)
        .slice(0, 12)
        .map(({ image, ...p }) => ({ ...p, hasImage: Boolean(image) }))
      writeFileSync(
        join(process.cwd(), 'data/state/last-import.json'),
        JSON.stringify(
          {
            fileName: file.name,
            at: new Date().toISOString(),
            headers,
            mapping,
            columns: [...Object.keys(mapping), ...Object.keys(sample?.extra ?? {})],
            sample: sample ? { ...sample, image: undefined, extra: sample.extra } : null,
            preview: previewSet,
            // The full catalogue, without image buffers — those stay on disk.
            products: products.map(({ image, ...p }) => ({ ...p, hasImage: Boolean(image) })),
          },
          null,
          2,
        ),
      )
    } catch {
      // Not being able to remember this is not a reason to fail the import.
    }

    // Image buffers stay on the server; the client only needs to know one exists.
    return NextResponse.json({
      fileName: file.name,
      sheetName,
      headers,
      mapping,
      issues,
      counts: {
        products: products.length,
        errors: issues.filter((i) => i.severity === 'error').length,
        warnings: issues.filter((i) => i.severity === 'warning').length,
        withImage: products.filter((p) => p.image).length,
        withArabic: products.filter((p) => p.name_ar).length,
      },
      products: products.map(({ image, ...p }) => ({ ...p, hasImage: Boolean(image) })),
    })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Could not read that workbook.' },
      { status: 500 },
    )
  }
}
