# Handoff

State of the project as of 2026-08-26. Read `CLAUDE.md` for the rules, `docs/db.md` for the database, `docs/decisions.md` for why anything is the way it is (append-only, 72 entries, each with a reversal condition), and this file for where things stand.

---

## Run it

```sh
brew services start ollama          # models already pulled, ~21 GB on disk
npm run db:up                       # Postgres in Docker, pinned to pg17, port 5434
npm run db:migrate                  # once, and after any db/*.sql change
npm run dev                         # http://localhost:3000
npm test                            # 367 assertions across 12 suites, seconds
npm run typecheck
npm run eval:chat                   # 30 questions against the live model, ~2 min
npm run kuwait:trends               # today's Kuwait search trends, by hand
npm run backup                      # the catalogue; restore has actually been run
```

**There are two catalogues, and the difference matters.**

| | |
|---|---|
| **The campaign sheet** | ~60 rows, a file, changes weekly. Loaded on *Designs*. What the posters and the copy are about |
| **The full catalogue** | Everything in Postgres, uploaded and edited on *Products*. The assistant, the advisor and the campaign report read it |

The database currently holds **62 rows** — the campaign sheet re-imported, not the 348-row retailer sheet. The retailer catalogue lives in `retailer-products/retailer-catalogue.xlsx` (photos embedded, gitignored); upload it on Products and press **Embed** to make the assistant know all of it. D70 corrected D67 on exactly this point.

**Postgres runs in Docker**, `pgvector/pgvector:pg17`, bound to `127.0.0.1:5434` (5432 is the old Homebrew server with a stale copy — a trap if `DATABASE_URL` ever points back at it). `docker compose down -v` is the only command that destroys the catalogue; `npm run backup` exists and its restore has been run against a destroyed volume.

---

## What works — every screen, no stubs

| | |
|---|---|
| `/` | Cards whose badges are READ from the screens (a stub import = "not built"), not typed. D67 |
| `/templates` — **Designs** | Load a sheet or pick products straight from the catalogue (`?skus=`), render, edit layout, download. D64 |
| `/templates/[id]/edit` | Layout editor: drag, resize, bind columns, per-slot typography, per-product overrides |
| `/products` — **Products** | The full catalogue: upload, search, edit, bulk photos, embed queue. D53–D62 |
| `/studio` — **Content** | Slogans, captions, hashtags, video scripts. Placeholders, never figures. Campaign context rides into the prompt. D69 |
| `/advisor` — **Advisor** | Paste a draft: named binary checks, quoted spans, ranked fixes, `not_assessed` printed. Never a score |
| `/chat` | The PUBLIC customer widget — no sidebar, nothing staff-only reachable from it |
| `/sales` — **Inbox** | Every conversation with full provenance per bot message, why it escalated, silent takeover, campaign shown |
| `/campaigns` — **The loop** | Four columns. What was promoted vs what customers asked about, and what the assistant could not answer. D68 |
| `/kuwait` — **Kuwait** | `knowledge/kuwait/` rendered (markdown stays the source), plus dated search trends with a Refresh button. D70–D72 |

**The chatbot eval passes** — `evals/chat.json`, 30 frozen questions, `npm run eval:chat`: 25/25 answerable, 5/5 escalations, **zero invented figures**, median 3.8s. That is vision.md's third success criterion, met and repeatable. The set is frozen: never edit a question to make a run pass.

**Campaigns close the loop.** Export, studio and chat each stamp `current()` (the newest campaign — a rule, not a status column) without asking. Membership is derived from what was stamped, never stored in a join table. The report reads `assets` from Postgres and drafts/conversations from disk, and its most valuable output is the list of questions the assistant could not answer, in the customer's own words.

**Trends without the app touching the internet.** `scripts/pull-trends.mjs` fetches Google Trends RSS for `geo=KW` — public data, nothing sent — and writes a dated file into `knowledge/kuwait/timely/`. The Kuwait tab renders it, freshness first, warning past seven days. The Refresh button (`/api/kuwait/trends`) EXECUTES that script by fixed path, no arguments, body never read — the one permitted execution, named in CLAUDE.md with its conditions. D71–D72.

---

## The three rules that matter most

1. **No request may leave localhost** — boot-time loopback asserts in `lib/ai/generate.ts` and `lib/db.ts`, plus `scripts/check-localhost.mjs` first in `npm test`: no HTTP client import outside the seam, no external URL literal in `app/`, `lib/`, `db/`. It is not ESLint and cannot be (TS 7 is the Go port; no typescript-eslint supports it) — esbuild strips comments/types and the check reads what is left. D66.
2. **The model never emits a number.** It writes `{price_now:502037}`; `formatKwd` fills it from the row. Grounding is a set operation (`cited ⊆ retrieved`), checked in TypeScript, never asked of the model.
3. **No score anywhere.** Binary named checks with quoted spans. A test greps the advisor for `score|rating|grade` and fails if one appears. The campaigns table is four columns and a test counts them.

