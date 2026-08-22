/**
 * The content studio: social copy from the same rows the designs come from.
 *
 * Two generations per request, each in two passes — prose first, structure
 * second. Grammar-constrained decoding measurably degrades writing, so the
 * model writes freely and a second cheap call sorts what it wrote into fields.
 *
 * English only, deliberately. No open model writes convincing Kuwaiti dialect,
 * and mediocre Arabic does not look broken — it looks correct and foreign,
 * which reads worse than English to this audience. See
 * knowledge/kuwait/evergreen/tone-and-dialect.md and docs/decisions.md D7.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { generate, generateJson, MODELS } from '@/lib/ai/generate'
import { check, blockers, fill, tokensFor, type Check } from './guard'

/** Bump when a prompt changes. Stored on every piece, so old drafts stay explicable. */
export const PROMPT_VERSION = 'content/v3'

export type Channel = 'instagram' | 'snapchat' | 'tiktok'

/**
 * What each channel actually rewards. Only conventions stable over months —
 * anything with a precise number belongs in knowledge/kuwait/timely/ with a
 * source and a date. See knowledge/kuwait/evergreen/channels-and-platforms.md.
 */
const CHANNELS: Record<Channel, { label: string; brief: string }> = {
  instagram: {
    label: 'Instagram',
    brief:
      'The first line sits above the "more" fold and is the only line most people read. ' +
      'One clear call to action. Caption up to about 30 words.',
  },
  snapchat: {
    label: 'Snapchat',
    brief:
      'Reaches roughly half of Kuwait and is not a secondary channel here. The hook must ' +
      'land within one to two seconds or the swipe hurts distribution. Very short, spoken, direct.',
  },
  tiktok: {
    label: 'TikTok',
    brief:
      'Watch time and completion decide distribution. Much viewing is muted, so the meaning ' +
      'has to survive with the sound off. Conversational, never an announcement.',
  },
}

/** The compliance rules, read from their source rather than paraphrased here. */
function guardrails(): string {
  const p = join(process.cwd(), 'knowledge/kuwait/compliance-guardrails.md')
  return existsSync(p) ? readFileSync(p, 'utf8') : ''
}

/** Only fields with a value. An empty column offered to the model invites invention. */
function factSheet(values: Record<string, unknown>): string {
  // display_name, not name_en. It resolves to the catalogue title when nobody
  // has shortened the product yet, so this is never empty — but once somebody
  // has, the caption stops carrying a 55-character title mid-sentence.
  const KEEP = ['sku', 'display_name', 'brand', 'category']
  const lines: string[] = []
  for (const k of KEEP) {
    const v = values[k]
    if (v !== undefined && v !== null && v !== '') lines.push(`${k}: ${v}`)
  }
  // Prices are named but never valued here. The model is told a price EXISTS so
  // it can write a sentence around it; it is never shown the figure, because a
  // figure it has seen is a figure it will paraphrase.
  if (values.price_now !== undefined) lines.push('price_now: (a price exists — write {price_now})')
  const now = Number(values.price_now), was = Number(values.price_was)
  if (Number.isFinite(now) && Number.isFinite(was) && was > now) {
    lines.push('price_was: (this product is discounted — you may write {price_was} and {discount_pct})')
  }
  // Deliberately last and deliberately blunt: the fact sheet doubles as the
  // placeholder vocabulary, so a field it does not list is a field that fails.
  lines.push('sku: (internal — never appears in copy)')

  // The description sits OUTSIDE the field list, under its own heading. Listed
  // as `description_en: ...` alongside the others, the model reads it as one
  // more placeholder and writes {description_en} — which substitutes a spec
  // dump into the middle of a sentence. Measured: three captions out of three.
  const desc = values.description_en
  if (desc) {
    lines.push(
      '',
      'WHAT IT DOES — background only. Say this in your own words.',
      'It is NOT a field and NOT a placeholder; writing {description_en} is a rejected draft.',
      String(desc),
    )
  }
  return lines.join('\n')
}

/**
 * The campaign's "this week's context" rides along when there is one, fenced.
 *
 * architecture.md: it is where marketing pastes what they already know is
 * trending, because nothing offline can know it. So it steers angle and tone and
 * may name the offer — a person typed it and a person approves the copy — but it
 * is not a second fact sheet: the no-number rule outranks it, or "free bag with
 * every laptop over 300 KD" walks a figure straight past the catalogue.
 */
