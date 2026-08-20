# Handoff

State of the project as of 2026-08-20. Read `CLAUDE.md` for the rules, `docs/decisions.md` for why anything is the way it is (append-only, 51 entries, each with a reversal condition), and this file for where things stand.

---

## Run it

```sh
brew services start ollama          # models already pulled, ~19 GB on disk
npm run dev                         # http://localhost:3000
npm test                            # 165 assertions across 6 suites
npm run typecheck
```

Postgres 17.11 is installed and running via Homebrew but **nothing writes to it yet** — the catalogue lives in `data/state/last-import.json` and templates are files in `data/templates/`. That is deliberate: no schema is committed until the real column vocabulary has settled.

---

## What works

**The whole path from a product sheet to downloadable designs.**

| | |
|---|---|
| `/templates` — **Designs** | The workspace. Load a sheet, pick or add a template, render, download |
| `/templates/[id]/edit` | Layout editor: drag, resize, bind columns, per-slot typography, per-product overrides |
| `/import` | The detailed import view — column mapping and every skipped row |
| `/typography` | The layout engine on its own, for testing a string against a box |
| `/studio` — **Content** | Pick a product, pick a channel, get slogans, captions, hashtags and a video script. Edit, approve, copy |

- **Excel import** — finds the header row under a title block, parses `"KD 89.750"`, matches embedded photos to rows by anchor, skips and reports rather than aborting. Verified on 60 real Retailer products: 0 errors, 0 warnings, 60/60 photos matched.
- **Layout engine** (`lib/template/layout.ts`, pure) — HarfBuzz shaping, bidi runs, wrap-then-shrink-then-truncate auto-fit, outline mode for Arabic.
- **Rendering** — 60 designs in 1.7s, 28 ms each. SVG, PNG, JPG, PDF.
- **Editor** — drag/resize, add any column from the sheet, per-slot font/size/colour/alignment/line-height/shrink-floor/text-mode, rewrite the text of any slot, upload brand fonts (`.ttf`/`.otf`, validated on upload).
- **Per-product overrides** — edit one design without touching the template, with an explicit way back.
- **Export** — one ZIP, folder per format, `README.txt` inside listing every design that needs a look.

**Current state of the real catalogue: 33 of 60 clean, 27 needing a look — every remaining flag is Arabic.** English name flags went 29 to 0 once short names were in. The flyer template is separately tuned now: its price box was 36px against a required 47 and 99px wide against a measured 151, so every one of its sixty designs shrank the price. 60 flags to 1.

**Short names** (`display_name`). Optional per product, from a `Display Name` column in the sheet or written in the app under *Designs → shorten names for posters*. Falls back to the full title, so nothing breaks without one. A local model proposes them a sorted batch of eight at a time — 56 proposals in about a minute — and four binary checks stand between a proposal and a saved name: every word must come from the product's own title, 35 characters, shorter than the title, and **not shared with another product**. That last one caught eleven collisions on the first real run, and is why this is allowed to be automatic at all.

**The content studio, from a row to approved copy.**

- Four model calls per product — copy and script each written as free prose, then sorted into fields by a cheap constrained call, because constraining the writing measurably degrades it. **25–31 seconds** measured on this machine, warm.
- **The model never writes a figure.** It writes `{price_now}` and the catalogue fills it in at read time, so copy approved today stays true after a price change. A bare digit fails a check and cannot be approved.
- **Eight named binary checks**, each quoting the span that failed — invented numbers, claims taken from a spare sheet column, placeholders that are not real fields, placeholders with no value, superlatives, competitor comparisons, guarantees, religion and politics. No score anywhere.
- Editing a draft records it as yours (`source: 'human'`) and returns it to draft. Regenerating keeps whatever was already approved.
- Stored at `data/state/content/<sku>.json` with the columns `content_pieces` will have — `status`, `source`, `model`, `prompt_version`, `campaign_id`, `lang`.
- **Export** — *Studio → Export* gives one `approved-copy-<date>.xlsx`: a row per approved piece with its channel, its `Do not say` guidance in its own column, and who wrote it. Drafts never leave. The Read me sheet carries the export date and the one caveat that matters: **exporting freezes the prices**, because the placeholder is filled on the way out. Re-export rather than edit the file. D51.