---

## Real usage so far

34 conversations sit in `data/state/chat/`, **7 escalated and waiting for a person** in the Inbox. 9 products have content drafts; 5 designs are recorded in `assets` (all pre-campaign, so unstamped). No campaign exists yet — the table is empty, and the first one created becomes `current()` and starts stamping everything. Somebody has clicked Refresh on the Kuwait tab.

---

## Open problems, in the order they matter

**1. No Kuwaiti voice in the copy.** Competent English retail copy with nothing local, because there are no exemplars to few-shot from. Waiting-list item 4 — not a modelling problem, and the largest gap in any pillar.

**2. Arabic names still flag the poster — and it is the sheet, not the app.** The `name_ar` column holds spec sentences, not names (longest 231 chars). Either the sheet gets real Arabic names, or a designer drops the Arabic slot — one click in the editor, and a legitimate choice.

**3. The advisor's other half is gated on the social export.** Comparison to past posts sits in `not_assessed`, named, rather than silently absent. The blind historical test (10 posts, 5 good 5 flops) is the best acceptance test in the project and needs that export.

**4. Most stores are still files.** Postgres holds `products`, `assets`, `campaigns`. Chat conversations, content drafts, the campaign sheet, short names and templates are files. `docs/db.md` lists what each first migration must carry — those columns are irrecoverable. The campaigns FK lands when `content_pieces` and `conversations` do, on all three at once.

**5. Memory at ~200 products on export** — ~1.5 GB peak, accepted at current scale (D39).

**6. `readSlots` ignores ancestor transforms.** Fine for generated templates; the designer-SVG upload path would break on it. No such route exists yet.

---

## Things that will bite you

- **`think: false` on gemma4 and qwen3.5.** At defaults, a twelve-word caption took 281s and returned empty. `num_ctx: 8192` explicitly — Ollama's default silently truncates and looks like a model-quality problem. `OLLAMA_KEEP_ALIVE=-1` and pre-warm before any demo.
- **A node script does not load `.env`; Next does.** Suites call `process.loadEnvFile` first or they connect to the wrong Postgres and SKIP — silently, while the total looks healthy.
- **`numeric(10,3)` arrives from `pg` as a string.** `"20" > "9"` is false. `catalogueProducts` converts; anything new reading prices must too. One representation, never a tolerant comparison (D57).
- **A literal on a template slot applies to every product.** The editor pre-fills the box with the preview product's own value, which makes it look right while wrong. It fired AGAIN on 2026-08-24 — one laptop's Arabic name on the template slot — and the suite refused. The assertion works; keep it.
- **resvg takes font paths, not buffers. HarfBuzz does not do bidi. Isolate whole tokens or nothing** — `MFHP4ZE/A` shipped as `4ZE/A3 MFHP` with every assertion green, twice.
- **`pdfkit`, `sharp`, `harfbuzzjs`, `@resvg/resvg-js`, `exceljs` stay in `serverExternalPackages`.**
- **The sheet's spare columns are hazards** (`Discount %`, `Monthly Installment`, `Product URL`). Retrieval may use the category path to FIND rows; the fact sheet never offers spare columns to SPEAK from. D48.
- **The fact sheet is also the placeholder vocabulary.** The description goes under its own heading or the model writes `{description_en}` mid-sentence. Never show the model a figure you do not want paraphrased — prices appear as field names only.
- **`req.json()` throws on malformed bodies** — `lib/http.ts` exists for this. **Derive, never type, any quantity with a formula.** **A fault computed but never displayed is a comment.**
- **A server page that reads runtime files must say `dynamic = 'force-dynamic'`.** `/kuwait` built static and would have served the build day's trends forever, freshness line asserting otherwise. Found in the build table, 2026-08-26.
- **`table.catalogue` carries a `min-width: 840px` floor** for the Products table; any other table using the class inherits it. `.knowledge` overrides to 0.
- **Retrieval embeds at most 64 missing rows inline.** Beyond that, unembedded rows answer lexically until the Products embed queue runs — a page load must not become minutes of model time.
- **`evals/` is not `npm test`.** The eval needs Ollama and Postgres and refuses to skip — a missing dependency is a loud failure, because an eval that skips silently passes silently.
- **For anything visual, render it and look.** Reversed digits, scrambled model numbers, one name on sixty posters, overlapping panels, a squeezed guardrails column — every one passed the suite.

---

## Verified, 2026-08-26

Everything below was run, not assumed.

