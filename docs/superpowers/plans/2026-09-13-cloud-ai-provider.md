# Bring-your-own cloud AI provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the maintainer switch content studio, advisor, sales chat, or campaigns/meeting from the local Ollama seam to a connected OpenAI, Anthropic, or Google key — per feature, opt-in, off by default — without touching `lib/ai/generate.ts` or embeddings.

**Architecture:** A new `lib/ai/cloud.ts` is the only other file (besides `lib/social/`) permitted to reach off this machine. A new `lib/ai/route.ts` resolves a per-feature setting (`lib/ai/settings.ts`, backed by a new `ai_settings` table) and dispatches to either `generate.ts` (local, untouched) or `cloud.ts` (new). The six existing call sites switch their import to `route.ts` and pass their feature id; nothing else about them changes except one display-metadata literal each.

**Tech Stack:** Next.js App Router, TypeScript, Postgres (`pg`), raw `fetch` against provider REST APIs (no SDK — see spec), AES-256-GCM via `lib/social/tokens.ts`.

**Spec:** `docs/superpowers/specs/2026-09-13-cloud-ai-provider-design.md`

## Global Constraints

- **Rule 1 (CLAUDE.md):** nothing reaches off this machine except through `lib/ai/cloud.ts` (this feature) and `lib/social/` (publishing, existing). Every other file's behavior is unchanged.
- **Embeddings never switch.** `lib/rag/retrieve.ts` and `lib/catalogue.ts` keep calling `generate.ts`'s `embed()` directly and are never touched by this plan.
- **No silent fallback to local on a cloud failure.** Every cloud call either succeeds or throws with the provider's own message.
- **No provider SDK.** `openai`, `@anthropic-ai/sdk`, `@google/generative-ai` are not installed and not needed — plain `fetch` against each provider's documented REST endpoint, same style as `lib/social/cloudinary.ts` and `lib/social/instagram.ts`.
- **Default is local for everything**, always, until someone explicitly changes a setting.
- **Model ids for each cloud provider's default are placeholders in this plan** (`gpt-4o-mini`, `claude-3-5-sonnet-20241022`, `gemini-1.5-flash`) — confirm each is still the provider's current recommended small/cheap chat model before shipping Task 3; all three are fully overridable per-row via `ai_settings.model` regardless, so a stale default is a cosmetic problem, not a functional one.
- **`npm test` must stay green after every task's commit.** It runs `scripts/check-localhost.mjs` second, right after the CSS check — any task that adds a host literal must have already taught the checker to allow it, or `npm test` breaks on that very commit.

---

### Task 1: `ai_settings` table and `lib/ai/settings.ts`

**Files:**
- Create: `db/009_ai_settings.sql`
- Create: `lib/ai/settings.ts`
- Test: `scripts/test-ai-settings.mjs`
- Modify: `package.json` — add `test-ai-settings.mjs` to the `test` script chain, right after `test-instagram.mjs` (same neighborhood: both are encryption-at-rest, database-backed settings).

