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
ok('google: hits the generateContent endpoint', calls[0].path.includes(':generateContent'))
ok('google: key travels as a header, not a query param', calls[0].headers['x-goog-api-key'] === 'g-x' && !calls[0].path.includes('g-x'))

calls = []
respond = () => ({ body: { candidates: [{ content: { parts: [{ text: '{"name":"Ada"}' }] } }] } })
const googleJson = await generateJson('hi', Schema, {}, {}, { name: 'google', apiKey: 'g-x', model: null })
ok('google: generateJson parses and validates', googleJson.name === 'Ada')
ok('google: sends responseSchema', !!calls[0].body.generationConfig?.responseSchema)

// ---------------------------------------------------------------------------
// Schema stripping: Google's responseSchema and Anthropic's input_schema
// reject keys z.toJSONSchema() emits ($schema everywhere, additionalProperties
// on every object, nested ones included).
// ---------------------------------------------------------------------------
function hasKeyDeep(obj, key) {
  if (Array.isArray(obj)) return obj.some((v) => hasKeyDeep(v, key))
  if (obj && typeof obj === 'object') return key in obj || Object.values(obj).some((v) => hasKeyDeep(v, key))
  return false
}
const NestedSchema = z.object({ inner: z.object({ x: z.string() }) })
const nestedJsonSchema = z.toJSONSchema(NestedSchema)
ok('fixture: z.toJSONSchema nests additionalProperties', hasKeyDeep(nestedJsonSchema.properties.inner, 'additionalProperties'))

calls = []
respond = () => ({ body: { content: [{ type: 'tool_use', input: { inner: { x: 'a' } } }] } })
await generateJson('hi', NestedSchema, nestedJsonSchema, {}, { name: 'anthropic', apiKey: 'ant-x', model: null })
ok('anthropic: strips $schema from the tool input_schema', !('$schema' in calls[0].body.tools[0].input_schema))

calls = []
respond = () => ({ body: { candidates: [{ content: { parts: [{ text: '{"inner":{"x":"a"}}' }] } }] } })
await generateJson('hi', NestedSchema, nestedJsonSchema, {}, { name: 'google', apiKey: 'g-x', model: null })
const sentSchema = calls[0].body.generationConfig.responseSchema
ok('google: strips $schema from responseSchema', !('$schema' in sentSchema))
ok('google: strips additionalProperties recursively, nested objects included', !hasKeyDeep(sentSchema, 'additionalProperties'))
ok('google: the schema itself still round-trips through', sentSchema.properties?.inner?.properties?.x?.type === 'string')

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
