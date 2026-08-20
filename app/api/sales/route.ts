import { NextResponse } from 'next/server'
import { readJson } from '@/lib/http'
import { append, inbox, load, save } from '@/lib/chat/store'

export const runtime = 'nodejs'

/** Every conversation, newest activity first. Escalated ones are the queue. */
export async function GET() {
  const all = inbox()
  return NextResponse.json({
    conversations: all,
    counts: {
      total: all.length,
      waiting: all.filter((c) => c.escalated_at && !c.taken_over_by).length,
      mine: all.filter((c) => c.taken_over_by).length,
    },
  })
}

/**
 * A rep takes a conversation over, or replies in it.
 *
 * Taking over is silent by design — the customer is told nothing, and the
 * assistant simply stops answering. The alternative is a "you are now speaking
 * to a human" banner, which announces that the previous answers were not.
 */
export async function POST(req: Request) {
  const { id, action, text, who } = (await readJson(req)) as {
    id?: string; action?: 'take' | 'reply' | 'release'; text?: string; who?: string
  }
  if (!id) return NextResponse.json({ error: 'Which conversation?' }, { status: 400 })

  const c = load(id)
  if (!c) return NextResponse.json({ error: 'No such conversation.' }, { status: 404 })

  const rep = (who ?? '').trim() || 'a colleague'

  if (action === 'take') {
    c.taken_over_by = rep
  } else if (action === 'release') {
    c.taken_over_by = null
  } else if (action === 'reply') {
    if (!text?.trim()) return NextResponse.json({ error: 'Type a reply first.' }, { status: 400 })
    // Replying takes the conversation implicitly. A rep who types is in it,
    // and leaving the assistant answering alongside them is the failure that
    // makes the handover visible.
    c.taken_over_by = c.taken_over_by ?? rep
    // No provenance: these are a person's own words, and inventing a model
    // field for them would make the transcript lie about who said what.
    append(c, { sender: 'rep', text: text.trim() })
  } else {
    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
  }

  save(c)
  return NextResponse.json({ conversation: c })
}
