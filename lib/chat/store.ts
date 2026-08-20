/**
 * Conversations on disk, in the shape `messages` will have.
 *
 * Files, like the rest of the project at this size — but the columns are the
 * irrecoverable ones from architecture.md, because no migration recovers a
 * history that was never written:
 *
 *   provenance {retrieved_ids, model, prompt_version}
 *       A customer says "your bot told me 40 KD" and you can find out why.
 *   sender ∈ customer | bot | rep
 *       Adding a human sender later changes the message shape in every consumer,
 *       so the rep is in the type from the first message, before /sales exists.
 *   channel, external_id
 *       D4: the widget is the product and no adapter interface is written, but
 *       the two columns cost nothing now and are a migration later.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export type Sender = 'customer' | 'bot' | 'rep'

export type Message = {
  id: string
  at: string
  sender: Sender
  text: string
  /** Only on a bot message. Null for a human's words — they have no provenance. */
  provenance?: {
    retrieved_ids: string[]
    cited_ids: string[]
    model: string
    prompt_version: string
    escalated: boolean
    reason?: string
  }
}

export type Conversation = {
  id: string
  channel: 'web'
  external_id: string | null
  started_at: string
  /** Set the moment the assistant cannot answer. This is the inbox's queue. */
  escalated_at: string | null
  /** A rep has picked it up. The customer is told nothing — D: silent takeover. */
  taken_over_by: string | null
  campaign_id: string | null
  messages: Message[]
}

const dir = () => join(process.cwd(), 'data/state/chat')
const pathFor = (id: string) => join(dir(), `${id}.json`)

/** Ids are filenames. A traversal here would read or write anywhere on disk. */
const safe = (id: string) => /^[A-Za-z0-9_-]{1,64}$/.test(id)

export function load(id: string): Conversation | null {
  if (!safe(id) || !existsSync(pathFor(id))) return null
  try {
    return JSON.parse(readFileSync(pathFor(id), 'utf8')) as Conversation
  } catch {
    return null
  }
}

export function save(c: Conversation): void {
  if (!safe(c.id)) throw new Error('Bad conversation id.')
  mkdirSync(dir(), { recursive: true })
  writeFileSync(pathFor(c.id), JSON.stringify(c, null, 2))
}

export function start(id: string, campaignId: string | null = null): Conversation {
  const now = new Date().toISOString()
  return {
    id, channel: 'web', external_id: null, started_at: now,
    escalated_at: null, taken_over_by: null, campaign_id: campaignId, messages: [],
  }
}

export function append(c: Conversation, m: Omit<Message, 'id' | 'at'>): Conversation {
  c.messages.push({ ...m, id: `${c.id}:${c.messages.length}`, at: new Date().toISOString() })
  // First failure to answer is what puts it in front of a person. Later ones do
  // not move it back down the queue.
  if (m.provenance?.escalated && !c.escalated_at) c.escalated_at = new Date().toISOString()
  return c
}

/** Everything a rep should see, newest activity first. */
export function inbox(): Conversation[] {
  const d = dir()
  if (!existsSync(d)) return []
  const out: Conversation[] = []
  for (const f of readdirSync(d).filter((f) => f.endsWith('.json'))) {
    try {
      out.push(JSON.parse(readFileSync(join(d, f), 'utf8')) as Conversation)
    } catch { /* one unreadable conversation must not hide the rest */ }
  }
  const last = (c: Conversation) => c.messages[c.messages.length - 1]?.at ?? c.started_at
  return out.sort((a, b) => last(b).localeCompare(last(a)))
}
