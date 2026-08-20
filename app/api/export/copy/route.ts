import { NextResponse } from 'next/server'
import { importedProducts } from '@/lib/template/columns'
import { buildCopyWorkbook } from '@/lib/excel/copy'
import { allPieces } from '@/lib/content/studio'

export const runtime = 'nodejs'

/** How much there is to export, for the button's label. */
export async function GET() {
  const approved = allPieces().filter((p) => p.status === 'approved')
  return NextResponse.json({
    approved: approved.length,
    products: new Set(approved.map((p) => p.sku)).size,
    drafts: allPieces().length - approved.length,
  })
}

export async function POST() {
  const products = Object.fromEntries(importedProducts().map((p) => [String(p.sku), p]))
  const { buffer, count, products: n } = await buildCopyWorkbook(products, new Date())

  if (!count) {
    return NextResponse.json(
      { error: 'Nothing is approved yet. Approve the lines you want, then export — drafts deliberately do not leave.' },
      { status: 400 },
    )
  }

  const day = new Date().toISOString().slice(0, 10)
  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="approved-copy-${day}.xlsx"`,
      // The counts the UI shows after a download, without re-reading the store.
      'X-Copy-Count': String(count),
      'X-Copy-Products': String(n),
    },
  })
}
