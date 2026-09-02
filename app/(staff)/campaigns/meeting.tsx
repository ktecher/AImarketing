'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { SLOTS } from '@/lib/brief'
import type { Ask, Meeting, Plan } from '@/lib/meeting'
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
  const [id] = useState(newId)
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

  const [plan, setPlan] = useState<Plan | null>(null)
  const [planBusy, setPlanBusy] = useState(false)
  const [planError, setPlanError] = useState('')

  // Set once POST .../meeting {action:'create'} actually lands a row in
  // Postgres. Nothing before that point touches the database — a meeting is a
  // conversation on disk until this button is pressed.
  const [campaignId, setCampaignId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')

  const foot = useRef<HTMLDivElement>(null)
  // The newest turn is the one being read — same reasoning as the advisor's
  // thread. A twenty-second reply that lands below the fold reads as nothing
  // happened.
  useEffect(() => { foot.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [meeting])

  const send = useCallback(async (text: string) => {
    const say = text.trim()
    if (!say || busy) return
    setBusy(true); setError(''); setOffline(''); setSaid('')
    try {
      const res = await fetch('/api/campaigns/meeting', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, said: say }),
      })
      const d = await res.json()
      if (!res.ok) { setError(d.error ?? 'The planner could not answer.') } else {
        setMeeting(d.meeting)
        setAsk(d.ask ?? null)
        setEnough(Boolean(d.enough))
        setInvented(d.invented ?? [])
        setCaution(d.caution ?? [])
        if (d.offline) setOffline(d.offline)
      }
    } catch {
      setError('Ollama is not answering on localhost.')
    }
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

        {busy && <div className="turn advisor-turn"><p className="hint">Thinking…</p></div>}

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
                  <button key={s} className="chip" disabled={busy} onClick={() => void send(s)}>
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
                  if (said.trim()) void send(said)
                }
              }}
            />
          </label>
          <button className="btn" disabled={busy || !said.trim()} onClick={() => void send(said)}>
            {busy ? 'Thinking…' : 'Send'}
          </button>
        </div>

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
