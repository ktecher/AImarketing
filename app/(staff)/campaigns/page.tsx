'use client'

import { useCallback, useEffect, useState } from 'react'

type Campaign = { id: string; name: string; context: string; created_at: string }
type Promoted = { sku: string; name: string; designs: number; drafts: number; approved: number; asked: number }
type Unanswered = { conversation: string; at: string; question: string; why: string }
type Report = {
  campaign: Campaign
  promoted: Promoted[]
  unpromoted: { sku: string; name: string; asked: number }[]
  unanswered: Unanswered[]
  conversations: number
}

const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { hour12: false }).replace(',', '')
const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

export default function Campaigns() {
  const [up, setUp] = useState<boolean | null>(null)
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [openId, setOpenId] = useState<string | null>(null)
  const [report, setReport] = useState<Report | null>(null)
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  // Two contexts, deliberately. One state served both boxes, so opening "new
  // campaign" while a campaign was open pre-filled the new one with the old
  // one's context — last week's offer, silently, on a campaign nobody had typed
  // it into.
  const [context, setContext] = useState('')
  const [newContext, setNewContext] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')

  const loadList = useCallback(async () => {
    // A fetch that rejects outright (server gone) reads the same as Postgres
    // being down: the page says what to run instead of rendering nothing.
    const d = await fetch('/api/campaigns').then((r) => r.json()).catch(() => ({ up: false }))
    setUp(d.up !== false)
    setCampaigns(d.campaigns ?? [])
    // The newest campaign is the one new work is being stamped with, so it is
    // the one worth opening.
    setOpenId((id) => id ?? d.current ?? null)
  }, [])

  useEffect(() => { void loadList() }, [loadList])

  useEffect(() => {
    if (!openId) { setReport(null); return }
    void fetch(`/api/campaigns?id=${encodeURIComponent(openId)}`)
      .then((r) => r.json())
      .then((d) => { setReport(d.campaign ? (d as Report) : null); setContext(d.campaign?.context ?? '') })
      .catch(() => setReport(null))
  }, [openId])

  const submit = useCallback(async () => {
    setBusy(true); setError('')
    const r = await fetch('/api/campaigns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, context: newContext }),
    })
    const d = await r.json()
    setBusy(false)
    if (!r.ok) { setError(d.error ?? 'Could not create the campaign.'); return }
    setName(''); setNewContext(''); setAdding(false); setOpenId(d.campaign.id)
    await loadList()
  }, [name, newContext, loadList])

  const saveContext = useCallback(async () => {
    if (!openId) return
    setBusy(true)
    // "Saved." on a failed save is the D56 failure in one word — a person walks
    // away believing the studio will see an offer it never got.
    const r = await fetch('/api/campaigns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: openId, context }),
    }).catch(() => null)
    setBusy(false)
    setSaved(r?.ok ? 'Saved.' : 'Not saved — is Postgres running?')
    setTimeout(() => setSaved(''), 4000)
  }, [openId, context])

  if (up === false) {
    return (
      <main>
        <h1>Campaigns</h1>
        <p className="sub">What ties marketing to sales, in both directions.</p>
        <p className="notice warn">Postgres is not answering. Run <code>npm run db:up</code>, then reload.</p>
      </main>
    )
  }

  return (
    <main>
      <h1>Campaigns</h1>
      <p className="sub">
        One id, stamped on every design, caption and conversation. Afterwards it answers the
        question nothing else in the system can: we promoted these products — what did customers
        ask about, and what could the assistant not answer?
      </p>

      <div className="chips">
        {campaigns.map((c, i) => (
          <button
            key={c.id}
            className={`chip${c.id === openId ? ' on' : ''}`}
            onClick={() => setOpenId(c.id)}
          >
            {c.name}
            {/* The newest campaign is the current one — a rule, not a column. */}
            {i === 0 && <span className="badge live"> current</span>}
          </button>
        ))}
        <button className="chip add" onClick={() => setAdding((a) => !a)}>
          {adding ? 'Cancel' : 'New campaign'}
        </button>
      </div>

      {(adding || (up && !campaigns.length)) && (
        <div className="panel">
          {!campaigns.length && !adding && (
            <p className="hint">
              Nothing has been stamped yet. Every design exported and every caption written from
              now on carries the campaign you make here.
            </p>
          )}
          <div className="fld">
            <span>Name</span>
            <input
              type="text" value={name} placeholder="Back to school — laptops"
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="fld">
            <span>This week&rsquo;s context <em>optional</em></span>
            <textarea
              rows={3} value={newContext}
              placeholder="The offer, the angle, what is trending right now — anything the machine cannot know offline."
              onChange={(e) => setNewContext(e.target.value)}
            />
          </div>
          <button className="btn" disabled={busy || !name.trim()} onClick={() => void submit()}>
            {busy ? 'Creating…' : 'Create campaign'}
          </button>
          {error && <p className="notice warn">{error}</p>}
        </div>
      )}

      {/* Not while the create form is open: two identical "this week's context"
          boxes on one screen, one of them belonging to a campaign that does not
          exist yet, is a reliable way to type into the wrong one. */}
      {report && !adding && (
        <>
          <div className="panel">
            <div className="fld">
              <span>This week&rsquo;s context <em>what the machine cannot know</em></span>
              <textarea rows={3} value={context} onChange={(e) => setContext(e.target.value)} />
            </div>
            <button className="btn small" disabled={busy} onClick={() => void saveContext()}>Save</button>
            {saved && <span className="hint"> {saved}</span>}
          </div>

          <div className="panel">
            <div className="kv"><span>Started</span><b>{day(report.campaign.created_at)}</b></div>
            <div className="kv"><span>Products promoted</span><b>{report.promoted.length}</b></div>
            <div className="kv">
              <span>Copy approved</span>
              <b>{report.promoted.reduce((n, p) => n + p.approved, 0)} of {report.promoted.reduce((n, p) => n + p.drafts, 0)} drafts</b>
            </div>
            <div className="kv"><span>Conversations</span><b>{report.conversations}</b></div>
          </div>

          <h2>What we promoted, and what customers asked about</h2>
          {report.promoted.length ? (
            <table className="catalogue">
              <thead>
                <tr><th>Product</th><th>Designs</th><th>Copy</th><th>Asked about</th></tr>
              </thead>
              <tbody>
                {report.promoted.map((p) => (
                  <tr key={p.sku}>
                    <td>{p.name}</td>
                    <td>{p.designs || '—'}</td>
                    <td>{p.drafts ? `${p.approved} of ${p.drafts} approved` : '—'}</td>
                    <td>{p.asked ? `${p.asked} conversation${p.asked === 1 ? '' : 's'}` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="hint">
              Nothing carries this campaign yet. Export designs from Designs, or write copy in the
              content studio, and they are stamped with it.
            </p>
          )}

          {report.unpromoted.length > 0 && (
            <>
              <h2>Asked about, but not promoted</h2>
              <p className="hint">
                Customers came to this campaign and asked about these instead.
              </p>
              <ul className="list">
                {report.unpromoted.map((p) => (
                  <li key={p.sku}>{p.name} — {p.asked} conversation{p.asked === 1 ? '' : 's'}</li>
                ))}
              </ul>
            </>
          )}

          <h2>What the assistant could not answer</h2>
          {report.unanswered.length ? (
            <>
              <p className="hint">
                Each of these is a customer who wanted something the catalogue could not give them.
                This is the list that says what the catalogue is missing.
              </p>
              {report.unanswered.map((u) => (
                <div className="panel" key={`${u.conversation}-${u.at}`}>
                  <b>{u.question}</b>
                  <div className="kv"><span>{u.why}</span><em>{when(u.at)}</em></div>
                </div>
              ))}
            </>
          ) : (
            <p className="hint">
              Nothing escalated. Either the assistant answered everything asked of it, or nobody has
              asked yet.
            </p>
          )}
        </>
      )}
    </main>
  )
}
