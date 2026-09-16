/**
 * Which backend each feature uses, and the key it uses it with.
 *
 * One row per feature in `ai_settings`, plus a `global` row every feature set
 * to `'default'` resolves through. This file only reads and writes that
 * table -- it never calls a model. `lib/ai/route.ts` is the only caller.
 */

import { query } from '@/lib/db'
import { encrypt, decrypt } from '@/lib/social/tokens'

export const FEATURES = ['content_studio', 'advisor', 'sales_chat', 'campaigns'] as const
export type Feature = (typeof FEATURES)[number]

export type Provider = 'local' | 'openai' | 'anthropic' | 'google'

export type Backend = {
  provider: Provider
  /** null means: use that provider's own default model. */
  model: string | null
  /** null when provider is 'local'. */
  apiKey: string | null
}

type Row = { feature: string; provider: string; model: string | null; api_key_encrypted: string | null }

async function row(feature: string): Promise<Row | undefined> {
  const [r] = await query<Row>(
    'select feature, provider, model, api_key_encrypted from ai_settings where feature = $1',
    [feature],
  )
  return r
}

function toBackend(r: Row): Backend {
  return {
    provider: r.provider as Provider,
    model: r.model,
    apiKey: r.api_key_encrypted ? decrypt(r.api_key_encrypted) : null,
  }
}

async function globalRow(): Promise<Row> {
  const g = await row('global')
  if (!g) throw new Error('ai_settings has no "global" row -- run the migration: db/009_ai_settings.sql')
  return g
}

/** What a feature actually resolves to right now -- following 'default' to 'global' once. */
export async function resolve(feature: Feature): Promise<Backend> {
  const own = await row(feature)
  if (own && own.provider !== 'default') return toBackend(own)
  return toBackend(await globalRow())
}

/** Every row, resolved, for the Settings screen. */
export async function all(): Promise<
  { feature: 'global' | Feature; own: Backend & { raw: Provider | 'default' }; resolved: Backend }[]
> {
  const g = await globalRow()
  const out: { feature: 'global' | Feature; own: Backend & { raw: Provider | 'default' }; resolved: Backend }[] = [
    { feature: 'global', own: { ...toBackend(g), raw: g.provider as Provider }, resolved: toBackend(g) },
  ]
  for (const feature of FEATURES) {
    const r = (await row(feature)) ?? { feature, provider: 'default', model: null, api_key_encrypted: null }
    out.push({
      feature,
      own: { ...toBackend(r), raw: r.provider as Provider | 'default' },
      resolved: await resolve(feature),
    })
  }
  return out
}

/** Set the global default. `provider` may not be 'default' -- nothing is left for it to follow. */
export async function setGlobal(provider: Provider, opts: { model?: string; apiKey?: string } = {}): Promise<void> {
  await write('global', provider, opts)
}

/** Set one feature's own choice, or hand it back to `global` with provider 'default'. */
export async function setFeature(
  feature: Feature,
  provider: Provider | 'default',
  opts: { model?: string; apiKey?: string } = {},
): Promise<void> {
  await write(feature, provider, opts)
}

async function write(feature: string, provider: string, opts: { model?: string; apiKey?: string }): Promise<void> {
  const model = opts.model ?? null
  // ponytail: a save always needs the key resent when a cloud provider is
  // selected, even to change only the model -- there is no "keep the existing
  // key" sentinel. Simpler and safer (a key is never re-displayed to decide
  // whether to keep it); add one if re-entering the key on every model change
  // becomes real friction.
  const apiKeyEncrypted = provider === 'local' || provider === 'default'
    ? null
    : opts.apiKey ? encrypt(opts.apiKey) : null
  await query(
    `insert into ai_settings (feature, provider, model, api_key_encrypted, updated_at)
     values ($1, $2, $3, $4, now())
     on conflict (feature) do update set
       provider = excluded.provider, model = excluded.model,
       api_key_encrypted = excluded.api_key_encrypted, updated_at = now()`,
    [feature, provider, model, apiKeyEncrypted],
  )
}
