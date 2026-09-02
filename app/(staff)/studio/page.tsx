'use client'

import { useCallback, useEffect, useState } from 'react'
import { CurrentCampaign } from '../current-campaign'
import { readPicked, writePicked } from '../picked'

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
  { kind: 'slogan', title: 'Slogans', more: 'More slogans',
    note: 'Six words or fewer. These go on the poster, not in the caption.' },
  { kind: 'caption', title: 'Captions', more: 'More captions',
    note: 'Written for the channel above. Edit freely — an edited line is recorded as yours.' },
  { kind: 'hashtags', title: 'Hashtags', more: 'Another set',
    note: 'Approved and copied as one block.' },
  // Not "more scripts". Two unrelated scripts leave a person diffing by eye;
  // the button hands the model the one that exists and asks for it back better.
  { kind: 'script', title: 'Video script', more: 'Improve it',
    note: 'For a person holding the product on camera. The footage is filmed, not generated.' },
] as const

export default function Studio() {
  const [products, setProducts] = useState<Product[]>([])
  const [picked, setPicked] = useState<string[]>([])
  // Narrowed to the picked products by default, with one click back to all.
  const [onlyPicked, setOnlyPicked] = useState(true)
  const [sku, setSku] = useState('')
  const [channel, setChannel] = useState('instagram')
  const [pieces, setPieces] = useState<Piece[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null)
  const [copied, setCopied] = useState('')
  const [stock, setStock] = useState<{ approved: number; products: number } | null>(null)
  // What the person wants different this time — shorter, funnier, lead with the
  // battery. It steers the prompt and never supplies a fact.
  const [note, setNote] = useState('')
  // Which button is running, so "More captions" says so and the other three
  // do not all read as busy for the same reason.
  const [running, setRunning] = useState('')
  /** '' when idle; otherwise "3 of 10", so a ten-product run is not a blank wait. */
  const [batch, setBatch] = useState('')

  useEffect(() => {
    // Products picked on the Designs screen. Somebody who picked two and walked
    // over here to write their captions means those two, and the studio used to
    // open on whatever happened to be first in the catalogue instead.
    const chosen = readPicked()
    setPicked(chosen)
    void fetch('/api/studio').then((r) => r.json()).then((d) => {
      setProducts(d.products ?? [])
      // ?sku= so the campaign report's product rows are a way back into the
      // work rather than a read-only table. `location.search` rather than
      // useSearchParams: this page is statically prerendered, and the hook
      // would force it into a Suspense boundary for one optional parameter.
      const wanted = new URLSearchParams(window.location.search).get('sku')
      const known = d.products?.some((p: Product) => p.sku === wanted)
      const firstPicked = chosen.find((s) => d.products?.some((p: Product) => p.sku === s))
      // A ?sku= naming a product outside the selection is a deliberate jump —
      // from a campaign report row — and must not land on an empty dropdown.
      if (known && wanted && !chosen.includes(wanted)) setOnlyPicked(false)
      if (d.products?.length) {
        setSku((s) => s || (known ? wanted! : firstPicked ?? d.products[0].sku))
      }
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

  /**
   * Write drafts. With no argument, the whole set; with one kind, only that —
   * which is what makes "more slogans" one short call instead of four.
   */
  async function write(only?: readonly string[]) {
    setBusy(true); setRunning(only?.[0] ?? 'all'); setError(''); setNotice('')
    const before = pieces.length
    try {
      const res = await fetch('/api/studio', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sku, channel, only, note }),
      })
      const d = await res.json()
      if (!res.ok) setError(d.error ?? 'Generation failed.')
      else {
        setPieces(d.pieces)
        // On success only. A failed generation is not a choice.
        const adopted = picked.length > 0 && !picked.includes(sku)
        if (adopted) setSelection([...picked, sku])
        const blocked = d.pieces.filter((p: Piece) => p.checks.some((c) => !c.pass)).length
        // Counted against what was there, so "More captions" reports the three
        // it added rather than the eleven now on screen.
        const added = only ? Math.max(d.pieces.length - before, 0) : d.pieces.length
        setNotice(
          blocked
            ? `${blocked} of ${d.pieces.length} drafts are blocked by a check. They are shown with the line that triggered it — fix the wording or discard them.`
            : only && !added
              ? 'Rewritten. Nothing is approved until you approve it.'
              : `${added} new draft${added === 1 ? '' : 's'}, every check passing. Nothing is approved until you approve it.`,
        )
        // Said out loud, because it changes what the other screens will do.
        if (adopted) {
          setNotice((n) => `${n} Added to your ${picked.length + 1} — it will be included when you write or publish the set.`)
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Generation failed.')
    }
    setBusy(false); setRunning('')
  }

  /**
   * A full set of drafts for every picked product, one after another.
   *
   * Sequential on purpose, and this is the one place where that is not a
   * preference. Each call is four generations on a local model inside a 12-15 GB
   * budget shared with Postgres, Next and the embedder; two at once is how the
   * model gets evicted mid-run and a demo dies. Ten products is minutes, so the
   * count says which one it is on.
   *
   * The screen follows along: `setSku` moves the dropdown to whatever is being
   * written, and the per-product effect loads its drafts as it lands. Somebody
   * watching sees work happening rather than a spinner.
   *
   * One failure does not stop the rest — a product missing from the sheet is one
   * product, and the other nine still have captions to write.
   */
  async function writeAll() {
    const list = picked.length ? picked : sku ? [sku] : []
    if (!list.length) return
    setBusy(true); setError(''); setNotice('')
    let wrote = 0
    const failures: string[] = []
    for (let i = 0; i < list.length; i++) {
      setBatch(`${i + 1} of ${list.length}`)
      setSku(list[i])
      try {
        const res = await fetch('/api/studio', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sku: list[i], channel, note }),
        })
        const d = await res.json()
        if (!res.ok) failures.push(`${list[i]}: ${d.error ?? 'generation failed'}`)
        else { wrote++; setPieces(d.pieces) }
      } catch (e) {
        failures.push(`${list[i]}: ${e instanceof Error ? e.message : 'generation failed'}`)
      }
    }
    setBatch('')
    setBusy(false)
    // Both numbers, always. "Wrote 8" beside nothing about the two that did not
    // is the shape of a screen that reports success for work that never happened.
    setNotice(
      `Drafts written for ${wrote} of ${list.length} products. Nothing is approved until you approve it.`,
    )
    if (failures.length) setError(failures.join(' · '))
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

  // A picked product the catalogue no longer lists must not empty the dropdown.
  const mine = products.filter((p) => picked.includes(p.sku))
  const listed = onlyPicked && mine.length ? mine : products

  /** Widening or narrowing must leave a product selected that is actually listed. */
  const toggleScope = () => {
    const next = !onlyPicked
    setOnlyPicked(next)
    const list = next && mine.length ? mine : products
    if (!list.some((p) => p.sku === sku)) setSku(list[0]?.sku ?? '')
  }

  /**
   * The selection is editable here, not only on Designs. Landing on a list you
   * cannot change means walking back to another screen to drop one product,
   * and both screens read the same store so they never disagree.
   */
  const setSelection = (next: string[]) => {
    setPicked(next)
    writePicked(next)
    const list = next.length ? products.filter((p) => next.includes(p.sku)) : products
    if (!list.some((p) => p.sku === sku)) setSku(list[0]?.sku ?? '')
  }

  return (
    <main>
      <h1>Content studio</h1>
      <CurrentCampaign verb="Everything written here is stamped" />
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
            {/* One line, not a chip per product. A hand-picked pair read fine
                as chips; a campaign's twenty-six filled the screen with
                truncated names before the first slogan, and the dropdown right
                below already does the choosing. This line is now only about the
                LIST — how many, and which list. Anything that acts on ONE
                product moved down beside the select that names it. */}
            {mine.length > 0 && (
              <p className="hint" style={{ marginTop: 0, marginBottom: 12 }}>
                {onlyPicked
                  ? `${mine.length} ${mine.length === 1 ? 'product' : 'products'} picked on Designs. `
                  : 'Writing from the whole catalogue. '}
                <button className="chip" onClick={toggleScope}>
                  {onlyPicked ? `Show all ${products.length}` : `Show my ${mine.length}`}
                </button>
              </p>
            )}
            <div className="row" style={{ alignItems: 'flex-end' }}>
              <label className="fld" style={{ flex: '2 1 380px', marginBottom: 0 }}>
                <span>Product {product?.approved ? <b>· {product.approved} approved</b> : null}</span>
                <select value={sku} onChange={(e) => setSku(e.target.value)}>
                  {listed.map((p) => (
                    <option key={p.sku} value={p.sku}>
                      {p.name}{p.onSale ? ' · on sale' : ''}{p.approved ? ` · ${p.approved} approved` : p.drafts ? ` · ${p.drafts} drafts` : ''}
                    </option>
                  ))}
                </select>
              </label>

              {/* Against the select, because "this one" has to be able to point
                  at something. On the line above it named a product that was not
                  on that line. */}
              {sku && (
                <div style={{ flex: '0 0 auto', display: 'flex', alignItems: 'flex-end' }}>
                  {picked.includes(sku) ? (
                    <button className="chip danger"
                            onClick={() => setSelection(picked.filter((one) => one !== sku))}>
                      Drop it
                    </button>
                  ) : (
                    <button className="chip add" onClick={() => setSelection([...picked, sku])}>
                      + Keep it
                    </button>
                  )}
                </div>
              )}

              <div style={{ flex: '0 0 auto', display: 'flex', gap: 8 }}>
                <button className="btn" onClick={() => void write()} disabled={busy}>
                  {running === 'all' ? 'Writing…' : pieces.length ? 'Write a full set' : 'Write drafts'}
                </button>
                {/* Only past one product. Over a single pick this button and the
                    one beside it would do the same thing under two names. */}
                {picked.length > 1 && (
                  <button className="btn" onClick={() => void writeAll()} disabled={busy}>
                    {batch ? `Writing ${batch}…` : `Write for all ${picked.length}`}
                  </button>
                )}
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

            <label className="fld" style={{ marginTop: 14, marginBottom: 0 }}>
              <span>Anything to change this time? <em>optional — steers the writing, never a fact</em></span>
              <input
                type="text" value={note} maxLength={300}
                placeholder="shorter · funnier · lead with the battery · less salesy"
                onChange={(e) => setNote(e.target.value)}
              />
            </label>

            <p className="hint">
              Runs on this machine. A full set is four model calls, roughly half a minute; asking
              for more of one kind is one call and a few seconds. The copy is written freely first
              and sorted into fields afterwards, because constraining the writing makes it worse.
              {/* Said out loud, because half a minute times twenty-six is a quarter
                  of an hour and an unexplained wait reads as a hang. */}
              {picked.length > 1 && (
                <> All {picked.length} is roughly {Math.max(1, Math.round(picked.length / 2))} minutes,
                one product at a time — the model is local and two at once evicts it.</>
              )}
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
                    <div className="section-head">
                      <h2>{s.title}</h2>
                      <button className="chip" disabled={busy} onClick={() => void write([s.kind])}>
                        {running === s.kind ? 'Writing…' : s.more}
                      </button>
                    </div>
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
