'use client'

import { useCallback, useEffect, useState } from 'react'
import { why } from '@/lib/chat/reasons'

type Provenance = {
  retrieved_ids: string[]; cited_ids: string[]; model: string
  prompt_version: string; escalated: boolean; reason?: string
}
type Msg = { id: string; at: string; sender: 'customer' | 'bot' | 'rep'; text: string; provenance?: Provenance }
type Convo = {
  id: string; channel: string; started_at: string; escalated_at: string | null
  taken_over_by: string | null; campaign_id: string | null; messages: Msg[]
}


const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { hour12: false }).replace(',', '')

export default function Sales() {
  const [convos, setConvos] = useState<Convo[]>([])
  const [counts, setCounts] = useState({ total: 0, waiting: 0, mine: 0 })
  const [openId, setOpenId] = useState<string | null>(null)
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    try {
      const d = await fetch('/api/sales').then((r) => r.json())
      setConvos(d.conversations ?? [])
      setCounts(d.counts ?? { total: 0, waiting: 0, mine: 0 })
    } catch { setError('Could not load the inbox.') }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const open = convos.find((c) => c.id === openId) ?? null

  async function act(action: 'take' | 'reply' | 'release') {
    if (!open || busy) return
    setBusy(true); setError('')
    try {
      const res = await fetch('/api/sales', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: open.id, action, text: reply }),
      })
      const d = await res.json()
      if (!res.ok) setError(d.error ?? 'That did not work.')
      else { setReply(''); await refresh() }
    } catch { setError('That did not work.') }
    setBusy(false)
  }

  return (
    <main>
      <h1>Sales inbox</h1>
      <p className="sub">
        Every conversation the assistant had. The ones it could not answer are waiting for you.
      </p>

      <div className="stats">
        <div className="stat"><b>{counts.total}</b><span>conversations</span></div>
        <div className="stat">
          <b style={{ color: counts.waiting ? 'var(--warn)' : undefined }}>{counts.waiting}</b>
          <span>waiting for a person</span>
        </div>
        <div className="stat"><b>{counts.mine}</b><span>taken over</span></div>
      </div>

      {error && <p className="note bad">{error}</p>}
      {convos.length === 0 && <p className="sub">Nothing yet. Ask something at <b>/chat</b> and it appears here.</p>}

      <div className="grid2">
        <div>
          {convos.map((c) => {
            const first = c.messages.find((m) => m.sender === 'customer')?.text ?? '(no question)'
            const waiting = c.escalated_at && !c.taken_over_by
            return (
              <button
                key={c.id}
                className={`convo ${openId === c.id ? 'on' : ''}`}
                onClick={() => setOpenId(c.id === openId ? null : c.id)}
              >
                <span className="convo-top">
                  {waiting && <span className="badge over">waiting</span>}
                  {c.taken_over_by && <span className="badge part">{c.taken_over_by}</span>}
                  <span className="when">{when(c.messages[c.messages.length - 1]?.at ?? c.started_at)}</span>
                </span>
                <span className="convo-q">{first}</span>
                {/* The loop, visible from this end too: which campaign brought
                    this customer in. The id reads (D68), so no name lookup. */}
                <span className="convo-n">
                  {c.messages.length} messages{c.campaign_id ? ` · ${c.campaign_id}` : ''}
                </span>
              </button>
            )
          })}
        </div>

        {open && (
          <div className="panel">
            <div className="transcript">
              {open.messages.map((m) => (
                <div key={m.id} className={`bubble ${m.sender}`}>
                  {m.sender !== 'customer' && (
                    <b className="who">{m.sender === 'rep' ? (open.taken_over_by ?? 'colleague') : 'assistant'}</b>
                  )}
                  {m.text}
                  {m.provenance && (
                    <span className="prov">
                      {m.provenance.escalated
                        ? `could not answer — ${why(m.provenance.reason)}`
                        : `from ${m.provenance.cited_ids.join(', ') || 'the retrieved rows'}`}
                      {' · '}looked at {m.provenance.retrieved_ids.join(', ') || 'nothing'}
                      {' · '}{m.provenance.model} {m.provenance.prompt_version}
                    </span>
                  )}
                </div>
              ))}
            </div>

            <p className="note">
              {open.taken_over_by
                ? 'You have this one. The assistant has stopped answering it.'
                : 'Replying takes it over. The customer is not told — they just keep talking to the same window.'}
            </p>

            <div className="chat-box">
              <input
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void act('reply') }}
                placeholder="Reply to the customer"
                aria-label="Your reply"
              />
              <button onClick={() => void act('reply')} disabled={busy || !reply.trim()}>
                {busy ? 'Sending…' : 'Send'}
              </button>
            </div>
            {open.taken_over_by && (
              <button className="linkish" onClick={() => void act('release')}>
                hand it back to the assistant
              </button>
            )}
          </div>
        )}
      </div>
    </main>
  )
}
