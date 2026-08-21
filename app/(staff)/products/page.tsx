'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

type Row = {
  sku: string
  name_en: string | null
  name_ar: string | null
  display_name: string | null
  brand: string | null
  category: string | null
  price: string | null
  sale_price: string | null
  in_stock: boolean
  has_photo: boolean
  edited: string[]
  sheet_values?: Record<string, string | null>
  updated_by: string | null
}
type Overwrite = { sku: string; field: string; yours: string; sheet: string }

/** Staged: what a person has typed but not yet saved. Keyed sku -> field. */
type Staged = Record<string, Record<string, string | boolean>>

const PAGES = [20, 50, 100]

/** Three decimals, always. Typing "19.9" or "19,900" both land on 19.900. */
const asPrice = (v: string) => {
  const n = Number(String(v).replace(/[^\d.]/g, ''))
  return Number.isFinite(n) && String(v).trim() ? n.toFixed(3) : ''
}

const FIELD_LABEL: Record<string, string> = {
  name_en: 'name', name_ar: 'Arabic name', display_name: 'short name',
  category: 'category', price_now: 'price', price_was: 'price', description_en: 'description',
}

export default function Products() {
  const [rows, setRows] = useState<Row[]>([])
  const [total, setTotal] = useState(0)
  const [all, setAll] = useState(0)
  const [categories, setCategories] = useState<string[]>([])
  const [brands, setBrands] = useState<string[]>([])

  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [brand, setBrand] = useState('')
  const [flags, setFlags] = useState({ onSale: false, outOfStock: false, edited: false, noPhoto: false })
  const [sort, setSort] = useState<{ by: string; dir: 'asc' | 'desc' }>({ by: 'updated_at', dir: 'desc' })
  const [perPage, setPerPage] = useState(20)
  const [page, setPage] = useState(0)

  const [staged, setStaged] = useState<Staged>({})
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [overwrote, setOverwrote] = useState<Overwrite[]>([])
  const [adding, setAdding] = useState(false)
  const [down, setDown] = useState(false)
  const upload = useRef<HTMLInputElement>(null)
  const photoFor = useRef<string | null>(null)
  const photoInput = useRef<HTMLInputElement>(null)

  const pending = useMemo(
    () => Object.values(staged).reduce((n, f) => n + Object.keys(f).length, 0),
    [staged],
  )

  // Leaving with staged edits loses them, and the browser is the only thing
  // that can ask in time.
  useEffect(() => {
    if (!pending) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [pending])

  const load = useCallback(async () => {
    setError('')
    const q = new URLSearchParams({
      q: search, limit: String(perPage), offset: String(page * perPage),
      sort: sort.by, dir: sort.dir,
    })
    if (category) q.set('category', category)
    if (brand) q.set('brand', brand)
    for (const [k, on] of Object.entries(flags)) if (on) q.set(k, '1')
    try {
      const res = await fetch(`/api/products?${q}`)
      const d = await res.json()
      if (!res.ok) { setDown(true); setError(d.error ?? 'Could not load the catalogue.'); return }
      setDown(false); setRows(d.rows ?? []); setTotal(d.total ?? 0); setAll(d.all ?? 0)
      setCategories(d.categories ?? []); setBrands(d.brands ?? [])
    } catch { setDown(true); setError('Could not reach the catalogue.') }
  }, [search, category, brand, flags, sort, perPage, page])

  useEffect(() => { void load() }, [load])

  const stage = (sku: string, field: string, value: string | boolean) =>
    setStaged((s) => ({ ...s, [sku]: { ...s[sku], [field]: value } }))

  const value = (r: Row, field: keyof Row) => {
    const s = staged[r.sku]?.[field as string]
    return s !== undefined ? String(s) : String(r[field] ?? '')
  }

  async function save() {
    if (!pending || busy) return
    setBusy('saving'); setError(''); setNotice('')
    try {
      const changes = Object.entries(staged).map(([sku, patch]) => {
        // Price and sale price travel together: the server needs both to work
        // out whether this is a sale or just a price.
        const row = rows.find((r) => r.sku === sku)
        const p = { ...patch } as Record<string, string | boolean>
        if ('price' in p || 'sale_price' in p) {
          p.price = String(p.price ?? row?.price ?? '')
          p.sale_price = String(p.sale_price ?? row?.sale_price ?? '')
        }
        return { sku, patch: p }
      })
      const res = await fetch('/api/products', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ changes }),
      })
      const d = await res.json()
      if (!res.ok) setError(d.error ?? 'Could not save.')
      else { setStaged({}); setNotice(`${d.saved} ${d.saved === 1 ? 'product' : 'products'} saved.`); await load() }
    } catch { setError('Could not save.') }
    setBusy('')
  }

  async function importSheet(file: File) {
    setBusy('importing'); setError(''); setNotice(''); setOverwrote([])
    const body = new FormData()
    body.append('file', file)
    try {
      const res = await fetch('/api/products', { method: 'POST', body })
      const d = await res.json()
      if (!res.ok) { setError(d.error ?? 'Could not import that sheet.'); setBusy(''); return }
      setOverwrote(d.overwrote ?? [])
      setNotice(
        `${d.written} products loaded, ${d.total} in the catalogue now.` +
        (d.restored?.length ? ` ${d.restored.length} you had deleted were in this sheet and are back.` : '') +
        (d.errors ? ` ${d.errors} rows were skipped.` : ''),
      )
      setPage(0); await load(); await embedAll()
    } catch { setError('Could not import that sheet.') }
    setBusy('')
  }

  async function embedAll() {
    setBusy('embedding')
    try {
      for (;;) {
        const res = await fetch('/api/products', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'embed' }),
        })
        const d = await res.json()
        if (!res.ok) { setError(d.error ?? 'Could not finish reading.'); break }
        if (!d.embedded) break
        setNotice(`Reading the catalogue so the assistant can search it — ${d.left} left.`)
      }
      setNotice('The assistant can search the whole catalogue now.')
    } catch { setError('Could not finish reading.') }
    setBusy('')
  }

  async function remove(sku: string, name: string) {
    if (!confirm(`Delete ${name || sku}?\n\nThe assistant stops offering it straight away. Posters you have already made and conversations that mentioned it are kept.`)) return
    try {
      const res = await fetch('/api/products', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sku }),
      })
      const d = await res.json()
      if (!res.ok) setError(d.error ?? 'Could not delete.')
      else { setNotice(`${name || sku} deleted.`); await load() }
    } catch { setError('Could not delete.') }
  }

  async function replacePhoto(file: File) {
    const sku = photoFor.current
    if (!sku) return
    const body = new FormData()
    body.append('file', file); body.append('sku', sku)
    try {
      const res = await fetch('/api/products', { method: 'POST', body })
      const d = await res.json()
      if (!res.ok) setError(d.error ?? 'Could not replace that photo.')
      else { setNotice(`Photo replaced. Designs already made with the old one are now out of date.`); await load() }
    } catch { setError('Could not replace that photo.') }
  }

  const header = (label: string, col: string) => (
    <th>
      <button
        className="sortable"
        onClick={() => setSort((s) => ({ by: col, dir: s.by === col && s.dir === 'asc' ? 'desc' : 'asc' }))}
      >
        {label}{sort.by === col ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : ''}
      </button>
    </th>
  )

  return (
    <main className="wide">
      <h1>Products</h1>
      <p className="sub">
        Everything the shop sells. The assistant answers from this, so a customer can ask about
        anything in stock. Designs works from the sheet you load there.
      </p>

      {down && (
        <div className="notice warn-notice">
          <b>Postgres is not answering.</b> Run <code>npm run db:up</code>.
        </div>
      )}

      <div className="panel">
        <div className="panel-head">
          <div>
            <b>{all} products</b>
            <p className="sub" style={{ margin: '2px 0 0' }}>
              A product already here is updated by a sheet, never duplicated. The most recent
              change wins — a sheet you upload now replaces edits made before it, and tells you which.
            </p>
          </div>
          <div className="row">
            <button className="btn" onClick={() => upload.current?.click()} disabled={Boolean(busy)}>
              {busy === 'importing' ? 'Reading…' : 'Upload catalogue'}
            </button>
            <button className="chip" onClick={() => setAdding((a) => !a)} disabled={Boolean(busy)}>
              {adding ? 'Cancel' : 'Add a product'}
            </button>
            {all > 0 && (
              <button className="chip" onClick={() => void embedAll()} disabled={Boolean(busy)}>
                {busy === 'embedding' ? 'Reading…' : 'Re-read for search'}
              </button>
            )}
          </div>
        </div>
        <input ref={upload} type="file" accept=".xlsx,.xls" hidden
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void importSheet(f); e.target.value = '' }} />
        <input ref={photoInput} type="file" accept="image/*" hidden
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void replacePhoto(f); e.target.value = '' }} />
      </div>

      {adding && <AddProduct categories={categories} onDone={() => { setAdding(false); void load() }} onError={setError} />}

      {notice && <p className="ok-note">{notice}</p>}
      {error && <p className="note bad">{error}</p>}

      {overwrote.length > 0 && (
        <div className="notice warn-notice">
          <b>This sheet replaced {overwrote.length} {overwrote.length === 1 ? 'field' : 'fields'} you had edited.</b>
          <table className="drift">
            <tbody>
              {overwrote.map((o, i) => (
                <tr key={i}>
                  <td className="mono">{o.sku}</td>
                  <td>{FIELD_LABEL[o.field] ?? o.field}</td>
                  <td><s>{o.yours}</s> → {o.sheet}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {all > 0 && (
        <>
          <div className="filters">
            <input type="search" value={search} placeholder="Search a name, SKU, brand or category"
              aria-label="Search" onChange={(e) => { setSearch(e.target.value); setPage(0) }} />
            <select value={category} aria-label="Category"
              onChange={(e) => { setCategory(e.target.value); setPage(0) }}>
              <option value="">every category</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <select value={brand} aria-label="Brand"
              onChange={(e) => { setBrand(e.target.value); setPage(0) }}>
              <option value="">every brand</option>
              {brands.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
            {([
              ['onSale', 'on sale'], ['outOfStock', 'out of stock'],
              ['edited', 'edited by hand'], ['noPhoto', 'no photo'],
            ] as const).map(([k, label]) => (
              <label className="toggle" key={k}>
                <input type="checkbox" checked={flags[k]}
                  onChange={(e) => { setFlags((f) => ({ ...f, [k]: e.target.checked })); setPage(0) }} />
                {label}
              </label>
            ))}
            <span className="sub">{total} {total === 1 ? 'match' : 'matches'}</span>
          </div>

          {pending > 0 && (
            <div className="savebar">
              <span>{pending} unsaved {pending === 1 ? 'change' : 'changes'}</span>
              <button className="chip" onClick={() => setStaged({})}>discard</button>
              <button className="btn" onClick={() => void save()} disabled={busy === 'saving'}>
                {busy === 'saving' ? 'Saving…' : `Save ${pending} ${pending === 1 ? 'change' : 'changes'}`}
              </button>
            </div>
          )}

          <table className="catalogue">
            <thead>
              <tr>
                {header('SKU', 'sku')}
                {header('Product', 'name_en')}
                {header('Category', 'category')}
                {header('Price', 'price_now')}
                <th>Sale price</th>
                {header('In stock', 'in_stock')}
                <th>Photo</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const dirty = (f: string) => staged[r.sku]?.[f] !== undefined
                // The dirty input is tinted, and colour on its own is not a
                // signal (WCAG 1.4.1). Same fact as a glyph and as text.
                const stagedMark = (f: string) => dirty(f) && (
                  <span className="staged" title="unsaved">✎<span className="sr"> unsaved</span></span>
                )
                const wasEdited = (f: string) => r.edited?.includes(f)
                const sheetSaid = (f: string) => r.sheet_values?.[f]
                return (
                  <tr key={r.sku} className={r.in_stock ? '' : 'out'}>
                    <td className="mono">{r.sku}</td>
                    <td>
                      <input className={`cell ${dirty('name_en') ? 'dirty' : ''}`}
                        value={value(r, 'name_en')} aria-label={`Name of ${r.sku}`}
                        onChange={(e) => stage(r.sku, 'name_en', e.target.value)} />
                      {stagedMark('name_en')}
                      {wasEdited('name_en') && (
                        <span className="mark" title={`you set this — the sheet says "${sheetSaid('name_en') ?? '(nothing)'}"`}>•<span className="sr"> edited by hand</span></span>
                      )}
                    </td>
                    <td>
                      <input className={`cell ${dirty('category') ? 'dirty' : ''}`} list="categories"
                        value={value(r, 'category')} aria-label={`Category of ${r.sku}`}
                        onChange={(e) => stage(r.sku, 'category', e.target.value)} />
                      {stagedMark('category')}
                    </td>
                    <td>
                      <input className={`cell price ${dirty('price') ? 'dirty' : ''}`}
                        value={value(r, 'price')} aria-label={`Price of ${r.sku}`}
                        onChange={(e) => stage(r.sku, 'price', e.target.value)}
                        onBlur={(e) => stage(r.sku, 'price', asPrice(e.target.value))} />
                      {stagedMark('price')}
                      {wasEdited('price_now') && (
                        <span className="mark" title={`you set this — the sheet says ${sheetSaid('price_now') ?? '(nothing)'}`}>•<span className="sr"> edited by hand</span></span>
                      )}
                    </td>
                    <td>
                      <input className={`cell price ${dirty('sale_price') ? 'dirty' : ''}`}
                        value={value(r, 'sale_price')} placeholder="—"
                        aria-label={`Sale price of ${r.sku}`}
                        onChange={(e) => stage(r.sku, 'sale_price', e.target.value)}
                        onBlur={(e) => stage(r.sku, 'sale_price', asPrice(e.target.value))} />
                      {stagedMark('sale_price')}
                    </td>
                    <td>
                      <label className="toggle">
                        <input type="checkbox"
                          checked={staged[r.sku]?.in_stock !== undefined ? Boolean(staged[r.sku].in_stock) : r.in_stock}
                          onChange={(e) => stage(r.sku, 'in_stock', e.target.checked)} />
                        {(staged[r.sku]?.in_stock !== undefined ? staged[r.sku].in_stock : r.in_stock) ? 'yes' : 'no'}
                      </label>
                    </td>
                    <td>
                      <button className="linkish"
                        onClick={() => { photoFor.current = r.sku; photoInput.current?.click() }}>
                        {r.has_photo ? 'replace' : 'add one'}
                      </button>
                    </td>
                    <td>
                      <button className="linkish danger-link"
                        onClick={() => void remove(r.sku, r.name_en ?? '')}>delete</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          <datalist id="categories">
            {categories.map((c) => <option key={c} value={c} />)}
          </datalist>

          <div className="row" style={{ marginTop: 12, alignItems: 'center' }}>
            <button className="chip" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Previous</button>
            <span className="sub">
              {total === 0 ? 'nothing here' : `${page * perPage + 1}–${Math.min((page + 1) * perPage, total)} of ${total}`}
            </span>
            <button className="chip" disabled={(page + 1) * perPage >= total}
              onClick={() => setPage((p) => p + 1)}>Next</button>
            <span className="sub" style={{ marginLeft: 'auto' }}>
              per page{' '}
              <select value={perPage} aria-label="Products per page"
                onChange={(e) => { setPerPage(Number(e.target.value)); setPage(0) }}>
                {PAGES.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </span>
          </div>
        </>
      )}
    </main>
  )
}

/** Adding one by hand. SKU and a name are the minimum; a price is nearly always wanted. */
function AddProduct(
  { categories, onDone, onError }:
  { categories: string[]; onDone: () => void; onError: (m: string) => void },
) {
  const [row, setRow] = useState({ sku: '', name_en: '', name_ar: '', category: '', brand: '', price: '', sale_price: '' })
  const [busy, setBusy] = useState(false)
  const set = (k: string, v: string) => setRow((r) => ({ ...r, [k]: v }))

  async function submit() {
    if (!row.sku.trim() || !row.name_en.trim()) { onError('A SKU and a name are needed.'); return }
    setBusy(true)
    try {
      const res = await fetch('/api/products', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'add', row }),
      })
      const d = await res.json()
      if (!res.ok) onError(d.error ?? 'Could not add that.')
      else onDone()
    } catch { onError('Could not add that.') }
    setBusy(false)
  }

  return (
    <div className="panel">
      <h2>A new product</h2>
      <p className="sub">
        The SKU cannot be changed afterwards — every poster and conversation is keyed to it.
        Picking a category it already knows makes it findable by &ldquo;do you sell laptops&rdquo;.
      </p>
      <div className="row">
        {([['sku', 'SKU'], ['name_en', 'Name'], ['brand', 'Brand'],
           ['price', 'Price'], ['sale_price', 'Sale price']] as const).map(([k, label]) => (
          <label className="fld" key={k}>
            <span className="lbl">{label}</span>
            <input value={row[k]} onChange={(e) => set(k, e.target.value)} aria-label={label} />
          </label>
        ))}
        <label className="fld">
          <span className="lbl">Category</span>
          <input list="categories" value={row.category}
            onChange={(e) => set('category', e.target.value)} aria-label="Category" />
        </label>
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn" onClick={() => void submit()} disabled={busy}>
          {busy ? 'Adding…' : 'Add it'}
        </button>
      </div>
      <datalist id="categories">
        {categories.map((c) => <option key={c} value={c} />)}
      </datalist>
    </div>
  )
}
