// The router: local vs. cloud dispatch, proven by actually calling
// route.generate()/generateJson() with fetch replaced -- not inferred from
// modelLabel() alone. modelLabel resolves the SAME setting but never calls
// anything, so it cannot prove which backend a real call actually reaches;
// this test asserts the real call landed on the right host.
try { process.loadEnvFile('.env') } catch { /* no .env is normal on a clone */ }
process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString('base64')

// Dynamic, after the env is set -- static imports are hoisted ahead of the
// two lines above, same convention scripts/test-schedule.mjs already follows.
const { query } = await import('../lib/db.ts')
const { setGlobal, setFeature } = await import('../lib/ai/settings.ts')
const route = await import('../lib/ai/route.ts')
const { DEFAULT_MODELS } = await import('../lib/ai/cloud.ts')
const { z } = await import('zod')

let failed = 0
const ok = (label, cond, detail = '') => {
  if (!cond) failed++
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `   ${detail}` : ''}`)
}

let calls = []
globalThis.fetch = async (url) => {
  const u = new URL(String(url))
  calls.push({ host: u.host, path: u.pathname })
  if (u.host.startsWith('127.0.0.1') || u.host === 'localhost:11434') {
    return { ok: true, status: 200, json: async () => ({ response: 'hi from local' }) }
  }
  if (u.host === 'api.openai.com') {
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'hi from cloud' } }] }) }
  }
  throw new Error(`test stub: unexpected host ${u.host}`)
}

const before = await query('select * from ai_settings order by feature')

try {
  await setGlobal('local')
  await setFeature('content_studio', 'default')

  calls = []
  const localText = await route.generate('content_studio', 'hi')
  ok('generate: a local feature reaches Ollama', localText === 'hi from local', localText)
  ok('generate: local call hits the loopback host, not a provider',
     calls.length === 1 && (calls[0].host.startsWith('127.0.0.1') || calls[0].host === 'localhost:11434'),
     JSON.stringify(calls))

  const localModel = await route.modelLabel('content_studio')
  ok('modelLabel: local feature returns the Ollama model id', localModel === 'gemma4:12b', localModel)

  await setFeature('content_studio', 'openai', { apiKey: 'sk-x', model: 'gpt-4o-mini' })

  calls = []
  const cloudText = await route.generate('content_studio', 'hi')
  ok('generate: a cloud feature reaches the configured provider', cloudText === 'hi from cloud', cloudText)
  ok('generate: cloud call hits api.openai.com, not Ollama',
     calls.length === 1 && calls[0].host === 'api.openai.com', JSON.stringify(calls))

  const cloudModel = await route.modelLabel('content_studio')
  ok('modelLabel: cloud feature returns "provider:model"', cloudModel === 'openai:gpt-4o-mini', cloudModel)

  await setFeature('content_studio', 'openai', { apiKey: 'sk-x' })
  const cloudDefaultModel = await route.modelLabel('content_studio')
  ok('modelLabel: no stored model falls back to the provider default', cloudDefaultModel === `openai:${DEFAULT_MODELS.openai}`, cloudDefaultModel)

  // generateJson takes the same dispatch branch as generate -- one call
  // proves the branch, not the JSON parsing itself (test-ai-cloud.mjs and
  // the existing generate.ts suite already cover that).
  await setFeature('content_studio', 'default')
  await setGlobal('openai', { apiKey: 'sk-global' })
  calls = []
  globalThis.fetch = async (url) => {
    const u = new URL(String(url))
    calls.push({ host: u.host })
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"ok":true}' } }] }) }
  }
  const jsonResult = await route.generateJson('content_studio', 'hi', z.object({ ok: z.boolean() }), {})
  ok('generateJson: "default" following a cloud global also dispatches to cloud',
     jsonResult.ok === true && calls[0]?.host === 'api.openai.com', JSON.stringify({ jsonResult, calls }))

  await setGlobal('local')
  await setFeature('content_studio', 'default')
  ok('embed is not exported by route.ts', route.embed === undefined)
} finally {
  await query('delete from ai_settings')
  for (const row of before) {
    await query(
      'insert into ai_settings (feature, provider, model, api_key_encrypted, updated_at) values ($1,$2,$3,$4,$5)',
      [row.feature, row.provider, row.model, row.api_key_encrypted, row.updated_at],
    )
  }
}

if (failed) { console.error(`\n${failed} failed`); process.exit(1) }
console.log('\nall ok')