const rules = (values: Record<string, unknown>, context = '') => `
You are writing retail social copy for a consumer electronics shop in Kuwait, in English.

FACTS YOU MAY USE — nothing else is true:
${factSheet(values)}
${context ? `
THIS WEEK, FROM MARKETING — the campaign's angle, typed in by a person:
${context}

Use it for the angle, the tone, and the offer it describes. It is not a fact
sheet: the no-number rule below applies to it too, and nothing in it changes a
price, a spec, or what the product is.
` : ''}

NEVER WRITE A NUMBER. Not a price, not a percentage, not a spec, not a size, not a year.
Where a fact belongs, write its field name in braces, exactly as spelled above — the system
substitutes the catalogue value. The only ones that exist for this product are:
${tokensFor(values).map((t) => `{${t}}`).join(' ')}
A digit you type is a rejected draft, and so is a field name that is not on that list.

Do not state a specification, stock level, delivery time or availability that is not listed above.
Write plainly. No emoji strings, no invented awards, no fake urgency.

${guardrails()}
`.trim()

const CopySchema = z.object({
  slogans: z.array(z.string()).min(1).max(3),
  captions: z.array(z.string()).min(1).max(3),
  hashtags: z.array(z.string()).min(3).max(10),
})

const ScriptSchema = z.object({
  hook: z.string(),
  body: z.string(),
  say: z.string(),
  avoid: z.array(z.string()).min(1).max(5),
})

export type Script = z.infer<typeof ScriptSchema>

export type Piece = {
  id: string
  sku: string
  kind: 'slogan' | 'caption' | 'hashtags' | 'script'
  /** Row-per-language, per docs/architecture.md. English only for now. */
  lang: 'en'
  channel: Channel
  /** The draft as written, placeholders intact. Substitution happens at read time. */
  text: string
  script?: Script
  checks: Check[]
  status: 'draft' | 'approved'
  /** Which of these a human actually wrote, once they start editing. */
  source: 'model' | 'human'
  model: string
  prompt_version: string
  /** Threaded from the start. Bolted on later it is a backfilled number. */
  campaign_id: string | null
  created_at: string
  approved_at?: string
}

/**
 * One product, one channel, a full set of drafts.
 *
 * Failing checks do not throw. A blocked draft is more useful on screen than in
 * a stack trace — the person approving can see what the model reached for, and
 * approval is refused separately. What throws is unusable JSON, twice.
 */
export async function draft(
  values: Record<string, unknown>,
  channel: Channel,
  campaignId: string | null = null,
  campaignContext = '',
): Promise<Piece[]> {
  const base = rules(values, campaignContext)
  const ch = CHANNELS[channel]
  const now = new Date().toISOString()
  const sku = String(values.sku ?? '')

  const [copyProse, scriptProse] = await Promise.all([
    generate(
      `${base}\n\nCHANNEL — ${ch.label}. ${ch.brief}\n\n` +
        `Write, for this one product:\n` +
        `- three slogans, at most six words each. Do NOT use the product name in a slogan — ` +
        `it is already printed on the design, and it is a catalogue title, not a headline\n` +
        `- three captions in the register described above. Use the product name once at most\n` +
        `- eight hashtags, English or transliterated, no numbers\n\n` +
        `Write them as a plain list. Do not explain your choices.`,
      // The only genuinely creative call in the project. Facts stay at 0; this
      // one is choosing phrasing, and at 0 it writes the same caption every time.
      { temperature: 0.8 },
    ),
    generate(
      `${base}\n\nCHANNEL — ${ch.label}. ${ch.brief}\n\n` +
        `Write a short vertical video script for a person holding this product on camera:\n` +
        `- the hook: the first line spoken, under two seconds\n` +
        `- the body: what happens in the middle, in two or three sentences\n` +
        `- what to say: the exact line that carries the offer\n` +
        `- what NOT to say: things a presenter would reach for that break the rules above, ` +
        `specific to this product rather than generic. Only things that are NOT already in ` +
        `the script you just wrote — a warning against a line you yourself wrote reads as a ` +
        `contradiction to whoever is on camera\n\n` +
        `The footage is filmed by a person. Do not describe effects or transitions.`,
      { temperature: 0.7 },
    ),
  ])

  const [copy, script] = await Promise.all([
    generateJson(
      `Sort this copy into fields. Change nothing about the wording — keep placeholders like {price_now} exactly as written. Drop anything that is a heading, a note, or an explanation.\n\n${copyProse}`,
      CopySchema,
      z.toJSONSchema(CopySchema),
      { maxTokens: 700 },
    ),
    generateJson(
      `Sort this video script into fields. Change nothing about the wording — keep placeholders like {price_now} exactly as written.\n\n${scriptProse}`,
      ScriptSchema,
      z.toJSONSchema(ScriptSchema),
      { maxTokens: 700 },
    ),
  ])

  const meta = {
    sku, lang: 'en' as const, channel,
    status: 'draft' as const, source: 'model' as const,
    model: MODELS.english, prompt_version: PROMPT_VERSION,
    campaign_id: campaignId, created_at: now,
  }

  const pieces: Piece[] = []
  copy.slogans.forEach((text, i) =>
    pieces.push({ ...meta, id: `${sku}:slogan:${i}`, kind: 'slogan', text, checks: check(text, values) }))
  copy.captions.forEach((text, i) =>
    pieces.push({ ...meta, id: `${sku}:caption:${i}`, kind: 'caption', text, checks: check(text, values) }))

  // Hashtags are one piece, not eight. They are approved and copied together.
  const tags = copy.hashtags.map((t) => (t.startsWith('#') ? t : `#${t}`)).join(' ')
  pieces.push({ ...meta, id: `${sku}:hashtags:0`, kind: 'hashtags', text: tags, checks: check(tags, values) })

  const scriptText = [script.hook, script.body, script.say].join('\n')
  pieces.push({
    ...meta, id: `${sku}:script:0`, kind: 'script',
    text: scriptText, script,
    // The avoid list is advice to a presenter, not copy to publish. Checking it
    // would flag the very words it exists to warn about.
    checks: check(scriptText, values),
  })

  return pieces
}

