# Bring-your-own cloud AI provider

**Date:** 2026-09-13
**Status:** approved, not yet implemented
**Decision entry:** D97 (to be written when this lands)

---

## The problem

Every AI call in this project goes through `lib/ai/generate.ts`, which asserts
at import time that `OLLAMA_BASE_URL` is a loopback address and refuses to
start otherwise. That is deliberate and it is rule 1 of CLAUDE.md: catalog
rows, customer messages and drafts never leave this machine.

The maintainer wants an escape hatch, opt-in and explicit: connect an OpenAI,
Anthropic or Google API key and let specific features use that provider
instead of the local model. Some features (advising, campaigns) may want
cloud reasoning quality; sales chat and the catalogue helper carry customer
and product data, so switching those to cloud is a real, informed choice, not
a default.

This is a deliberate, recorded widening of rule 1 — not a workaround of it.
What still never happens: nothing is sent to a cloud provider without that
specific feature being explicitly switched to it in Settings.

## Scope

**In:**
- A `Settings` screen: a global default (local vs. one connected cloud
  provider) and a per-feature override for each of: content studio, creative
  advisor, sales chat, campaigns/meeting, catalogue helper.
- Storage for one API key per provider (OpenAI, Anthropic, Google), encrypted
  at rest.
- A new `lib/ai/cloud.ts`, the only other file (besides `lib/social/`)
  permitted to reach off this machine, implementing the same three calls
  `generate.ts` exposes (`generate`, `generateJson`, `generateStream`) against
  whichever provider a feature is set to.
- A router, `lib/ai/route.ts`, that every one of the eight existing call
  sites imports instead of `generate.ts` directly, resolving which backend to
  use per feature at call time.
- A visible, specific warning next to the sales-chat and catalogue-helper
  toggles stating what leaves when cloud is on for them.

**Out, deliberately:**
- **Embeddings are not switchable.** `rag/retrieve.ts`'s `embed()` keeps
  calling Ollama's `bge-m3` unconditionally. Cosine similarity is only
  meaningful when every row in the corpus was embedded by the same model;
  switching mid-corpus doesn't error, it just quietly degrades retrieval
  ranking. This file is exempt from the router entirely.
- **No silent fallback to local on cloud failure.** A bad key, a rate limit,
  or a provider outage fails the call visibly, same as a bad JSON response
  from Ollama does today. Falling back silently would hide a cost or quality
  problem behind output that looks normal.
- **No unified multi-provider SDK abstraction** (e.g. Vercel AI SDK). Three
  light, official SDKs (`openai`, `@anthropic-ai/sdk`, `@google/generative-ai`)
  cover this with less new surface than a generic abstraction layer would,
  and the `openai` client already works against Ollama unchanged.
- **No change to `lib/ai/generate.ts` itself.** Its loopback assertion and
  guarantees stay exactly as they are; it remains the local-only path,
  untouched by this feature.
- **No image generation.** Separate feature, separate spec.

---

## Architecture

```
                    ┌─────────────────────┐
call sites  ──────▶ │   lib/ai/route.ts   │
(8 modules)         │  (per-feature pick) │
                    └──────────┬──────────┘
                          local│      │cloud
                    ┌──────────▼──┐ ┌─▼──────────────┐
                    │generate.ts  │ │  cloud.ts       │
                    │(unchanged,  │ │(new; the only   │
                    │ always      │ │ other file that │
                    │ loopback)   │ │ leaves the box)  │
                    └─────────────┘ └─────────────────┘
```

`route.ts` reads the resolved setting for a feature (its own override, else
the global default), and calls the matching module with the same signature
either way — a call site never branches on provider itself.

## Data model

```sql
create table ai_settings (
  feature           text primary key,   -- 'global' | 'content_studio' | 'advisor'
                                          -- | 'sales_chat' | 'campaigns' | 'catalogue'
  provider          text not null,       -- 'default' | 'local' | 'openai' | 'anthropic' | 'google'
  model             text,                -- provider-specific model id; null = provider default
  api_key_encrypted text,                -- null when provider = 'local' or 'default'
  updated_at        timestamptz not null default now()
);
```

Seeded at migration time: one `global` row (provider starts as `local`) and
one row per feature, each starting at `provider = 'default'` — meaning
"inherit whatever `global` is right now," resolved at call time rather than
copied in, so changing `global` moves every feature still set to `default`
without touching their rows. A feature explicitly set to `local`, or to a
cloud provider, ignores `global` from then on. The `global` row itself may
not be `default` — it is always a concrete choice. Keys encrypted with the
existing `APP_ENCRYPTION_KEY` — the same scheme already protecting Instagram
tokens in `lib/social/tokens.ts`. No new crypto code.

## `lib/ai/cloud.ts`

Signature-compatible with `generate.ts`:

```ts
export async function generate(prompt, opts, provider): Promise<string>
export async function generateJson<T>(prompt, schema, jsonSchema, opts, provider): Promise<T>
export async function generateStream(prompt, opts, onDelta, provider): Promise<string>
```

`provider` carries `{ name: 'openai'|'anthropic'|'google', apiKey: string, model?: string }`,
resolved by `route.ts` from `ai_settings` — `cloud.ts` never reads the table
itself, keeping it a pure "given credentials, call this provider" module,
same separation `lib/social/instagram.ts` keeps from `lib/social/store.ts`.

**`generate`/`generateStream`:** OpenAI and Google both accept a plain prompt
+ system message; Anthropic's Messages API takes the same shape with a
slightly different envelope. One adapter function per provider, each
returning the same plain string / stream callback shape callers already get
from `generate.ts`.

**`generateJson`:** the retry-twice-then-fail-visibly wrapper is shared code
(lifted from the existing `generateJson`, parameterized over which one-shot
call to make). Per provider:
- **OpenAI:** `response_format: { type: 'json_schema', ... }` — same
  guarantee-of-shape Ollama's `format` gives.
- **Google:** `responseSchema` in `generationConfig` — same guarantee.
- **Anthropic:** no native JSON-schema decoding; forced via a single tool
  definition matching the schema and requiring that tool call. Falls back on
  the same parse-and-retry safety net as a normal bad response would.

## `lib/ai/route.ts`

```ts
type Feature = 'content_studio' | 'advisor' | 'sales_chat' | 'campaigns' | 'catalogue'

async function backendFor(feature: Feature): Promise<Backend>  // reads ai_settings; 'default' resolves to the global row
export async function generate(feature, prompt, opts): Promise<string>
export async function generateJson<T>(feature, prompt, schema, jsonSchema, opts): Promise<T>
export async function generateStream(feature, prompt, opts, onDelta): Promise<string>
```

Each of the eight existing call sites changes its import from
`@/lib/ai/generate` to `@/lib/ai/route` and adds its feature id as the first
argument. No other change to those files — the router's return shape matches
`generate.ts`'s exactly.

`scripts/check-localhost.mjs` gains one more named exception, the same shape
as its existing `lib/social/` carve-out: `lib/ai/cloud.ts` may name
`api.openai.com`, `api.anthropic.com`, and
`generativelanguage.googleapis.com` — those exact hosts, that exact file,
nowhere else.

## Settings UI

A new `app/(staff)/settings/` (or a tab on an existing screen) with:
- Global default: Local / OpenAI / Anthropic / Google, each cloud option
  revealing its key field once selected.
- Five per-feature rows, each starting at "Default (follows global)" with an
  override dropdown of Local / OpenAI / Anthropic / Google.
- Inline, next to the **sales chat** and **catalogue** rows specifically: a
  visible sentence that customer messages / catalog rows leave this machine
  when that row is set to a cloud provider. Not a tooltip — always visible
  when a cloud provider is selected for that row.
- Saving writes to `ai_settings`; keys are encrypted before the row is
  written and never re-displayed in full afterward (masked, same UX as a
  connected Instagram account's token).

## Error handling

- Missing/invalid key: the settings screen validates by making one cheap
  call (e.g. a models-list request) before saving, so a bad key is caught at
  configuration time, not at the next customer's chat message.
- Runtime failure (rate limit, outage, revoked key): the call fails with the
  provider's own message surfaced to whichever screen made the request — same
  "fail visibly, no tolerant parser" pattern `generateJson` already uses for
  bad Ollama JSON. No automatic fallback to local.

## Testing

- `scripts/test-ai-route.mjs` (new, mirrors the shape of the existing
  `scripts/test-*.mjs` scripts): feature resolution (`default` follows
  `global`, an explicit per-feature value ignores it, changing `global`
  moves every `default` feature at once), that `embed()` is never reachable
  through the router, and that a cloud call with a missing key fails before
  any network call is attempted.
- `scripts/check-localhost.mjs` extended with a fixture asserting the three
  new hosts are allowed only inside `lib/ai/cloud.ts`, and that a fourth host
  or a different file still fails the build — exactly like the existing
  `lib/social/` fixture.
- Cloud provider adapters themselves are not covered by an automated test
  against the real APIs (no synthetic-only cloud credentials exist yet for
  that); verified manually against each connected provider once a key is
  entered, same as the Instagram connect flow was.

---

## Decision entry (draft, for `docs/decisions.md` on landing)

**D97 — features may be switched, per-feature, to a connected cloud AI
provider (OpenAI/Anthropic/Google) instead of the local model.** Opt-in only,
off by default. Embeddings are excluded permanently — mixing embedding
providers silently corrupts retrieval ranking. No silent fallback to local on
a cloud failure. `lib/ai/cloud.ts` is now the second (and last) file, after
`lib/social/`, permitted to name a host off this machine, gated by
`scripts/check-localhost.mjs` the same way.
