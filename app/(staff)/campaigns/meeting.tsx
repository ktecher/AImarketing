'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { SLOTS } from '@/lib/brief'
import type { Ask, Meeting, Plan, Step } from '@/lib/meeting'
import type { Slot } from '@/lib/brief'
import type { Check } from '@/lib/content/guard'

/**
 * Written out rather than derived: these are the same nine questions
 * `QUESTION_FOR` in lib/meeting.ts asks, just short enough for a quiet label
 * rather than the full instruction sent to the model.
 */
const SLOT_LABEL: Record<Slot, string> = {
  pushing: 'Pushing',
  special: "What's special",
  objective: 'Objective',
  audience: 'Audience',
  budget: 'Budget',
  channels: 'Channels',
  when: 'When',
  offer: 'Offer',
  constraints: 'Constraints',
}

/** Ids are filenames in lib/meeting.ts. Generated once per meeting, never reused. */
const newId = () => `m-${crypto.randomUUID().slice(0, 8)}`

/** The same shape lib/meeting.ts and the route both insist on. */
const safeId = (id: string) => /^[A-Za-z0-9_-]{1,64}$/.test(id)

/**
 * The meeting this tab is in, from the URL.
 *
 * `useState(newId)` minted a fresh id on every mount and wrote it nowhere, so a
 * meeting became unreachable the instant this component unmounted: pressing
 * "Or fill the brief in yourself" and then "← Talk it through instead" lost six
 * turns, and so did a refresh. The transcripts sat in data/state/meeting/*.json
 * forever, unlisted and undeletable. The query string is the whole fix — GET
 * /api/campaigns/meeting already existed for exactly this and nothing called it.
 */
const idFromUrl = () => {
  if (typeof window === 'undefined') return newId()
  const from = new URLSearchParams(window.location.search).get('meeting')
  return from && safeId(from) ? from : newId()
}

/** A turn in flight. Every field is null until the step that fills it. */
type Live = {
  matched: boolean | null
  noted: Partial<Record<Slot, string>> | null
  slot: Slot | null
  text: string
}

type Props = {
  /**
   * Called once the meeting actually becomes a campaign — the orchestrator's
   * hook to switch the page over to it. Optional: this component works with
   * nobody listening, it just stops being reachable from the list until a
   * reload.
   */
  onCreated?: (campaignId: string) => void
}