---

## The three rules that matter most

1. **Nothing leaves localhost.** Enforced by a boot-time assert in `lib/ai/generate.ts`.
2. **The model never emits a number.** Prices come from SQL through one formatter. KWD is three decimals.
3. **There is no field called `price`.** Templates bind `price_now` or `price_was`; binding `price_kwd` throws. Every product in a real catalogue can be discounted, and a poster carrying the pre-discount price advertises a number the customer will not be charged.

---

## What is not built

The other two pillars and the loop. Each has an honest stub page saying what it will do and what it is waiting on.

- **Creative advisor** (`/advisor`) — **the ungated half works.** The checks — price against the catalogue, claim safety, compliance — need no post history and no model, and `architecture.md` calls the price check *"the most valuable check"*. Still waiting on the social export for the other half: the five most similar past posts with their real reach. Until it arrives that sits in `not_assessed`, named, rather than silently absent.
- ~~**Sales assistant** (`/chat`) and **inbox** (`/sales`)~~ — **v1 works.** See below.
- **Campaigns** (`/campaigns`) — the loop. `campaign_id` belongs in the first migration whenever a database arrives.

---

**The sales assistant, from a question to a person.**

- **Retrieval** (`lib/rag/retrieve.ts`) — an exact SKU in the question wins outright; otherwise lexical scoring, and `bge-m3` cosine in TypeScript only when the words are not decisive. No pgvector at sixty rows, per `architecture.md`.
- **The model never writes a figure.** It writes `{price_now:502037}` — the studio's trick plus a SKU, because one reply can span two products — and the catalogue fills it through `formatKwd`.
- **Grounding is a set operation.** Cited SKUs must be a subset of what retrieval returned, checked with `isGrounded`, never asked of the model.
- **Four ways to fail, all of them escalate**: nothing retrieved, a SKU that was not retrieved, a figure the model typed itself, a field with no value. The reason is named in the transcript, not softened into an apology.
- **A figure in a retrieved row is not invented.** "Airpods 4" and "(SKU 561044)" are the answer. `bareNumber` reuses the copy guard's `isProductIdentity` — one definition of "is this the product's own name", not two.
- **Provenance from the first message.** Every bot reply records `retrieved_ids`, `cited_ids`, model and prompt version, and the inbox prints them under the message. `sender ∈ customer | bot | rep` from the start, so adding a human did not change the shape.
- **Silent takeover.** A rep replying takes the conversation; the assistant stops answering it and the customer is told nothing.

**Measured:** answers a price, a two-variant question and a "what is this" correctly; escalates a returns-policy question and a RAM question. The second is correct and deliberate — spec figures live in a description paragraph, and `architecture.md` requires typed columns before those are answerable.

---

**The creative advisor, v1 — no model, no score.**

- `review(text, {channel, lang})` takes **text, not a draft object**, so the compiler enforces that the thing which writes copy is never the thing that judges it.
- **The flagship check**: *your caption says 25.000 KD, the catalogue says 19.900 KD.* Numeric comparison, so `119.5`, `119.500` and `119,500` are one price written three ways — flagging a formatting difference as a wrong price is how a check loses the credibility that makes people act on it.
- **Claim safety reuses `lib/content/guard`.** One definition of "is this claim safe", not a second that drifts from it.
- **Advice versus checks**, per the architecture: advice tops out at "needs work"; only a check returns "problem". A superlative is a blocker, not a tone note.
- **Rule 4 is asserted, not just intended.** A test greps the module and the page for `score`, `rating` and `grade` outside comments and fails if any appears.
- **`not_assessed` is printed.** Trend fit, hook and clarity, comparison to past posts, and — for an Arabic draft — whether it reads Kuwaiti or reads translated. Silence there would read as a pass.

**Five false positives found by using it, all fixed** — each one was the check crying wolf, which is the failure that makes people stop reading it:

- A **correct** price flagged as an invented number. The copy guard exists to stop a *model* writing a figure; a person reviewing their own draft has every right to type the right price. A price the catalogue agrees with is verified, not invented.
- **A draft carrying two prices** was judged against one product, so the Apple Pencil's correct 19.900 read as drift because the AirPods won the match. It now declines and says so in `not_assessed` — a check that flags a correct price gets clicked past, and then the wrong one gets through too.
- **Claim checks were gated behind a product match**, so a caption the retriever could not place got no safety check at all. They are pure text and now always run.
- **A weak semantic match was presented as the product.** Measured: text about no product tops out near 0.43, a real mention runs 0.50–0.58. Below the bar it reports no match rather than guessing.
- **The same wrong price twice** was two blockers. One problem.

A spec figure and a superlative also used to be filed under the same heading; facts and claims are now grouped by what the check is about.

**Measured** on a deliberately bad caption: four blockers, each quoting its own span, three ranked fixes with the wrong price first.

---

## Open problems, in the order they matter

**1. No Kuwaiti voice in the copy.** What the studio writes is competent English retail copy with nothing local in it, because there are no exemplars to few-shot from. Item 4 on the waiting list below, not a modelling problem — and now the largest gap in the pillar.

**2. Arabic names are the only thing still flagging the poster.** 27 of 60, median 74 characters against English's 66. `display_name` is an English column and does not touch them. `display_name_ar` would need a second reviewing pass, and no open model can judge whether a shortened Kuwaiti name still reads right — so this is human work, or the Arabic slot gets more room.

**3. No database.** Everything is files: the catalogue, the templates, the per-product overrides, the short names, and the content drafts. Fine at 60 products, and the schema decisions in `docs/decisions.md` (message provenance, `assets.bound_values`, `campaign_id`, approval `status`, upsert-by-SKU) are all irrecoverable if rows get written without them. Docker is available whenever this is worth doing.

**4. Memory at ~200 products.** The export holds every buffer, then the ZIP, then a copy — roughly 1.5 GB peak. Accepted at current scale, recorded in D39. This is the one problem a per-batch limit would actually solve.

**5. `readSlots` ignores ancestor transforms.** Fine for generated templates; it is the D2 designer-SVG path that would break. No SVG upload route exists yet.

**6. Three short names still need a human.** 53 of 56 proposals passed every check; the other three are 36 characters, one over. They sit in the edit boxes on the Designs page waiting for a decision.

---

## Things that will bite you

- **`think: false` on gemma4 and qwen3.5.** At defaults, `gemma4:12b` spent **281 seconds and 8,138 tokens** on a twelve-word caption and returned an empty response.
- **`num_ctx: 8192` explicitly.** Ollama's default silently truncates and it looks exactly like a model-quality problem.
- **resvg takes font *paths*, not buffers.** Passing buffers is silently ignored and falls back to system fonts — output looks right locally and wrong everywhere else.
- **HarfBuzz does not do bidi.** Digits in Arabic reverse without `bidiRuns`. This shipped once and 32 assertions stayed green, because the widths are identical.
- **`pdfkit`, `sharp`, `harfbuzzjs`, `@resvg/resvg-js`, `exceljs` must stay in `serverExternalPackages`.**
- **Derive, never type, any quantity that has a formula.** This class of bug appeared four times, twice inside its own fix. `requiredHeight()` exists; call it.
- **The sheet's spare columns are hazards, not just data.** The real one carries `Stock: Yes`, `Monthly Installment: 5.000 KWD`, `Discount %` and `Product URL`, and `parse.ts` keeps every one of them. A human binds a template slot; the model picks a placeholder. D48.
- **`req.json()` throws on a malformed body.** Unhandled, that is a 500 with an empty response body and a log line that says nothing. `lib/http.ts` exists for this. D50.
- **A fallback belongs in the renderer, not in a loader.** `display_name` fell back to `name_en` inside the loader the app happens to use, and the batch script — which reads a sheet straight off disk — rendered 60 of 60 posters with an empty name slot. D47.
- **The fact sheet is also the placeholder vocabulary.** List `description_en:` alongside the other fields and the model writes `{description_en}`, substituting a spec dump mid-sentence. Three captions out of three, twice. It goes under its own heading.
- **Do not show the model a figure you do not want paraphrased.** The fact sheet names `price_now` and says a price exists; it never carries the number.
- **`formatKwd('')` used to return `0.000 KD`.** `Number('')` is `0` and is finite. An absent price printed a figure the shop never set — guarded now, and the same trap is waiting in any new formatter.
- **For anything visual, render it and look.** Assertions did not catch reversed Arabic digits, a strike-through 110px from its text, a box that could never hold two lines, a model number reassembled as `4ZE/A3 MFHP`, or one product's Arabic name printed on all sixty posters. Every one of those passed the suite.
- **Isolating part of a token is worse than isolating none of it.** `⁨…⁩` marks make a run self-contained, so splitting `MFHP4ZE/A` into `MFHP` and an isolated `4ZE/A` guarantees they reorder. Isolate whole tokens or nothing.
- **A literal on a template slot applies to every product.** The editor pre-fills that box with the preview product's own value, which is exactly what makes it look right while it is wrong. `scripts/test-template.mjs` now refuses a manifest carrying one.
- **A fault that is computed but never displayed is not a fault, it is a comment.** `templateFaults` existed, was correct, and reached no screen for the life of the project.