| | |
|---|---|
| `npm test` | **367 assertions, 0 failures**, 12 suites |
| `npm run typecheck` | clean |
| `npm run build` | 27 routes, 0 errors (2 known benign trace warnings from reading `knowledge/` at request time) |
| `npm run eval:chat` (2026-08-23) | **PASS — 25/25, 5/5 escalations, 0 invented figures, median 3.8s** |
| `npm run kuwait:trends` | 10 trends written; the tab's Refresh button does the same on a click |
| Campaign loop, live | question escalates → appears in the report in the customer's words; export stamps; cited product counts as asked-about |
| Studio with campaign context | laptop captions carry the free-bag offer, the stylus's do not, zero digits in either (D69) |

---

## Where the last sessions stopped (D64–D72)

- **D64** Design straight from the catalogue — `productsFor()`, URL-held selection, no new store.
- **D65** Panel spacing belongs to `.panel`, once.
- **D66** The localhost rule is CHECKED (esbuild, not ESLint), and two dead home cards deleted.
- **D67** The home page reads the screens instead of describing them. (Its "348 rows" claim corrected in D70 — the count is 62.)
- **D68** Campaigns: four columns with a test counting them, derived membership, silent stamping, both legs of the report.
- **D69** `campaigns.context` actually reaches the studio prompt, fenced — angle yes, numbers never. Two false-success fixes.
- **D70** The chatbot eval (frozen, passing) and the Kuwait screen (markdown rendered, calendar beside the guardrails).
- **D71** Trends via a hand-run script into `timely/`, freshness displayed, no model reads the feed.
- **D72** The Refresh button: a click is a person running the tool. Fixed path, no arguments, body never read.

The way of working that produced all of it, and the one to keep: **grill the module to a shared understanding, build it, then use it for real before believing it.** Every real defect came from using the thing, never from the suite — a correct price called invented, a new campaign inheriting last week's offer, a static page freezing the trends, one laptop's name on sixty posters. The suite exists to stop the SECOND occurrence.

---

## What to do next, in order

**1. Use it for real, for half an hour.** Still the highest-value item. Every screen exists and none has been used for real work by anyone but the machine that built it. CLAUDE.md's bar for a finished pillar is *a real colleague used it for real work*. Create the first campaign (it starts stamping everything from that moment), load a sheet, write copy for five real products, take designs out, answer the 7 waiting conversations in the Inbox.

**2. Decide the catalogue.** 62 rows or 348? If the assistant should know everything the shop sells, upload the retailer sheet on Products and press Embed. Five minutes.

**3. The remaining evals.** The advisor's blind historical test needs the social export; the designer batch test needs the artwork. Both are on the waiting list, neither is code.

**4. Smaller things, already agreed:** the drift banner still has no re-render button; chat and content stores' first migrations are specified in `docs/db.md`; no user identity — every edit is `'a colleague'`.

---

## Waiting on the user

1. A **vector or high-resolution** brand template — current artwork is 465×659, ~19% of A4 at 300 dpi.
2. The **brand's Arabic font licence**: does it permit outlining as well as embedding? Two separate grants.
3. The **social export**: last 100 posts, captions joined to per-post reach. Gates the advisor's other half.
4. **30–50 approved past Arabic posts** — the only source of Kuwaiti voice; no prompt substitutes.
5. A **baseline**: how long do 50 posts take by hand today? Unmeasurable once this replaces the process.

---

## Where the code lives

```
lib/template/layout.ts    shaping, wrap, fit, bidi — PURE, keep it that way
lib/template/columns.ts   sheet + catalogue resolvers (productsFor is the join)
lib/template/render.ts    manifest + row → SVG;  export.ts → PNG/JPG/PDF/ZIP
lib/excel/parse.ts        the importer (withoutCommentRels for the D61 bug)
lib/catalogue.ts          Postgres catalogue: upsert, edits, embed queue
lib/db.ts                 the one Postgres seam, loopback-asserted
lib/ai/generate.ts        the one model seam, loopback-asserted
lib/rag/retrieve.ts       SKU > lexical > category > meaning, in that order
lib/chat/answer.ts        grounded answer or named escalation
lib/chat/reasons.ts       the escalation labels both screens print
lib/chat/store.ts         conversations on disk, in messages' future shape
lib/content/studio.ts     drafts, approval gate, campaign context in the prompt
lib/content/guard.ts      the binary checks copy and chat both reuse
lib/advisor/review.ts     review(text) — checks, blockers, not_assessed
lib/campaigns.ts          create/current/report — the loop, derived membership
lib/money.ts              formatKwd, the only place a price becomes a string
lib/assets.ts             what was exported, and what was baked into it

app/api/campaigns         list/create/context + the report
app/api/kuwait/trends     executes scripts/pull-trends.mjs, nothing else
scripts/pull-trends.mjs   the one outbound request, quarantined, no input
scripts/check-localhost.mjs  rule 1, enforced (esbuild-stripped source)
scripts/eval-chat.mjs     the frozen 30, its own figure check on purpose
scripts/test-campaigns.mjs  four columns asserted, both report legs
evals/chat.json           FROZEN — append with a decisions entry, never edit
```
