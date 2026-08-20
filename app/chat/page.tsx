'use client'

import { useEffect, useRef, useState } from 'react'

type Msg = { id: string; at: string; sender: 'customer' | 'bot' | 'rep'; text: string }

export default function Chat() {
  const [messages, setMessages] = useState<Msg[]>([])
  const [question, setQuestion] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [id, setId] = useState<string | null>(null)
  const [handed, setHanded] = useState(false)
  const end = useRef<HTMLDivElement>(null)

  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, busy])

  async function ask(text: string) {
    if (!text.trim() || busy) return
    setBusy(true); setError(''); setQuestion('')
    // Shown immediately. A customer who cannot see their own question assumes
    // the box swallowed it and types it again.
    setMessages((m) => [...m, { id: `local:${m.length}`, at: '', sender: 'customer', text }])
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: text, conversationId: id }),
      })
      const d = await res.json()
      if (!res.ok) setError(d.error ?? 'Something went wrong. Try again.')
      else {
        setId(d.conversationId)
        setMessages(d.conversation.messages)
        if (d.escalated) setHanded(true)
      }
    } catch {
      setError('Could not reach the assistant.')
    }
    setBusy(false)
  }

  return (
    <main className="chat-widget">
      <header>
        <b>Ask about a product</b>
        <span>Answers come from the catalogue. Prices are live.</span>
      </header>

      <div className="chat-log" role="log" aria-live="polite">
        {messages.length === 0 && !busy && (
          <div className="chat-empty">
            <p>Ask about a price, a discount, or what a product is.</p>
            <div className="chat-suggestions">
              {['How much is the Apple Pencil?', 'Is the AirPods 4 on sale?', 'What is the iPad Pro?'].map((s) => (
                <button key={s} onClick={() => void ask(s)}>{s}</button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) => (
          <div key={m.id} className={`bubble ${m.sender}`}>
            {m.sender === 'rep' && <b className="who">A colleague</b>}
            {m.text}
          </div>
        ))}

        {busy && <div className="bubble bot thinking">…</div>}
        <div ref={end} />
      </div>

      {handed && (
        <p className="chat-note">
          A colleague has been asked to pick this up. You can keep typing — they will see everything.
        </p>
      )}
      {error && <p className="chat-note bad">{error}</p>}

      <form
        className="chat-box"
        onSubmit={(e) => { e.preventDefault(); void ask(question) }}
      >
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Type your question"
          maxLength={500}
          aria-label="Your question"
          autoFocus
        />
        <button type="submit" disabled={busy || !question.trim()}>
          {busy ? 'Asking…' : 'Send'}
        </button>
      </form>
    </main>
  )
}