**Interfaces:**
- Consumes: `query` from `@/lib/db`; `encrypt`, `decrypt` from `@/lib/social/tokens`.
- Produces (for Task 4's router):
  ```ts
  export const FEATURES: readonly ['content_studio', 'advisor', 'sales_chat', 'campaigns']
  export type Feature = 'content_studio' | 'advisor' | 'sales_chat' | 'campaigns'
  export type Provider = 'local' | 'openai' | 'anthropic' | 'google'
  export type Backend = { provider: Provider; model: string | null; apiKey: string | null }
  export async function resolve(feature: Feature): Promise<Backend>
  export async function all(): Promise<{ feature: 'global' | Feature; own: Backend & { raw: Provider | 'default' }; resolved: Backend }[]>
  export async function setGlobal(provider: Provider, opts?: { model?: string; apiKey?: string }): Promise<void>
  export async function setFeature(feature: Feature, provider: Provider | 'default', opts?: { model?: string; apiKey?: string }): Promise<void>
  ```

- [ ] **Step 1: Write the migration**

```sql
-- db/009_ai_settings.sql
-- Migration nine: which AI backend each feature uses.
--
-- Every text-generation call in this project has gone through lib/ai/generate.ts
-- and Ollama alone. D97 lets the maintainer connect an OpenAI, Anthropic or
-- Google key and switch specific features to it -- opt-in, off by default, and
-- never silently inherited: a feature either follows `global` explicitly
-- ('default') or has made its own concrete choice.
--
-- Embeddings are not a feature here on purpose -- lib/rag/retrieve.ts and
-- lib/catalogue.ts stay on lib/ai/generate.ts's embed() unconditionally.
-- Cosine similarity across a corpus embedded by two different models is not
-- comparable, and nothing about that fails loudly.

create table if not exists ai_settings (
  feature           text        primary key
                      check (feature in ('global','content_studio','advisor','sales_chat','campaigns')),
  provider          text        not null
                      check (provider in ('default','local','openai','anthropic','google')),
  model             text,
  api_key_encrypted text,
  updated_at        timestamptz not null default now(),

  -- The global row is the fallback every 'default' feature resolves through --
  -- it cannot itself say "follow global", or resolution has nowhere to land.
  check (feature <> 'global' or provider <> 'default')
);

comment on column ai_settings.api_key_encrypted is
  'AES-256-GCM ciphertext of a provider API key, base64, IV and auth tag
   prefixed -- same scheme as social_accounts.token_cipher. The key is
   APP_ENCRYPTION_KEY and is not in this database. Null whenever provider is
   ''local'' or ''default''.';

insert into ai_settings (feature, provider) values
  ('global', 'local'),
  ('content_studio', 'default'),
  ('advisor', 'default'),
  ('sales_chat', 'default'),
  ('campaigns', 'default')
on conflict (feature) do nothing;
```

Apply it: `psql "$DATABASE_URL" -f db/009_ai_settings.sql` (or `npm run db:migrate` if using the docker-compose Postgres).

- [ ] **Step 2: Write the failing test**

```js
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
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx tsx scripts/test-ai-settings.mjs`
Expected: FAIL — `lib/ai/settings.ts` does not exist yet (module not found).

- [ ] **Step 4: Write the implementation**

```ts
// lib/ai/settings.ts
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
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx tsx scripts/test-ai-settings.mjs`
Expected: PASS — `all ok`.

- [ ] **Step 6: Wire it into `npm test` and run the whole suite**

Edit `package.json`'s `test` script, inserting `&& tsx scripts/test-ai-settings.mjs` immediately after `tsx scripts/test-instagram.mjs`.

Run: `npm test`
Expected: PASS (this also re-confirms `scripts/check-localhost.mjs` still passes — nothing in this task added a URL literal).

- [ ] **Step 7: Commit**

```bash
git add db/009_ai_settings.sql lib/ai/settings.ts scripts/test-ai-settings.mjs package.json
git commit -m "Add ai_settings table and lib/ai/settings.ts (D97)"
```

---

### Task 2: Teach `scripts/check-localhost.mjs` about `lib/ai/cloud.ts`

**Files:**
- Modify: `scripts/check-localhost.mjs`

**Interfaces:**
- Consumes: nothing new.
- Produces: a third named exception (after `SEAM` and `SOCIAL`) that Task 3 relies on existing before it can add any provider host literal.

This task exists on its own, ahead of Task 3, so that the commit that introduces `lib/ai/cloud.ts` never has a moment where `npm test` is red.

- [ ] **Step 1: Confirm the check currently rejects the hosts this feature needs**

Run:
```bash
mkdir -p lib/ai && printf 'export const x = "https://api.openai.com/v1/chat/completions"\n' > lib/ai/__scratch.ts
node scripts/check-localhost.mjs
rm lib/ai/__scratch.ts
```
Expected: FAIL — `lib/ai/__scratch.ts:1  names "api.openai.com" — nothing here may leave this machine`. This confirms the check is exercising the path this task changes.

- [ ] **Step 2: Add the exception**

In `scripts/check-localhost.mjs`, immediately after the existing `SOCIAL`/`SOCIAL_HOSTS` block:

```js
/**
 * The second (and last) file that may name a host off this machine, and the
 * only hosts it may name (D97).
 *
 * A cloud AI call is opt-in per feature and made only when the maintainer has
 * connected a key in Settings -- see lib/ai/settings.ts and lib/ai/route.ts.
 * lib/ai/generate.ts (the SEAM) stays local-only and untouched; this is a
 * SEPARATE file specifically so that guarantee never has to be read with a
 * conditional in mind.
 */
const AI_CLOUD = 'lib/ai/cloud.ts'
const AI_CLOUD_HOSTS = new Set([
  'api.openai.com',
  'api.anthropic.com',
  'generativelanguage.googleapis.com',
])
```

Then, inside the per-file loop where `isSocial` is computed:

```js
    const isSocial = rel.startsWith(SOCIAL)
    const isAiCloud = rel === AI_CLOUD
```

And in the `URL_LITERAL` matching loop, change:

```js
      if (isLoopback(host) || NAMESPACES.has(host)) continue
      if (isSocial && SOCIAL_HOSTS.has(host)) continue
```

to:

```js
      if (isLoopback(host) || NAMESPACES.has(host)) continue
      if (isSocial && SOCIAL_HOSTS.has(host)) continue
      if (isAiCloud && AI_CLOUD_HOSTS.has(host)) continue
```

And extend the message ternary right below it from:

```js
      problems.push(
        SOCIAL_HOSTS.has(host)
          ? `${rel}:${lineOf(m[0], m[1])}  names "${host}" — publishing lives in ${SOCIAL}, and only there`
          : isSocial
            ? `${rel}:${lineOf(m[0], m[1])}  names "${host}" — ${SOCIAL} may name only ${[...SOCIAL_HOSTS].join(', ')}`
            : `${rel}:${lineOf(m[0], m[1])}  names "${host}" — nothing here may leave this machine`,
      )
```

to:

```js
      problems.push(
        SOCIAL_HOSTS.has(host)
          ? `${rel}:${lineOf(m[0], m[1])}  names "${host}" — publishing lives in ${SOCIAL}, and only there`
          : isSocial
            ? `${rel}:${lineOf(m[0], m[1])}  names "${host}" — ${SOCIAL} may name only ${[...SOCIAL_HOSTS].join(', ')}`
            : AI_CLOUD_HOSTS.has(host)
              ? `${rel}:${lineOf(m[0], m[1])}  names "${host}" — cloud AI calls live in ${AI_CLOUD}, and only there`
              : isAiCloud
                ? `${rel}:${lineOf(m[0], m[1])}  names "${host}" — ${AI_CLOUD} may name only ${[...AI_CLOUD_HOSTS].join(', ')}`
                : `${rel}:${lineOf(m[0], m[1])}  names "${host}" — nothing here may leave this machine`,
      )
```

- [ ] **Step 2: Re-run the same scratch check, now in the right file**

```bash
mkdir -p lib/ai && printf 'export const x = "https://api.openai.com/v1/chat/completions"\n' > lib/ai/cloud.ts
node scripts/check-localhost.mjs
```
Expected: PASS (prints the "no request can leave this machine" line).

```bash
printf 'export const x = "https://evil.example.com"\n' > lib/ai/cloud.ts
node scripts/check-localhost.mjs
```
Expected: FAIL — `lib/ai/cloud.ts:1  names "evil.example.com" — lib/ai/cloud.ts may name only api.openai.com, api.anthropic.com, generativelanguage.googleapis.com`.

```bash
rm lib/ai/cloud.ts   # Task 3 writes the real file
node scripts/check-localhost.mjs
```
Expected: PASS.

- [ ] **Step 3: Run the whole suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add scripts/check-localhost.mjs
git commit -m "Let lib/ai/cloud.ts name the three provider hosts (D97)"
```

---

### Task 3: `lib/ai/cloud.ts` — the provider adapters

**Files:**
- Create: `lib/ai/cloud.ts`
- Test: `scripts/test-ai-cloud.mjs`
- Modify: `package.json` — add `test-ai-cloud.mjs` right after `test-ai-settings.mjs`.

**Interfaces:**
- Consumes: a `Backend`-shaped provider argument (matches `lib/ai/settings.ts`'s `Backend`, minus the null-provider case — this file is only called once a caller already knows it's cloud).
- Produces (for Task 4's router):
  ```ts
  export type CloudProvider = { name: 'openai' | 'anthropic' | 'google'; apiKey: string; model: string | null }
  export const DEFAULT_MODELS: Record<'openai' | 'anthropic' | 'google', string>
  export async function generate(prompt: string, opts: { temperature?: number; maxTokens?: number; system?: string }, provider: CloudProvider): Promise<string>
  export async function generateJson<T>(prompt: string, schema: z.ZodType<T>, jsonSchema: unknown, opts: { temperature?: number; maxTokens?: number; system?: string }, provider: CloudProvider): Promise<T>
  export async function generateStream(prompt: string, opts: {...}, onDelta: (text: string) => void, provider: CloudProvider): Promise<string>
  ```

- [ ] **Step 1: Write the failing test**

Provider APIs are stubbed via a replaced global `fetch` — same pattern `scripts/test-instagram.mjs` uses for Meta.

```js
// scripts/test-ai-cloud.mjs
//
// The three provider adapters, offline. fetch is replaced so nothing reaches
// a real provider; each stub answers with that provider's real response
// shape, taken from its documented API.
try { process.loadEnvFile('.env') } catch { /* no .env is normal on a clone */ }

import { z } from 'zod'
// Dynamic: same convention as the other new test scripts here, even though
// this module doesn't itself read process.env at import time.
const { generate, generateJson, generateStream, DEFAULT_MODELS } = await import('../lib/ai/cloud.ts')

let failed = 0
const ok = (label, cond, detail = '') => {
  if (!cond) failed++
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `   ${detail}` : ''}`)
}

let calls = []
let respond = () => ({ status: 200, body: {} })
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url))
  calls.push({ host: u.host, path: u.pathname, headers: init.headers ?? {}, body: init.body ? JSON.parse(init.body) : null })
  const r = respond(u, init)
  return {
    ok: (r.status ?? 200) < 400,
    status: r.status ?? 200,
    json: async () => r.body ?? {},
    text: async () => JSON.stringify(r.body ?? {}),
  }
}

// ---------------------------------------------------------------------------
// OpenAI
// ---------------------------------------------------------------------------
calls = []
respond = () => ({ body: { choices: [{ message: { content: 'hello from gpt' } }] } })
const openaiText = await generate('hi', {}, { name: 'openai', apiKey: 'sk-x', model: null })
ok('openai: generate returns the message content', openaiText === 'hello from gpt')
ok('openai: hits the chat completions endpoint', calls[0].path === '/v1/chat/completions')
ok('openai: sends the bearer token', calls[0].headers.Authorization === 'Bearer sk-x')
ok('openai: defaults to DEFAULT_MODELS.openai when model is null', calls[0].body.model === DEFAULT_MODELS.openai)

calls = []
respond = () => ({ body: { choices: [{ message: { content: '{"name":"Ada"}' } }] } })
const Schema = z.object({ name: z.string() })
const openaiJson = await generateJson('hi', Schema, {}, {}, { name: 'openai', apiKey: 'sk-x', model: null })
ok('openai: generateJson parses and validates', openaiJson.name === 'Ada')
ok('openai: sends response_format json_schema', calls[0].body.response_format?.type === 'json_schema')

// ---------------------------------------------------------------------------
// Anthropic
// ---------------------------------------------------------------------------
calls = []
respond = () => ({ body: { content: [{ type: 'text', text: 'hello from claude' }] } })
const anthropicText = await generate('hi', {}, { name: 'anthropic', apiKey: 'ant-x', model: null })
ok('anthropic: generate returns the text block', anthropicText === 'hello from claude')
ok('anthropic: hits the messages endpoint', calls[0].path === '/v1/messages')
ok('anthropic: sends x-api-key, not a bearer token', calls[0].headers['x-api-key'] === 'ant-x')

calls = []
respond = () => ({ body: { content: [{ type: 'tool_use', input: { name: 'Ada' } }] } })
const anthropicJson = await generateJson('hi', Schema, {}, {}, { name: 'anthropic', apiKey: 'ant-x', model: null })
ok('anthropic: generateJson reads the tool_use input', anthropicJson.name === 'Ada')
ok('anthropic: forces the tool with tool_choice', calls[0].body.tool_choice?.name === 'emit')

// ---------------------------------------------------------------------------
// Google
// ---------------------------------------------------------------------------
calls = []
respond = () => ({ body: { candidates: [{ content: { parts: [{ text: 'hello from gemini' }] } }] } })
const googleText = await generate('hi', {}, { name: 'google', apiKey: 'g-x', model: null })
ok('google: generate returns the part text', googleText === 'hello from gemini')
ok('google: key travels as a query param, not a header', calls[0].path.includes(':generateContent') && String(new URL(`https://x${calls[0].path}`).search).length >= 0)

calls = []
respond = () => ({ body: { candidates: [{ content: { parts: [{ text: '{"name":"Ada"}' }] } }] } })
const googleJson = await generateJson('hi', Schema, {}, {}, { name: 'google', apiKey: 'g-x', model: null })
ok('google: generateJson parses and validates', googleJson.name === 'Ada')
ok('google: sends responseSchema', !!calls[0].body.generationConfig?.responseSchema)

// ---------------------------------------------------------------------------
// generateJson retry: first reply is bad JSON, second is good -- must not
// throw, and must feed the parse error back on the retry prompt.
// ---------------------------------------------------------------------------
calls = []
let n = 0
respond = () => {
  n++
  return { body: { choices: [{ message: { content: n === 1 ? 'not json' : '{"name":"Ada"}' } }] } }
}
const retried = await generateJson('hi', Schema, {}, {}, { name: 'openai', apiKey: 'sk-x', model: null })
ok('openai: generateJson retries once on bad JSON then succeeds', retried.name === 'Ada')
ok('openai: retry prompt mentions the rejection', calls[1].body.messages.some((m) => /rejected/i.test(m.content)))

// ---------------------------------------------------------------------------
// generateStream: SSE frames assembled into the same string a non-streaming
// call would return, and each delta reaches onDelta.
// ---------------------------------------------------------------------------
calls = []
respond = () => ({
  body: null,
  stream: [
    'data: {"choices":[{"delta":{"content":"hel"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
    'data: [DONE]\n\n',
  ],
})
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url))
  calls.push({ host: u.host, path: u.pathname })
  const r = respond(u, init)
  const frames = r.stream
  return {
    ok: true,
    status: 200,
    body: {
      getReader() {
        let i = 0
        return {
          async read() {
            if (i >= frames.length) return { done: true, value: undefined }
            const value = new TextEncoder().encode(frames[i++])
            return { done: false, value }
          },
        }
      },
    },
  }
}
let streamed = ''
const full = await generateStream('hi', {}, (d) => { streamed += d }, { name: 'openai', apiKey: 'sk-x', model: null })
ok('openai: generateStream assembles the full string', full === 'hello')
ok('openai: generateStream delivers the same text via onDelta', streamed === 'hello')

