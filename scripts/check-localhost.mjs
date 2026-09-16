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
 * ── the one place inside the app that may reach out (D83) ──
 *
 * Publishing a finished post to the company's own Instagram account cannot be
 * done from localhost: Meta FETCHES the image from a public URL rather than
 * accepting uploaded bytes, so the poster has to be hosted somewhere Meta can
 * read it. The maintainer chose Cloudinary over a tunnel and over a
 * fully-manual assistant, knowing the cost.
 *
 * So four hosts are allowed, and only inside lib/social/. Not app/, not a route,
 * not lib/content. Three of them carry data — api.instagram.com,
 * graph.instagram.com and api.cloudinary.com — and www.instagram.com is the
 * OAuth dialog the browser is redirected to; see SOCIAL_HOSTS below for why it
 * is not the same kind of thing. Everything else is unchanged: the same host
 * named one directory over still fails, and a fifth host named inside
 * lib/social/ still fails. What leaves is one rendered poster and its caption,
 * for a post a person chose to publish. Catalogue rows in bulk, customer
 * messages and Excel contents still never leave.
 *
 * graph.facebook.com and www.facebook.com were the two allowed here until D86.
 * Nothing in this project talks to Graph any more, so they are not allowed
 * anywhere — reintroducing either is a decision, not a refactor.
 *
 * Remove this exception when publishing no longer runs from a laptop — once the
 * app is hosted, the image already has a public URL and Cloudinary has no job.
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

/**
 * Files that are not under any of those roots and still run on the server.
 *
 * `instrumentation.ts` has to sit at the project root — Next will not look for
 * it anywhere else — and it runs on every server start. Left out of this list it
 * would be the one server file where a `fetch` to anywhere is invisible to this
 * check, which is exactly the hole a boundary like this exists to not have
 * (D89). Anything else that must live at the root belongs here too.
 */
const ALSO = ['instrumentation.ts', 'middleware.ts', 'proxy.ts']

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

/**
 * The one directory that may name a host off this machine, and the only hosts it
 * may name.
 *
 * Three of the four carry data. `api.instagram.com` spends the authorisation
 * code; `graph.instagram.com` receives the caption and the image URL and hands
 * back the long-lived token; `api.cloudinary.com` receives the poster itself.
 *
 * Meta really does split the login across those two hosts — the code is
 * exchanged at api.instagram.com and everything afterwards at
 * graph.instagram.com — so neither can be dropped for tidiness.
 *
 * `www.instagram.com` is weaker, and is here for one reason: the OAuth login
 * dialog lives at `www.instagram.com/oauth/authorize` and neither API host
 * serves it. Nothing fetches it. It goes in a 302 Location header and the
 * person's browser follows it, carrying the client_id, the scope list and a
 * random state, all public by construction. No catalogue row, caption, image or
 * credential rides on it.
 *
 * That distinction is a comment, not an enforcement — this check reads literals
 * and cannot tell a redirect target from a fetch target. If a `fetch` to
 * www.instagram.com is ever added, this set is not what will catch it (D85, D86).
 */
const SOCIAL = 'lib/social/'
const SOCIAL_HOSTS = new Set([
  'api.instagram.com',
  'graph.instagram.com',
  'www.instagram.com',
  'api.cloudinary.com',
])

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

/**
 * Files that may call `fetch` with a target this check cannot read.
 *
 * The two checks above read IMPORTS and URL LITERALS. Neither can see
 * `fetch(url)` where `url` arrived in a request body — and the comment on
 * CLIENTS has always said so: fetch is a global, so an import rule cannot see
 * it. Until D99 nothing in app/ or lib/ did that, and the gap was theoretical.
 * `app/api/products/photo/route.ts` fetches one image from an address a person
 * pasted, so the gap is now real and this is what keeps it from widening
 * quietly: a dynamic fetch anywhere else fails the build.
 *
 * A fetch whose first argument is a string starting with `/` is same-origin by
 * construction — that is every client component in this project talking to its
 * own API, and none of it leaves the machine.
 */
