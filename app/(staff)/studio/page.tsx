'use client'

import { useCallback, useEffect, useState } from 'react'

type Check = { name: string; pass: boolean; span?: string; hint?: string }
type Script = { hook: string; body: string; say: string; avoid: string[] }
type Piece = {
  id: string; sku: string; kind: 'slogan' | 'caption' | 'hashtags' | 'script'
  channel: string; text: string; filled: string; script?: Script
  checks: Check[]; status: 'draft' | 'approved'; source: 'model' | 'human'
  model: string; prompt_version: string; created_at: string
}
type Product = { sku: string; name: string; brand?: string; onSale?: boolean; drafts?: number; approved?: number }

const CHANNELS = [
  { id: 'instagram', label: 'Instagram', use: 'first line is the whole caption' },
  { id: 'snapchat', label: 'Snapchat', use: 'half of Kuwait — hook in 1–2s' },
  { id: 'tiktok', label: 'TikTok', use: 'has to work with the sound off' },
]

const SECTIONS = [
  { kind: 'slogan', title: 'Slogans', note: 'Six words or fewer. These go on the poster, not in the caption.' },
  { kind: 'caption', title: 'Captions', note: 'Written for the channel above. Edit freely — an edited line is recorded as yours.' },
  { kind: 'hashtags', title: 'Hashtags', note: 'Approved and copied as one block.' },
  { kind: 'script', title: 'Video script', note: 'For a person holding the product on camera. The footage is filmed, not generated.' },
] as const

