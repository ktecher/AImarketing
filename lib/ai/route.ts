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
  MODELS,
} from '@/lib/ai/generate'
import {
  generate as cloudGenerate,
  generateJson as cloudGenerateJson,
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
 * Display-only: what this feature currently resolves to. Same resolution as
 * the calls above, no network request of its own — safe to call on every
 * render of a result that wants to say which model wrote it.
 */
export async function modelLabel(feature: Feature): Promise<string> {
  const backend = await resolve(feature)
  if (backend.provider === 'local') return MODELS.english
  return `${backend.provider}:${backend.model ?? DEFAULT_MODELS[backend.provider]}`
}