---

## Verified, 2026-08-20

Everything below was run, not assumed.

| | |
|---|---|
| `npm test` | **295 assertions, 0 failures**, 9 suites |
| `npm run typecheck` | clean |
| `npm run build` | 21 routes, 0 errors, 0 warnings |
| Batch render, real 60 products | 33 clean, 27 flagged — every flag Arabic |
| `check-fonts` | every template font resolves |
| Adversarial copy sweep | 18 must-block, 4 must-pass: **0 leaked, 0 false positives** |
| Every page and API route | 200 |
| Malformed body at 11 mutating routes | 66 requests, **no 500s** |
| Live generation, 3 products | 8 of 8 drafts clean each |

A review pass on 2026-08-20 found and fixed seven defects — the pre-discount price
reachable through a placeholder, four hazardous sheet columns, 500s on malformed
request bodies, an unknown SKU writing an invisible permanent orphan, and a
cleared short name resolving to `""` instead of its title. D48, D49 and D50 carry
the reasoning; the bite list above carries the shapes to watch for.

A live end-to-end run the same day — the whole path, on the real sheet, looking at
the output — found seven more. All fixed, each with an assertion:

- **`isolateNumbers` split alphanumeric tokens at the digit**, and the isolate
  marks then reordered the halves: `MFHP4ZE/A` shipped as `4ZE/A3 MFHP`,
  `14-fk0016ne` as `0016nefk-14`, `M4 Pro` as `4 ProM`. Every assertion stayed
  green both times, because the widths are identical. Whole tokens are isolated
  now, and the trailing-unit clause has a lookahead so `KD` in `449.500 KD` is
  still caught while `3 MFHP4ZE/A` is not split in a new place.
- **`slot.text` beat `slot.bind` with no warning.** Saved on a template rather
  than on one product it stamps one row's words on the whole catalogue — 60
  posters carried one laptop's Arabic name, every slot filled and every check
  passing. Now a named `templateFaults` entry.
- **`templateFaults` was computed and consumed nowhere.** `boxTooShort` had been
  discarded since the beginning. Surfaced now in the render API, the export
  README and a banner on Designs — and it immediately named the flyer's price
  box as 36px against the 47px its own size needs.
- **`scripts/make-template-svg.mjs` bound the name slot to `name_en`**, so the
  rebuild HANDOFF tells you to run discarded every short name. `flyer.json` had
  the same stale binding.
- **Three routes 500'd on a malformed body** — `POST /api/names` (which never
  adopted `lib/http.ts`) and `PUT`/`POST /api/templates/[id]`.
- **`{brand} {display_name}` read "APPLE Apple Airpods 4"** on a catalogue whose
  titles already carry the brand. Deduplicated in `fill`.
- **`coverage()` returned total pieces as `drafts`**, printing "8 drafts · 4
  approved" for a product holding four of each.

Two destructive routes now copy what they are about to remove into
`data/.trash/` and name the folder in their response. `DELETE` on a template
took its overrides with it during this run and there was nothing to restore
from — the state directories are gitignored precisely because they hold real
catalogue data, so version control was never going to be the answer.

---

## What to do next, in order

