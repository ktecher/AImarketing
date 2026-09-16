import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { readJson } from '@/lib/http'
import { answer, AskSchema } from '@/lib/chat/answer'
import { append, load, save, start, type Conversation } from '@/lib/chat/store'
import { current } from '@/lib/campaigns'

export const runtime = 'nodejs'
// One retrieval and one model call. Seconds warm, longer on the first question
// of the day while the model loads.
export const maxDuration = 300

/** Ids are filenames. The same guard lib/chat/store.ts applies to the path. */
const safe = (id: string) => /^[A-Za-z0-9_-]{1,64}$/.test(id)

/**
 * A conversation, for the widget resuming or a rep reading it.
 *
 * No ownership check, because this app has no user identity to check against.
 * The id IS the credential, so it has to be unguessable — see the mint in POST.
 * The conversations already on disk keep their old clock-derived ids and stay
 * enumerable; renaming a file a rep is waiting on in the Inbox costs more than
 * it buys.
 */
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

  // Same guard lib/chat/store.ts applies to the filename, hoisted to the route.
  // Below it, an id that fails safe() still ran the retrieval and the model —
  // 300 seconds of work — before save() threw and the request 500'd.
  if (conversationId && !safe(conversationId)) {
    return NextResponse.json({ error: 'No such conversation.' }, { status: 404 })
  }

  // Unguessable, because possession of the id is the only thing standing
  // between a visitor and someone else's transcript. This used to be a base36
  // stamp of the wall clock: increment it and GET above handed you the next
  // customer's chat, escalation state and all.
  const id = conversationId ?? randomUUID()
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
