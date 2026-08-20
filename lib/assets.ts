/**
 * Which exported designs carry a figure that has since changed.
 *
 * A rendered poster is pixels. The price in it stops being a reference to the
 * catalogue the moment the PNG is written, and prices move weekly — so a folder
 * of two hundred designs rots quietly and the first person to notice is a
 * customer reading last month's figure off an ad.
 *
 * The fix is not clever. Record what the renderer actually painted, and compare
 * it to what the same product paints now.
 */

import { query } from '@/lib/db'
import { renderProduct, type ProductValues } from '@/lib/template/render'
import { fonts, layoutFor, loadOverrides, loadTemplate, productImage, templateShape } from '@/lib/template/store'

export type Asset = {
  sku: string
  template_id: string
  bound_values: Record<string, string>
  formats: string[]
  width: number | null
  exported_at: string
  exported_by: string | null
}

export type Drift = {
  sku: string
  template_id: string
  name: string
  exported_at: string
  /** Slot by slot, only what changed. `{ price: { was, now } }`. */
  changed: Record<string, { was: string; now: string }>
}

/**
 * Record what an export put on disk.
 *
 * `bound_values` is what `renderProduct` reports as `resolved` — the strings it
 * actually painted, not the row it painted them from. Storing the row would
 * mean formatting it a second time to compare, and a quantity derived twice is
 * the bug this project has shipped four times (D32, D38, D39).
 */
export async function recordExport(
  entries: { sku: string; templateId: string; bound: Record<string, string> }[],
  { formats, width, campaignId, by }: {
    formats: string[]; width?: number; campaignId?: string | null; by?: string
  },
): Promise<number> {
  let n = 0
  for (const e of entries) {
    if (!e.sku) continue
    await query(
      `insert into assets (sku, template_id, bound_values, formats, width, campaign_id, exported_by, exported_at)
       values ($1,$2,$3,$4,$5,$6,$7, now())
       on conflict (sku, template_id) do update set
         bound_values = excluded.bound_values,
         formats      = excluded.formats,
         width        = excluded.width,
         campaign_id  = excluded.campaign_id,
         exported_by  = excluded.exported_by,
         exported_at  = now()`,
      [e.sku, e.templateId, JSON.stringify(e.bound), formats, width ?? null, campaignId ?? null, by ?? null],
    )
    n++
  }
  return n
}

/**
 * Re-render each exported design in memory and see what moved.
 *
 * Deliberately a re-render rather than a price comparison. A poster can go stale
 * because a price changed, but equally because somebody fixed a name, shortened
 * it for the poster, or marked a product out of stock — anything a slot binds.
 * Comparing only prices would report clean on a design carrying the wrong name.
 *
 * Nothing is written and no file is produced; this is the same code path the
 * export uses, stopped one step early.
 */
export async function drifted(
  rowsNow: ProductValues[],
  templateId?: string,
): Promise<{ drift: Drift[]; checked: number }> {
  const assets = await query<Asset>(
    templateId
      ? 'select * from assets where template_id = $1'
      : 'select * from assets',
    templateId ? [templateId] : [],
  )
  if (!assets.length) return { drift: [], checked: 0 }

  const byId = new Map(rowsNow.map((p) => [String(p.sku), p]))
  const f = fonts()
  const templates = new Map<string, ReturnType<typeof loadTemplate>>()

  const drift: Drift[] = []
  for (const a of assets) {
    const row = byId.get(a.sku)
    // A product that has left the catalogue is not drift — it is a different
    // problem, and reporting it here would bury the prices.
    if (!row) continue

    if (!templates.has(a.template_id)) templates.set(a.template_id, loadTemplate(a.template_id))
    const template = templates.get(a.template_id)
    if (!template) continue

    const shape = templateShape(template.svg)
    const overrides = loadOverrides(a.template_id)
    const { svg, manifest } = layoutFor(template, shape, overrides[a.sku])

    let resolved: Record<string, string>
    try {
      ;({ resolved } = renderProduct(svg, manifest, row, f, {
        mode: 'auto',
        images: productImage(a.sku) ? { image: productImage(a.sku) as string } : {},
      }))
    } catch {
      continue
    }

    const changed: Record<string, { was: string; now: string }> = {}
    for (const [slot, was] of Object.entries(a.bound_values)) {
      const now = resolved[slot] ?? ''
      if (now !== was) changed[slot] = { was, now }
    }

    if (Object.keys(changed).length) {
      drift.push({
        sku: a.sku,
        template_id: a.template_id,
        name: String(row.display_name ?? row.name_en ?? a.sku),
        exported_at: a.exported_at,
        changed,
      })
    }
  }

  return { drift, checked: assets.length }
}

/** Forget an export — after a re-render, or when the design is withdrawn. */
export async function forget(sku: string, templateId: string): Promise<void> {
  await query('delete from assets where sku = $1 and template_id = $2', [sku, templateId])
}
