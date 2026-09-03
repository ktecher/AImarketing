'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

type Verdict = 'ok' | 'needs work' | 'problem'
type Check = { name: string; pass: boolean; span?: string; hint?: string }
type Blocker = { quote: string; criterion: string; why: string }
type Fix = { quote: string; change: string; why: string; criterion: string }
type Review = {
  verdicts: Record<string, Verdict>
  blockers: Blocker[]
  fixes: Fix[]
  not_assessed: string[]
  matched: { sku: string; name: string; confidence: string } | null
}
type Rewrite = { instead_of: string; write: string; checks: Check[] }
type Answer = {
  review: Review
  say: string
  asks: string[]
  rewrites: Rewrite[]
  caution: Check[]
  offline?: string
  model: string
  prompt_version: string
}
/** The conversation as the screen holds it: your words, or a whole answer. */
type Entry = { role: 'you'; text: string } | { role: 'advisor'; answer: Answer }

const HOW_SURE: Record<string, string> = {
  sku: 'you named the product',
  category: 'matched the category it sits in',
  lexical: 'matched on the words',
  meaning: 'matched on meaning — check this is the right product',
}

const CHANNELS = [
  { id: 'instagram', label: 'Instagram' },
  { id: 'snapchat', label: 'Snapchat' },
  { id: 'tiktok', label: 'TikTok' },
]