**1. Use it for real, for half an hour.** Load the sheet, shorten the names,
write copy for five products you would actually post, and take the designs out.
Nothing in this document is worth as much as the list of complaints that
produces. CLAUDE.md's bar for finishing a pillar is *a real colleague used it for
real work*, and that has not happened yet for the content studio.

**2. Fix the three short names.** 36 characters each, one over the limit. They are
sitting in the edit boxes under *Designs → shorten names for posters*. Two minutes.

**3. Decide what happens to Arabic on the poster.** 27 of 60 designs still flag,
all of them `name_ar`. Two honest options and they are not equivalent: a
`display_name_ar` column with a second human reviewing pass — no open model can
judge whether a shortened Kuwaiti name still reads right — or give the Arabic slot
more room in the template and accept smaller type. The second is an afternoon; the
first is real recurring human work.

**4. Then pick the next pillar, and only then.** The advisor is gated on the social
export (item 3 below) and changes shape entirely without it. The sales assistant is
not gated on anything and is the larger build. Four pillars at 70% is still the
most likely way this fails.

**Not yet:** the database. It is four JSON files at 60 products, and the studio is
what settles the column vocabulary. The signal to move is a second consumer needing
to query across products — an export of approved copy, the campaign view, or the
advisor looking up past copy. Item 3 above may well be that signal. Docker is
installed and ready when it is.

---

## Waiting on the user

1. A **vector or high-resolution** brand template. The current artwork is 465×659 — about 19% of what A4 needs at 300 dpi.
2. The **brand's Arabic font**, and whether its licence permits **outlining** as well as embedding — two separate grants, and outlining is the default path for Arabic.
3. The **social export**: last 100 posts with captions joined to per-post reach. Gates the advisor.
4. **30–50 approved past Arabic posts** — the source of Kuwaiti brand voice, and worth more than any prompt engineering. Now the studio's largest single gap, not a future one: it writes correct English with no local register, and no prompt fixes that.
5. A **baseline**: how long does producing 50 product posts take today? It stops being measurable once this replaces the manual process.

---

## Scripts

```sh
npx tsx scripts/build-retailer-sheet.mjs      # scraped folder  → product sheet
npx tsx scripts/fetch-arabic-names.mjs     # Arabic names from /ar-KW/, resumable
npx tsx scripts/extract-images.mjs         # embedded photos → data/samples/images
npx tsx scripts/render-catalogue.mjs       # whole sheet → renders/, with a report
npx tsx scripts/make-template-svg.mjs      # rebuild the brand poster template
npx tsx scripts/measure-safe-area.mjs <f>  # largest clear rectangle in artwork
npx tsx scripts/check-fonts.mjs            # every template font resolves
```

---

## Where the content studio's code lives

```
lib/content/guard.ts    the checks and the placeholder substitution — no I/O, no model
lib/content/names.ts    short-name checks and the batched suggester
lib/http.ts             request bodies that fail as 400s rather than 500s
lib/content/studio.ts   prompts, the two-pass generation, and the per-SKU store
lib/money.ts            the one place a price becomes a string, shared with the renderer
app/api/studio/route.ts generate, edit, approve, discard
app/api/names/route.ts   propose, check, save short names
lib/excel/copy.ts        the approved-copy workbook
app/api/export/copy      what is approved, and the download
lib/snapshot.ts         a copy of what a destructive route is about to remove

lib/rag/retrieve.ts     which catalogue rows a question is about
lib/chat/answer.ts      grounded answer or escalation — rules 2 and 3, in TypeScript
lib/chat/store.ts       conversations, in the shape `messages` will have
app/api/chat/route.ts   the customer's side
app/api/sales/route.ts  take over, reply, hand back
scripts/test-chat.mjs   the chat guards, no model needed

lib/advisor/review.ts   review(text) — checks, blockers, ranked fixes, not_assessed
app/api/advisor/route.ts  only the text crosses this line
scripts/test-advisor.mjs  price drift, and rule 4 asserted by grep
scripts/test-content.mjs  the copy guard, no model needed
scripts/test-names.mjs    the short-name checks, no model needed
scripts/test-snapshot.mjs the copy taken before a delete, and its pruning
scripts/test-copy-export.mjs  15 assertions — built and read back, so a draft
                          or a raw {placeholder} cannot escape unnoticed
```
