'use client'

import { useState } from 'react'
import { KUWAIT_TABS, Tabs } from '../../tabs'

type Item = { title: string; source: string; link: string; published: string }
type Result = {
  topic: string; query: string; source: string; pulled: string; items: Item[]
  /** Rule 5 applied to the feed. Reported, never silent — see below. */
  dropped: { political: number; religious: number }
  droppedTotal: number
}

/**
 * The second half of Kuwait: looking a topic up, rather than reading what today
 * happened to be.
 *
 * It is its own tab and not a box bolted onto the Today panel for the reason
 * the maintainer gave — one page carrying both is a page where the dated
 * snapshot and a live search compete for the same attention, and the snapshot
 * is the one with a shelf life that matters.
 *
 * Nothing is stored. A file per query would turn knowledge/kuwait/timely/ from
 * a set of dated snapshots into a search log, and the date beside a snapshot is
 * the only thing making it safe to read.
 */
const SUGGESTIONS = ['cars', 'back to school', 'phones', 'laptops', 'gaming', 'air conditioning']

const when = (iso: string) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function KuwaitSearch() {
  const [topic, setTopic] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<Result | null>(null)

  async function search(q: string) {
    if (!q.trim() || busy) return
    setBusy(true); setError(''); setResult(null)
    const r = await fetch('/api/kuwait/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic: q }),
    }).catch(() => null)
    const d = await r?.json().catch(() => null)
    setBusy(false)
    if (r?.ok) setResult(d as Result)
    else setError(d?.error ?? 'Could not search — is this machine online?')
  }

  return (
    <main>
      <h1>Kuwait</h1>
      <Tabs items={KUWAIT_TABS} />
      <p className="sub">
        What Kuwait is reading about one topic, pulled live from public news when you press search.
        Real headlines with their outlet and date — nothing here is written by a model, and nothing
        about this machine is sent but the words you type. What to do with any of it is a judgement
        that stays with you: the <a href="/kuwait">compliance rules</a> apply to a trend exactly as
        they apply to a caption.
      </p>

      <div className="panel">
        <div className="row" style={{ alignItems: 'center' }}>
          <input
            type="search" value={topic} placeholder="cars, back to school, phones…"
            aria-label="Search a topic"
            style={{ flex: '1 1 320px' }}
            onChange={(e) => setTopic(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void search(topic) }}
          />
          <button className="btn" disabled={busy || !topic.trim()} onClick={() => void search(topic)}>
            {busy ? 'Searching…' : 'Search'}
          </button>
        </div>
        <div className="chips" style={{ marginTop: 12 }}>
          {SUGGESTIONS.map((s) => (
            <button key={s} className="chip" disabled={busy}
                    onClick={() => { setTopic(s); void search(s) }}>
              {s}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="notice warn">{error}</p>}

      {result && (
        <>
          <p className="sub" style={{ marginTop: 24 }}>
            {result.items.length
              ? <>{result.items.length} results for <b>{result.query}</b>, from {result.source}, pulled just now.</>
              : <>Nothing found for <b>{result.query}</b>. Some topics genuinely have no Kuwait coverage — that is an answer, not a failure.</>}
          </p>

          {/* Said out loud. A feed showing eighteen of twenty-five and saying
              nothing has quietly changed what the search means, and the person
              reading it cannot tell it happened. */}
          {result.droppedTotal > 0 && (
            <p className="hint" style={{ marginTop: -14, marginBottom: 18 }}>
              {result.droppedTotal} more {result.droppedTotal === 1 ? 'headline was' : 'headlines were'} left
              out as political or religious
              {' '}({result.dropped.political} political, {result.dropped.religious} religious).
              Neither may be a marketing angle, so neither is offered as one.
            </p>
          )}
          {result.items.length > 0 && (
            <table className="catalogue">
              <thead><tr><th>Headline</th><th>Source</th><th>When</th></tr></thead>
              <tbody>
                {result.items.map((i) => (
                  <tr key={i.link}>
                    <td><a href={i.link} target="_blank" rel="noreferrer">{i.title}</a></td>
                    <td>{i.source}</td>
                    <td>{when(i.published)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </main>
  )
}
