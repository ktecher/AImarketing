/**
 * Which backend each feature uses, from the Settings screen.
 *
 * A key is validated with one cheap call to the provider BEFORE it is saved —
 * catching a bad key here means the next customer message or advisor review
 * is the first time anyone finds out, instead of a save that looked fine.
 */
import { NextResponse } from 'next/server'
import { reachable } from '@/lib/db'
import { readJson } from '@/lib/http'
import { all, setGlobal, setFeature, FEATURES, type Feature, type Provider } from '@/lib/ai/settings'
import { generate as cloudGenerate } from '@/lib/ai/cloud'

export const runtime = 'nodejs'

/** Never send a stored key back to the browser — only whether one exists. */
function mask(rows: Awaited<ReturnType<typeof all>>) {
  return rows.map((r) => ({
    feature: r.feature,
    provider: r.own.raw,
    model: r.own.model,
    hasKey: r.own.apiKey !== null,
    resolvedProvider: r.resolved.provider,
    resolvedModel: r.resolved.model,
  }))
}

export async function GET() {
  if (!(await reachable())) {
    return NextResponse.json({ up: false, rows: [], error: 'Postgres is not answering. Run: npm run db:up' }, { status: 503 })
  }
  return NextResponse.json({ up: true, rows: mask(await all()) })
}

export async function PUT(req: Request) {
  const body = await readJson<{ feature: string; provider: string; model?: string; apiKey?: string }>(req)
  const feature = body.feature
  const provider = body.provider as Provider | 'default'

  if (feature !== 'global' && !FEATURES.includes(feature as Feature)) {
    return NextResponse.json({ error: `Unknown feature "${feature}".` }, { status: 400 })
  }
  const validProviders: (Provider | 'default')[] = ['local', 'openai', 'anthropic', 'google', 'default']
  if (!validProviders.includes(provider)) {
    return NextResponse.json({ error: `Unknown provider "${provider}".` }, { status: 400 })
  }
  if (feature === 'global' && provider === 'default') {
    return NextResponse.json({ error: 'The global default cannot be "default" — it has nothing to follow.' }, { status: 400 })
  }

  if (provider !== 'local' && provider !== 'default') {
    if (!body.apiKey) {
      return NextResponse.json({ error: `An API key is required to use ${provider}.` }, { status: 400 })
    }
    try {
      await cloudGenerate('Say "ok".', { maxTokens: 5 }, { name: provider, apiKey: body.apiKey, model: body.model ?? null })
    } catch (e) {
      return NextResponse.json(
        { error: `Could not verify that key with ${provider}: ${e instanceof Error ? e.message : 'unknown error'}` },
        { status: 400 },
      )
    }
  }

  try {
    if (feature === 'global') {
      await setGlobal(provider as Provider, { model: body.model, apiKey: body.apiKey })
    } else {
      await setFeature(feature as Feature, provider, { model: body.model, apiKey: body.apiKey })
    }
  } catch (e) {
    return NextResponse.json(
      { error: `Could not save: ${e instanceof Error ? e.message : 'the database rejected this write'}. If Postgres is down, run: npm run db:up` },
      { status: 503 },
    )
  }

  return NextResponse.json({ ok: true, rows: mask(await all()) })
}
