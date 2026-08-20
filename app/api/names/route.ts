import { NextResponse } from 'next/server'
import { readJson } from '@/lib/http'
import { displayNames, importedProducts, saveDisplayNames } from '@/lib/template/columns'
import { checkName, nameBlockers, suggestNames, POSTER_MAX } from '@/lib/content/names'

export const runtime = 'nodejs'
// A batch of sixty is roughly eight model calls.
export const maxDuration = 600

/** Every product, with its short name resolved and checked against the rest. */
function rows(pending: Record<string, string> = {}) {
  const saved = displayNames()
  const products = importedProducts()

  // Resolved names for the WHOLE catalogue first — the collision check is
  // meaningless against a subset, and a pending edit has to collide with what
  // the person is about to save, not with what is on disk.
  const resolved = products.map((p) => {
    const sku = String(p.sku)
    // `||`, not `??`. An edit that CLEARS a name sends an empty string, and `??`
    // would resolve that product to "" rather than to the title it falls back
    // to — the same "nothing is not zero" trap as an absent price.
    return { sku, name: (pending[sku] ?? saved[sku] ?? '') || String(p.name_en ?? '') }
  })

  return products.map((p) => {
    const sku = String(p.sku)
    const full = String(p.name_en ?? '')
    const short = pending[sku] ?? saved[sku] ?? ''
    return {
      sku,
      name_en: full,
      length: full.length,
      short,
      // An unset name is not a failure; it falls back to the title, which is
      // long but never wrong. Checks only apply to a name somebody chose.
      checks: short ? checkName(short, { sku, name_en: full }, resolved) : [],
      source: short ? (saved[sku] ? 'saved' : 'suggested') : 'none',
    }
  })
}

export async function GET() {
  const all = rows()
  return NextResponse.json({
    posterMax: POSTER_MAX,
    products: all,
    counts: {
      total: all.length,
      set: all.filter((r) => r.short).length,
      tooLong: all.filter((r) => !r.short && r.length > POSTER_MAX).length,
    },
  })
}

/** Propose short names. Nothing is saved — the response is a draft to review. */
export async function POST(req: Request) {
  const { skus } = (await readJson(req)) as { skus?: string[] }
  const products = importedProducts()
  const wanted = skus?.length
    ? products.filter((p) => skus.includes(String(p.sku)))
    : // Default to the ones that actually need it. A name already inside the
      // poster range does not need a model to look at it.
      products.filter((p) => String(p.name_en ?? '').length > POSTER_MAX)

  if (!wanted.length) return NextResponse.json({ products: rows(), suggested: 0 })

  try {
    const suggestions = await suggestNames(
      wanted.map((p) => ({ sku: String(p.sku), name_en: String(p.name_en ?? ''), brand: String(p.brand ?? '') })),
    )
    return NextResponse.json({ products: rows(suggestions), suggested: Object.keys(suggestions).length })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Could not suggest names.'
    return NextResponse.json(
      { error: /fetch failed|ECONNREFUSED/i.test(msg) ? 'Ollama is not answering on localhost. Run: brew services start ollama' : msg },
      { status: 500 },
    )
  }
}

/**
 * Save reviewed names.
 *
 * A name that fails a check is refused — but only that name. Rejecting a batch
 * of fifty-three good names because three are one character too long throws
 * away the reviewing that was already done, and the person would simply do it
 * again. The refused ones come back so they stay in the box being edited.
 */
export async function PUT(req: Request) {
  const { edits } = (await readJson(req)) as { edits?: Record<string, string> }
  if (!edits || !Object.keys(edits).length) return NextResponse.json({ products: rows(), saved: 0, refused: [] })

  const checked = rows(edits)
  const refused = checked
    .filter((r) => edits[r.sku]?.trim() && nameBlockers(r.checks).length)
    .map((r) => ({ sku: r.sku, short: r.short, failed: nameBlockers(r.checks).map((c) => c.name) }))

  // A SKU that is not in the catalogue is a typo or a stale tab, and storing it
  // writes a row nothing will ever show: the table only lists real products, so
  // an orphan is invisible, permanent, and re-attaches itself if a later sheet
  // reuses that SKU. The import route already refuses to leave orphaned layout
  // overrides behind for exactly this reason.
  const known = new Set(checked.map((r) => r.sku))
  for (const sku of Object.keys(edits)) {
    if (!known.has(sku)) refused.push({ sku, short: edits[sku], failed: ['no such product in the loaded sheet'] })
  }

  const refusedSkus = new Set(refused.map((r) => r.sku))
  const accepted = Object.fromEntries(Object.entries(edits).filter(([sku]) => !refusedSkus.has(sku)))
  saveDisplayNames(accepted)

  return NextResponse.json({ products: rows(), saved: Object.keys(accepted).length, refused })
}
