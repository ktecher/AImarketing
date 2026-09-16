/**
 * Per-feature dispatch between the local model and a connected cloud
 * provider (D97). Every call site that generates text imports this instead
 * of lib/ai/generate.ts directly.
 *
 * Deliberately does NOT export embed() — embeddings are never switchable
 * (see docs/superpowers/specs/2026-09-13-cloud-ai-provider-design.md), so a
 * call site that needs embeddings keeps importing lib/ai/generate.ts's
 * embed() directly, and this file cannot be reached for it by accident.
 */

import type { z } from 'zod'
import { resolve, type Feature } from '@/lib/ai/settings'
import {
  generate as localGenerate,
  generateJson as localGenerateJson,
  generateStream as localGenerateStream,
  MODELS,
} from '@/lib/ai/generate'
import {
  generate as cloudGenerate,
  generateJson as cloudGenerateJson,
  generateStream as cloudGenerateStream,
  DEFAULT_MODELS,
  type CloudProvider,
} from '@/lib/ai/cloud'

export type { Feature }

type Options = { maxTokens?: number; temperature?: number; system?: string }

async function cloudProviderFor(feature: Feature): Promise<CloudProvider | null> {
  const backend = await resolve(feature)
  if (backend.provider === 'local') return null
  if (!backend.apiKey) {
    throw new Error(`${feature} is set to ${backend.provider} but has no stored API key. Reconnect it in Settings.`)
  }
  return { name: backend.provider, apiKey: backend.apiKey, model: backend.model }
}

export async function generate(feature: Feature, prompt: string, opts: Options = {}): Promise<string> {
  const provider = await cloudProviderFor(feature)
  return provider ? cloudGenerate(prompt, opts, provider) : localGenerate(prompt, opts)
}

export async function generateJson<T>(
  feature: Feature,
  prompt: string,
  schema: z.ZodType<T>,
  jsonSchema: unknown,
  opts: Options = {},
): Promise<T> {
  const provider = await cloudProviderFor(feature)
  return provider
    ? cloudGenerateJson(prompt, schema, jsonSchema, opts, provider)
    : localGenerateJson(prompt, schema, jsonSchema, opts)
}

/**
 * Streamed text, per-feature (D95's campaign turn is the only caller).
 *
 * Anthropic and Google are answered whole and handed to `onDelta` in ONE
 * chunk rather than refused: the return value is identical either way, and a
 * caller that only wants the string cannot tell. The screen shows the reply
 * arriving at once instead of word by word, which is what it did before D95 —
 * a slower screen, not a broken one, and far better than a planner that throws
 * the moment somebody points a feature at Gemini.
 */
export async function generateStream(
  feature: Feature,
  prompt: string,
  opts: Options,
  onDelta: (text: string) => void,
): Promise<string> {
  const provider = await cloudProviderFor(feature)
  if (!provider) return localGenerateStream(prompt, opts, onDelta)
  if (provider.name === 'openai') return cloudGenerateStream(prompt, opts, onDelta, provider)
  const whole = await cloudGenerate(prompt, opts, provider)
  onDelta(whole)
  return whole
}

/**
 * Display-only: what this feature currently resolves to. Same resolution as
 * the calls above, no network request of its own — safe to call on every
 * render of a result that wants to say which model wrote it.
 */
export async function modelLabel(feature: Feature): Promise<string> {
  const backend = await resolve(feature)
  if (backend.provider === 'local') return MODELS.english
  return `${backend.provider}:${backend.model ?? DEFAULT_MODELS[backend.provider]}`
}
