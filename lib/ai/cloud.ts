/**
 * The second (and last) file in this project permitted to talk to something
 * off this machine — see scripts/check-localhost.mjs and D97.
 *
 * Same shape as lib/ai/generate.ts's three calls, against whichever provider
 * a feature is switched to. No SDK: lib/social/cloudinary.ts and
 * lib/social/instagram.ts already made this call for the same reason — a
 * dependency, a bundle and an update treadmill for a handful of fetch calls.
 *
 * Nothing here reads lib/ai/settings.ts. It is handed credentials and calls
 * exactly the provider it is told to — same separation instagram.ts keeps
 * from social/store.ts.
 */

import { z } from 'zod'

export type CloudProviderName = 'openai' | 'anthropic' | 'google'

export type CloudProvider = {
  name: CloudProviderName
  apiKey: string
  /** null means: use DEFAULT_MODELS[name]. */
  model: string | null
}

/**
 * Placeholders. Confirm each is still the provider's current recommended
 * small/cheap chat model before shipping — these change often. Fully
 * overridable per feature via ai_settings.model regardless.
 */
export const DEFAULT_MODELS: Record<CloudProviderName, string> = {
  openai: 'gpt-4o-mini',
  anthropic: 'claude-3-5-sonnet-20241022',
  google: 'gemini-1.5-flash',
}

type Options = { temperature?: number; maxTokens?: number; system?: string }

function modelOf(provider: CloudProvider): string {
  return provider.model ?? DEFAULT_MODELS[provider.name]
}

// ── OpenAI ──────────────────────────────────────────────────────────────────

async function openaiCall(
  prompt: string,
  opts: Options & { format?: unknown },
  provider: CloudProvider,
  stream: boolean,
) {
  const messages = [
    ...(opts.system ? [{ role: 'system', content: opts.system }] : []),
    { role: 'user', content: prompt },
  ]
  const body: Record<string, unknown> = {
    model: modelOf(provider),
    messages,
    stream,
    temperature: opts.temperature ?? 0,
    ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
    ...(opts.format ? { response_format: { type: 'json_schema', json_schema: { name: 'result', strict: true, schema: opts.format } } } : {}),
  }
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${provider.apiKey}` },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`OpenAI ${res.status} for ${modelOf(provider)}: ${await res.text()}`)
  return res
}

// ── Anthropic ────────────────────────────────────────────────────────────────

/** JSON Schema's `object`/`properties` shape is what Anthropic's tool `input_schema` expects verbatim. */
async function anthropicCall(
  prompt: string,
  opts: Options & { format?: unknown },
  provider: CloudProvider,
  stream: boolean,
) {
  const body: Record<string, unknown> = {
    model: modelOf(provider),
    max_tokens: opts.maxTokens ?? 1024,
    temperature: opts.temperature ?? 0,
    stream,
    ...(opts.system ? { system: opts.system } : {}),
    messages: [{ role: 'user', content: prompt }],
    ...(opts.format
      ? {
          tools: [{ name: 'emit', description: 'Emit the result.', input_schema: opts.format }],
          tool_choice: { type: 'tool', name: 'emit' },
        }
      : {}),
  }
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': provider.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`Anthropic ${res.status} for ${modelOf(provider)}: ${await res.text()}`)
  return res
}

// ── Google ───────────────────────────────────────────────────────────────────

async function googleCall(
  prompt: string,
  opts: Options & { format?: unknown },
  provider: CloudProvider,
  stream: boolean,
) {
  const body: Record<string, unknown> = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    ...(opts.system ? { systemInstruction: { parts: [{ text: opts.system }] } } : {}),
    generationConfig: {
      temperature: opts.temperature ?? 0,
      ...(opts.maxTokens ? { maxOutputTokens: opts.maxTokens } : {}),
      ...(opts.format ? { responseMimeType: 'application/json', responseSchema: opts.format } : {}),
    },
  }
  const method = stream ? 'streamGenerateContent' : 'generateContent'
  const qs = stream ? '&alt=sse' : ''
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${modelOf(provider)}:${method}?key=${provider.apiKey}${qs}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
  )
  if (!res.ok) throw new Error(`Google ${res.status} for ${modelOf(provider)}: ${await res.text()}`)
  return res
}

// ── Dispatch ─────────────────────────────────────────────────────────────────

async function call(
  prompt: string,
  opts: Options & { format?: unknown },
  provider: CloudProvider,
  stream: boolean,
) {
  if (provider.name === 'openai') return openaiCall(prompt, opts, provider, stream)
  if (provider.name === 'anthropic') return anthropicCall(prompt, opts, provider, stream)
  return googleCall(prompt, opts, provider, stream)
}

function textOf(provider: CloudProviderName, json: any): string {
  if (provider === 'openai') return json.choices?.[0]?.message?.content ?? ''
  if (provider === 'anthropic') return json.content?.find((b: any) => b.type === 'text')?.text ?? ''
  return json.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? '').join('') ?? ''
}

function jsonOf(provider: CloudProviderName, json: any): string {
  if (provider === 'anthropic') {
    const use = json.content?.find((b: any) => b.type === 'tool_use')
    return use ? JSON.stringify(use.input) : ''
  }
  return textOf(provider, json)
}

export async function generate(prompt: string, opts: Options, provider: CloudProvider): Promise<string> {
  const res = await call(prompt, opts, provider, false)
  return textOf(provider.name, await res.json())
}

/**
 * Same retry-twice-then-fail-visibly contract as lib/ai/generate.ts's
 * generateJson. Kept as a small local copy rather than a shared helper —
 * fifteen lines duplicated once is cheaper than a third module two callers
 * would have to agree on.
 */
export async function generateJson<T>(
  prompt: string,
  schema: z.ZodType<T>,
  jsonSchema: unknown,
  opts: Options,
  provider: CloudProvider,
): Promise<T> {
  let lastError = ''
  for (let attempt = 0; attempt < 2; attempt++) {
    const p = attempt === 0 ? prompt : `${prompt}\n\nYour last reply was rejected: ${lastError}\nReturn valid JSON.`
    const res = await call(p, { ...opts, format: jsonSchema }, provider, false)
    const raw = jsonOf(provider.name, await res.json())
    try {
      return schema.parse(JSON.parse(raw))
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e)
    }
  }
  throw new Error(`${provider.name} returned unusable JSON twice.\nLast error: ${lastError}`)
}

/**
 * Each provider's SSE framing differs; only OpenAI's is implemented for the
 * delta shape used by streaming callers today (the advisor and meeting
 * screens, which are always local — see D97 scope). This throws rather than
 * silently falling back to a full non-streaming call, so a future caller that
 * turns on Anthropic/Google streaming finds out immediately rather than
 * shipping a UI that never streams.
 * ponytail: OpenAI-only streaming; add Anthropic/Google SSE parsing if a
 * cloud-routed feature needs streamed output.
 */
export async function generateStream(
  prompt: string,
  opts: Options,
  onDelta: (text: string) => void,
  provider: CloudProvider,
): Promise<string> {
  if (provider.name !== 'openai') {
    throw new Error(`Streaming is not implemented for ${provider.name} yet — switch this feature to OpenAI or local for streamed output.`)
  }
  const res = await call(prompt, opts, provider, true)
  if (!res.body) throw new Error('OpenAI returned no body to stream.')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let out = ''

  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue
      const payload = trimmed.slice(5).trim()
      if (payload === '[DONE]') continue
      const chunk = JSON.parse(payload)
      const delta = chunk.choices?.[0]?.delta?.content
      if (delta) {
        out += delta
        onDelta(delta)
      }
    }
  }
  return out
}
