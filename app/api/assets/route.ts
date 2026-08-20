import { NextResponse } from 'next/server'
import { readJson } from '@/lib/http'
import { drifted, forget } from '@/lib/assets'
import { campaignProducts } from '@/lib/template/columns'

export const runtime = 'nodejs'
export const maxDuration = 300

/**
 * Which exported designs no longer match what the product resolves to now.
 *
 * Every recorded design is re-rendered in memory to answer this. Nothing is
 * written and no file is produced — it is the export's own code path stopped one
 * step early, so the comparison cannot drift away from what a real re-render
 * would actually produce.
 */
export async function GET(req: Request) {
  const templateId = new URL(req.url).searchParams.get('templateId') ?? undefined
  try {
    const { drift, checked } = await drifted(await campaignProducts(), templateId)
    return NextResponse.json({ watching: true, checked, drift })
  } catch {
    // No database. Say so rather than reporting zero out-of-date designs, which
    // reads identically to "everything is fine" and is not what is meant.
    return NextResponse.json({ watching: false, checked: 0, drift: [] })
  }
}

/** Forget a design — after re-exporting it, or when it is withdrawn. */
export async function DELETE(req: Request) {
  const { sku, templateId } = (await readJson(req)) as { sku?: string; templateId?: string }
  if (!sku || !templateId) return NextResponse.json({ error: 'Which design?' }, { status: 400 })
  await forget(sku, templateId)
  return NextResponse.json({ forgotten: true })
}
