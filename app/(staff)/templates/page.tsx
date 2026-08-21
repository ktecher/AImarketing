'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

type Drift = {
  sku: string; template_id: string; name: string; exported_at: string
  changed: Record<string, { was: string; now: string }>
}
type Report = { slot: string; truncated?: boolean; shrunkTo?: number; empty?: boolean; missingImage?: boolean; boxTooShort?: { need: number; have: number }; literalText?: { printing: string; insteadOf: string } }
type Result = { sku: string; name: string; report: Report[]; png?: string; overridden?: boolean }
type Tpl = { id: string; name: string; slots: string[]; width: number; height: number }
type NameCheck = { name: string; pass: boolean; span?: string; hint?: string }
type NameRow = { sku: string; name_en: string; length: number; short: string; checks: NameCheck[]; source: string }

const PAGE = 12

// What a retail marketing team actually uses each format for.
const FORMATS = [
  { id: 'png', label: 'PNG', use: 'social posts, screens' },
  { id: 'jpg', label: 'JPG', use: 'WhatsApp, email — smaller' },
  { id: 'svg', label: 'SVG', use: 'editable in Illustrator' },
  { id: 'pdf', label: 'PDF', use: 'approvals, print house' },
]

const SIZES = [
  { px: 0,    label: 'as designed' },
  { px: 1080, label: '1080 — Instagram' },
  { px: 1600, label: '1600 — large' },
]

function describe(r: Report): string {
  if (r.literalText) {
    return `${r.slot} — printing “${r.literalText.printing}” on every design instead of each product's ${r.literalText.insteadOf}`
  }
  if (r.boxTooShort) return `${r.slot} — box is ${r.boxTooShort.have}px, needs ${r.boxTooShort.need}px`
  if (r.truncated) return `${r.slot} — text was cut to fit`
  if (r.missingImage) return `${r.slot} — no product photo`
  if (r.empty) return `${r.slot} — nothing in that column`
  if (r.shrunkTo) return `${r.slot} — shrunk to ${r.shrunkTo}pt`
  return r.slot
}

