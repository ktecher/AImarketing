#!/usr/bin/env node
/**
 * Fails if the app could talk to anything but this machine.
 *
 * The company's requirement is that catalogue rows, customer messages, uploaded
 * images and Excel contents never reach an external service. `lib/ai/generate.ts`
 * asserts at import time that OLLAMA_BASE_URL is a loopback address, which
 * covers the model — and nothing covered the other direction: any file could
 * import an HTTP client, or call `fetch` against a URL somebody typed, and no
 * test would notice.
 *
 * Two checks over app/, lib/ and db/:
 *
 *   1. No HTTP client is imported outside lib/ai/generate.ts. That module is the
 *      one seam through which a request may originate.
 *   2. No absolute http(s) URL appears in a string, unless its host is this
 *      machine. This is the one that catches the realistic mistake — `fetch` is
 *      a global, so no import rule can see it, and "just this once to compare"
 *      gets written as a literal.
 *
 * scripts/ is deliberately NOT checked. Seeding a catalogue from a retailer's
 * public site happened once, by hand, before the app existed — see
 * docs/retailer-api.md. Keeping that distinction visible is the point: the app may
 * not reach the internet; a one-off tool a person runs is not the app.
 *
 * ── why this is not the ESLint rule CLAUDE.md used to promise ──
 *
 * It could not be installed. No published typescript-eslint supports TypeScript
 * 7, and forcing the peer range gives an install that breaks `npm ci` on a fresh
 * clone. TypeScript 7 is the Go port and ships no JavaScript compiler API
 * either — `node_modules/typescript/lib` holds a launcher and a version string,
 * so there is no createSourceFile to parse with.
 *
 * So the source is run through esbuild, which tsx already installs, purely to
 * remove comments and type syntax. What is left is code, and a URL or a module
 * name found in it is really there — no counting quotes, and a doc link in a
 * comment cannot raise a false alarm.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { transformSync } from 'esbuild'

const ROOTS = ['app', 'lib', 'db']

/** The one module allowed to originate a request. */
const SEAM = 'lib/ai/generate.ts'

/**
 * Modules that exist to make HTTP requests.
 *
 * `openai` is on the list and is not a mistake: Ollama speaks the OpenAI wire
 * protocol, so that client pointed at localhost is the correct implementation —
 * inside the seam. Anywhere else it is a request to OpenAI.
 */
const CLIENTS = new Set([
  'axios', 'node-fetch', 'got', 'superagent', 'undici', 'ky', 'request', 'needle', 'phin',
  'http', 'https', 'http2', 'node:http', 'node:https', 'node:http2',
  'openai', '@anthropic-ai/sdk', '@google/generative-ai', 'cohere-ai',
])

/**
 * Hosts a literal may name.
 *
 * The W3C namespaces are XML identifiers, not addresses — an SVG that declares a
 * different one is not an SVG. Nothing ever fetches them.
 */
const NAMESPACES = new Set(['www.w3.org'])
const isLoopback = (host) =>
  host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]' ||
  host.endsWith('.localhost')

function sources(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('.') || entry === 'node_modules') continue
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) sources(path, out)
    else if (/\.tsx?$/.test(path)) out.push(path)
  }
  return out
}

// Both forms of specifier: `from "x"`, `import("x")`, `require("x")`, and a
// bare `import "x"` for side effects.
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)["']([^"']+)["']/g
const URL_LITERAL = /["'`]https?:\/\/([^/:?#"'`\s]+)/gi

const problems = []

for (const root of ROOTS) {
  let files
  try { files = sources(root) } catch { continue }

  for (const file of files) {
    const rel = relative(process.cwd(), file)
    const isSeam = rel === SEAM

    // Comments and types out; strings and imports left exactly as written.
    // An import esbuild drops as unused is one nothing calls, which is one that
    // cannot make a request.
    let code
    try {
      code = transformSync(readFileSync(file, 'utf8'), {
        loader: file.endsWith('.tsx') ? 'tsx' : 'ts',
        jsx: 'preserve',
      }).code
    } catch (e) {
      problems.push(`${rel}  could not be read: ${e.message.split('\n')[0]}`)
      continue
    }

    const lineOf = (index) => code.slice(0, index).split('\n').length

    for (const m of code.matchAll(SPECIFIER)) {
      if (!CLIENTS.has(m[1]) || isSeam) continue
      problems.push(`${rel}:${lineOf(m.index)}  imports "${m[1]}" — only ${SEAM} may originate a request`)
    }

    for (const m of code.matchAll(URL_LITERAL)) {
      const host = m[1].toLowerCase()
      if (isLoopback(host) || NAMESPACES.has(host)) continue
      problems.push(`${rel}:${lineOf(m.index)}  names "${host}" — nothing here may leave this machine`)
    }
  }
}

if (problems.length) {
  for (const p of problems) console.error('  ' + p)
  console.error(`\n${problems.length} way${problems.length === 1 ? '' : 's'} out of this machine`)
  process.exit(1)
}

console.log(`${ROOTS.join(', ')}: no request can leave this machine (${SEAM} excepted, and it asserts loopback)`)