export default function Advisor() {
  const [draft, setDraft] = useState('')
  const [lang, setLang] = useState<'en' | 'ar'>('en')
  const [channel, setChannel] = useState('')
  const [sku, setSku] = useState('')
  const [thread, setThread] = useState<Entry[]>([])
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [products, setProducts] = useState<{ sku: string; name: string }[] | null>(null)
  const [copied, setCopied] = useState('')
  const foot = useRef<HTMLDivElement>(null)

  // Null while loading, false once the route says the database is not answering.
  // Without this an outage rendered as "no catalogue is loaded — import a sheet
  // first", which is advice that cannot work: importing needs the database too.
  const [dbUp, setDbUp] = useState<boolean | null>(null)

  useEffect(() => {
    void fetch('/api/advisor').then((r) => r.json())
      .then((d) => { setDbUp(d.up !== false); setProducts(d.list ?? []) })
      // A fetch that rejects outright — the server gone — reads the same as the
      // database being down, and the same sentence is the right one.
      .catch(() => { setDbUp(false); setProducts([]) })
  }, [])

  // The newest turn is the one being read. Without this a long answer arrives
  // below the fold and the page looks like it did nothing.
  useEffect(() => { foot.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [thread])

  const send = useCallback(async (said?: string) => {
    if (!draft.trim() || busy) return
    setBusy(true); setError('')
    // The person's words go on screen before the request, not after it. A reply
    // that vanishes for thirty seconds reads as a dropped message.
    const next: Entry[] = said ? [...thread, { role: 'you', text: said }] : thread
    if (said) { setThread(next); setReply('') }
    try {
      const res = await fetch('/api/advisor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: draft, lang, sku: sku || undefined, channel: channel || undefined,
          // Only what was actually said, in order. The advisor's own turns go
          // back as the prose it wrote, so it can see what it already told you.
          turns: next.map((e) => e.role === 'you'
            ? { role: 'you', text: e.text }
            : { role: 'advisor', text: e.answer.say }),
        }),
      })
      const d = await res.json()
      if (!res.ok) setError(d.error ?? 'Could not review that.')
      else setThread([...next, { role: 'advisor', answer: d.answer as Answer }])
    } catch { setError('Could not review that.') }
    setBusy(false)
  }, [draft, lang, sku, channel, thread, busy])

  function copy(w: Rewrite) {
    void navigator.clipboard.writeText(w.write)
    setCopied(w.write)
    setTimeout(() => setCopied(''), 1400)
  }

  const last = [...thread].reverse().find((e) => e.role === 'advisor') as
    { role: 'advisor'; answer: Answer } | undefined
  const review = last?.answer.review

  return (
    <main className="advisor">
      <h1>Creative advisor</h1>
      <p className="sub">
        Paste a draft your team wrote — including work this system did not generate — and talk it
        through. The checks against the catalogue run in code and cannot be argued with; the read
        on the writing is a conversation, and it asks when it cannot tell what it is looking at.
        No opinion out of ten, ever.
      </p>

      {dbUp === false ? (
        <div className="notice warn-notice">
          Postgres is not answering, so there is no price to check a draft against.
          Run <code>npm run db:up</code>. Importing a sheet will not help — that needs
          the database too.
        </div>
      ) : products?.length === 0 && (
        <div className="notice warn-notice">
          No catalogue is loaded, so there is no price to check a draft against.
          Import a product sheet on <b>Products &amp; designs</b> first.
        </div>
      )}

      <div className="panel">
        <label className="lbl" htmlFor="draft">THE DRAFT</label>
        <textarea
          id="draft"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={6}
          placeholder="Paste a caption, a slogan, or a video script."
        />
        <div className="row" style={{ alignItems: 'flex-end', marginTop: 10 }}>
          <label className="fld" style={{ flex: '2 1 240px', marginBottom: 0 }}>
            <span>Which product <em>optional — it fixes what the prices are checked against</em></span>
            <select value={sku} onChange={(e) => setSku(e.target.value)}>
              <option value="">let it work it out</option>
              {(products ?? []).map((p) => <option key={p.sku} value={p.sku}>{p.name}</option>)}
            </select>
          </label>
          <label className="fld" style={{ flex: '1 1 160px', marginBottom: 0 }}>
            <span>Channel</span>
            <select value={channel} onChange={(e) => setChannel(e.target.value)}>
              <option value="">not said</option>
              {CHANNELS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </label>
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <label className="toggle">
            <input type="checkbox" checked={lang === 'ar'} onChange={(e) => setLang(e.target.checked ? 'ar' : 'en')} />
            this draft is in Arabic
          </label>
          <button className="btn" onClick={() => void send()} disabled={busy || !draft.trim()}>
            {busy ? 'Reading…' : thread.length ? 'Look again' : 'Review it'}
          </button>
        </div>
      </div>

      {error && <p className="note bad">{error}</p>}

      {thread.map((e, i) => e.role === 'you' ? (
        <div className="turn you" key={i}><p>{e.text}</p></div>
      ) : (
        <div className="turn advisor-turn" key={i}>
          {e.answer.offline && <p className="notice warn">{e.answer.offline}</p>}
          {e.answer.say && <p className="said">{e.answer.say}</p>}

          {e.answer.caution.length > 0 && (
            <p className="note bad">
              Careful with this answer — it wrote{' '}
              {e.answer.caution.map((c) => `“${c.span}” (${c.name})`).join(', ')}.
              The advisor is held to the same rules as the copy it reviews, and this broke one.
              Do not copy that wording into anything.
            </p>
          )}

          {e.answer.asks.length > 0 && (
            <div className="asks">
              <b>Before I can go further</b>
              <ul className="list">{e.answer.asks.map((a) => <li key={a}>{a}</li>)}</ul>
              <span className="hint">
                Answer above, or type it below — either way press Look again.
              </span>
            </div>
          )}

          {e.answer.rewrites.length > 0 && (
            <div className="rewrites">
              <b>Lines to try</b>
              {e.answer.rewrites.map((w) => {
                const failed = w.checks.filter((c) => !c.pass)
                return (
                  <div className={`rewrite${failed.length ? ' blocked' : ''}`} key={w.write}>
                    <q>{w.instead_of}</q>
                    <p>{w.write}</p>
                    {failed.length > 0 ? (
                      <span className="why">
                        Not usable as written — {failed.map((c) => c.name).join(', ')}
                        {failed[0].span ? <> (<code>{failed[0].span}</code>)</> : null}.
                      </span>
                    ) : (
                      <button className="chip" onClick={() => copy(w)}>
                        {copied === w.write ? 'copied' : 'Copy'}
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      ))}

      {busy && <div className="turn advisor-turn"><p className="hint">Reading it…</p></div>}

      {thread.length > 0 && (
        <>
          <div className="row reply-row">
            <input
              type="text" value={reply} placeholder="Answer it, or ask something back"
              onChange={(ev) => setReply(ev.target.value)}
              onKeyDown={(ev) => { if (ev.key === 'Enter' && reply.trim()) void send(reply.trim()) }}
            />
            <button className="btn" disabled={busy || !reply.trim()} onClick={() => void send(reply.trim())}>
              Send
            </button>
          </div>

          {review && (
            <>
              {review.matched ? (
                <p className="sub">
                  Checked against <b>{review.matched.name}</b> ({review.matched.sku}) — {HOW_SURE[review.matched.confidence]}.
                </p>
              ) : (
                <p className="sub">No product in the catalogue matched this draft, so nothing factual could be checked.</p>
              )}

              <div className="verdicts">
                {Object.entries(review.verdicts).map(([dim, v]) => (
                  <div key={dim} className={`verdict ${v.replace(' ', '-')}`}>
                    <b>{v}</b>
                    <span>{dim}</span>
                  </div>
                ))}
              </div>

              {review.blockers.length > 0 ? (
                <div className="panel">
                  <h2>Do not publish</h2>
                  <p className="sub">
                    {review.blockers.length === 1 ? 'One thing' : `${review.blockers.length} things`} the
                    catalogue will not back. Each one quotes the line it came from.
                  </p>
                  {review.blockers.map((b, i) => (
                    <div key={i} className="blocker">
                      <q>{b.quote}</q>
                      <b>{b.criterion}</b>
                      <span>{b.why}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="ok-note">Nothing in this draft contradicts the catalogue.</p>
              )}

              {review.fixes.length > 0 && (
                <div className="panel">
                  <h2>What to change</h2>
                  <p className="sub">Most important first. Three at most — twelve suggestions is none.</p>
                  <ol className="fixes">
                    {review.fixes.map((f, i) => (
                      <li key={i}>
                        <q>{f.quote}</q>
                        <b>{f.change}</b>
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              <div className="panel">
                <h2>Not looked at</h2>
                <p className="sub">Said out loud, because silence here would read as a pass.</p>
                <ul className="list blocked">
                  {review.not_assessed.map((n) => <li key={n}>{n}</li>)}
                </ul>
              </div>
            </>
          )}
        </>
      )}
      <div ref={foot} />
    </main>
  )
}
