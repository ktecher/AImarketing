'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

type Row = {
  sku: string
  name_en: string | null
  name_ar: string | null
  display_name: string | null
  brand: string | null
  category: string | null
  category_path: string | null
  price_now: string | null
  price_was: string | null
  in_stock: boolean
  updated_at: string
  updated_by: string | null
}

const PAGE = 50

/** Three decimals, always. The same rule the posters and the assistant follow. */
const kwd = (v: string | null) =>
  v === null || v === '' ? '' : `${Number(v).toFixed(3)} KD`

export default function Products() {
  const [rows, setRows] = useState<Row[]>([])
  const [total, setTotal] = useState(0)
  const [all, setAll] = useState(0)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [down, setDown] = useState(false)
  const upload = useRef<HTMLInputElement>(null)

  const load = useCallback(async (q: string, at: number) => {
    setError('')
    try {
      const res = await fetch(`/api/products?q=${encodeURIComponent(q)}&limit=${PAGE}&offset=${at * PAGE}`)
      const d = await res.json()
      if (!res.ok) { setDown(true); setError(d.error ?? 'Could not load the catalogue.'); return }
      setDown(false); setRows(d.rows ?? []); setTotal(d.total ?? 0); setAll(d.all ?? 0)
    } catch { setDown(true); setError('Could not reach the catalogue.') }
  }, [])

  useEffect(() => { void load(search, page) }, [load, search, page])

  async function importSheet(file: File) {
    setBusy('importing'); setError(''); setNotice('')
    const body = new FormData()
    body.append('file', file)
    try {
      const res = await fetch('/api/products', { method: 'POST', body })
      const d = await res.json()
      if (!res.ok) setError(d.error ?? 'Could not import that sheet.')
      else {
        setNotice(
          `${d.written} products loaded, ${d.total} in the catalogue now.` +
            (d.errors ? ` ${d.errors} rows were skipped.` : ''),
        )
        await load(search, 0); setPage(0)
        await embedAll()
      }
    } catch { setError('Could not import that sheet.') }
    setBusy('')
  }

  /**
   * Embedding runs in batches from here rather than inside the import request.
   * A few thousand rows is minutes of model time, and a browser gives up on a
   * request long before that — this way progress is visible and resumable.
   */
  async function embedAll() {
    setBusy('embedding')
    try {
      for (;;) {
        const res = await fetch('/api/products', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'embed' }),
        })
        const d = await res.json()
        if (!res.ok) { setError(d.error ?? 'Could not finish embedding.'); break }
        if (!d.embedded) break
        setNotice(`Reading the catalogue so the assistant can search it — ${d.left} left.`)
      }
      setNotice('The assistant can search the whole catalogue now.')
    } catch { setError('Could not finish embedding.') }
    setBusy('')
  }

  async function save(sku: string, patch: Record<string, string | boolean | null>) {
    setError('')
    try {
      const res = await fetch('/api/products', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sku, patch }),
      })
      const d = await res.json()
      if (!res.ok) { setError(d.error ?? 'Could not save.'); return }
      setRows((r) => r.map((x) => (x.sku === sku ? { ...x, ...d.row } : x)))
    } catch { setError('Could not save.') }
  }

  return (
    <main>
      <h1>Products</h1>
      <p className="sub">
        Everything the shop sells. The assistant answers from this, so a customer can ask about
        anything in stock — not only what this week&rsquo;s designs are about. Designs and the
        content studio keep working from the sheet you load there.
      </p>

      {down && (
        <div className="notice warn-notice">
          <b>Postgres is not answering.</b> Run <code>brew services start postgresql@17</code>.
          Until it does, the assistant falls back to the campaign sheet.
        </div>
      )}

      <div className="panel">
        <div className="panel-head">
          <div>
            <b>{all} products</b>
            <p className="sub" style={{ margin: '2px 0 0' }}>
              Upload the full list as Excel. A product already here is updated, never duplicated,
              and nothing is deleted by a sheet that happens to omit it.
            </p>
          </div>
          <div className="row">
            <button className="btn" onClick={() => upload.current?.click()} disabled={Boolean(busy)}>
              {busy === 'importing' ? 'Reading…' : 'Upload catalogue'}
            </button>
            {all > 0 && (
              <button className="chip" onClick={() => void embedAll()} disabled={Boolean(busy)}>
                {busy === 'embedding' ? 'Reading…' : 'Re-read for search'}
              </button>
            )}
          </div>
        </div>
        <input
          ref={upload}
          type="file"
          accept=".xlsx,.xls"
          hidden
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void importSheet(f); e.target.value = '' }}
        />
      </div>

      {notice && <p className="ok-note">{notice}</p>}
      {error && <p className="note bad">{error}</p>}

      {all > 0 && (
        <>
          <div className="row" style={{ margin: '14px 0' }}>
            <input
              type="search"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(0) }}
              placeholder="Search a name, a SKU, a brand or a category"
              aria-label="Search the catalogue"
              style={{ flex: '1 1 320px' }}
            />
            <span className="sub" style={{ alignSelf: 'center' }}>
              {total} {total === 1 ? 'match' : 'matches'}
            </span>
          </div>

          <table className="catalogue">
            <thead>
              <tr>
                <th>SKU</th><th>Product</th><th>Now</th><th>Was</th><th>In stock</th><th>Changed</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.sku} className={r.in_stock ? '' : 'out'}>
                  <td className="mono">{r.sku}</td>
                  <td>
                    <input
                      className="cell"
                      defaultValue={r.name_en ?? ''}
                      onBlur={(e) => e.target.value !== (r.name_en ?? '') && void save(r.sku, { name_en: e.target.value })}
                      aria-label={`Name of ${r.sku}`}
                    />
                    <span className="cap-name">{r.category ?? ''}</span>
                  </td>
                  <td>
                    <input
                      className="cell price"
                      defaultValue={r.price_now ? Number(r.price_now).toFixed(3) : ''}
                      onBlur={(e) => e.target.value !== (r.price_now ? Number(r.price_now).toFixed(3) : '') &&
                        void save(r.sku, { price_now: e.target.value })}
                      aria-label={`Price of ${r.sku}`}
                    />
                  </td>
                  <td>
                    <input
                      className="cell price"
                      defaultValue={r.price_was ? Number(r.price_was).toFixed(3) : ''}
                      onBlur={(e) => e.target.value !== (r.price_was ? Number(r.price_was).toFixed(3) : '') &&
                        void save(r.sku, { price_was: e.target.value })}
                      aria-label={`Was-price of ${r.sku}`}
                    />
                  </td>
                  <td>
                    <label className="toggle">
                      <input
                        type="checkbox"
                        checked={r.in_stock}
                        onChange={(e) => void save(r.sku, { in_stock: e.target.checked })}
                      />
                      {r.in_stock ? 'yes' : 'no'}
                    </label>
                  </td>
                  <td className="cap-name">
                    {r.updated_by === 'sheet' ? 'from the sheet' : (r.updated_by ?? '')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {total > PAGE && (
            <div className="row" style={{ marginTop: 12 }}>
              <button className="chip" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                Previous
              </button>
              <span className="sub" style={{ alignSelf: 'center' }}>
                {page * PAGE + 1}–{Math.min((page + 1) * PAGE, total)} of {total}
              </span>
              <button
                className="chip"
                disabled={(page + 1) * PAGE >= total}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </button>
            </div>
          )}

          <p className="sub" style={{ marginTop: 14 }}>
            Prices are three-decimal fils. A price you change here is what the assistant quotes
            immediately. {kwd('12.5')} is how one is written.
          </p>
        </>
      )}
    </main>
  )
}
