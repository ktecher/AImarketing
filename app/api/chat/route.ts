import { NextResponse } from 'next/server'
import { readJson } from '@/lib/http'
import { answer, AskSchema } from '@/lib/chat/answer'
import { append, load, save, start, type Conversation } from '@/lib/chat/store'
import { current } from '@/lib/campaigns'

export const runtime = 'nodejs'
// One retrieval and one model call. Seconds warm, longer on the first question
// of the day while the model loads.
export const maxDuration = 300

/** A conversation, for the widget resuming or a rep reading it. */
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Which conversation?' }, { status: 400 })
  const c = load(id)
  if (!c) return NextResponse.json({ error: 'No such conversation.' }, { status: 404 })
  return NextResponse.json({ conversation: c })
}

export async function POST(req: Request) {
  const parsed = AskSchema.safeParse(await readJson(req))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Type a question first.' }, { status: 400 })
  }
  const { question, conversationId } = parsed.data

  const id = conversationId ?? `c${Date.now().toString(36)}`
  // Stamped once, when the conversation begins, and never revisited — a customer
  // who started under one campaign belongs to that campaign even if a new one is
  // created mid-chat. `current()` swallows a database that is down: an unstamped
  // conversation is a gap in a report, a refused answer is a lost customer.
  const convo: Conversation = load(id) ?? start(id, await current())

  append(convo, { sender: 'customer', text: question })

  // A rep is in this conversation. The assistant stops talking the moment a
  // person takes it — two voices answering the same customer is the failure
  // that makes a takeover visible, and the whole point is that it is not.
  if (convo.taken_over_by) {
    save(convo)
    return NextResponse.json({ conversationId: id, waiting: true, conversation: convo })
  }

  const a = await answer(question)

  append(convo, {
    sender: 'bot',
    text: a.reply,
    provenance: {
      retrieved_ids: a.retrieved,
      cited_ids: a.cited,
      model: a.model,
      prompt_version: a.prompt_version,
      escalated: a.escalated,
      ...(a.reason ? { reason: a.reason } : {}),
    },
  })
  save(convo)

  return NextResponse.json({
    conversationId: id,
    reply: a.reply,
    escalated: a.escalated,
    conversation: convo,
  })
}
