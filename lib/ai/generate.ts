/**
 * The only file in this project that talks to a model.
 *
 * Everything else imports from here. That is what makes the localhost rule in
 * CLAUDE.md enforceable rather than aspirational — there is exactly one place a
 * request can originate, and it asserts its own destination at module load.
 */

import { z } from 'zod'

const BASE = process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434'

/**
 * Boot-time guard. Throws on import if inference is pointed anywhere but this
 * machine. Catalog rows and customer messages pass through here.
 */
function assertLoopback(url: string): void {
  let host: string
  try {
    host = new URL(url).hostname
  } catch {
    throw new Error(`OLLAMA_BASE_URL is not a valid URL: ${url}`)
  }
  const loopback =
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host === '[::1]' ||
    host.endsWith('.localhost')

  if (!loopback) {
    throw new Error(
      `Refusing to start: OLLAMA_BASE_URL points at "${host}", which is not this machine.\n` +
        `This project sends product catalogue rows and customer messages to the model.\n` +
        `Those must never leave localhost — see CLAUDE.md.\n` +
        `Set OLLAMA_BASE_URL=http://127.0.0.1:11434`,
    )
  }
}
assertLoopback(BASE)

export const MODELS = {
  /** Reads and critiques Arabic. Not the copywriter — see docs/decisions.md D7. */
  arabic: process.env.MODEL_AR ?? 'hf.co/mradermacher/Fanar-1-9B-Instruct-GGUF:Q4_K_M',
  /** English generation and structured output. */
  english: process.env.MODEL_EN ?? 'gemma4:12b',
  embed: process.env.MODEL_EMBED ?? 'bge-m3',
} as const

/** Models with a reasoning mode that must be switched off — see D16. */
const THINKS = /^(gemma4|qwen3|qwen3\.5)/

type Options = {
  model?: string
  /** Caps runaway generation. Omit for prose, set for structured calls. */
  maxTokens?: number
  /** Only raise for genuinely creative copy. Facts stay at 0. */
  temperature?: number
  system?: string
}

async function call(prompt: string, opts: Options & { format?: unknown }) {
  const model = opts.model ?? MODELS.english

  const body: Record<string, unknown> = {
    model,
    prompt,
    stream: false,
    options: {
      // Ollama's default is 2048-4096 and it SILENTLY TRUNCATES. Left unset,
      // retrieved catalogue rows fall out of the window and the result looks
      // exactly like a model-quality problem. The most common local-RAG footgun.
      num_ctx: 8192,
      temperature: opts.temperature ?? 0,
      ...(opts.maxTokens ? { num_predict: opts.maxTokens } : {}),
    },
  }
  if (opts.system) body.system = opts.system
  if (opts.format) body.format = opts.format

  // Measured 2026-08-19: gemma4:12b at defaults spent 281s and 8138 tokens on a
  // twelve-word caption request and returned an EMPTY response — the whole
  // budget went to reasoning. Same call with think:false takes 4.2s. See D16.
  if (THINKS.test(model)) body.think = false

  const res = await fetch(`${BASE}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    throw new Error(`Ollama ${res.status} for ${model}: ${await res.text()}`)
  }
  return (await res.json()) as { response: string; eval_count?: number }
}

/** Free-form generation. Use for prose; do not constrain it — see below. */
export async function generate(prompt: string, opts: Options = {}): Promise<string> {
  const { response } = await call(prompt, opts)
  return response.trim()
}

/**
 * Schema-constrained generation, validated on the way out.
 *
 * Ollama masks tokens that would violate the schema, so the SHAPE is guaranteed.
 * Nothing about the content is. Hence the Zod parse, and hence one retry with
 * the error fed back — then a visible failure. There is deliberately no tolerant
 * parser: for a solo maintainer with nobody watching logs, a partial result that
 * looks complete is worse than an error.
 *
 * Keep these calls small and separate from prose. Grammar-constrained decoding
 * measurably degrades writing quality, so generate copy freely first, then
 * structure it in a second cheap call.
 */
export async function generateJson<T>(
  prompt: string,
  schema: z.ZodType<T>,
  jsonSchema: unknown,
  opts: Options = {},
): Promise<T> {
  let lastError = ''

  for (let attempt = 0; attempt < 2; attempt++) {
    const p = attempt === 0 ? prompt : `${prompt}\n\nYour last reply was rejected: ${lastError}\nReturn valid JSON.`
    const { response } = await call(p, { ...opts, format: jsonSchema, maxTokens: opts.maxTokens ?? 500 })

    try {
      return schema.parse(JSON.parse(response))
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e)
    }
  }
  throw new Error(`Model returned unusable JSON twice.\nLast error: ${lastError}`)
}

/**
 * Verify a model's quoted span actually exists in the source text.
 *
 * The advisor must anchor every judgement to a quote. Checking that the quote is
 * real is a string operation — never ask the model to confirm its own grounding.
 */
export function isQuoted(span: string, source: string): boolean {
  if (!span) return true
  return source.includes(span)
}

/** Same idea for retrieval: cited SKUs must be a subset of what was retrieved. */
export function isGrounded(cited: string[], retrieved: string[]): boolean {
  const seen = new Set(retrieved)
  return cited.every((s) => seen.has(s))
}

export async function embed(input: string | string[]): Promise<number[][]> {
  const res = await fetch(`${BASE}/api/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODELS.embed, input }),
  })
  if (!res.ok) throw new Error(`Ollama embed ${res.status}: ${await res.text()}`)
  const { embeddings } = (await res.json()) as { embeddings: number[][] }
  return embeddings
}

/** Cosine similarity. Fine over a few hundred rows; pgvector when it is thousands. */
export function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1)
}