/** A draft with its catalogue values substituted, ready to read or copy. */
export const filled = (p: Piece, values: Record<string, unknown>) => fill(p.text, values)

/* ── Storage ──────────────────────────────────────────────────────────────
 * One file per SKU, carrying the columns docs/architecture.md names for
 * content_pieces. No schema is committed until the vocabulary settles, and the
 * studio is what settles it — but the fields are written now so the first
 * migration is an insert rather than a backfill.
 */

const dir = () => join(process.cwd(), 'data/state/content')
const file = (sku: string) => join(dir(), `${sku.replace(/[^\w.-]/g, '_')}.json`)

export function load(sku: string): Piece[] {
  const p = file(sku)
  if (!existsSync(p)) return []
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as Piece[]
  } catch {
    return []
  }
}

export function save(sku: string, pieces: Piece[]): void {
  mkdirSync(dir(), { recursive: true })
  writeFileSync(file(sku), JSON.stringify(pieces, null, 2))
}

/** Approval is refused while any check fails. That is the whole gate. */
export function approve(sku: string, id: string, values: Record<string, unknown>): Piece[] {
  const pieces = load(sku)
  const piece = pieces.find((p) => p.id === id)
  if (!piece) throw new Error(`No draft ${id}.`)

  // Re-checked here rather than trusted from the stored draft — the text may
  // have been edited since, and a check that ran before the edit proves nothing.
  piece.checks = check(piece.text, values)
  const failed = blockers(piece.checks)
  if (failed.length) {
    throw new Error(`Cannot approve: ${failed.map((c) => c.name).join(', ')}.`)
  }
  piece.status = 'approved'
  piece.approved_at = new Date().toISOString()
  save(sku, pieces)
  return pieces
}

/** Every stored piece, across every product. For the export and the counters. */
export function allPieces(): Piece[] {
  const d = dir()
  if (!existsSync(d)) return []
  const out: Piece[] = []
  for (const f of readdirSync(d).filter((f) => f.endsWith('.json'))) {
    try {
      out.push(...(JSON.parse(readFileSync(join(d, f), 'utf8')) as Piece[]))
    } catch { /* an unreadable file is not a reason to lose the rest */ }
  }
  return out
}

/** Which products already have copy, for the picker. */
export function coverage(): Record<string, { drafts: number; approved: number }> {
  const d = dir()
  if (!existsSync(d)) return {}
  const out: Record<string, { drafts: number; approved: number }> = {}
  for (const f of readdirSync(d).filter((f) => f.endsWith('.json'))) {
    try {
      const pieces = JSON.parse(readFileSync(join(d, f), 'utf8')) as Piece[]
      if (!pieces.length) continue
      const approved = pieces.filter((p) => p.status === 'approved').length
      // Drafts are what is NOT approved. Returning the total here printed
      // "8 drafts · 4 approved" for a product holding 4 of each.
      out[pieces[0].sku] = { drafts: pieces.length - approved, approved }
    } catch { /* an unreadable file is not a reason to hide the rest */ }
  }
  return out
}