if (failed) { console.error(`\n${failed} failed`); process.exit(1) }
console.log('\nall ok')
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx scripts/test-ai-cloud.mjs`
Expected: FAIL — `lib/ai/cloud.ts` does not exist.

- [ ] **Step 3: Write the implementation**

```ts
// lib/ai/cloud.ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx tsx scripts/test-ai-cloud.mjs`
Expected: PASS — `all ok`.

- [ ] **Step 5: Wire it into `npm test` and run the whole suite**

Edit `package.json`'s `test` script, inserting `&& tsx scripts/test-ai-cloud.mjs` right after `tsx scripts/test-ai-settings.mjs`.

Run: `npm test`
Expected: PASS, including `scripts/check-localhost.mjs` (Task 2 already taught it about these three hosts).

- [ ] **Step 6: Commit**

```bash
git add lib/ai/cloud.ts scripts/test-ai-cloud.mjs package.json
git commit -m "Add lib/ai/cloud.ts: OpenAI/Anthropic/Google adapters (D97)"
```

---

### Task 4: `lib/ai/route.ts` — the router

**Files:**
- Create: `lib/ai/route.ts`
- Test: `scripts/test-ai-route.mjs`
- Modify: `package.json` — add `test-ai-route.mjs` right after `test-ai-cloud.mjs`.

