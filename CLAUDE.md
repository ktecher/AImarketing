# AImarketing

One system closing the loop between marketing and sales for a Kuwait retailer.

Four pillars plus a loop: a **template studio** that fills brand designs from an Excel product sheet; a **content studio** that writes social copy from the same rows; a **creative advisor** that reviews drafts the team wrote; and a **sales chatbot** grounded in the catalog that hands hot leads to a human. A `campaign` record ties them together in both directions.

Read `docs/vision.md` before changing anything about what this is for, and `docs/architecture.md` before changing how it works. Read `docs/db.md` before touching the schema — it carries the decisions no later migration can take back. Record every non-obvious decision in `docs/decisions.md` — it is append-only.

---

## Hard rules

These are not style preferences. Each one exists because breaking it causes a failure that is expensive or impossible to reverse.

### 1. No request may leave localhost

The company's requirement is absolute: catalog rows, customer messages, uploaded images, and Excel contents never reach an external service — including while debugging, and including "just this once to compare."

Enforcement is structural, not a promise:

- A boot-time assert that `OLLAMA_BASE_URL`'s host is a loopback address, throwing with an actionable message.
- `scripts/check-localhost.mjs`, first in `npm test`. Over `app/`, `lib/` and `db/`: no HTTP client imported outside `lib/ai/generate.ts`, and no absolute http(s) URL in a string unless its host is this machine or one of the two publishing hosts named below, inside `lib/social/` and nowhere else. The second check is the one that matters — `fetch` is a global, so an import rule cannot see it.

  Not ESLint, though this was promised as `no-restricted-imports` for months and never existed. It cannot be installed: no published typescript-eslint supports TypeScript 7, and TypeScript 7 is the Go port, which ships no JavaScript compiler API to parse with either. The source goes through esbuild — already installed by `tsx` — to strip comments and types, and the check reads what is left. Switch to ESLint when typescript-eslint supports TS 7.

  `scripts/` is deliberately outside the check: seeding a catalogue from a public site happened once, by hand, before the app existed (`docs/retailer-api.md`). The app may not reach the internet; a one-off tool a person runs is not the app. Two routes may EXECUTE a script in `scripts/`, by fixed path, and do nothing else — a staff click is a person running the tool, and the request code stays where there is one file to read to know what leaves:

  - `/api/kuwait/trends` runs `scripts/pull-trends.mjs` with **no arguments**, never reading the request body (D72).
  - `/api/kuwait/search` runs `scripts/search-trends.mjs <topic>` with **one argument**: a topic a person typed, stripped to letters, digits and spaces and capped at sixty characters, at the route and again in the script. Nothing else reaches the child process (D73).

  **Publishing a post is the second exception, and the only one inside the app** (D83). Meta does not accept uploaded image bytes — it FETCHES the image from a public URL — so a finished poster has to be hosted somewhere Meta can read it, and the maintainer chose Cloudinary over a tunnel and over publishing by hand. Four hosts, one directory, and the checker enforces exactly that:

  - `api.instagram.com`, `graph.instagram.com` and `api.cloudinary.com` may be named **only inside `lib/social/`**. Those exact hosts, that exact directory. The same host one directory over fails the build, and a fifth host inside `lib/social/` fails the build. Meta splits the login across two of them — the authorisation code is spent at `api.instagram.com`, the long-lived token and every publish happen at `graph.instagram.com` — so neither can be folded into the other.
  - `www.instagram.com` is the fourth, and is not the same kind of thing (D85). It is the OAuth login dialog, which neither API host serves. Nothing fetches it — it goes in a 302 `Location` header and the person’s browser follows it, carrying the client_id, the scope list and a random state. No catalogue row, caption, image or credential rides on it.
  - **Instagram only, and no Facebook Page** (D86). Publishing through a Page needs a Meta Business portfolio the shop could not create, so this uses **Instagram API with Instagram Login**, which Meta ships for accounts that have no Page. `graph.facebook.com` and `www.facebook.com` are no longer allowed anywhere in this project; nothing here talks to Graph.
  - `lib/social/instagram.ts` and `lib/social/cloudinary.ts` are the two files that reach out. `lib/social/store.ts` and `lib/social/tokens.ts` are local Postgres only.
  - **What leaves:** the rendered poster image (it carries a product name and a price), the caption text, and the Instagram/Cloudinary credentials. Per post.
  - **Publishing is opt-in per post and never automatic.** Not on render, not on save, not on a timer. A person picks the design, reads the caption, and presses publish.

  Note what the rule above still says, unchanged: catalogue rows in bulk, customer messages, uploaded Excel contents, and any product nobody chose to publish never leave. A topic somebody typed into a search box and a post somebody chose to publish are the exceptions, they are enumerated here, and widening this again is a decision that gets written down.