const DYNAMIC_FETCH_FILES = new Set([
  SEAM,
  AI_CLOUD,
  'app/api/products/photo/route.ts',
])

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
// `fetch(` whose first argument is not a same-origin string literal. The
// lookbehind keeps `x.fetch(` and `prefetch(` out of it.
const DYNAMIC_FETCH = /(?<![.\w])fetch\s*\(\s*(?!['"`]\/)/g

const problems = []

for (const root of [...ROOTS, ...ALSO]) {
  let files
  try {
    // A root may be a directory to walk or a single file that may not exist.
    files = statSync(root).isDirectory() ? sources(root) : [root]
  } catch { continue }

  for (const file of files) {
    const rel = relative(process.cwd(), file)
    const isSeam = rel === SEAM
    const isSocial = rel.startsWith(SOCIAL)
    const isAiCloud = rel === AI_CLOUD

    // Comments and types out; strings and imports left exactly as written.
    // An import esbuild drops as unused is one nothing calls, which is one that
    // cannot make a request.
    const src = readFileSync(file, 'utf8')

    let code
    try {
      code = transformSync(src, {
        loader: file.endsWith('.tsx') ? 'tsx' : 'ts',
        jsx: 'preserve',
      }).code
    } catch (e) {
      problems.push(`${rel}  could not be read: ${e.message.split('\n')[0]}`)
      continue
    }

    // Line numbers come from the SOURCE, never from the stripped code. esbuild
    // deletes the comments, so a line counted in `code` is short by however many
    // comment lines came before it — always wrong, and worst in the files that
    // document themselves most.
    //
    // Detection still runs on the stripped code, so a URL in a comment cannot
    // raise a false alarm — only the line reported for a real one is at stake.
    //
    // This takes the matched TEXT and never the match index. `m.index` is an
    // offset into the stripped code; passing it here made `src.indexOf(48)`
    // search for the characters "48", which is how a violation on line 141 was
    // reported as line 48. Every violation this check ever printed pointed at
    // the wrong line, and nobody noticed because a passing run prints none.
    //
    // The whole match is tried first because it is the most specific; the
    // capture is the fallback for a match whose surrounding syntax esbuild
    // rewrote. A literal repeated in one file reports its first occurrence —
    // worse than a sourcemap, better than a number that is wrong every time.
    const lineOf = (...needles) => {
      for (const needle of needles) {
        const at = typeof needle === 'string' ? src.indexOf(needle) : -1
        if (at >= 0) return src.slice(0, at).split('\n').length
      }
      return 1
    }

    for (const m of code.matchAll(SPECIFIER)) {
      if (!CLIENTS.has(m[1]) || isSeam) continue
      problems.push(`${rel}:${lineOf(m[0], m[1])}  imports "${m[1]}" — only ${SEAM} may originate a request`)
    }

    if (!DYNAMIC_FETCH_FILES.has(rel) && !isSocial) {
      for (const m of code.matchAll(DYNAMIC_FETCH)) {
        problems.push(
          `${rel}:${lineOf(m[0])}  calls fetch() with a target this check cannot read — ` +
          `only ${[...DYNAMIC_FETCH_FILES].join(', ')} and ${SOCIAL} may do that`,
        )
      }
    }

    for (const m of code.matchAll(URL_LITERAL)) {
      const host = m[1].toLowerCase()
      if (isLoopback(host) || NAMESPACES.has(host)) continue
      if (isSocial && SOCIAL_HOSTS.has(host)) continue
      if (isAiCloud && AI_CLOUD_HOSTS.has(host)) continue
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
    }
  }
}

if (problems.length) {
  for (const p of problems) console.error('  ' + p)
  console.error(`\n${problems.length} way${problems.length === 1 ? '' : 's'} out of this machine`)
  process.exit(1)
}

console.log(`${ROOTS.join(', ')} and ${ALSO.length} root files: no request can leave this machine (${SEAM} excepted, and it asserts loopback)`)