export default function CampaignMeeting({ onCreated }: Props = {}) {
  // Settable, because "start over" is a new meeting in the same component
  // rather than a remount — the parent has no reason to know a conversation was
  // abandoned.
  const [id, setId] = useState(idFromUrl)
  // Two states rather than a window.confirm: the confirmation has to say how
  // much is being thrown away, and a native dialog cannot. Same pattern the
  // campaign delete already uses.
  const [scrapping, setScrapping] = useState(false)
  const [meeting, setMeeting] = useState<Meeting | null>(null)
  const [said, setSaid] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [offline, setOffline] = useState('')
  const [ask, setAsk] = useState<Ask | null>(null)
  const [enough, setEnough] = useState(false)
  // Held from the LATEST turn only — the server does not store these on the
  // meeting file, because they are a fact about the prose just written, not
  // about the meeting as a whole. An older turn's caution is not re-shown.
  const [invented, setInvented] = useState<string[]>([])
  const [caution, setCaution] = useState<Check[]>([])
  /**
   * The turn happening right now: what it found, what it wrote down, what it
   * decided to ask, and the reply as it arrives.
   *
   * Cleared when the turn lands, because the reply itself is then on screen and
   * this would be a second copy of it. Nothing about it is saved anywhere — a
   * turn in flight is the only thing it describes.
   */
  const [live, setLive] = useState<Live | null>(null)

  const [plan, setPlan] = useState<Plan | null>(null)
  const [planBusy, setPlanBusy] = useState(false)
  const [planError, setPlanError] = useState('')

  // Set once POST .../meeting {action:'create'} actually lands a row in
  // Postgres. Nothing before that point touches the database — a meeting is a
  // conversation on disk until this button is pressed.
  const [campaignId, setCampaignId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')

  /**
   * Put the id in the URL, and pull back whatever is already under it.
   *
   * Both halves of the same fix. The id in the query string survives a refresh
   * and a remount; the GET is what makes arriving with one mean anything. A 404
   * is the ordinary case — a brand new meeting has no file yet — so it leaves
   * the screen exactly as it found it rather than reporting an error.
   *
   * `ask` is deliberately not restored: it is not stored on the meeting, and
   * the last planner turn already ends with the question in its own words. The
   * chips come back on the next turn.
   */
  useEffect(() => {
    const url = new URL(window.location.href)
    if (url.searchParams.get('meeting') !== id) {
      url.searchParams.set('meeting', id)
      window.history.replaceState(null, '', url)
    }
    let live = true
    void fetch(`/api/campaigns/meeting?id=${encodeURIComponent(id)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const back: Meeting | undefined = d?.meeting
        if (!live || !back) return
        setMeeting(back)
        setPlan(back.plan ?? null)
        setCampaignId(back.campaign_id ?? null)
        // Whether anything is still missing is a fact about the slots, the same
        // fact `nextSlot()` computes on the server. Read here rather than
        // imported: lib/meeting.ts reaches Postgres, and importing one function
        // from it puts a database driver in the browser bundle — the trap
        // lib/brief.ts documents and this file already sidesteps for SLOTS.
        setEnough(SLOTS.filter((s) => s !== 'constraints').every((s) => back.known[s]?.trim()))
      })
      .catch(() => {})
    return () => { live = false }
  }, [id])

  const foot = useRef<HTMLDivElement>(null)
  // The newest turn is the one being read — same reasoning as the advisor's
  // thread. A twenty-second reply that lands below the fold reads as nothing
  // happened.
  useEffect(() => { foot.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [meeting])

  /**
   * One turn, read as it happens.
   *
   * The route sends events rather than a body: three about what the planner is
   * doing, then the reply a few characters at a time, then the finished `Reply`
   * — which is the same object this used to get from `res.json()`, so
   * everything below the last line of this function is unchanged.
   *
   * Read with a reader rather than an `EventSource`, which can only GET. Events
   * are separated by a blank line and a network chunk ends wherever it ends, so
   * a partial event stays in the buffer until the rest of it arrives.
   */
  const send = useCallback(async (text: string) => {
    const say = text.trim()
    if (!say || busy) return
    setBusy(true); setError(''); setOffline(''); setSaid('')
    setLive({ matched: null, noted: null, slot: null, text: '' })
    try {
      const res = await fetch('/api/campaigns/meeting', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, said: say }),
      })
      if (!res.ok || !res.body) {
        setError('The planner could not answer.')
      } else {
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const events = buffer.split('\n\n')
          buffer = events.pop() ?? ''
          for (const event of events) {
            const line = event.replace(/^data: /, '').trim()
            if (!line) continue
            const d = JSON.parse(line) as { step?: Step; done?: Record<string, unknown>; error?: string }
            if (d.error) { setError(d.error); continue }
            if (d.step) {
              const step = d.step
              setLive((was) => {
                const now = was ?? { matched: null, noted: null, slot: null, text: '' }
                if (step.at === 'shelf') return { ...now, matched: step.matched }
                if (step.at === 'noted') return { ...now, noted: step.known }
                if (step.at === 'asking') return { ...now, slot: step.slot }
                return { ...now, text: now.text + step.delta }
              })
            }
            if (d.done) {
              const out = d.done as {
                meeting: Meeting; ask?: Ask | null; enough?: boolean
                invented?: string[]; caution?: Check[]; offline?: string
              }
              setMeeting(out.meeting)
              setAsk(out.ask ?? null)
              setEnough(Boolean(out.enough))
              setInvented(out.invented ?? [])
              setCaution(out.caution ?? [])
              if (out.offline) setOffline(out.offline)
            }
          }
        }
      }
    } catch {
      setError('Ollama is not answering on localhost.')
    }
    setLive(null)
    setBusy(false)
  }, [id, busy])

  const writePlan = useCallback(async () => {
    if (planBusy) return
    setPlanBusy(true); setPlanError('')
    try {
      const res = await fetch('/api/campaigns/meeting', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action: 'plan' }),
      })
      const d = await res.json()
      if (!res.ok) setPlanError(d.error ?? 'Could not write the plan.')
      else setPlan(d.plan as Plan)
    } catch {
      setPlanError('Ollama is not answering on localhost.')
    }
    setPlanBusy(false)
  }, [id, planBusy])

  /**
   * The only call in this file that writes to Postgres. A 409 still names the
   * campaign that already exists — treated as success, not an error, so a
   * double-click (or a slow first click retried) cannot read as having lost
   * the work.
   */
  const create = useCallback(async () => {
    if (creating || campaignId) return
    setCreating(true); setCreateError('')
    try {
      const res = await fetch('/api/campaigns/meeting', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action: 'create' }),
      })
      const d = await res.json()
      const landed: string | undefined = d.campaign?.id ?? d.campaign_id
      if (landed) { setCampaignId(landed); onCreated?.(landed) }
      else setCreateError(d.error ?? 'Could not create the campaign.')
    } catch {
      setCreateError('Could not reach the server.')
    }
    setCreating(false)
  }, [id, creating, campaignId, onCreated])

  /**
   * Abandon this meeting and begin a new one.
   *
   * The transcript is deleted only when it never became a campaign. Once it has,
   * the file is the record of how that campaign got its brief, so a new meeting
   * starts alongside it rather than on top of it — the server refuses the
   * deletion in that case anyway, and this keeps the screen from asking for
   * something it will not get.
   */
  const startOver = useCallback(async () => {
    if (!campaignId) {
      // A failure here must not strand the person in a conversation they have
      // said they are done with. The file is theirs to lose; the fresh meeting
      // is the thing they asked for.
      await fetch(`/api/campaigns/meeting?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
        .catch(() => {})
    }
    setId(newId())
    setMeeting(null); setSaid(''); setAsk(null); setEnough(false)
    setInvented([]); setCaution([]); setLive(null); setError(''); setOffline('')
    setPlan(null); setPlanError(''); setCreateError(''); setCampaignId(null)
    setScrapping(false)
  }, [id, campaignId])

  const turns = meeting?.turns ?? []
  const known = meeting?.known ?? {}
  const knownSlots = SLOTS.filter((s) => known[s]?.trim())
  // Two columns only once there is something to put in the second one — an
  // empty "plan so far" panel beside a one-line thread is a hole, not a UI.
  const hasSide = knownSlots.length > 0 || plan !== null

  return (
    <div className={hasSide ? 'grid2' : undefined}>
      <div>
        {turns.map((t, i) => (
          t.role === 'you' ? (
            <div className="turn you" key={i}><p>{t.text}</p></div>
          ) : (
            <div className="turn advisor-turn" key={i}><p className="said">{t.text}</p></div>
          )
        ))}

        {/* What "Thinking…" used to be. Every line here is something that
            actually happened, in the order it happened: three of the four steps
            of a turn are settled before the model writes a word, and they were
            invisible for the fifteen seconds somebody spent waiting on them. */}
        {busy && live && (
          <div className="turn advisor-turn">
            <p className="hint">
              {live.matched === null
                ? 'Searching the catalogue…'
                : live.matched
                  ? 'Found matching products in the catalogue.'
                  : 'Nothing in the catalogue matches this.'}
              {live.matched !== null && !live.noted && ' Reading back what you said…'}
              {live.noted && ` Noted ${SLOTS.filter((x) => live.noted?.[x]?.trim()).map((x) => SLOT_LABEL[x].toLowerCase()).join(', ') || 'nothing yet'}.`}
              {live.noted && live.slot !== null && ` Asking about ${SLOT_LABEL[live.slot].toLowerCase()} next.`}
              {live.noted && !live.text && ' Writing…'}
            </p>
            {live.text && <p className="said">{live.text}</p>}
          </div>
        )}

        {offline && <p className="notice warn-notice">{offline}</p>}
        {error && <p className="note bad">{error}</p>}

        {invented.length > 0 && (
          <p className="notice warn-notice">
            The planner wrote {invented.map((f) => `“${f}”`).join(', ')} — figures nobody gave
            it. Nobody has checked these; do not repeat them.
          </p>
        )}

        {caution.length > 0 && (
          <div className="rewrites">
            <b>Careful with this</b>
            {caution.map((c, i) => (
              <div className="blocker" key={i}>
                {c.span && <q>{c.span}</q>}
                <b>{c.name}</b>
                {c.hint && <span>{c.hint}</span>}
              </div>
            ))}
          </div>
        )}

        {/* One question, never a form. Hidden while a turn is in flight so it
            cannot be mistaken for something still answerable this instant. */}
        {ask && !busy && (
          <div className="asks">
            {/* The planner's prose already ends with this question, in its own
                words — printing the canonical one too puts two questions on
                screen and the person answers whichever they read first. It is
                shown only when there IS no prose, which is the offline turn:
                then it is the only thing telling them what to say next. */}
            {turns[turns.length - 1]?.role !== 'planner' && <p>{ask.question}</p>}
            {ask.suggestions.length > 0 && (
              <div className="chips">
                {ask.suggestions.map((s) => (
                  <button key={s} className="chip" disabled={busy || planBusy} onClick={() => void send(s)}>
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Not on screen at all until the planner says it has enough. The
            person presses this — it never fires on its own. */}
        {enough && !busy && (
          <p style={{ marginTop: 14 }}>
            <button className="btn" disabled={planBusy} onClick={() => void writePlan()}>
              {planBusy ? 'Writing the plan…' : plan ? 'Write it again' : 'Write the plan'}
            </button>
          </p>
        )}
        {planError && <p className="note bad">{planError}</p>}

        {/* The last step, and the only one that writes to Postgres. It is a
            separate press from writing the plan on purpose: a plan is a draft
            somebody reads, and a campaign is stamped on every design and
            caption made from here on. */}
        {plan && !campaignId && (
          <p style={{ marginTop: 14 }}>
            <button className="btn" disabled={creating} onClick={() => void create()}>
              {creating ? 'Creating…' : `Create “${plan.name}”`}
            </button>
          </p>
        )}
        {createError && <p className="note bad">{createError}</p>}
        {campaignId && (
          <p className="notice">
            Created <b>{plan?.name ?? campaignId}</b>. Everything designed, written and posted
            from now on is counted against it.
          </p>
        )}

        {/* Always here, even with chips on screen — somebody will want to say
            something the chips do not cover. Shift+Enter for a line break,
            plain Enter sends. */}
        <div className="row reply-row" style={{ alignItems: 'flex-end' }}>
          <label className="fld" style={{ flex: '1 1 320px', marginBottom: 0 }}>
            <span className="sr">What would you like to say?</span>
            <textarea
              rows={2}
              value={said}
              placeholder={turns.length ? 'Say more, or answer above' : 'What is the campaign?'}
              onChange={(e) => setSaid(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  // Not while the plan is being written. Writing the plan is two
                  // model calls and takes about a minute, and a turn sent during
                  // it used to race the plan's own save — whichever finished
                  // last reverted the other, while the screen went on showing
                  // both from React state. The server merges now; this stops the
                  // race being started at all.
                  if (said.trim() && !planBusy) void send(said)
                }
              }}
            />
          </label>
          <button className="btn" disabled={busy || planBusy || !said.trim()} onClick={() => void send(said)}>
            {busy ? 'Thinking…' : 'Send'}
          </button>
        </div>

        {/* Quiet, and only once there is something to abandon. It sits under
            Send rather than beside it: one is what you do every turn, the other
            is what you do once, and putting them together makes the wrong one
            easy to hit. */}
        {turns.length > 0 && !busy && (
          <p className="hint" style={{ marginTop: 10 }}>
            {!scrapping ? (
              <button className="linkish" onClick={() => setScrapping(true)}>
                {campaignId ? 'Start another meeting' : 'Start over'}
              </button>
            ) : (
              <>
                {campaignId
                  ? 'Begin a new meeting? This one stays — it is how the campaign got its brief.'
                  : `Throw away ${turns.length === 1 ? 'this turn' : `these ${turns.length} turns`} and start again? It cannot be undone.`}
                {' '}
                <button className="linkish" onClick={() => void startOver()}>
                  {campaignId ? 'Yes, new meeting' : 'Yes, start over'}
                </button>
                {' · '}
                <button className="linkish" onClick={() => setScrapping(false)}>Keep it</button>
              </>
            )}
          </p>
        )}

        <div ref={foot} />
      </div>

      {hasSide && (
        <div>
          {/* Read-only facts the planner has gathered — not a form. Filling one
              in here would suggest it can be typed over, and it cannot; it only
              changes by saying so in the thread. */}
          {knownSlots.length > 0 && (
            <div className="panel compact">
              <span className="pillar">What&rsquo;s established</span>
              {knownSlots.map((s) => (
                <div className="kv" key={s}><span>{SLOT_LABEL[s]}</span><b>{known[s]}</b></div>
              ))}
            </div>
          )}

          {plan && (
            <div className="panel">
              <h2 style={{ marginTop: 0 }}>{plan.name}</h2>
              <span className="pillar">The proposition</span>
              <p style={{ fontFamily: 'var(--font-h)', fontSize: 24, fontWeight: 600, lineHeight: 1.3, margin: '4px 0 18px' }}>
                {plan.say}
              </p>

              <div className="kv"><span>Objective</span><b>{plan.objective}</b></div>
              <div className="kv"><span>Audience</span><b>{plan.audience}</b></div>
              <div className="kv"><span>Offer</span><b>{plan.offer}</b></div>
              <div className="kv"><span>When</span><b>{plan.shape}</b></div>
              <div className="kv"><span>Budget, as given</span><b>{plan.budget || '—'}</b></div>

              <h2>Channels</h2>
              <ul className="list">
                {plan.channels.map((c) => (
                  <li key={c.channel}><b>{c.channel}</b> — {c.role}</li>
                ))}
              </ul>

              {/* Every figure here came from split() in lib/spend.ts against the
                  budget the person typed. Rendered verbatim — never parsed,
                  never summed, never turned into a percentage in this file. */}
              {plan.spend.length > 0 ? (
                <>
                  <h2>Spend</h2>
                  <table>
                    <thead><tr><th>Item</th><th>Why</th><th>Amount</th></tr></thead>
                    <tbody>
                      {plan.spend.map((s) => (
                        <tr key={s.item}>
                          <td>{s.item}</td>
                          <td>{s.why}</td>
                          <td className="num">{s.text}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              ) : (
                <p className="hint">No budget figure was given, so there is nothing to split.</p>
              )}

              <h2>How we&rsquo;ll know it worked</h2>
              <ul className="list">
                {plan.measure.map((m) => <li key={m}>{m}</li>)}
              </ul>

              {/* Required, not decorative — timely/README.md is explicit that a
                  trend's date travels with it into the UI rather than staying a
                  hidden assumption. */}
              {plan.kuwait_context_as_of && (
                <p className="hint">Kuwait context as of {plan.kuwait_context_as_of}.</p>
              )}

              {/* The working-out behind everything above it, which used to be
                  generated and dropped. Labelled as thinking, not as plan: it
                  is not checked by the guards the fields are, and nothing here
                  reaches a caption or the campaign's context. */}
              {plan.reasoning && (
                <details className="last-said" style={{ marginTop: 14 }}>
                  <summary>How it thought about this</summary>
                  <pre>{plan.reasoning}</pre>
                </details>
              )}

              {plan.invented.length > 0 && (
                <p className="notice warn-notice">
                  The plan wrote {plan.invented.map((f) => `“${f}”`).join(', ')} — figures
                  nobody gave it. Replace or delete them before this goes anywhere.
                </p>
              )}

              {plan.caution.length > 0 && (
                <div className="rewrites">
                  <b>Careful with this plan</b>
                  {plan.caution.map((c, i) => (
                    <div className="blocker" key={i}>
                      {c.span && <q>{c.span}</q>}
                      <b>{c.name}</b>
                      {c.hint && <span>{c.hint}</span>}
                    </div>
                  ))}
                </div>
              )}
              {/* The Create button lives in the thread column, beside the rest
                  of what the person presses — this panel is the plan itself,
                  read-only. */}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