Note what this rule does **not** say. It does not ban the `openai` package — Ollama's endpoint is OpenAI-compatible, so the `openai` client pointed at localhost is the correct implementation. Do not hand-roll HTTP to avoid an import.

Cloud models may be used for **evaluation on invented sample data only**, from a separate module with separate credentials whose only data source is a synthetic fixture. Synthetic means genuinely invented — real SKUs, price points, and category structure are competitive information even with the names changed.

### 2. The model never emits a number

Prices and specs come from SQL, substituted through one formatter with one assertion test. KWD is three-decimal fils: `12.500 KD`, never `12.50`.

Spec comparisons ("is this router faster than that one") are answered by SQL over normalised typed columns, never by a 9B model reasoning across heterogeneous `specs` jsonb where one brand writes `wifi_standard: "Wi-Fi 6"` and another writes `speed: "AC1200"`.

The model supplies phrasing. Never figures.

### 3. Never state a fact that is not in a retrieved row

No spec, price, or stock level the catalog does not contain. When the answer is not there, escalate to a human — do not guess, do not hedge into a guess. One fabricated price is a failed acceptance test, because grounding is the entire claim.

### 4. No aggregate score, and no `score` column on advisor tables

A composite number gets screenshotted, quoted in meetings, and tracked as if it meant something, and it is the least meaningful figure in the output. The advisor reports **binary yes/no named checks** with a quoted span as evidence. Any headline figure is a sum of binary checks, never a model-generated number.

The schema is the enforcement: **you cannot hallucinate into a field that does not exist.** Never add a column named `score`, `rating`, or `grade` to `reviews` or any advisor table. `leads.score` is fine — an internal sales metric, not a claim about creative quality.

The words *score*, *rating*, and *grade* do not appear in the advisor UI. Call it a review or a checklist.

### 5. Never generate political or religious content

Not as a topic, not as a marketing angle, not as a seasonal hook. Religious occasions may be referenced only as neutral calendar facts. See `knowledge/kuwait/compliance-guardrails.md`.

### 6. Things not to build

- **No `ChannelAdapter` interface** until a second channel actually exists. `messages.channel` and `external_id` columns are enough.
- **No i18n abstraction.** `products` uses column-per-language and `content_pieces` uses row-per-language. This inconsistency is deliberate — there is no third language coming.
- **No `lib/ai/provider.ts`.** Ollama's OpenAI-compatible wire protocol is already the seam; `OLLAMA_BASE_URL` covers the move to an on-prem server.
- **No job queue or `render_jobs` table.** Rendering a few hundred rows on localhost is a loop and a ZIP.
- **No `product_versions` table.** Product history is snapshotted at the consumer via provenance columns.
- **Campaigns are four columns.** Guard this against your future self — it grows into scheduling, budgets, statuses, and approval workflows, and that is a CRM.

---

## Stack

| Concern | Choice |
|---|---|
| App | Next.js App Router + TypeScript |
| Database | Postgres 17.11, already installed and running via Homebrew |
| Vectors | `brew install pgvector` — only when the corpus is thousands of rows |
| Inference | Ollama on `localhost:11434`, OpenAI-compatible endpoint |
| Excel | `exceljs` — **not** SheetJS, which cannot read image anchors at all |
| SVG parsing | `svgson` or `cheerio` in `xmlMode` |
| Text shaping | `harfbuzzjs` — **not** `opentype.js` |
| PNG export | `resvg-js` — **not** `sharp` |
| PDF export | Installed Chrome via `puppeteer-core` |

Publishing (D83, D86) adds the only credentials in this project that are not local. Placeholders live in `.env.example`; the real values never enter a tracked file.

| Variable | What it is |
|---|---|
| `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET` | The **Instagram** app id and secret from the Meta app dashboard — not the Facebook app id beside them |
| `INSTAGRAM_REDIRECT_URI` | OAuth callback — `https://localhost:3000/api/social/instagram/callback`. **HTTPS, not HTTP**: Meta refuses to save an http redirect URI, so local dev runs `npm run dev:https` (D86) |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | The account hosting the poster for Meta to fetch |
| `APP_ENCRYPTION_KEY` | Encrypts the stored Instagram tokens at rest. A long-lived token is a standing permission to post as the company, and it lasts sixty days |

**No Python anywhere.** A second toolchain for one script is real cost for a solo maintainer.

**Do not `brew upgrade postgresql`** — pgvector has an open issue on Postgres 18.

