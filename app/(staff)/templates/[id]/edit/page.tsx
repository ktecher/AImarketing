'use client'

import { use, useCallback, useEffect, useRef, useState } from 'react'

type Box = { id: string; x: number; y: number; width: number; height: number }
type Slot = {
  id: string; type: 'text' | 'image'; bind: string
  font?: string; size?: number; maxLines?: number
  align?: 'start' | 'center' | 'end'; colour?: string
  lineHeight?: number; minScale?: number; textMode?: 'auto' | 'live' | 'outline'
  format?: 'kwd'; fit?: 'cover' | 'contain'; text?: string
}
type Manifest = { v: 1; name: string; slots: Slot[] }
type Column = { name: string; label: string; kind: 'text' | 'image' | 'price'; placeholder: string }
type Report = { slot: string; truncated?: boolean; shrunkTo?: number; missingImage?: boolean; empty?: boolean; boxTooShort?: { need: number; have: number } }

type Loaded = {
  id: string; manifest: Manifest; boxes: Box[]; artwork: string
  width: number; height: number; columns: Column[]; columnSource: string
  sample: Record<string, string | number>
  products: { sku: string; label: string; values: Record<string, string | number> }[]
  hasOverride?: boolean
  fonts: string[]
}


type Drag =
  | { kind: 'move'; id: string; dx: number; dy: number }
  | { kind: 'resize'; id: string; corner: string; ox: number; oy: number; ow: number; oh: number; px: number; py: number }

