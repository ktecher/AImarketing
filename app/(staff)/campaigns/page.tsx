'use client'

import { useCallback, useEffect, useState } from 'react'
import { composeContext, OFFER_MECHANICS, type Brief } from '@/lib/brief'
import CampaignMeeting from './meeting'

/**
 * Reach figures from knowledge/kuwait/evergreen/channels-and-platforms.md.
 * Snapchat leads and is pre-ticked: at 48% of Kuwait it is not a secondary
 * channel here, and a form whose default omits it is wrong for this market.
 */
const CHANNELS = ['Snapchat', 'Instagram', 'TikTok', 'YouTube', 'X']

const EMPTY: Brief = {
  pushing: '', audience: '', offer: '', offerDetail: '',
  say: '', channels: ['Snapchat'], runs: '', notes: '',
}

type Campaign = { id: string; name: string; context: string; created_at: string }
type Promoted = {
  sku: string; name: string; designs: number; drafts: number; approved: number; asked: number
  /** Posts that actually went out carrying it — the loop's last step. */
  posted: number
}
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
  /**
   * Which way a new campaign gets made.
   *
   * The meeting is the front door because a blank brief is the worst possible
   * first screen — the fields are stamped on every design and caption from then
   * on, and nothing on a form says what a good answer looks like. The form
   * stays one click away for somebody who already knows exactly what they want
   * and does not need to be asked; taking it away would make the fast path
   * slower to spite the slow one.
   */
  const [mode, setMode] = useState<'meeting' | 'form'>('meeting')
  const [name, setName] = useState('')
  // Two contexts, deliberately. One state served both boxes, so opening "new
  // campaign" while a campaign was open pre-filled the new one with the old
  // one's context — last week's offer, silently, on a campaign nobody had typed
  // it into.
  const [context, setContext] = useState('')
  // The new campaign's brief. Seven answers, one field — see lib/brief.ts.
  const [brief, setBrief] = useState<Brief>(EMPTY)
  // How many catalogue rows "Pushing" actually matches. A campaign aimed at a
  // word the catalogue does not carry is worth knowing before it is created.
  const [matches, setMatches] = useState<number | null>(null)
  // Two states, not a window.confirm: the confirmation has to show the counts,
  // and a native dialog cannot. Deleting the loop's history is irreversible.
  const [confirming, setConfirming] = useState(false)
  /**
   * Whether the brief is on screen.
   *
   * It starts closed, and that is the whole fix for "the workflow is
   * confusing". Seven fields on a blank page is a form; one question with a
   * button beside it is a request. The fields are for CHECKING what came back,
   * not for filling in from scratch — so they appear once there is something to
   * check, or when somebody says they would rather type it themselves.
   */
  const [showBrief, setShowBrief] = useState(false)
  // Headlines a person reads, never something the assist swallows. Feeding news
  // into the prompt would let a story become the campaign angle with nobody
  // having read it — and vision.md promises this system never says what is
  // trending. So: a button, a list, and the person copies what matters.
  const [reading, setReading] = useState<{ title: string; source: string; link: string }[] | null>(null)
  const [looking, setLooking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')
  // The rough idea, and what the model made of it. Nothing here is saved — it
  // fills the two fields below, which a person then edits.
  const [idea, setIdea] = useState('')
  const [drafting, setDrafting] = useState(false)
  const [invented, setInvented] = useState<string[]>([])
  const [weak, setWeak] = useState<string[]>([])

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
    setConfirming(false)
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
      body: JSON.stringify({ name, context: composeContext(brief) }),
    })
    const d = await r.json()
    setBusy(false)
    if (!r.ok) { setError(d.error ?? 'Could not create the campaign.'); return }
    setName(''); setBrief(EMPTY); setIdea(''); setInvented([]); setWeak([]); setMatches(null); setReading(null)
    setShowBrief(false); setAdding(false); setOpenId(d.campaign.id)
    await loadList()
  }, [name, brief, loadList])

  const askForHelp = useCallback(async () => {
    if (!idea.trim() || drafting) return
    setDrafting(true); setError(''); setInvented([]); setWeak([])
    const r = await fetch('/api/campaigns/assist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idea }),
    }).catch(() => null)
    const d = await r?.json().catch(() => null)
    setDrafting(false)
    if (!r?.ok) { setError(d?.error ?? 'Could not draft that.'); return }
    const g = d.suggestion
    setName(g.name)
    // Only the fields the model is actually better at than a blank box, and
    // never over an answer already given: a person who typed their own audience
    // does not want it replaced by a guess. The rough idea lands in Notes,
    // because it is usually the most natural sentence anybody writes here.
    setBrief((b) => ({
      ...b,
      pushing: b.pushing || g.pushing || '',
      audience: b.audience || g.audience || '',
      offer: b.offer || (OFFER_MECHANICS.includes(g.offer) ? g.offer : ''),
      say: b.say || g.say || '',
      // Snapchat is the TypeScript default and stays ticked; the model's picks
      // are added to it rather than replacing it. A brief for this market that
      // silently drops Snapchat is wrong before anybody reads it.
      channels: [...new Set([...b.channels, ...(Array.isArray(g.channels) ? g.channels : [])])],
      runs: b.runs || g.runs || '',
      notes: b.notes || idea.trim(),
    }))
    setInvented(g.invented ?? [])
    setWeak(g.weak ?? [])
    setShowBrief(true)
  }, [idea, drafting])

  const seeWhatKuwaitReads = useCallback(async () => {
    if (!idea.trim() || looking) return
    setLooking(true); setReading(null)
    const r = await fetch('/api/kuwait/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic: idea }),
    }).catch(() => null)
    const d = await r?.json().catch(() => null)
    setLooking(false)
    setReading(r?.ok ? (d.items ?? []).slice(0, 6) : [])
  }, [idea, looking])

  /**
   * How many products the catalogue holds for what is being pushed. Debounced,
   * and silent on failure — a hint that cannot load is a hint, not an error.
   */
  useEffect(() => {
    const q = brief.pushing.trim()
    if (!q) { setMatches(null); return }
    // Split on commas: "Standard Laptops, Convertible Laptops, Wireless
    // Earphones" is three searches, and asking for it as one phrase matched
    // nothing and reported a red 0 for a campaign covering half the catalogue.
    // Counted as a union, because a product in two of the terms is one product.
    const terms = q.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 6)
    const t = setTimeout(() => {
      void Promise.all(
        terms.map((term) =>
          fetch(`/api/products?q=${encodeURIComponent(term)}&skusOnly=1`)
            .then((r) => r.json())
            .then((d) => (Array.isArray(d.skus) ? (d.skus as string[]) : []))),
      )
        .then((lists) => setMatches(new Set(lists.flat()).size))
        .catch(() => setMatches(null))
    }, 450)
    return () => clearTimeout(t)
  }, [brief.pushing])

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

  const destroy = useCallback(async () => {
    if (!openId) return
    setBusy(true); setError('')
    const r = await fetch(`/api/campaigns?id=${encodeURIComponent(openId)}`, { method: 'DELETE' })
      .catch(() => null)
    const d = await r?.json().catch(() => null)
    setBusy(false); setConfirming(false)
    if (!r?.ok) { setError(d?.error ?? 'Could not delete it — is Postgres running?'); return }
    setOpenId(null); setReport(null)
    await loadList()
  }, [openId, loadList])

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
            {/* The newest campaign is the current one — a rule, not a column.
                A dot, not a pill reading "current": the word doubled the width
                of every chip it sat in and repeated on the one chip that is
                always in the same place. The name stays for screen readers,
                which cannot see where a dot is. */}
            {i === 0 && <i className="now" aria-hidden="true" />}
            {c.name}
            {i === 0 && <span className="sr"> — current</span>}
          </button>
        ))}
        <button className="chip add" onClick={() => setAdding((a) => !a)}>
          {adding ? 'Cancel' : 'New campaign'}
        </button>
      </div>

      {(adding || (up && !campaigns.length)) && mode === 'meeting' && (
        <div className="panel">
          <CampaignMeeting
            onCreated={(created) => {
              setAdding(false)
              setOpenId(created)
              void loadList()
            }}
          />
          <p className="hint" style={{ marginTop: 14 }}>
            <button className="linkish" onClick={() => setMode('form')}>
              Or fill the brief in yourself
            </button>
          </p>
        </div>
      )}

      {(adding || (up && !campaigns.length)) && mode === 'form' && (
        <div className="panel">
          <p className="hint">
            <button className="linkish" onClick={() => setMode('meeting')}>
              ← Talk it through instead
            </button>
          </p>
          {!campaigns.length && !adding && (
            <p className="hint">
              Nothing has been stamped yet. Every design exported and every caption written from
              now on carries the campaign you make here.
            </p>
          )}
          {/* The rough idea stays on screen after the assist runs. It is the
              most natural sentence most people write here, and hiding it once
              it had been "used" meant the best line was the one thrown away. */}
          <div className="fld">
            <span>What is the campaign?</span>
            <div className="row" style={{ alignItems: 'center' }}>
              <input
                type="text" value={idea} maxLength={500} style={{ flex: '1 1 320px' }}
                placeholder="laptops and tablets for students going back in September"
                onChange={(e) => setIdea(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void askForHelp() }}
              />
              <button className="btn" disabled={drafting || !idea.trim()} onClick={() => void askForHelp()}>
                {drafting ? 'Writing the brief…' : 'Write the brief'}
              </button>
              <button className="chip" disabled={looking || !idea.trim()}
                      onClick={() => void seeWhatKuwaitReads()}>
                {looking ? 'Looking…' : 'What is Kuwait reading?'}
              </button>
            </div>

            {reading && (
              <div className="reading">
                {reading.length ? (
                  <>
                    <b>Kuwait is reading about this. Nothing here is in the brief — copy anything worth keeping into Notes.</b>
                    <ul className="list">
                      {reading.map((h) => (
                        <li key={h.link}>
                          <a href={h.link} target="_blank" rel="noreferrer">{h.title}</a>
                          {h.source ? <em> — {h.source}</em> : null}
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <b>Nothing found, or the machine is offline. That is an answer, not a failure.</b>
                )}
              </div>
            )}
            {!showBrief && (
              <p className="hint">
                One sentence is enough. It reads the catalogue, the Kuwait retail calendar and your
                last campaign, and fills in the rest for you to check.{' '}
                <button className="linkish" onClick={() => setShowBrief(true)}>
                  Or fill it in yourself
                </button>
              </p>
            )}
          </div>

          {showBrief && (
            <>
            {/* Named as a review step, not a form. Everything below arrives
                filled in; what is left to do is disagree with it. */}
            <p className="step">Check it over, change anything, then create it.</p>

            {/* Campaign ten used to start knowing nothing about campaign one,
                though the previous context was already loaded on this page. */}
            {campaigns.length > 0 && campaigns[0].context && (
              <details className="last-said">
                <summary>What {campaigns[0].name} said</summary>
                <pre>{campaigns[0].context}</pre>
              </details>
            )}

            {invented.length > 0 && (
              <p className="notice warn">
                The draft wrote {invented.map((f) => `“${f}”`).join(', ')} — figures nobody
                gave it. Replace or delete them: a figure the model chose is not an offer anybody made.
              </p>
            )}

            {/* Not blockers — nothing is saved until Create — but both are
                invisible until a caption is already carrying them. */}
            {weak.map((w) => <p className="hint" key={w}>{w}</p>)}

            <div className="fld">
              <span>Name</span>
              <input
                type="text" value={name} placeholder="Back to school — laptops"
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className="row">
              <label className="fld" style={{ flex: '1 1 300px' }}>
                <span>
                  Pushing <em>what you are promoting</em>
                  {matches !== null && (
                    <b className={matches ? '' : 'none'}>
                      {' · '}{matches} product{matches === 1 ? '' : 's'} match
                    </b>
                  )}
                </span>
                <input
                  type="text" value={brief.pushing} placeholder="laptops and tablets"
                  onChange={(e) => setBrief({ ...brief, pushing: e.target.value })}
                />
              </label>
              <label className="fld" style={{ flex: '1 1 300px' }}>
                <span>For <em>who it is aimed at</em></span>
                <input
                  type="text" value={brief.audience}
                  placeholder="students, and the parents actually paying"
                  onChange={(e) => setBrief({ ...brief, audience: e.target.value })}
                />
              </label>
            </div>

            {/* In retail the offer IS the campaign, and the mechanics are a
                closed list — knowledge/kuwait/evergreen/pricing-and-offers.md. */}
            <div className="fld">
              <span>Offer</span>
              <div className="chips">
                {OFFER_MECHANICS.map((m) => (
                  <button
                    key={m}
                    className={`chip${brief.offer === m ? ' on' : ''}`}
                    onClick={() => setBrief({ ...brief, offer: brief.offer === m ? '' : m })}
                  >
                    {m}
                  </button>
                ))}
              </div>
              <input
                type="text" value={brief.offerDetail} style={{ marginTop: 8 }}
                placeholder="the specifics — up to 40% off selected laptops, bag included"
                onChange={(e) => setBrief({ ...brief, offerDetail: e.target.value })}
              />
              {/* Said plainly, or a marketer assumes their own figure was thrown
                  away. Rule 2 forbids the MODEL writing a number, not a person. */}
              <span className="hint">
                Type the figure if there is one. Rule 2 stops the model inventing prices; it was
                never about yours. The catalogue still fills every price that prints.
              </span>
            </div>

            <div className="fld">
              <span>The one thing to say <em>one sentence, one idea</em></span>
              <input
                type="text" value={brief.say} maxLength={120}
                placeholder="a laptop that lasts the whole degree, not the first term"
                onChange={(e) => setBrief({ ...brief, say: e.target.value })}
              />
              <span className="hint">
                If it needs an &ldquo;and&rdquo;, it is two campaigns. This is the line every caption
                is a different way of saying.
              </span>
            </div>

            <div className="row">
              <div className="fld" style={{ flex: '1 1 340px' }}>
                <span>Channels</span>
                <div className="chips">
                  {CHANNELS.map((c) => (
                    <button
                      key={c}
                      className={`chip${brief.channels.includes(c) ? ' on' : ''}`}
                      onClick={() => setBrief({
                        ...brief,
                        channels: brief.channels.includes(c)
                          ? brief.channels.filter((x) => x !== c)
                          : [...brief.channels, c],
                      })}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </div>
              <label className="fld" style={{ flex: '1 1 260px' }}>
                <span>Runs <em>in words, not dates</em></span>
                <input
                  type="text" value={brief.runs}
                  placeholder="through the first week of September"
                  onChange={(e) => setBrief({ ...brief, runs: e.target.value })}
                />
              </label>
            </div>

            <div className="fld">
              <span>Notes <em>anything else the machine cannot know</em></span>
              <textarea
                rows={2} value={brief.notes}
                placeholder="what is trending right now, what the competition is doing, why now"
                onChange={(e) => setBrief({ ...brief, notes: e.target.value })}
              />
            </div>

            {/* The one field that actually gets saved, shown as it will be saved.
                Seven inputs writing into a column nobody can see is a form that
                asks for trust it has not earned. */}
            {composeContext(brief) && (
              <div className="fld">
                <span>This is what gets stamped on every design and caption</span>
                <pre className="brief-preview">{composeContext(brief)}</pre>
              </div>
            )}
            </>
          )}

          {showBrief && (
            <button className="btn" disabled={busy || drafting || !name.trim()} onClick={() => void submit()}>
              {busy ? 'Creating…' : 'Create campaign'}
            </button>
          )}
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
              {/* Eight rows, not three: this holds the composed brief now, and
                  three rows clipped it at "Offer:" with no sign there was more. */}
              <textarea rows={8} value={context} onChange={(e) => setContext(e.target.value)} />
            </div>
            <div className="row" style={{ alignItems: 'center' }}>
              <button className="btn small" disabled={busy} onClick={() => void saveContext()}>Save</button>
              {saved && <span className="hint">{saved}</span>}
              {!confirming && (
                <button className="linkish danger-link" style={{ marginLeft: 'auto' }}
                        onClick={() => setConfirming(true)}>
                  Delete this campaign
                </button>
              )}
            </div>

            {/* The numbers are the point of asking. "Are you sure?" with nothing
                behind it is a button people learn to click through; naming what
                is about to be detached is the only version worth reading. */}
            {confirming && (
              <div className="confirm">
                <b>Delete {report.campaign.name}?</b>
                <p>
                  {report.promoted.length || report.conversations ? (
                    <>
                      {report.promoted.reduce((n, x) => n + x.designs, 0)} designs,{' '}
                      {report.promoted.reduce((n, x) => n + x.drafts, 0)} drafts and{' '}
                      {report.conversations} conversation{report.conversations === 1 ? '' : 's'} carry
                      this campaign. They are kept — the stamp is removed from each of them — but the
                      report joining them together is gone, and nothing can rebuild it.
                    </>
                  ) : (
                    <>Nothing carries this campaign yet, so nothing is lost but the name.</>
                  )}
                </p>
                <div className="row">
                  <button className="chip" onClick={() => setConfirming(false)}>Keep it</button>
                  <button className="chip danger" disabled={busy} onClick={() => void destroy()}>
                    {busy ? 'Deleting…' : 'Delete it'}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Two doors, not five remembered steps. The Advisor is not in this
              loop — it reviews what a person wrote by hand — and listing it
              here as a stage made a three-step flow read as a five-step one. */}
          <div className="next">
            <a className="next-do" href="/templates">
              <b>Make the designs</b>
              <span>a poster per product, from the sheet</span>
            </a>
            <a className="next-do" href="/studio">
              <b>Write the posts</b>
              <span>captions and a script, steered by this brief</span>
            </a>
          </div>

          <div className="panel">
            <div className="kv"><span>Started</span><b>{day(report.campaign.created_at)}</b></div>
            <div className="kv"><span>Products promoted</span><b>{report.promoted.length}</b></div>
            <div className="kv">
              <span>Posts published</span>
              <b>{report.promoted.reduce((n, x) => n + x.posted, 0)}</b>
            </div>
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
                <tr><th>Product</th><th>Designs</th><th>Copy</th><th>Posted</th><th>Asked about</th></tr>
              </thead>
              <tbody>
                {report.promoted.map((p) => (
                  <tr key={p.sku}>
                    <td><a href={`/studio?sku=${encodeURIComponent(p.sku)}`}>{p.name}</a></td>
                    <td>{p.designs || '—'}</td>
                    <td>{p.drafts ? `${p.approved} of ${p.drafts} approved` : '—'}</td>
                    {/* A design exported and a design a customer saw are
                        different facts. This is the second one. */}
                    <td>{p.posted ? `${p.posted} post${p.posted === 1 ? '' : 's'}` : '—'}</td>
                    <td>{p.asked ? `${p.asked} conversation${p.asked === 1 ? '' : 's'}` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="hint">Nothing carries this campaign yet. Start above.</p>
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