export default function Studio() {
  const [products, setProducts] = useState<Product[]>([])
  const [sku, setSku] = useState('')
  const [channel, setChannel] = useState('instagram')
  const [pieces, setPieces] = useState<Piece[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null)
  const [copied, setCopied] = useState('')
  const [stock, setStock] = useState<{ approved: number; products: number } | null>(null)

  useEffect(() => {
    void fetch('/api/studio').then((r) => r.json()).then((d) => {
      setProducts(d.products ?? [])
      if (d.products?.length) setSku((s) => s || d.products[0].sku)
    })
  }, [])

  const loadStock = useCallback(async () => {
    setStock(await fetch('/api/export/copy').then((r) => r.json()))
  }, [])

  useEffect(() => { void loadStock() }, [loadStock])

  const loadPieces = useCallback(async (s: string) => {
    if (!s) return
    const d = await fetch(`/api/studio?sku=${encodeURIComponent(s)}`).then((r) => r.json())
    setPieces(d.pieces ?? [])
    setEditing(null)
  }, [])

  useEffect(() => { void loadPieces(sku) }, [sku, loadPieces])

  async function write() {
    setBusy(true); setError(''); setNotice('')
    try {
      const res = await fetch('/api/studio', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sku, channel }),
      })
      const d = await res.json()
      if (!res.ok) setError(d.error ?? 'Generation failed.')
      else {
        setPieces(d.pieces)
        const blocked = d.pieces.filter((p: Piece) => p.checks.some((c) => !c.pass)).length
        setNotice(
          blocked
            ? `${blocked} of ${d.pieces.length} drafts are blocked by a check. They are shown with the line that triggered it — fix the wording or discard them.`
            : `${d.pieces.length} drafts, every check passing. Nothing is approved until you approve it.`,
        )
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Generation failed.')
    }
    setBusy(false)
  }

  async function act(id: string, action: string, text?: string) {
    setError('')
    const res = await fetch('/api/studio', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sku, id, action, text }),
    })
    const d = await res.json()
    if (!res.ok) setError(d.error ?? 'Could not save.')
    else { setPieces(d.pieces); setEditing(null); void loadStock() }
  }

  function copy(p: Piece) {
    const text = p.kind === 'script' && p.script
      ? [`HOOK: ${p.script.hook}`, '', p.script.body, '', `SAY: ${p.script.say}`].join('\n')
      : p.filled
    void navigator.clipboard.writeText(text)
    setCopied(p.id)
    setTimeout(() => setCopied(''), 1400)
  }

  const product = products.find((p) => p.sku === sku)
  const approved = pieces.filter((p) => p.status === 'approved').length

  return (
    <main>
      <h1>Content studio</h1>
      <p className="sub">
        Slogans, captions, hashtags and a video script from the same rows the designs
        come from. English only for now — nothing available writes convincing Kuwaiti
        dialect, and Arabic that reads translated is worse than English here.
      </p>

      {!products.length ? (
        <div className="panel">
          <b>No products loaded</b>
          <p className="hint" style={{ marginTop: 6 }}>
            The studio writes from the catalogue, not from a blank page.{' '}
            <a href="/templates">Import a product sheet</a> and come back.
          </p>
        </div>
      ) : (
        <>
          <div className="panel" style={{ marginBottom: 16 }}>
            <div className="row" style={{ alignItems: 'flex-end' }}>
              <label className="fld" style={{ flex: '2 1 380px', marginBottom: 0 }}>
                <span>Product {product?.approved ? <b>· {product.approved} approved</b> : null}</span>
                <select value={sku} onChange={(e) => setSku(e.target.value)}>
                  {products.map((p) => (
                    <option key={p.sku} value={p.sku}>
                      {p.name}{p.onSale ? ' · on sale' : ''}{p.approved ? ` · ${p.approved} approved` : p.drafts ? ` · ${p.drafts} drafts` : ''}
                    </option>
                  ))}
                </select>
              </label>
              <div style={{ flex: '0 0 auto' }}>
                <button className="btn" onClick={() => void write()} disabled={busy}>
                  {busy ? 'Writing…' : pieces.length ? 'Write more drafts' : 'Write drafts'}
                </button>
              </div>
            </div>

            <div className="fmt-grid" style={{ marginTop: 14 }}>
              {CHANNELS.map((c) => (
                <label key={c.id} className={`fmt ${channel === c.id ? 'on' : ''}`}>
                  <input type="radio" name="channel" checked={channel === c.id}
                         onChange={() => setChannel(c.id)} />
                  <b>{c.label}</b>
                  <span>{c.use}</span>
                </label>
              ))}
            </div>

            <p className="hint">
              Runs on this machine. Four model calls, roughly half a minute — the copy is
              written freely first and sorted into fields afterwards, because constraining
              the writing makes it worse.
            </p>
          </div>

          {notice && <div className="notice">{notice}</div>}
          {error && <div className="err" style={{ marginBottom: 16 }}>{error}</div>}
          {busy && !pieces.length && <div className="panel"><b>Writing…</b><p className="hint">First call after a restart also loads the model.</p></div>}

          {pieces.length > 0 && (
            <>
              <div className="export-head">
                <div>
                  <b>{pieces.length - approved} drafts · {approved} approved</b>
                  <span>
                    Prices are never written by the model. It writes {'{price_now}'} and the
                    catalogue fills it in — so the copy stays true after a price change.
                  </span>
                </div>
                {stock && stock.approved > 0 && (
                  <a className="btn small" href="/api/export/copy" onClick={(e) => {
                    e.preventDefault()
                    // A form post rather than fetch: the browser handles the file,
                    // and there is nothing useful to do with the bytes in here.
                    const f = document.createElement('form')
                    f.method = 'POST'; f.action = '/api/export/copy'
                    document.body.appendChild(f); f.submit(); f.remove()
                  }}>
                    Export {stock.approved} approved · {stock.products} product{stock.products === 1 ? '' : 's'}
                  </a>
                )}
              </div>

              {SECTIONS.map((s) => {
                const mine = pieces.filter((p) => p.kind === s.kind)
                if (!mine.length) return null
                return (
                  <section key={s.kind}>
                    <h2>{s.title}</h2>
                    <p className="hint" style={{ marginTop: 0, marginBottom: 10 }}>{s.note}</p>
                    {mine.map((p) => {
                      const failed = p.checks.filter((c) => !c.pass)
                      const isEditing = editing?.id === p.id
                      return (
                        <div key={p.id} className={`piece ${p.status === 'approved' ? 'ok' : ''} ${failed.length ? 'blocked' : ''}`}>
                          {p.kind === 'script' && p.script ? (
                            <div className="script">
                              <div className="kv"><span>Hook</span><b>{p.script.hook}</b></div>
                              <p>{p.script.body}</p>
                              <div className="kv"><span>Say</span><b>{p.script.say}</b></div>
                              <div className="avoid">
                                <span>Do not say</span>
                                <ul className="list blocked">{p.script.avoid.map((a, i) => <li key={i}>{a}</li>)}</ul>
                              </div>
                            </div>
                          ) : isEditing ? (
                            <label className="fld" style={{ marginBottom: 8 }}>
                              <span>Editing · placeholders stay as they are <em>{'{price_now} {price_was} {discount_pct} {name} {brand}'}</em></span>
                              <textarea rows={3} value={editing.text}
                                        onChange={(e) => setEditing({ id: p.id, text: e.target.value })} />
                            </label>
                          ) : (
                            <p className="body">{p.filled}</p>
                          )}

                          {failed.length > 0 && (
                            <div className="checks">
                              {failed.map((c) => (
                                <div key={c.name} className="issue error">
                                  <b>{c.name}</b>{c.span ? <> — <code>{c.span}</code></> : null}
                                  {c.hint ? <span className="hint" style={{ display: 'block', marginTop: 3 }}>{c.hint}</span> : null}
                                </div>
                              ))}
                            </div>
                          )}

                          <div className="piece-foot">
                            <span className="meta">
                              {p.status === 'approved'
                                ? <span className="badge live">approved</span>
                                : failed.length
                                  ? <span className="badge todo">blocked</span>
                                  : <span className="badge part">draft</span>}
                              {' '}{p.source === 'human' ? 'edited by you' : p.model} · {p.prompt_version}
                            </span>
                            <span className="acts">
                              {isEditing ? (
                                <>
                                  <button className="chip" onClick={() => setEditing(null)}>Cancel</button>
                                  <button className="btn small" onClick={() => void act(p.id, 'edit', editing.text)}>Save wording</button>
                                </>
                              ) : (
                                <>
                                  <button className="chip" onClick={() => copy(p)}>{copied === p.id ? 'copied' : 'Copy'}</button>
                                  {p.kind !== 'script' && (
                                    <button className="chip" onClick={() => setEditing({ id: p.id, text: p.text })}>Edit</button>
                                  )}
                                  <button className="chip danger" onClick={() => void act(p.id, 'delete')}>Discard</button>
                                  {p.status === 'approved' ? (
                                    <button className="chip" onClick={() => void act(p.id, 'unapprove')}>Withdraw</button>
                                  ) : (
                                    <button className="btn small" disabled={failed.length > 0}
                                            onClick={() => void act(p.id, 'approve')}>Approve</button>
                                  )}
                                </>
                              )}
                            </span>
                          </div>
                        </div>
                      )
                    })}
                  </section>
                )
              })}

              <p className="hint" style={{ marginTop: 24 }}>
                Approved copy is stored per product under <code>data/state/content/</code>, carrying
                the status, model and prompt version behind every line. Kuwaiti Arabic comes from
                thirty to fifty of the company&rsquo;s own approved posts, used as examples — not
                from a prompt describing the dialect.
              </p>
            </>
          )}
        </>
      )}
    </main>
  )
}
