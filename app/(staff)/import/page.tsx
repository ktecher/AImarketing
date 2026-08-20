'use client'

import { useState, useRef } from 'react'

type Product = {
  row: number; sku: string
  name_en?: string; name_ar?: string; brand?: string; category?: string
  price_kwd?: number; sale_price_kwd?: number
  hasImage: boolean; extra: Record<string, string>
}
type Issue = { row: number; reason: string; severity: 'warning' | 'error' }
type Result = {
  fileName: string; sheetName: string; headers: string[]
  mapping: Record<string, string>; issues: Issue[]
  counts: { products: number; errors: number; warnings: number; withImage: number; withArabic: number }
  products: Product[]
}

const kwd = (n?: number) => (n === undefined ? '' : `${n.toFixed(3)}`)

export default function ImportPage() {
  const [result, setResult] = useState<Result | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [over, setOver] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  async function upload(file: File) {
    setBusy(true); setError(''); setResult(null)
    const body = new FormData()
    body.append('file', file)
    try {
      const res = await fetch('/api/import', { method: 'POST', body })
      const data = await res.json()
      if (!res.ok) setError(data.error ?? 'Import failed.')
      else setResult(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed.')
    }
    setBusy(false)
  }

  const unmapped = result ? result.headers.filter((h) => h && !Object.values(result.mapping).includes(h)) : []

  return (
    <main>
      <h1>Import a product sheet</h1>
      <p className="sub">
        Upload the real Excel. Nothing is saved yet — this shows what the system
        understood, so the column names can be checked before anything is built on them.
      </p>

      <div className="starter">
        <div>
          <b>No sheet yet?</b>
          <span>
            Download the blank template. Its columns are the ones the importer
            reads, so a sheet filled from it maps exactly — nothing to guess at.
            It includes two example rows to delete and a page explaining each column.
          </span>
        </div>
        <a className="btn" href="/api/template" download>Download template</a>
      </div>

      <div
        className="drop"
        data-over={over}
        onClick={() => input.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setOver(true) }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault(); setOver(false)
          const f = e.dataTransfer.files[0]; if (f) upload(f)
        }}
      >
        <input
          ref={input} type="file" accept=".xlsx,.xls"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f) }}
        />
        {busy ? 'Reading the sheet…' : <><b>Drop an .xlsx here</b><br /><span style={{ color: 'var(--muted)', fontSize: 13 }}>or click to choose — embedded images are read too</span></>}
      </div>

      {error && <div className="err" style={{ marginTop: 20 }}>{error}</div>}

      {result && (
        <>
          <div className="stats">
            <div className="stat"><b>{result.counts.products}</b><span>products read</span></div>
            <div className="stat"><b style={{ color: result.counts.errors ? 'var(--err)' : undefined }}>{result.counts.errors}</b><span>rows skipped</span></div>
            <div className="stat"><b>{result.counts.warnings}</b><span>warnings</span></div>
            <div className="stat"><b>{result.counts.withImage}</b><span>with an image</span></div>
            <div className="stat"><b>{result.counts.withArabic}</b><span>with Arabic</span></div>
          </div>

          <h2>Columns understood</h2>
          <p style={{ marginTop: 0, color: 'var(--muted)', fontSize: 13 }}>
            These names become the template bindings and the assistant&rsquo;s
            comparison surface. If something below is wrong, it is worth fixing here
            rather than later.
          </p>
          <div className="panel">
            {Object.entries(result.mapping).map(([field, header]) => (
              <span key={field} className="tag mapped">{field} ← {header}</span>
            ))}
            {unmapped.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <div style={{ color: 'var(--muted)', fontSize: 12, marginBottom: 6 }}>
                  Kept but not mapped to a known field — nothing is discarded:
                </div>
                {unmapped.map((h) => <span key={h} className="tag">{h}</span>)}
              </div>
            )}
          </div>

          {result.issues.length > 0 && (
            <>
              <h2>Issues ({result.issues.length})</h2>
              <div>
                {result.issues.slice(0, 40).map((i, n) => (
                  <div key={n} className={`issue ${i.severity}`}>
                    <b>Row {i.row}</b> — {i.reason}
                  </div>
                ))}
                {result.issues.length > 40 && (
                  <div style={{ color: 'var(--muted)', fontSize: 13, padding: '6px 12px' }}>
                    …and {result.issues.length - 40} more.
                  </div>
                )}
              </div>
            </>
          )}

          <h2>Products</h2>
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>Row</th><th>SKU</th><th>Name (EN)</th><th>Name (AR)</th>
                  <th>Brand</th><th style={{ textAlign: 'right' }}>Price</th>
                  <th style={{ textAlign: 'right' }}>Sale</th><th>Image</th>
                </tr>
              </thead>
              <tbody>
                {result.products.slice(0, 100).map((p) => (
                  <tr key={p.sku}>
                    <td style={{ color: 'var(--muted)' }}>{p.row}</td>
                    <td>{p.sku}</td>
                    <td>{p.name_en}</td>
                    <td className="ar">{p.name_ar}</td>
                    <td>{p.brand}</td>
                    <td className="num">{kwd(p.price_kwd)}</td>
                    <td className="num">{kwd(p.sale_price_kwd)}</td>
                    <td>{p.hasImage ? '✓' : <span style={{ color: 'var(--warn)' }}>none</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {result.products.length > 100 && (
            <p style={{ color: 'var(--muted)', fontSize: 13 }}>
              Showing the first 100 of {result.products.length}.
            </p>
          )}
        </>
      )}
    </main>
  )
}