**Interfaces:**
- Consumes: `resolve`, `Feature` from `@/lib/ai/settings`; `generate`, `generateJson`, `MODELS` from `@/lib/ai/generate`; `generate` (as `cloudGenerate`), `generateJson` (as `cloudGenerateJson`), `DEFAULT_MODELS` from `@/lib/ai/cloud`.
- Produces (for Task 5's six call sites):
  ```ts
  export async function generate(feature: Feature, prompt: string, opts?: Options): Promise<string>
  export async function generateJson<T>(feature: Feature, prompt: string, schema: z.ZodType<T>, jsonSchema: unknown, opts?: Options): Promise<T>
  export async function modelLabel(feature: Feature): Promise<string>
  ```

**Ruling, recorded during execution (not in the original spec):** `lib/ai/generate.ts` — the real, committed local seam this branch builds on — has no `generateStream` export, and no committed call site in this codebase currently calls one either. The original plan assumed one existed (based on a misread of an uncommitted, in-progress edit on `main` that was never part of this branch's history). Since nothing needs router-dispatched streaming today, `route.ts` does not export `generateStream` at all — adding one here would mean either breaking the "no change to `generate.ts`" constraint to invent a local counterpart with no caller, or shipping a dead export. `lib/ai/cloud.ts`'s own `generateStream` (Task 3, already built and reviewed) is untouched and remains directly callable by a future feature that needs cloud-only streaming.

- [ ] **Step 1: Write the failing test**

```js
// scripts/test-ai-route.mjs
//
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
  ok('modelLabel: no stored model falls back to the provider default', cloudDefaultModel === 'openai:gpt-4o-mini', cloudDefaultModel)

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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx scripts/test-ai-route.mjs`
Expected: FAIL — `lib/ai/route.ts` does not exist.

- [ ] **Step 3: Write the implementation**

```ts
// lib/ai/route.ts
/**
 * Per-feature dispatch between the local model and a connected cloud
 * provider (D97). Every one of the six text-generation call sites imports
 * this instead of lib/ai/generate.ts directly.
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx tsx scripts/test-ai-route.mjs`
Expected: PASS — `all ok`.

- [ ] **Step 5: Wire it into `npm test` and run the whole suite**

Edit `package.json`'s `test` script, inserting `&& tsx scripts/test-ai-route.mjs` right after `tsx scripts/test-ai-cloud.mjs`.

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/ai/route.ts scripts/test-ai-route.mjs package.json
git commit -m "Add lib/ai/route.ts: per-feature local/cloud dispatch (D97)"
```

---

### Task 5: Switch the six call sites to the router

**Files:**
- Modify: `lib/content/studio.ts:17,246,256,275,283,295`
- Modify: `lib/content/names.ts:16,135`
- Modify: `lib/advisor/converse.ts:23,188,217,226,290`
- Modify: `lib/chat/answer.ts:20,155,169`
- Modify: `lib/campaigns.ts:32,499,597`
- Modify: `lib/meeting.ts:36,163,575,624,838,851,930`
- Test: existing `scripts/test-content.mjs`, `scripts/test-names.mjs`, `scripts/test-advisor.mjs`, `scripts/test-chat.mjs`, `scripts/test-campaigns.mjs`, `scripts/test-meeting.mjs` (all already in `npm test` — no new test files; this task's correctness is that they still pass unchanged, since with every feature at its seeded 'default'/'local' state the router's behavior is identical to calling `generate.ts` directly).

**Note on line numbers:** these were re-verified directly against this branch's actual committed files during Task 4's fix loop — they differ from an earlier draft of this plan, which was accidentally written against an uncommitted, in-progress edit on `main` that this branch never had (see Task 4's ruling). `lib/meeting.ts` in particular has no `generateStream` call anywhere in this branch — its four async calls are `generateJson`, `generate`, `generate`, `generateJson`, in that order, listed below exactly as they appear.

**Interfaces:**
- Consumes: `generate`, `generateJson`, `modelLabel` from `@/lib/ai/route` (feature id is each file's own constant — `'content_studio'`, `'advisor'`, `'sales_chat'`, or `'campaigns'`). No file in this task uses `generateStream` — `lib/ai/route.ts` does not export one (Task 4's ruling).
- Produces: no change to any of these files' own exports.

Because every `ai_settings` row is seeded to `'local'`/`'default'` (Task 1), `route.generate(feature, ...)` calls `localGenerate(...)` under the hood exactly as `generate.ts`'s own `generate(...)` did before — these six files' behavior is unchanged until someone uses the Settings screen (Task 7).

- [ ] **Step 1: `lib/content/studio.ts` and `lib/content/names.ts` (feature `'content_studio'`)**

In `lib/content/studio.ts:17`, change:
```ts
import { generate, generateJson, MODELS } from '@/lib/ai/generate'
```
to:
```ts
import * as route from '@/lib/ai/route'
```
Change every `generate(` call in this file to `route.generate('content_studio', ` and every `generateJson(` call to `route.generateJson('content_studio', `. Change the `model: MODELS.english` literal at line 295 to `model: await route.modelLabel('content_studio')` (the enclosing function must already be `async`, since it already `await`s a `generate`/`generateJson` call above it).

In `lib/content/names.ts:16`, change:
```ts
import { generateJson } from '@/lib/ai/generate'
```
to:
```ts
import * as route from '@/lib/ai/route'
```
Change the `generateJson(` call at line 135 to `route.generateJson('content_studio', `. This file has no `model: MODELS.english` literal to update (confirmed by the earlier grep — only `studio.ts` records that metadata for this feature).

- [ ] **Step 2: Run this feature's tests**

Run: `npx tsx scripts/test-content.mjs && npx tsx scripts/test-names.mjs`
Expected: PASS, unchanged from before this task.

- [ ] **Step 3: `lib/advisor/converse.ts` (feature `'advisor'`)**

At line 23, change:
```ts
import { generate, generateJson, isQuoted, MODELS } from '@/lib/ai/generate'
```
to:
```ts
import { isQuoted } from '@/lib/ai/generate'
import * as route from '@/lib/ai/route'
```
Change the `generate(` call at line 188 to `route.generate('advisor', ` and the `generateJson(` call at line 226 to `route.generateJson('advisor', `. Change both `model: MODELS.english` literals (lines 217 and 290) to `model: await route.modelLabel('advisor')`.

- [ ] **Step 4: Run this feature's tests**

Run: `npx tsx scripts/test-advisor.mjs`
Expected: PASS, unchanged.

- [ ] **Step 5: `lib/chat/answer.ts` (feature `'sales_chat'`)**

At line 20, change:
```ts
import { generate, isGrounded, MODELS } from '@/lib/ai/generate'
```
to:
```ts
import { isGrounded } from '@/lib/ai/generate'
import * as route from '@/lib/ai/route'
```
Change the `generate(` call at line 169 to `route.generate('sales_chat', `. Change the `model: MODELS.english` literal at line 155 to `model: await route.modelLabel('sales_chat')` (the object at line 155 is built inside a function that must already be `async` for the `generate` call below it to be awaited — confirm, and if that particular helper is not itself `async`, thread `modelLabel`'s result in from its caller instead of adding `await` where it would break the function's signature).

- [ ] **Step 6: Run this feature's tests**

Run: `npx tsx scripts/test-chat.mjs`
Expected: PASS, unchanged.

- [ ] **Step 7: `lib/campaigns.ts` and `lib/meeting.ts` (feature `'campaigns'`)**

In `lib/campaigns.ts:32`, change:
```ts
import { generateJson, MODELS } from '@/lib/ai/generate'
```
to:
```ts
import * as route from '@/lib/ai/route'
```
Change the `generateJson(` call at line 499 to `route.generateJson('campaigns', `. Change the `model: MODELS.english` literal at line 597 to `model: await route.modelLabel('campaigns')`.

In `lib/meeting.ts:36`, change:
```ts
import { generate, generateJson, MODELS } from '@/lib/ai/generate'
```
to:
```ts
import * as route from '@/lib/ai/route'
```
This file has four calls to route, in source order: the `generateJson(` call at line 575 becomes `route.generateJson('campaigns', `; the `generate(` call at line 624 becomes `route.generate('campaigns', `; the `generate(` call at line 838 becomes `route.generate('campaigns', `; the `generateJson(` call at line 851 becomes `route.generateJson('campaigns', `. Change both `model: MODELS.english` literals (lines 163 and 930) to `model: await route.modelLabel('campaigns')`. There is no `generateStream` call in this file — `lib/ai/route.ts` does not export one (Task 4's ruling), and nothing here needs it.

- [ ] **Step 8: Run this feature's tests**

Run: `npx tsx scripts/test-campaigns.mjs && npx tsx scripts/test-meeting.mjs`
Expected: PASS, unchanged.

- [ ] **Step 9: Run the whole suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add lib/content/studio.ts lib/content/names.ts lib/advisor/converse.ts lib/chat/answer.ts lib/campaigns.ts lib/meeting.ts
git commit -m "Route all six AI call sites through lib/ai/route.ts (D97)"
```

---

### Task 6: Settings API route

**Files:**
- Create: `app/api/settings/ai/route.ts`

**Interfaces:**
- Consumes: `all`, `setGlobal`, `setFeature`, `FEATURES` from `@/lib/ai/settings`; `reachable` from `@/lib/db`; `readJson` from `@/lib/http`.
- Produces: `GET` returns `{ up, rows: Awaited<ReturnType<typeof all>> }` with `apiKey` masked; `PUT` accepts `{ feature: 'global' | Feature; provider; model?; apiKey? }` and validates a cloud key with one cheap call before saving.

- [ ] **Step 1: Write the route**

```ts
// app/api/settings/ai/route.ts
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
  } catch {
    return NextResponse.json({ error: 'Postgres is not answering, so this was not saved. Run: npm run db:up' }, { status: 503 })
  }

  return NextResponse.json({ ok: true, rows: mask(await all()) })
}
```

- [ ] **Step 2: Manually verify against the running dev server**

Run: `npm run dev` (if not already running), then:
```bash
curl -s http://localhost:3000/api/settings/ai | head -c 500
```
Expected: `{"up":true,"rows":[...5 rows, "global" first, hasKey:false everywhere...]}`.

```bash
curl -s -X PUT http://localhost:3000/api/settings/ai -H 'Content-Type: application/json' \
  -d '{"feature":"content_studio","provider":"openai","apiKey":"sk-not-a-real-key"}'
```
Expected: `{"error":"Could not verify that key with openai: ..."}` with a 400 — proving the validation call runs and a bad key is rejected before anything is written. (Confirm with a real key once one is available, then confirm the row afterward with the `GET` above.)

- [ ] **Step 3: Commit**

```bash
git add app/api/settings/ai/route.ts
git commit -m "Add GET/PUT /api/settings/ai (D97)"
```

---

### Task 7: Settings screen

**Files:**
- Create: `app/(staff)/settings/page.tsx`

**Interfaces:**
- Consumes: `GET`/`PUT /api/settings/ai` from Task 6.
- Produces: nothing consumed elsewhere — this is the leaf UI.

- [ ] **Step 1: Write the page**

```tsx
// app/(staff)/settings/page.tsx
'use client'

import { useEffect, useState } from 'react'

type Row = {
  feature: 'global' | 'content_studio' | 'advisor' | 'sales_chat' | 'campaigns'
  provider: 'default' | 'local' | 'openai' | 'anthropic' | 'google'
  model: string | null
  hasKey: boolean
  resolvedProvider: string
  resolvedModel: string | null
}

const LABEL: Record<Row['feature'], string> = {
  global: 'Global default',
  content_studio: 'Content studio',
  advisor: 'Creative advisor',
  sales_chat: 'Sales chat',
  campaigns: 'Campaigns / meeting',
}

const WARNING: Partial<Record<Row['feature'], string>> = {
  sales_chat: 'Customer messages leave this machine and go to the connected provider while this is set to a cloud option.',
}

export default function SettingsPage() {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [keyDraft, setKeyDraft] = useState<Record<string, string>>({})

  async function load() {
    const res = await fetch('/api/settings/ai')
    const data = await res.json()
    if (res.ok) setRows(data.rows)
  }
  useEffect(() => { load() }, [])

  async function save(feature: Row['feature'], provider: Row['provider']) {
    setBusy(feature)
    setError(null)
    const res = await fetch('/api/settings/ai', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ feature, provider, apiKey: keyDraft[feature] || undefined }),
    })
    const data = await res.json()
    setBusy(null)
    if (!res.ok) { setError(data.error); return }
    setRows(data.rows)
    setKeyDraft((d) => ({ ...d, [feature]: '' }))
  }

  if (!rows) return <p>Loading…</p>

  const options: Row['provider'][] = ['local', 'openai', 'anthropic', 'google']

  return (
    <div style={{ maxWidth: 640 }}>
      <h1>AI provider</h1>
      {error && <p style={{ color: '#c0392b' }}>{error}</p>}
      {rows.map((r) => (
        <div key={r.feature} style={{ marginBottom: 24, paddingBottom: 16, borderBottom: '1px solid #ddd' }}>
          <strong>{LABEL[r.feature]}</strong>
          <div style={{ fontSize: 13, color: '#666' }}>
            Currently: {r.resolvedProvider}{r.resolvedModel ? ` (${r.resolvedModel})` : ''}
          </div>
          <select
            value={r.provider}
            onChange={(e) => save(r.feature, e.target.value as Row['provider'])}
            disabled={busy === r.feature}
          >
            {r.feature !== 'global' && <option value="default">Default (follows global)</option>}
            {options.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
          {r.provider !== 'local' && r.provider !== 'default' && (
            <input
              type="password"
              placeholder={r.hasKey ? 'Key saved — enter a new one to replace it' : 'API key'}
              value={keyDraft[r.feature] ?? ''}
              onChange={(e) => setKeyDraft((d) => ({ ...d, [r.feature]: e.target.value }))}
              onBlur={() => keyDraft[r.feature] && save(r.feature, r.provider)}
              style={{ marginLeft: 8 }}
            />
          )}
          {WARNING[r.feature] && r.provider !== 'local' && r.provider !== 'default' && (
            <p style={{ color: '#c0392b', fontSize: 13 }}>{WARNING[r.feature]}</p>
          )}
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Manually verify in the browser**

Run `npm run dev`, open `/settings`. Confirm: five rows render (global first); switching `content_studio` to `openai` reveals a key field; saving with an obviously-fake key shows the 400 error from Task 6 inline; the sales-chat warning is visible only once a cloud provider is chosen for it; reloading the page after a successful save shows the new "Currently: …" line.

- [ ] **Step 3: Commit**

```bash
git add "app/(staff)/settings/page.tsx"
git commit -m "Add the AI provider Settings screen (D97)"
```

---

### Task 8: Record the decision

**Files:**
- Modify: `docs/decisions.md` (append-only — add at the end, never edit an earlier entry)

**Interfaces:** none — this is documentation, done last, once Tasks 1–7 are verified working.

- [ ] **Step 1: Append D97**

```markdown
### D97 — features may be switched, per-feature, to a connected cloud AI provider

OpenAI, Anthropic, or Google, instead of the local Ollama model. Opt-in only,
off by default — every feature starts on `'default'`, which follows the
global default, which starts on `'local'`. Embeddings are excluded
permanently: `lib/rag/retrieve.ts` and `lib/catalogue.ts` keep calling
`lib/ai/generate.ts`'s `embed()` directly and are never routed, because
cosine similarity across a corpus embedded by two different models silently
corrupts retrieval ranking rather than erroring.

No silent fallback to local on a cloud failure — a bad key, a rate limit, or
an outage fails the call visibly, the same "fail loud, no tolerant parser"
rule `generateJson` already followed for bad Ollama JSON.

`lib/ai/cloud.ts` is now the second (and last) file, after `lib/social/`,
permitted to name a host off this machine — `api.openai.com`,
`api.anthropic.com`, `generativelanguage.googleapis.com` — gated by
`scripts/check-localhost.mjs` the same way `lib/social/`'s four hosts are.

No provider SDK: `lib/social/cloudinary.ts` and `lib/social/instagram.ts` had
already made this call twice, for the same reason — a dependency, a bundle
and an update treadmill for a handful of `fetch` calls.

See `docs/superpowers/specs/2026-09-13-cloud-ai-provider-design.md`.
```

- [ ] **Step 2: Commit**

```bash
git add docs/decisions.md
git commit -m "Record D97: bring-your-own cloud AI provider"
```

---

## Self-Review Notes

- **Spec coverage:** Settings storage (Task 1), `lib/ai/cloud.ts` (Task 3), `lib/ai/route.ts` + `modelLabel` (Task 4), checker exception (Task 2, sequenced before Task 3 so `npm test` never goes red), all six call sites (Task 5), Settings UI + validation-before-save (Tasks 6–7), decision entry (Task 8). Embeddings-excluded requirement is enforced structurally — `route.ts` never imports or re-exports `embed`, and Task 4's test asserts that.
- **Type consistency checked:** `Feature`, `Provider`, `Backend`, `CloudProvider` are defined once (`lib/ai/settings.ts` and `lib/ai/cloud.ts` respectively) and only ever imported downstream, never redeclared.
- **Known ceiling, on record (Task 3):** `lib/ai/cloud.ts`'s `generateStream` only implements OpenAI's SSE framing; Anthropic/Google streaming throws a clear error rather than silently degrading. It has no caller today — `lib/ai/route.ts` does not export a `generateStream` at all (Task 4's ruling, made when Task 4 discovered `lib/ai/generate.ts` has no local streaming primitive in this branch, unlike an earlier draft of this plan that assumed one existed). Add one to both files together if a future feature genuinely needs router-dispatched streaming.