---

## Models

| Role | Model | Size |
|---|---|---|
| Arabic reading and critique | `QCRI/Fanar-1-9B-Instruct` | ~5.5 GB |
| English generation and JSON | `google/gemma-4-12B-it` or `Qwen/Qwen3.5-9B` | ~5.5–7.5 GB |
| Embeddings | `bge-m3` | ~1.2 GB |

**The resident budget is 12–15 GB, not 24.** macOS gives the GPU roughly 75% of unified memory, and Postgres, Next.js, Chrome, screen sharing, and the embedder all sit alongside. A dense 27B needs 17–18 GB and **will not survive a demo** even though it loads on a quiet machine.

**Fanar is the Arabic reader, not the Kuwaiti copywriter.** Its dialect evidence is comprehension benchmarks, not generation, and the Gulf-dialect claim on its model card is not substantiated in either paper. No open model is Kuwaiti-dialect-aware. Kuwaiti register comes from few-shot exemplars drawn from the company's own past posts, plus human review.

**Do not make Fanar do the English** — its base is Gemma-2-era, two generations behind the alternatives.

### Calling the model

Every call goes through `lib/ai/generate.ts`. Two settings are mandatory there, with comments saying why:

- **`num_ctx: 8192` explicitly.** Ollama's default is 2048–4096 and it *silently truncates*, eating retrieved rows and producing bugs that look exactly like model-quality problems. This is the most common local-RAG footgun.
- **`temperature: 0`** for anything factual.
- **`think: false`** on `gemma4` and `qwen3.5`. Measured, not theoretical: at defaults `gemma4:12b` spent **281 seconds and 8,138 tokens** on a request for a twelve-word caption and returned an *empty* response — the entire budget went to reasoning. With `think: false` the same call takes **4.2 seconds**. Fanar has no thinking mode and needs no flag.

Also set `OLLAMA_KEEP_ALIVE=-1` and pre-warm before any demo — the default five-minute unload means a 20–60 second dead pause mid-presentation.

Structured output uses Ollama's `format` with a Zod-generated JSON Schema. It guarantees **shape, not truth**, so:

1. Parse with Zod on the way out.
2. Check grounding in TypeScript, not by asking the model — `cited_skus ⊆ retrieved_skus` is a set operation. Verify quoted spans with `input.includes(span)`.
3. One retry with the validation error appended, then **fail visibly**. No tolerant parser: a partial result that looks complete is worse than an error when nobody is watching logs.
4. Keep constrained calls small and separate from prose. Grammar-constrained decoding measurably degrades writing quality — generate copy freely, then structure it in a second cheap call.

Never let the same model grade its own output in the same pass. Generate with one, critique with the other.

---

## Layout

```
docs/            vision, architecture, decisions (append-only), demo-script
knowledge/kuwait/  evergreen/ (stable) and timely/ (dated, sourced)
data/samples/    real Excel and images — gitignored, never leaves the machine
data/fonts/      self-hosted OFL fonts; never hotlink Google Fonts
evals/           frozen test sets — the substitute for a deadline
app/(staff)/     studio, advisor, templates, sales-inbox, campaigns
app/chat/        the public customer widget
lib/             excel, template, ai, rag, advisor
db/  scripts/
```

Five lib modules, not seven. `lib/render` belongs inside `lib/template` — they share the manifest type, font loading, and measurement. `lib/kuwait` does not exist; it is markdown plus one read function.

**`lib/template/layout.ts` must stay pure** — shaping, measurement, wrapping, fitting. No I/O, no database, no sibling imports. It is the hardest code in the project and purity is what makes it testable. Keep the SVG snapshot fixtures current; text-layout regressions are invisible until you are looking at 200 bad posts.

---

## Working agreements

**Finish one pillar to "a real colleague used it for real work" before starting the next.** There is no deadline, so nothing external says stop. Four pillars at 70% is the most likely way this fails.

**Nothing gets added without something being removed.** Write the v1 definition of done in `docs/decisions.md` and hold it.

**Docs are load-bearing and dangerous.** A stale doc is worse than a missing one, because a future session will follow it. Four docs, kept current, is the ceiling.

**Do not write the template contract early.** The manifest is derived from the real Excel's column vocabulary, the fit algorithm's needs, and the Arabic output mode. Sketch it; freeze it after the first full-catalogue batch render over real data.

## Agent skills

### Issue tracker

Issues and specs are markdown files under `.scratch/` — there is no remote. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context: `CONTEXT.md` at the root, and `docs/decisions.md` as the decision log. See `docs/agents/domain.md`.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