export default function Editor({
  params, searchParams,
}: {
  params: Promise<{ id: string }>
  // `back` carries the chosen products the Designs page came in with. That
  // selection lives only in that page's URL, so a bare "/templates" on the way
  // out silently empties it — you save a layout, press Back, and the products
  // you picked are gone along with their renders.
  searchParams: Promise<{ sku?: string; back?: string }>
}) {
  const { id } = use(params)
  const { sku: editingSku, back } = use(searchParams)
  const backHref = back ? `/templates?skus=${encodeURIComponent(back)}` : '/templates'

  const [data, setData] = useState<Loaded | null>(null)
  const [boxes, setBoxes] = useState<Box[]>([])
  const [manifest, setManifest] = useState<Manifest | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [preview, setPreview] = useState<string>('')
  const [report, setReport] = useState<Report[]>([])
  const [resolved, setResolved] = useState<Record<string, string>>({})
  const [saved, setSaved] = useState(false)
  const [showGuide, setShowGuide] = useState(false)
  const [products, setProducts] = useState<{ sku: string; label: string; values: Record<string, string | number> }[]>([])
  const [product, setProduct] = useState<string>('')
  const [live, setLive] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [rendering, setRendering] = useState(false)
  const [hasOverride, setHasOverride] = useState(false)
  const [notFollowing, setNotFollowing] = useState('')
  const [fontList, setFontList] = useState<string[]>([])
  const [fontBusy, setFontBusy] = useState(false)
  const fontRef = useRef<HTMLInputElement>(null)

  const canvas = useRef<HTMLDivElement>(null)
  const drag = useRef<Drag | null>(null)

  useEffect(() => {
    // `back` is the Designs page's own selection. It doubles as the answer to
    // "which products is this layout for", so the preview shows one of them.
    const p = new URLSearchParams()
    if (editingSku) p.set('sku', editingSku)
    if (back) p.set('skus', back)
    const q = p.toString()
    fetch(`/api/templates/${id}${q ? `?${q}` : ''}`).then((r) => r.json()).then((d: Loaded) => {
      setData(d); setBoxes(d.boxes); setManifest(d.manifest)
      setProducts(d.products ?? [])
      setHasOverride(Boolean(d.hasOverride))
      setFontList(d.fonts ?? [])
      // Editing one product means previewing that product, not an arbitrary one.
      setProduct(editingSku || d.products?.[0]?.sku || '')
    })
  }, [id, editingSku, back])

  const apply = useCallback(async () => {
    if (!manifest || !boxes.length) return
    setRendering(true)
    const values = products.find((p) => p.sku === product)?.values
    const res = await fetch(`/api/templates/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ boxes, manifest, values }),
    })
    if (res.ok) {
      const d = await res.json()
      setPreview(d.png); setReport(d.report); setResolved(d.resolved ?? {}); setDirty(false)
    }
    setRendering(false)
  }, [boxes, manifest, id, product, products])

  // First render, and whenever the previewed product changes.
  useEffect(() => { void apply() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [product, data])

  // Live mode is opt-in: rendering on every drag is a server round trip per
  // pixel, and it makes it harder to see what a deliberate change actually did.
  useEffect(() => {
    if (!live || !dirty) return
    const t = setTimeout(() => { void apply() }, 260)
    return () => clearTimeout(t)
  }, [live, dirty, apply])

  const scale = useCallback(() => {
    if (!canvas.current || !data) return 1
    return canvas.current.clientWidth / data.width
  }, [data])

  function onPointerDown(e: React.PointerEvent, box: Box, corner?: string) {
    e.preventDefault(); e.stopPropagation()
    ;(e.target as Element).setPointerCapture(e.pointerId)
    setSelected(box.id)
    const s = scale()
    const px = e.clientX / s, py = e.clientY / s
    drag.current = corner
      ? { kind: 'resize', id: box.id, corner, ox: box.x, oy: box.y, ow: box.width, oh: box.height, px, py }
      : { kind: 'move', id: box.id, dx: px - box.x, dy: py - box.y }
  }

  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current
    if (!d || !data) return
    const s = scale()
    const px = e.clientX / s, py = e.clientY / s

    setDirty(true)
    setBoxes((prev) => prev.map((b) => {
      if (b.id !== d.id) return b
      if (d.kind === 'move') {
        return { ...b, x: Math.round(px - d.dx), y: Math.round(py - d.dy) }
      }
      const mx = px - d.px, my = py - d.py
      let { ox: x, oy: y, ow: width, oh: height } = d
      if (d.corner.includes('e')) width = d.ow + mx
      if (d.corner.includes('s')) height = d.oh + my
      if (d.corner.includes('w')) { x = d.ox + mx; width = d.ow - mx }
      if (d.corner.includes('n')) { y = d.oy + my; height = d.oh - my }
      return {
        ...b,
        x: Math.round(x), y: Math.round(y),
        width: Math.round(Math.max(24, width)), height: Math.round(Math.max(18, height)),
      }
    }))
  }

  function endDrag(e?: React.PointerEvent) {
    if (e && (e.target as Element).hasPointerCapture?.(e.pointerId)) {
      ;(e.target as Element).releasePointerCapture(e.pointerId)
    }
    drag.current = null
  }

  function addColumn(col: Column) {
    if (!data || !manifest) return
    const slotId = col.name
    if (boxes.some((b) => b.id === slotId)) { setSelected(slotId); return }

    setBoxes((p) => [...p, {
      id: slotId,
      x: Math.round(data.width * 0.15), y: Math.round(data.height * 0.4),
      width: Math.round(data.width * 0.7), height: col.kind === 'image' ? Math.round(data.height * 0.25) : 46,
    }])
    setManifest({
      ...manifest,
      slots: [...manifest.slots, col.kind === 'image'
        ? { id: slotId, type: 'image', bind: col.name, fit: 'contain' }
        : {
            id: slotId, type: 'text', bind: col.name, font: 'Cairo', size: 28,
            maxLines: 2, align: 'center', colour: '#1a1a19',
            ...(col.kind === 'price' ? { format: 'kwd' as const } : {}),
          }],
    })
    setSelected(slotId)
    setDirty(true)
  }

  function removeSelected() {
    if (!selected || !manifest) return
    setDirty(true)
    setBoxes((p) => p.filter((b) => b.id !== selected))
    setManifest({ ...manifest, slots: manifest.slots.filter((s) => s.id !== selected) })
    setSelected(null)
  }

  function updateSlot(patch: Partial<Slot>) {
    if (!selected || !manifest) return
    setDirty(true)
    setManifest({
      ...manifest,
      slots: manifest.slots.map((s) => (s.id === selected ? { ...s, ...patch } : s)),
    })
  }

  async function addFont(file: File) {
    setFontBusy(true)
    const body = new FormData()
    body.append('file', file)
    const res = await fetch('/api/fonts', { method: 'POST', body })
    const d = await res.json()
    if (res.ok) {
      const list = await fetch(`/api/templates/${id}`).then((r) => r.json())
      setFontList(list.fonts ?? [])
      updateSlot({ font: d.family })
    } else {
      setNotFollowing(d.error ?? 'That font could not be added.')
    }
    setFontBusy(false)
  }

  async function save() {
    const res = await fetch(`/api/templates/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ boxes, manifest, sku: editingSku }),
    })
    if (editingSku) setHasOverride(true)
    else {
      const d = await res.json().catch(() => null)
      const n = d?.notFollowing?.length ?? 0
      if (n) {
        setNotFollowing(
          `${n} product${n > 1 ? 's have' : ' has'} its own layout and will not pick this up. ` +
          `Open it from the grid and choose "Follow the template again" if it should.`,
        )
      }
    }
    setSaved(true); setTimeout(() => setSaved(false), 2200)
  }

  /** Drops this product's exception so it follows the template again. */
  async function resetToTemplate() {
    if (!editingSku) return
    await fetch(`/api/templates/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ boxes, manifest, sku: editingSku, reset: true }),
    })
    window.location.reload()
  }

  if (!data || !manifest) return <main><p className="sub">Loading the template…</p></main>

  const slot = manifest.slots.find((s) => s.id === selected)
  const box = boxes.find((b) => b.id === selected)
  const used = new Set(manifest.slots.map((s) => s.bind))

  return (
    <main className="wide">
      {editingSku && (
        <div className={`mode-bar ${hasOverride ? 'has' : ''}`}>
          <div>
            <b>Editing {editingSku} on its own</b>
            <span>
              {hasOverride
                ? 'This product has its own layout and no longer follows the template.'
                : 'Changes here apply to this product only. The other products keep the template layout.'}
            </span>
          </div>
          {hasOverride && (
            <button className="chip danger" onClick={() => void resetToTemplate()}>
              Follow the template again
            </button>
          )}
        </div>
      )}

      {notFollowing && <div className="notice warn-notice">{notFollowing}</div>}

      <div className="editor-head">
        <div>
          <h1 style={{ marginBottom: 2 }}>{manifest.name}</h1>
          <p className="sub" style={{ margin: 0 }}>
            {editingSku ? `one product · ` : `the template · `}
            {data.width} × {data.height} · drag to move, corners to resize · columns from {data.columnSource}
          </p>
        </div>
        <div className="head-actions">
          <label className="toggle">
            <input type="checkbox" checked={showGuide} onChange={(e) => setShowGuide(e.target.checked)} />
            clean area
          </label>
          <a className="chip" href={backHref}>Back</a>
          <button className="btn" onClick={save}>
            {saved ? 'Saved' : editingSku ? 'Save for this product' : 'Save layout'}
          </button>
        </div>
      </div>

      <input ref={fontRef} type="file" accept=".ttf,.otf" style={{ display: 'none' }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void addFont(f) }} />

      <div className="editor">
        <div>
          <div
            ref={canvas}
            className="stage"
            style={{ aspectRatio: `${data.width} / ${data.height}` }}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onClick={(e) => { if (e.target === e.currentTarget) setSelected(null) }}
          >
            <img src={data.artwork} alt="" draggable={false} />
            {showGuide && <div className="guide" />}
            {boxes.map((b) => {
              const s = manifest.slots.find((x) => x.id === b.id)
              const pc = (v: number, of: number) => `${(v / of) * 100}%`
              return (
                <div
                  key={b.id}
                  className={`slot ${selected === b.id ? 'sel' : ''} ${s?.type ?? 'text'}`}
                  style={{ left: pc(b.x, data.width), top: pc(b.y, data.height),
                           width: pc(b.width, data.width), height: pc(b.height, data.height) }}
                  onPointerDown={(e) => onPointerDown(e, b)}
                  onClick={(e) => e.stopPropagation()}
                >
                  <span className="slot-label">{s?.bind ?? b.id}</span>
                  {selected === b.id && ['nw', 'ne', 'sw', 'se'].map((c) => (
                    <i key={c} className={`h ${c}`}
                       onPointerDown={(e) => onPointerDown(e, b, c)}
                       onClick={(e) => e.stopPropagation()} />
                  ))}
                </div>
              )
            })}
          </div>
          <p className="hint">
            The boxes are the layout. The picture on the right is what actually
            comes out — it updates as you move things.
          </p>
        </div>

        <div>
          <div className="panel">
            <div className="panel-head">
              <h2 style={{ margin: 0 }}>Result</h2>
              <div className="apply-bar">
                <label className="toggle">
                  <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} />
                  live
                </label>
                <button className={`btn small ${dirty ? 'pulse' : ''}`}
                        onClick={() => void apply()} disabled={rendering}>
                  {rendering ? 'Rendering…' : dirty ? 'Apply changes' : 'Applied'}
                </button>
              </div>
            </div>

            {products.length > 0 && !editingSku && (
              <label className="fld" style={{ marginBottom: 12 }}>
                <span>Preview with</span>
                <select value={product} onChange={(e) => setProduct(e.target.value)}>
                  {products.map((p) => <option key={p.sku} value={p.sku}>{p.sku} · {p.label}</option>)}
                </select>
              </label>
            )}
            {preview
              ? <img className="live" src={`data:image/png;base64,${preview}`} alt="preview" />
              : <div className="live placeholder">rendering…</div>}
            {report.length > 0 && (
              <div style={{ marginTop: 10 }}>
                {report.map((r) => (
                  <div key={r.slot} className={`issue ${r.truncated ? 'error' : 'warning'}`}>
                    <b>{r.slot}</b> — {r.boxTooShort
                      ? `box is ${r.boxTooShort.have}px but needs ${r.boxTooShort.need}px for its line count`
                      : r.truncated ? 'text was cut to fit'
                      : r.missingImage ? 'no photo for this product'
                      : r.empty ? 'that column is empty'
                      : `shrunk to ${r.shrunkTo}pt`}
                  </div>
                ))}
              </div>
            )}
          </div>

          {slot && box ? (
            <div className="panel compact" style={{ marginTop: 14 }}>
              <div className="panel-head">
                <h2 style={{ margin: 0 }}>{slot.bind}</h2>
                <button className="chip danger" onClick={removeSelected}>Remove</button>
              </div>

              {slot.type === 'text' && (
                <label className="fld">
                  <span>
                    Text
                    {slot.text !== undefined
                      ? <em> · rewritten</em>
                      : <em> · from {slot.bind}</em>}
                  </span>
                  <textarea
                    rows={2}
                    value={slot.text ?? resolved[slot.id] ?? ''}
                    placeholder={resolved[slot.id] ?? ''}
                    onChange={(e) => updateSlot({ text: e.target.value })}
                  />
                  <div className="text-meta">
                    <span>{(slot.text ?? resolved[slot.id] ?? '').length} characters</span>
                    {slot.text !== undefined && (
                      <button className="linkish" onClick={() => updateSlot({ text: undefined })}>
                        use {slot.bind} again
                      </button>
                    )}
                  </div>
                  <p className="hint" style={{ margin: '4px 0 0' }}>
                    {editingSku
                      ? 'Rewriting here changes this product only — the sheet is untouched.'
                      : 'Typed text becomes a fixed label on every product. Leave it alone to keep using the column.'}
                  </p>
                </label>
              )}

              <div className="row tight">
                {(['x', 'y', 'width', 'height'] as const).map((k) => (
                  <label className="fld" key={k}>
                    <span>{k}</span>
                    <input type="number" value={Math.round(box[k])}
                      onChange={(e) => { setDirty(true); setBoxes((p) => p.map((b) => b.id === box.id ? { ...b, [k]: +e.target.value } : b)) }} />
                  </label>
                ))}
              </div>

              {slot.type === 'text' ? (
                <>
                  <div className="row">
                    <label className="fld">
                      <span>Font</span>
                      <select value={slot.font ?? fontList[0] ?? 'Cairo'}
                              onChange={(e) => {
                                if (e.target.value === '__add') { fontRef.current?.click(); return }
                                updateSlot({ font: e.target.value })
                              }}>
                        {fontList.map((f) => <option key={f}>{f}</option>)}
                        <option value="__add">{fontBusy ? 'adding…' : '+ add a font…'}</option>
                      </select>
                    </label>
                    <label className="fld">
                      <span>Size <b>{slot.size ?? 28}</b></span>
                      <input type="range" min={8} max={96} value={slot.size ?? 28}
                        onChange={(e) => updateSlot({ size: +e.target.value })} />
                    </label>
                  </div>
                  <div className="row">
                    <label className="fld">
                      <span>Align</span>
                      <select value={slot.align ?? 'center'} onChange={(e) => updateSlot({ align: e.target.value as Slot['align'] })}>
                        <option value="start">start (right for Arabic)</option>
                        <option value="center">centre</option>
                        <option value="end">end</option>
                      </select>
                    </label>
                    <label className="fld">
                      <span>Max lines</span>
                      <select value={slot.maxLines ?? 2} onChange={(e) => updateSlot({ maxLines: +e.target.value })}>
                        {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
                      </select>
                    </label>
                    <label className="fld">
                      <span>Colour</span>
                      <input type="color" value={slot.colour ?? '#1a1a19'}
                        onChange={(e) => updateSlot({ colour: e.target.value })} />
                    </label>
                  </div>
                  <div className="row">
                    <label className="fld">
                      <span>Line height <b>{(slot.lineHeight ?? 1.35).toFixed(2)}</b></span>
                      <input type="range" min={100} max={200} value={(slot.lineHeight ?? 1.35) * 100}
                        onChange={(e) => updateSlot({ lineHeight: +e.target.value / 100 })} />
                    </label>
                    <label className="fld">
                      <span>Shrink floor <b>{Math.round((slot.minScale ?? 0.65) * 100)}%</b></span>
                      <input type="range" min={40} max={100} value={(slot.minScale ?? 0.65) * 100}
                        onChange={(e) => updateSlot({ minScale: +e.target.value / 100 })} />
                    </label>
                    <label className="fld">
                      <span>Arabic text</span>
                      <select value={slot.textMode ?? 'auto'}
                        onChange={(e) => updateSlot({ textMode: e.target.value as Slot['textMode'] })}>
                        <option value="auto">outline Arabic, keep Latin live</option>
                        <option value="live">live text — needs the font installed</option>
                        <option value="outline">outline everything</option>
                      </select>
                    </label>
                  </div>
                  <p className="hint" style={{ marginTop: 0 }}>
                    Size is a ceiling, not a promise — text too long for the box still
                    shrinks toward the floor, then says so in the result. A box shorter
                    than lines × size × line-height can never hold that many lines.
                  </p>
                </>
              ) : (
                <label className="fld">
                  <span>Fit</span>
                  <select value={slot.fit ?? 'contain'} onChange={(e) => updateSlot({ fit: e.target.value as Slot['fit'] })}>
                    <option value="contain">contain — whole photo, may leave space</option>
                    <option value="cover">cover — fills the box, may crop</option>
                  </select>
                </label>
              )}
            </div>
          ) : (
            <div className="panel compact" style={{ marginTop: 14 }}>
              <h2 style={{ marginTop: 0 }}>Add a field</h2>
              <p style={{ marginTop: 0, fontSize: 13, color: 'var(--muted)' }}>
                From {data.columnSource}. Click one to drop it on the design.
              </p>
              <div className="chips">
                {data.columns.map((c) => (
                  <button key={c.name}
                          className={`chip ${used.has(c.name) ? 'on' : ''}`}
                          onClick={() => addColumn(c)}>
                    {c.label}
                  </button>
                ))}
              </div>
              <p className="hint">Select a box on the design to change its font, size, colour or alignment.</p>
            </div>
          )}
        </div>
      </div>
    </main>
  )
}
