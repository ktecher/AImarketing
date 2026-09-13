// scripts/test-ai-settings.mjs
//
// Resolution logic for ai_settings: 'default' follows global, an explicit
// per-feature choice ignores it, and keys round-trip through encryption.
//
// This table holds real configuration once the maintainer uses it, so every
// row this test touches is read back to its ORIGINAL value in a `finally` --
// never assume the last assertion is the last thing that runs.
try { process.loadEnvFile('.env') } catch { /* no .env is normal on a clone */ }
process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64')

// Dynamic, after the env is set -- static imports are hoisted ahead of the
// two lines above, same convention scripts/test-schedule.mjs already follows.
const { query } = await import('../lib/db.ts')
const { FEATURES, resolve, setGlobal, setFeature } = await import('../lib/ai/settings.ts')

let failed = 0
const ok = (label, cond, detail = '') => {
  if (!cond) failed++
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `   ${detail}` : ''}`)
}

const before = await query('select * from ai_settings order by feature')

try {
  await setGlobal('local')
  for (const f of FEATURES) await setFeature(f, 'default')

  const g1 = await resolve('content_studio')
  ok('default follows global (local)', g1.provider === 'local' && g1.apiKey === null)

  await setGlobal('openai', { apiKey: 'sk-test-global' })
  const g2 = await resolve('content_studio')
  ok('changing global moves every "default" feature', g2.provider === 'openai' && g2.apiKey === 'sk-test-global')

  await setFeature('sales_chat', 'local')
  const g3 = await resolve('sales_chat')
  ok('an explicit per-feature value ignores global', g3.provider === 'local' && g3.apiKey === null)

  const g4 = await resolve('content_studio')
  ok('other "default" features are unaffected by a sibling override', g4.provider === 'openai')

  await setFeature('advisor', 'anthropic', { apiKey: 'sk-ant-test', model: 'claude-3-5-sonnet-20241022' })
  const g5 = await resolve('advisor')
  ok('per-feature key round-trips through encryption', g5.apiKey === 'sk-ant-test')
  ok('per-feature model is stored', g5.model === 'claude-3-5-sonnet-20241022')

  await setFeature('advisor', 'default')
  const g6 = await resolve('advisor')
  ok('a feature can be handed back to "default"', g6.provider === 'openai')
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
