import { NextResponse } from 'next/server'
import { readForm, readJson, isResponse } from '@/lib/http'
import { parseWorkbook } from '@/lib/excel/parse'
import { catalogueSize, reachable } from '@/lib/db'
import { edit, embedPending, list, upsert, type Editable } from '@/lib/catalogue'

export const runtime = 'nodejs'
// Thousands of rows, embedded in batches. The client keeps asking until done.
export const maxDuration = 600

/** A page of the catalogue, or the state of an empty one. */
export async function GET(req: Request) {
  const url = new URL(req.url)

  if (!(await reachable())) {
    return NextResponse.json(
      { up: false, error: 'Postgres is not answering. Run: brew services start postgresql@17' },
      { status: 503 },
    )
  }

  const { rows, total } = await list({
    search: url.searchParams.get('q') ?? '',
    limit: Number(url.searchParams.get('limit') ?? 50),
    offset: Number(url.searchParams.get('offset') ?? 0),
  })
  return NextResponse.json({ up: true, rows, total, all: await catalogueSize() })
}

/** Upload the full catalogue, or embed the next batch. */
export async function POST(req: Request) {
  if (!(await reachable())) {
    return NextResponse.json(
      { error: 'Postgres is not answering. Run: brew services start postgresql@17' },
      { status: 503 },
    )
  }

  // Embedding is driven from the client so a few thousand rows do not sit
  // inside one request that a browser will give up on. Each call does a batch
  // and says how many are left.
  if (req.headers.get('content-type')?.includes('application/json')) {
    const { action } = (await readJson(req)) as { action?: string }
    if (action !== 'embed') return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
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

  const form = await readForm(req)
  if (isResponse(form)) return form
  const file = form.get('file')
  if (!(file instanceof File)) return NextResponse.json({ error: 'No file was uploaded.' }, { status: 400 })
  if (!/\.xlsx?$/i.test(file.name)) {
    return NextResponse.json(
      { error: `"${file.name}" is not an Excel file. Export the sheet as .xlsx and try again.` },
      { status: 400 },
    )
  }

  try {
    const { products, issues } = await parseWorkbook(await file.arrayBuffer())
    const { written } = await upsert(products)
    return NextResponse.json({
      written,
      total: await catalogueSize(),
      errors: issues.filter((i) => i.severity === 'error').length,
      warnings: issues.filter((i) => i.severity === 'warning').length,
      issues: issues.slice(0, 50),
    })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Could not read that workbook.' },
      { status: 500 },
    )
  }
}

/** Change a price, fix a name, or mark something out of stock. */
export async function PUT(req: Request) {
  const { sku, patch, by } = (await readJson(req)) as {
    sku?: string; patch?: Partial<Record<Editable, string | number | boolean | null>>; by?: string
  }
  if (!sku || !patch) return NextResponse.json({ error: 'Nothing to change.' }, { status: 400 })

  // A price is three-decimal fils and must arrive as a number. "12,500" and
  // "12.5 KD" both mean something here and neither is a number yet.
  const clean: Record<string, string | number | boolean | null> = {}
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'price_now' || k === 'price_was') {
      if (v === '' || v === null) { clean[k] = null; continue }
      const n = Number(String(v).replace(/[^\d.]/g, ''))
      if (!Number.isFinite(n) || n < 0) {
        return NextResponse.json({ error: `"${v}" is not a price.` }, { status: 400 })
      }
      clean[k] = n
    } else if (k === 'in_stock') {
      clean[k] = Boolean(v)
    } else {
      clean[k] = v === '' ? null : String(v)
    }
  }

  try {
    const row = await edit(sku, clean, (by ?? '').trim() || 'a colleague')
    if (!row) return NextResponse.json({ error: 'No such product.' }, { status: 404 })
    return NextResponse.json({ row })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not save.' }, { status: 500 })
  }
}