export default function Templates() {
  const [templates, setTemplates] = useState<Tpl[]>([])
  const [active, setActive] = useState('brand-poster')
  const [results, setResults] = useState<Result[]>([])
  const [total, setTotal] = useState(0)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const [onlyFlagged, setOnlyFlagged] = useState(false)
  const [faults, setFaults] = useState<Report[]>([])
  const [drift, setDrift] = useState<Drift[]>([])
  const [watching, setWatching] = useState(true)
  const [showDrift, setShowDrift] = useState(false)
  const [formats, setFormats] = useState<string[]>(['png'])
  const [exportWidth, setExportWidth] = useState(0)
  const [exporting, setExporting] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [adding, setAdding] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [notice, setNotice] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [sheet, setSheet] = useState<{ fileName: string; products: number; mapping: Record<string, string> } | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [importing, setImporting] = useState(false)
  const sheetRef = useRef<HTMLInputElement>(null)
  const [namesOpen, setNamesOpen] = useState(false)
  const [names, setNames] = useState<NameRow[]>([])
  const [nameEdits, setNameEdits] = useState<Record<string, string>>({})
  const [namesBusy, setNamesBusy] = useState('')
  const [posterMax, setPosterMax] = useState(35)

  const loadTemplates = useCallback(async () => {
    const d = await fetch('/api/templates').then((r) => r.json())
    setTemplates(d.templates ?? [])
  }, [])

  const loadSheet = useCallback(async () => {
    const d = await fetch('/api/import').then((r) => r.json())
    setSheet(d.loaded ? d : null)
  }, [])

  const loadNames = useCallback(async () => {
    const d = await fetch('/api/names').then((r) => r.json())
    setNames(d.products ?? [])
    setPosterMax(d.posterMax ?? 35)
    setNameEdits({})
  }, [])

  useEffect(() => { void loadTemplates(); void loadSheet() }, [loadTemplates, loadSheet])

  async function suggestNames() {
    setNamesBusy('suggesting'); setError(''); setNotice('')
    try {
      const res = await fetch('/api/names', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      const d = await res.json()
      if (!res.ok) setError(d.error ?? 'Could not suggest names.')
      else {
        setNames(d.products)
        // Suggestions are a draft. They are not saved until Save is pressed, so
        // the edit map is what carries them.
        const drafted: Record<string, string> = {}
        for (const r of d.products as NameRow[]) if (r.source === 'suggested') drafted[r.sku] = r.short
        setNameEdits(drafted)
        setNotice(`${d.suggested} names proposed. Nothing is saved yet — read them, fix what is wrong, then Save.`)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not suggest names.')
    }
    setNamesBusy('')
  }

  async function saveNames() {
    setNamesBusy('saving'); setError(''); setNotice('')
    try {
      const res = await fetch('/api/names', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ edits: nameEdits }),
      })
      const d = await res.json()
      if (!res.ok) { setError(d.error ?? 'Could not save.'); setNames(d.products ?? names) }
      else {
        setNames(d.products)
        // Refused names stay in the edit boxes. They are the ones still needing
        // a decision, and clearing them would hide the work that remains.
        const stillOpen: Record<string, string> = {}
        for (const r of (d.refused ?? []) as { sku: string; short: string }[]) stillOpen[r.sku] = r.short
        setNameEdits(stillOpen)
        setNotice(
          `${d.saved} short names saved. The posters below use them now, and so will new captions.` +
          (d.refused?.length ? ` ${d.refused.length} still fail a check and are left in the boxes for you.` : ''),
        )
        void render(active, 0, true)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.')
    }
    setNamesBusy('')
  }

  async function importSheet(file: File) {
    setImporting(true); setError(''); setNotice('')
    const body = new FormData()
    body.append('file', file)
    try {
      const res = await fetch('/api/import', { method: 'POST', body })
      const d = await res.json()
      if (!res.ok) setError(d.error ?? 'Import failed.')
      else {
        await loadSheet()
        setSheetOpen(false)
        const c = d.counts
        setNotice(
          `Loaded ${c.products} products from ${d.fileName}` +
          `${c.errors ? `, skipped ${c.errors}` : ''}` +
          `${c.withArabic ? `, ${c.withArabic} with Arabic` : ''}.` +
          ` Photos are read from the sheet — check the column list before building on it.`,
        )
        void render(active, 0, true)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed.')
    }
    setImporting(false)
  }

  async function addTemplate(file: File) {
    setUploading(true); setError(''); setNotice('')
    const body = new FormData()
    body.append('file', file)
    try {
      const res = await fetch('/api/templates', { method: 'POST', body })
      const d = await res.json()
      if (!res.ok) setError(d.error ?? 'Could not add that template.')
      else {
        await loadTemplates()
        setActive(d.id)
        setAdding(false)
        setNotice(
          `Added "${d.name}" — ${d.width}×${d.height}, with ${d.slots.length} slots placed inside the ` +
          `clear area.${d.warning ? ' ' + d.warning : ''} Open Edit layout to move them.`,
        )
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add that template.')
    }
    setUploading(false)
  }

  const render = useCallback(async (id: string, offset: number, replace: boolean) => {
    setBusy(true); setError('')
    try {
      const res = await fetch('/api/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // A grid does not need full-size renders; 320px keeps the payload sane.
        body: JSON.stringify({ templateId: id, limit: PAGE, offset, width: 320 }),
      })
      const data = await res.json()
      if (!res.ok) setError(data.error ?? 'Render failed.')
      else {
        setTotal(data.total ?? 0)
        setResults((prev) => (replace ? data.results : [...prev, ...data.results]))
        setFaults(data.templateFaults ?? [])
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Render failed.')
    }
    setBusy(false)
  }, [])

  useEffect(() => { void render(active, 0, true) }, [active, render])

  /**
   * Which already-downloaded designs have gone stale.
   *
   * Re-checked after every export, because exporting is exactly what makes the
   * warning go away and a banner that lingers after you have fixed it is a
   * banner people learn to ignore.
   */
  const checkDrift = useCallback(async (id: string) => {
    try {
      const d = await fetch(`/api/assets?templateId=${encodeURIComponent(id)}`).then((r) => r.json())
      setWatching(d.watching !== false)
      setDrift(d.drift ?? [])
    } catch { setWatching(false) }
  }, [])

  useEffect(() => { void checkDrift(active) }, [active, checkDrift])

  async function download() {
    setExporting(true); setError('')
    try {
      const res = await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId: active, formats, width: exportWidth || undefined }),
      })
      if (!res.ok) {
        setError((await res.json()).error ?? 'Export failed.')
      } else {
        // Straight to a file — a 60-design ZIP has no business in memory twice.
        const url = URL.createObjectURL(await res.blob())
        const a = document.createElement('a')
        a.href = url
        a.download = `${active}-designs.zip`
        a.click()
        URL.revokeObjectURL(url)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed.')
    }
    // The export just refreshed every design it wrote, so re-ask.
    void checkDrift(active)
    setExporting(false)
  }

  async function deleteTemplate() {
    const t = templates.find((x) => x.id === active)
    if (!t) return
    setError(''); setNotice('')
    const res = await fetch(`/api/templates/${active}`, { method: 'DELETE' })
    if (!res.ok) { setError('Could not delete that template.'); return }

    const rest = templates.filter((x) => x.id !== active)
    setTemplates(rest)
    setConfirmDelete(false)
    setNotice(`Deleted "${t.name}". Your products and other templates are untouched.`)
    // Fall back to whatever template is left, so the page is never pointed at
    // something that no longer exists.
    if (rest[0]) setActive(rest[0].id)
    else { setResults([]); setTotal(0) }
  }

  async function clearCatalogue() {
    setClearing(true); setError('')
    try {
      const res = await fetch('/api/import', { method: 'DELETE' })
      if (!res.ok) setError('Could not clear the catalogue.')
      else { setResults([]); setTotal(0); setConfirmClear(false); setSheet(null) }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not clear the catalogue.')
    }
    setClearing(false)
  }

  const flagged = results.filter((r) => r.report.length > 0)
  const shown = onlyFlagged ? flagged : results

  return (
    <main>
      <h1>Designs</h1>
      <p className="sub">
        A product sheet, a template, and one finished design per product. Everything
        happens here.
      </p>

      <div className="chips" style={{ marginBottom: 14 }}>
        {templates.map((t) => (
          <button key={t.id} className={`chip ${t.id === active ? 'on' : ''}`}
                  onClick={() => { setActive(t.id); setConfirmDelete(false); setNotice('') }}>
            {t.name} · {t.width}×{t.height}
          </button>
        ))}
        <button className="chip add" onClick={() => setAdding((a) => !a)}>
          {adding ? '× close' : '+ add a template'}
        </button>
      </div>

      {adding && (
        <div
          className="drop"
          style={{ marginBottom: 16 }}
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault()
            const f = e.dataTransfer.files[0]
            if (f) void addTemplate(f)
          }}
        >
          <input ref={fileRef} type="file" accept=".png,.jpg,.jpeg,.webp,.avif,.tif,.tiff"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void addTemplate(f) }} />
          {uploading ? 'Reading the artwork…' : (
            <>
              <b>Drop brand artwork here</b><br />
              <span style={{ color: 'var(--muted)', fontSize: 13 }}>
                PNG, JPG, WebP or AVIF. The clear area is measured and the fields are
                placed inside it — you move them afterwards. Your existing templates are kept.
              </span>
            </>
          )}
        </div>
      )}

      {notice && <div className="notice">{notice}</div>}

      <div className="starter">
        <div>
          <b>{templates.find((t) => t.id === active)?.name ?? active}</b>
          <span>
            Slots: {templates.find((t) => t.id === active)?.slots.join(', ') || '…'}.
            Their positions live in the SVG; the manifest only says what binds to
            what and how it should fit.
          </span>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {confirmDelete ? (
            <>
              <span style={{ fontSize: 12.5, color: 'var(--err)' }}>
                Delete this template and its per-product changes? Products are kept.
              </span>
              <button className="chip" onClick={() => setConfirmDelete(false)}>Keep</button>
              <button className="btn danger-btn" onClick={() => void deleteTemplate()}>Delete</button>
            </>
          ) : (
            <>
              {templates.length > 1 && (
                <button className="chip danger" onClick={() => setConfirmDelete(true)}>Delete</button>
              )}
              <a className="chip" href="/api/template">Product sheet</a>
              <a className="btn" href={`/templates/${active}/edit`}>Edit layout</a>
            </>
          )}
        </div>
      </div>

      {error && <div className="err">{error}</div>}

      <div className="panel catalogue">
        <div className="export-head" style={{ margin: 0 }}>
          <div>
            {sheet ? (
              <>
                <b>{sheet.products} products · {sheet.fileName}</b>
                <span>
                  {Object.keys(sheet.mapping).length} columns understood.{' '}
                  <button className="linkish" onClick={() => setSheetOpen((o) => !o)}>
                    {sheetOpen ? 'hide' : 'check them'}
                  </button>
                  {' · '}
                  <button className="linkish" onClick={() => {
                    setNamesOpen((o) => !o)
                    if (!namesOpen && !names.length) void loadNames()
                  }}>
                    {namesOpen ? 'hide short names' : 'shorten names for posters'}
                  </button>
                </span>
              </>
            ) : (
              <>
                <b>No products loaded</b>
                <span>Drop the product sheet below, or download a blank one to fill in.</span>
              </>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <a className="chip" href="/api/template">Blank sheet</a>
            <button className="chip" onClick={() => sheetRef.current?.click()}>
              {sheet ? 'Use a different sheet' : 'Choose a sheet'}
            </button>
          </div>
        </div>

        <input ref={sheetRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void importSheet(f) }} />

        {importing && <p className="hint">Reading the sheet…</p>}

        {sheet && sheetOpen && (
          <div style={{ marginTop: 12 }}>
            {Object.entries(sheet.mapping).map(([field, header]) => (
              <span key={field} className="tag mapped">{field} ← {header}</span>
            ))}
            <p className="hint" style={{ marginTop: 8 }}>
              These names become the template bindings and the assistant&rsquo;s comparison
              surface. Wrong here is expensive later.
            </p>
          </div>
        )}

        {sheet && namesOpen && (
          <div className="names">
            <div className="export-head" style={{ marginTop: 14, marginBottom: 10 }}>
              <div>
                <b>
                  {names.filter((r) => r.short).length} of {names.length} products have a short name
                </b>
                <span>
                  A catalogue title is not a headline — {posterMax} characters is the poster range.
                  Blank means the full product name is used. Every word must come from that name,
                  and no two products may share one.
                </span>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="chip" disabled={Boolean(namesBusy)} onClick={() => void suggestNames()}>
                  {namesBusy === 'suggesting' ? 'proposing…' : `Propose for the ${names.filter((r) => !r.short && r.length > posterMax).length} too long`}
                </button>
                <button className="btn small" disabled={!Object.keys(nameEdits).length || Boolean(namesBusy)}
                        onClick={() => void saveNames()}>
                  {namesBusy === 'saving' ? 'saving…' : `Save ${Object.keys(nameEdits).length || ''}`}
                </button>
              </div>
            </div>

            {namesBusy === 'suggesting' && (
              <p className="hint">Runs on this machine, eight products a call. A full catalogue takes a minute or two.</p>
            )}

            <div className="scroll">
              <table>
                <thead>
                  <tr>
                    <th>Product name</th>
                    <th style={{ width: 60 }}>Chars</th>
                    <th style={{ width: 300 }}>Short name</th>
                  </tr>
                </thead>
                <tbody>
                  {names.map((r) => {
                    const value = nameEdits[r.sku] ?? r.short
                    const failed = r.checks.filter((c) => !c.pass)
                    return (
                      <tr key={r.sku}>
                        <td>
                          <span className="cap-name">{r.name_en}</span>
                          <span className="tag">{r.sku}</span>
                        </td>
                        <td className="num" style={{ color: r.length > posterMax ? 'var(--warn)' : 'var(--muted)' }}>
                          {r.length}
                        </td>
                        <td>
                          <input type="text" value={value} placeholder="— uses the full name —"
                                 className={failed.length ? 'bad' : ''}
                                 onChange={(e) => setNameEdits((m) => ({ ...m, [r.sku]: e.target.value }))} />
                          <span className="text-meta">
                            <span>{value ? `${value.length} characters` : ''}</span>
                            {r.source === 'saved' && !nameEdits[r.sku] ? <span>saved</span> : null}
                          </span>
                          {/* no fontWeight override — the 600 weight on .note.bad
                              is the only cue separating a failed check from a
                              warning without relying on colour */}
                          {failed.map((c) => (
                            <span key={c.name} className="note bad" style={{ fontSize: 11.5 }}>
                              {c.name}{c.span ? ` — ${c.span}` : ''}
                            </span>
                          ))}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {!sheet && (
          <div className="drop" style={{ marginTop: 12 }}
            onClick={() => sheetRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) void importSheet(f) }}>
            <b>Drop an .xlsx here</b><br />
            <span style={{ color: 'var(--muted)', fontSize: 13 }}>embedded photos are read too</span>
          </div>
        )}
      </div>

      {total > 0 && (
        <div className="panel clear-panel">
          {!confirmClear ? (
            <div className="export-head" style={{ margin: 0 }}>
              <div>
                <b>Finished with these {total} products?</b>
                <span>Clear them out and import a different sheet.</span>
              </div>
              <button className="chip danger" onClick={() => setConfirmClear(true)}>
                Clear catalogue
              </button>
            </div>
          ) : (
            <div className="export-head" style={{ margin: 0 }}>
              <div>
                <b style={{ color: 'var(--err)' }}>Remove {total} products?</b>
                <span>
                  Goes: the products, their photos, and any single-product layout
                  changes. <b>Stays: your templates and their layouts.</b> Nothing
                  here touches the original Excel file.
                </span>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="chip" onClick={() => setConfirmClear(false)}>Keep them</button>
                <button className="btn danger-btn" onClick={() => void clearCatalogue()} disabled={clearing}>
                  {clearing ? 'Clearing…' : `Yes, remove ${total}`}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {total > 0 && (
        <div className="panel export">
          <div className="export-head">
            <div>
              <b>Download all {total} designs</b>
              <span>One ZIP, one folder per format, with a note listing every design that needs a look.</span>
            </div>
            <button className="btn" onClick={() => void download()} disabled={exporting || !formats.length}>
              {exporting ? 'Building the ZIP…' : `Download ${total} designs`}
            </button>
          </div>

          <div className="fmt-grid">
            {FORMATS.map((f) => (
              <label key={f.id} className={`fmt ${formats.includes(f.id) ? 'on' : ''}`}>
                <input type="checkbox" checked={formats.includes(f.id)}
                  onChange={(e) => setFormats((p) =>
                    e.target.checked ? [...p, f.id] : p.filter((x) => x !== f.id))} />
                <b>{f.label}</b>
                <span>{f.use}</span>
              </label>
            ))}
          </div>

          <div className="row" style={{ marginTop: 12, maxWidth: 280 }}>
            <label className="fld">
              <span>Size</span>
              <select value={exportWidth} onChange={(e) => setExportWidth(+e.target.value)}>
                {SIZES.map((s) => <option key={s.px} value={s.px}>{s.label}</option>)}
              </select>
            </label>
          </div>
          <p className="hint" style={{ marginTop: 0 }}>
            The artwork is a raster file, so enlarging past its own size softens it.
            PDF is RGB — good for approvals, not a print master.
          </p>
        </div>
      )}

      {drift.length > 0 && (
        <div className="notice warn-notice" role="alert" style={{ marginBottom: 14 }}>
          <b>
            {drift.length} exported {drift.length === 1 ? 'design carries' : 'designs carry'} a
            value that has since changed.
          </b>
          <p style={{ margin: '4px 0 0' }}>
            The figures in those files are pixels. Download them again to bring them up to date.
          </p>
          <p style={{ margin: '8px 0 0' }}>
            <button className="linkish" onClick={() => setShowDrift((v) => !v)}>
              {showDrift ? 'hide them' : 'show me which'}
            </button>
          </p>
          {showDrift && (
            <table className="drift">
              <tbody>
                {drift.map((d) => (
                  <tr key={`${d.sku}:${d.template_id}`}>
                    <td className="mono">{d.sku}</td>
                    <td>{d.name}</td>
                    <td>
                      {Object.entries(d.changed).map(([slot, c]) => (
                        <span key={slot} className="drift-change">
                          <b>{slot}</b> <s>{c.was}</s> → {c.now}
                        </span>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {!watching && (
        <p className="sub">
          Designs already downloaded are not being watched for price changes — Postgres is not
          running. Start it with <code>npm run db:up</code>.
        </p>
      )}

      {faults.length > 0 && (
        <div className="notice warn-notice" role="alert" style={{ marginBottom: 14 }}>
          <b>The template itself needs fixing — this affects all {total} designs.</b>
          <ul style={{ margin: '6px 0 0', paddingInlineStart: 18 }}>
            {faults.map((f) => <li key={f.slot}>{describe(f)}</li>)}
          </ul>
          <p style={{ margin: '6px 0 0' }}>
            Open <b>Edit layout</b> and clear that slot&rsquo;s text so it reads its column again.
          </p>
        </div>
      )}

      <div className="stats">
        <div className="stat"><b>{total}</b><span>products imported</span></div>
        <div className="stat"><b>{results.length}</b><span>rendered so far</span></div>
        <div className="stat">
          <b style={{ color: flagged.length ? 'var(--warn)' : undefined }}>{flagged.length}</b>
          <span>needed attention</span>
        </div>
        <div className="stat"><b>{results.length - flagged.length}</b><span>clean</span></div>
      </div>

      {flagged.length > 0 && (
        <label className="toggle" style={{ marginBottom: 14 }}>
          <input type="checkbox" checked={onlyFlagged} onChange={(e) => setOnlyFlagged(e.target.checked)} />
          show only the ones that need a look
        </label>
      )}



      <div className="renders">
        {shown.map((r) => (
          <figure key={r.sku} className="render">
            {r.png
              ? <img src={`data:image/png;base64,${r.png}`} alt={r.name} loading="lazy" />
              : <div className="panel">no preview</div>}
            <figcaption>
              <b>
                {r.sku}
                {r.overridden && <span className="badge over" style={{ marginLeft: 6 }}>own layout</span>}
              </b>
              <span className="cap-name">{r.name}</span>
              {r.report.length === 0
                ? <span className="ok-note">clean</span>
                : r.report.map((x) => (
                    <span key={x.slot} className={`note ${x.truncated ? 'bad' : ''}`}>{describe(x)}</span>
                  ))}
              <div className="card-actions">
                <a className="chip" href={`/templates/${active}/edit?sku=${encodeURIComponent(r.sku)}`}>
                  Edit this one
                </a>
              </div>
            </figcaption>
          </figure>
        ))}
      </div>

      {busy && <p className="hint">Rendering…</p>}

      {!busy && results.length < total && (
        <button className="btn" style={{ marginTop: 18 }}
                onClick={() => void render(active, results.length, false)}>
          Render the next {Math.min(PAGE, total - results.length)}
        </button>
      )}

      {!busy && results.length > 0 && results.length === total && (
        <div className="panel" style={{ marginTop: 22 }}>
          <p style={{ marginTop: 0 }}>
            All {total} rendered. <b>{flagged.length} needed attention</b> — every
            shrink and every truncation is listed rather than hidden.
          </p>
          <p style={{ margin: 0, color: 'var(--muted)', fontSize: 13 }}>
            &ldquo;{flagged.length} of {total} needed attention&rdquo; is a more
            trustworthy claim than &ldquo;{total} designs, all perfect&rdquo; — and it
            is the one that survives somebody finding the broken one.
          </p>
        </div>
      )}
    </main>
  )
}
