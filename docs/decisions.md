# Decisions

Append-only. Newest at the bottom. Each entry: what was decided, why, and what would reverse it.

Do not edit past entries. If a decision changes, add a new one that supersedes it by number.

---

## D1 — Output format is SVG, with PNG and PDF alongside

**Decided.** Generated designs are SVG first. PNG and PDF are derived.

**Why.** SVG opens natively in Illustrator, Figma, Inkscape, and Affinity, and it is the only format that can be produced headlessly without an Adobe licence or a running Adobe application. PSD and AI would need Photoshop scripting or a paid SDK with no clean server path.

**Reverses if.** A print workflow becomes primary and the print house rejects the PDF path — then the answer is a real CMYK pipeline, not a different editable format.

---

## D2 — One template format, two authoring paths

**Decided.** SVG upload and (later) a visual editor both emit the same `base.svg` + `manifest.json` pair. The renderer consumes only that pair and never knows which produced it.

**Why.** A data contract rather than a code abstraction. It makes supporting both paths cost barely more than supporting one.

**Reverses if.** Nothing foreseeable. This is the strongest decision in the project.

---

## D3 — All inference is local; the catalog never leaves the machine

**Decided.** Real catalog rows, customer messages, images, and Excel contents go only to Ollama on localhost. Cloud models may be used for evaluation on invented sample data only, from a separate module with separate credentials.

**Why.** The company's requirement. It is also the product's best feature — the reason to build rather than buy — and the strongest version of the argument is that marketing drafts are unpublished commercial strategy.

Verified against Google's own terms: the Gemini API free tier states that submitted content is used to improve Google products and that human reviewers may read it. The paid tier says the opposite. This is categorical, not a matter of degree.

**Reverses if.** Management explicitly relaxes the constraint in writing. That decision also reopens WhatsApp, CRM sync, and hosted infrastructure — see D4.

---

## D4 — The chatbot is a web widget, and WhatsApp is out

**Decided.** The widget on the company site is the product, not a placeholder. `messages.channel` and `external_id` exist from the first migration, but no adapter interface is written.

**Why.** Customers ask their questions on the website today. And WhatsApp Business API routes every customer message through Meta, which D3 forbids. An earlier draft of the plan contained both the privacy rule and a WhatsApp adapter and did not notice the contradiction.

**Reverses if.** D3 is relaxed, or customer behaviour moves to Instagram DM and WhatsApp in a way that makes the widget serve nobody.

---

## D5 — Generated copy is English-first; Arabic rendering is not

**Decided.** AI-written copy is English for now. Arabic *rendering* — placing Arabic product names, prices, and specs from the Excel onto designs — is in scope from day one.

**Why.** These are different risks and an earlier draft wrongly merged them. Rendering is deterministic: a font, shaping, and bidi problem with no model involved. Generating Kuwaiti-dialect copy depends on the weakest capability of small local models. Separating them means the output looks properly bilingual while the risky part waits.

**Reverses if.** Evaluation shows a local model writing Arabic the user judges usable, or enough approved past posts exist to make few-shot generation reliable.

---

## D6 — Retrieval supplies facts; fine-tuning cannot replace it

**Decided.** Product facts come from SQL over normalised typed columns. Fine-tuning, if it ever happens, supplies voice and format only.

**Why.** A fine-tuned model will confidently invent RAM amounts and prices. This is the most common way projects of this shape fail, and it is worth writing down so nobody proposes fine-tuning as a way to "teach it the catalog."

**Reverses if.** Never. Facts come from the database.

---

## D7 — Fanar-1-9B is the Arabic reader, not the Kuwaiti copywriter

**Decided.** `QCRI/Fanar-1-9B-Instruct` for Arabic comprehension, critique, and retrieval grounding. Gemma-4-12B or Qwen3.5-9B for English generation and JSON. Not the Fanar 27B.

**Why.** Verified by reading both Fanar papers in full rather than the model card. The Gulf-dialect claim is on the card and not in the research: *Kuwait* appears zero times in the Fanar 2 paper, *Gulf* once and in an image-generation caption. Per-dialect benchmarks cover Egyptian and Levantine only. What the papers do support is dialect *comprehension*, which is what the chatbot and advisor actually need.

Also both Fanar text models are continual pretraining on Google bases, not from-scratch Arabic models — so "Gulf-built versus multilingual with Arabic bolted on" was the wrong reason to prefer it.

The 9B over the 27B on Arabic grounds and not only memory: roughly 410B Arabic training tokens versus roughly 54B. Seven to eight times more in absolute terms. The 27B also needs 17–18 GB resident, which does not survive a demo.

**Reverses if.** A model with published Gulf-dialect *generation* benchmarks ships under a commercial licence at a size that fits. Re-evaluate only on that trigger, not on general release news.

---

## D8 — No aggregate score anywhere in the advisor, enforced by the schema

**Decided.** Binary yes/no named checks with a quoted span as evidence. No composite number. No column named `score`, `rating`, or `grade` on any advisor table. Those words do not appear in the advisor UI.

**Why.** A local model cannot predict engagement, and a number that looks like a forecast gets used as a measurement regardless of how it is labelled. The explanation is read once, at the demo; the number is read every time after.

Schema enforcement is the cheapest available: **you cannot hallucinate into a field that does not exist.**

Supporting evidence: multilingual LLM-as-judge research measured Fleiss' κ around 0.3 on average with Arabic significantly worse, and found that neither multilingual training nor model scale improves judgement consistency.

**Reverses if.** Never for the advisor. `leads.score` is unaffected — an internal sales metric is not a claim about creative quality.

---

## D9 — The advisor ships first as retrieval over the company's own post history

**Decided.** v1 is: paste a draft, see the five most similar past posts with their real numbers. No model, no score.

**Why.** The rubric lines a small local model can score reliably are lines a regex could score, and the lines that matter it cannot score at all. Social performance has no ground truth, so critique here is not verification — it is a second generation task, harder than writing the caption. Retrieval over real history is honest by construction and is roughly the value of the whole pillar.

**Gated on.** Whether Instagram and Snapchat insights export with **captions joined to per-post reach**. If they do not, this pillar is not built in this form.

---

## D10 — Position the system as assistive, never end-to-end generative

**Decided.** Human-shot footage, assisted script, assisted layout, human approval. A rubric check flags content indistinguishable from wholly synthetic, as a **policy-risk flag, not a quality judgement**.

**Why.** As of 31 July 2026 Snapchat no longer recommends wholly AI-generated video on Spotlight, on a platform reaching 48.2% of Kuwait's population. Content enhanced with AI stays eligible. This is a live policy, and a strong signal about where other platforms are heading.

**Reverses if.** Platforms reverse course, which is not the direction of travel.

---

## D11 — Things deliberately not built

**Decided.** No `lib/ai/provider.ts`. No `ChannelAdapter` interface. No i18n abstraction. No `render_jobs` or job queue. No `product_versions` table. No pgvector until the corpus is thousands of rows. Campaigns stay four columns.

**Why.** Each is an abstraction with one implementation, or scaffolding for a future that has not arrived. With no deadline, scope creep is the primary risk to this project, and campaigns in particular grow into scheduling, budgets, statuses, and approval workflows — which is a CRM.

**Reverses if.** The second implementation actually exists. Not before.

---

## D12 — No Python

**Decided.** TypeScript throughout. `exceljs` reads embedded image anchors, which SheetJS cannot do at all.

**Why.** A second toolchain for one script is real operational cost for a solo maintainer.

**Reverses if.** Never for this project.

---

## D13 — Manifest stores no geometry

**Decided.** Slots reference SVG element ids; the renderer reads position from the SVG at render time.

**Why.** A designer nudges a box and re-exports, and stored coordinates go silently stale. And Illustrator SVGs are nested transform matrices, so absolute coordinates require flattening the CTM at parse and re-flattening on every re-upload. A reference inherits the transform for free — and four SVGs at four sizes can then share one manifest.

**Reverses if.** Never. This one pays for itself repeatedly.

---

## D14 — Outline the Arabic, keep the Latin live

**Decided.** `textMode: "auto"` outlines any string containing Arabic-range codepoints. Ship both a live-text and an outlined file, outlined by default.

**Why.** Illustrator's Middle Eastern text engine is not enabled by default, a non-Arabic language build hides the RTL controls entirely, and Illustrator's own SVG export loses RTL ordering. Converting to outlines is Adobe's own first recommendation.

**The reframe this requires.** Editability was never going to mean a designer retyping Arabic in Illustrator; it means fixing the Excel cell and re-rendering. The template is the editable artifact; the output is a rendering. This needs designer buy-in as a workflow decision.

**Reverses if.** The designer test (see `demo-script.md`) shows live text surviving on the company's actual Illustrator installation with the composer enabled.

---

## D15 — v1 definition of done

**Decided.** v1 is complete when all four hold, and **nothing is added without something being removed**:

1. Fifty real products from the real Excel render in one batch, and a designer confirms the files are workable.
2. The advisor's feedback on five known-flopped posts matches what the team already knows went wrong.
3. Thirty salesperson-written questions are answered with zero invented prices or specs, and the unanswerable ones escalate.
4. The whole thing runs with the wifi off.

**Why.** There is no deadline, so nothing external says stop. Four pillars at 70% is the most likely way this fails. Finish one pillar to "a real colleague used it for real work" before starting the next.

**Reverses if.** The user explicitly redefines v1 here, in a new entry.

---

## D16 — `think: false` is mandatory on the reasoning models

**Decided.** Every call to `gemma4` and `qwen3.5` sets `think: false`. Fanar has no thinking mode and needs no flag.

**Why.** Measured on this machine, 2026-08-19. Asked for a twelve-word English caption at default settings, `gemma4:12b` generated **8,138 tokens over 281 seconds and returned an empty response** — the whole budget went to reasoning that never produced an answer. The identical call with `think: false` completes in **4.2 seconds**.

This belongs beside `num_ctx` as a footgun that presents as a model-quality problem. A future session debugging "the model is slow and returns nothing" will not guess this.

**Reverses if.** A task genuinely needs multi-step reasoning, in which case enable it deliberately for that call and cap `num_predict`.

---

## D17 — Local stack verified working, 2026-08-19

**Decided.** Nothing new. Recording measured results so later regressions have a baseline.

Ollama 0.32.14 via Homebrew. `bge-m3` 1024 dims, embeds code-switched Arabic. Models on disk: `gemma4:12b` (7.6 GB), `qwen3.5:9b` (6.6 GB), `hf.co/mradermacher/Fanar-1-9B-Instruct-GGUF:Q4_K_M` (5.4 GB).

**Fanar reads Kuwaiti dialect and reports in English.** Given a dialect caption containing `اشتري الحين` (dialect, not MSA) and the superlative `أفضل سعر في الكويت`, it identified the superlative, confirmed the call to action, and correctly reported that no specific price was present — answering in English, in 1.8 seconds at 44 tok/s. This is the advisor's actual job and it is the strongest evidence so far that D7's reader-not-copywriter framing is right.

**Schema-constrained output works, 9 of 9.** Three models × three cases (English superlative, Arabic superlative, clean control). Every response was valid against the JSON Schema, every quoted span appeared verbatim in the input, and the clean control correctly produced no false positive. Latency 1.5–5.6 s, inside the 5 s median target.

**What this does not prove.** Detecting a superlative is a mechanical check. It says nothing about whether these models can judge dialect authenticity or cultural fit — see D8 and the Arabic judging ceiling. Those remain human.

---

## D18 — Next.js 16.3 with Turbopack, hand-scaffolded

**Decided.** Next 16.3.1, React 19.2, TypeScript 7. Scaffolded by hand rather than with `create-next-app`, because the directory structure already existed and the generator fights it.

**Why it matters to a future session.** Next 16 removed the synchronous compatibility shim: `params`, `searchParams`, `cookies()`, `headers()`, and `draftMode()` are **async only**. Nothing in this project uses them yet, so there is no migration debt — but the first page that reads a route param must await it.

Turbopack is the default; no flag needed. `next dev` also appends a `nextjs-agent-rules` block to `CLAUDE.md` on every run. It appends, it does not overwrite — our guardrails survive it. Leave the block alone; removing it only re-creates the diff.

The bundled docs at `node_modules/next/dist/docs/` are the authority for this version, not training data.

---

## D19 — Keeping exceljs despite an audit warning

**Decided.** `npm audit` reports a moderate advisory in `uuid` reached through `exceljs`. Not fixing it.

**Why.** The advisory is a missing buffer bounds check in uuid v3/v5/v6 **when a `buf` argument is supplied**. exceljs does not supply one, and this project only ever reads files it was handed. The offered remediation downgrades exceljs to 3.4.0, which removes `getImages()` — the single capability that made us choose exceljs over SheetJS, and the only way to know which embedded image belongs to which row.

**Reverses if.** exceljs ships a release on a patched uuid, or an advisory appears that is actually reachable from a read path.

---

## D20 — Excel importer built and verified against a deliberately messy fixture

**Decided.** `lib/excel/parse.ts` implements the skip-and-report contract. `scripts/test-parse.mjs` asserts it against `data/samples/fixture-messy.xlsx`, which reproduces what real exports actually do wrong.

Sixteen assertions, all passing: a title block above the header is skipped and the real header row found; `"KD 89.750"` parses to `89.75`; a duplicate SKU, a row with no SKU, and a row with no name in either language are rejected with the row number and reason; a missing price warns but keeps the row; a sale price above the regular price warns; a blank row does not truncate the sheet; embedded images are matched to their rows via anchors; unmapped columns are preserved verbatim.

**Two bugs the fixture caught that a clean test sheet would not have.** The `name_en` pattern failed to match `"Product Name (EN)"`, so the English name column was silently unmapped. And the `name_ar` pattern matched a bare `ar` substring, which meant it would have stolen the **"Warranty"** column on any sheet without an Arabic header. Both patterns now use word boundaries, and both cases have their own assertion.

The lesson is worth keeping: a fixture that reproduces real mess finds bugs that a well-formed one cannot.

**Note.** Header matching is heuristic by nature. When the real sheet arrives, the import screen shows exactly which column mapped to which field — check that first, before anything is built on the vocabulary.

---

## D21 — The blank product sheet is generated, not a static file

**Decided.** `lib/excel/template.ts` builds the downloadable template at request time, served from `/api/template`. It is not a checked-in `.xlsx`.

**Why.** The template's header row and the parser's matching patterns are the same contract seen from two sides. A static file drifts the moment someone edits a pattern, and the failure is the worst kind — a sheet filled from our own download imports wrong, which looks like the user's mistake rather than ours. Generating it from code keeps them in one place, and `scripts/test-template.mjs` asserts the round trip: build the template, parse it, and require all nine known fields to map with zero errors.

**What the template carries beyond headers.** Two greyed example rows to delete. Hover notes on every header. Price columns pre-formatted as `0.000` down to row 400, so a price typed into an empty row still displays as fils. Arabic columns pre-set to right-to-left reading order. A frozen header row and an autofilter. And a second sheet explaining the SKU rule, the three-decimal convention, how to attach images, and that extra columns are kept rather than discarded.

**Reverses if.** Never — but if a header name changes, change it in `template.ts` and in `parse.ts`'s pattern together, and let the round-trip test confirm.

---

## D22 — Layout engine built on HarfBuzz, with the ligature claim now measured

**Decided.** `lib/template/layout.ts` is the pure text-layout module: shaping, measurement, wrapping, auto-fit, bidi isolation, and outline conversion. No I/O, no database, no sibling imports. `scripts/test-layout.mjs` holds 30 assertions against it.

**The opentype.js claim is now a number, not an argument.** Measured with Cairo on this machine: the Arabic ligature `لا` shapes to **one glyph, 644 units wide**. Summing its two characters gives 935 — a **45% overestimate**. Any per-character measurement shrinks text that would have fitted. Contextual shaping is confirmed the same way: `ب` alone is glyph 283, in `با` it becomes 286, and in `ابا` the run is 266/286/265. Shaping and measuring are one operation, and HarfBuzz is infrastructure rather than a fallback.

**`font.glyphToPath()` returns real SVG path data**, so outline mode (D14) is confirmed possible rather than assumed.

**A claim in the plan that turned out wrong.** The plan asserted Arabic always runs longer than English. Measured, `ماك بوك برو 14 بوصة` came out **5% narrower** than `MacBook Pro 14-inch`. Length varies per product in both directions, so auto-fit cannot assume it only ever needs to shrink Arabic.

**A bug the tests caught that review would not have.** `uniformSize` originally returned only a number, and when the longest value could not fit *even at the floor size*, it returned that floor — a size at which the value was silently truncated. It now returns `{ size, wontFit }`, naming the values that cannot be shown in full. Those names go straight into the batch report. The general rule this reinforces: a floor is a real floor, and the honest answer at it is "this one will be cut", never a size that quietly cuts it.

**Two assertions of mine were wrong before the code was**, both from guessing at string widths instead of measuring. Test values are now chosen from measured widths, with the measurement recorded in a comment so the next person does not re-guess.

---

## D23 — Fonts are self-hosted OFL files

**Decided.** Cairo (variable), Tajawal (regular and bold), and Noto Naskh Arabic (variable) live in `data/fonts/`, with their OFL licences beside them.

**Why self-hosted.** Linking Google Fonts from a stylesheet is an outbound request on every page load, which breaks the offline requirement and the wifi-off demo. Downloading the files once at development time is public data coming in — the rule is about company data going out.

`resvg-js` also takes explicit font files, which is better than a browser's opaque font matching when the whole point is deterministic output.

**Still open.** If the brand book specifies a commercial Arabic face, it replaces these. Two licence questions, not one: embedding *and* outlining are granted separately, and outlining is the default path here. See `data/fonts/LICENCE-NOTES.md`.

---

## D24 — HarfBuzz does not do bidi. This was found by looking, not by testing.

**The bug.** The typography page rendered `ماك بوك برو 41 بوصة` where the source said `14`, and `005.944` where it said `449.500`. **Every digit in Arabic text was reversed.** Thirty-two assertions passed while this was on screen.

**Cause.** HarfBuzz shapes a *single run in a single direction* — it does not implement the Unicode bidirectional algorithm. The whole mixed line was handed to it as RTL, so the Latin digits were reversed along with everything else. `bidi-js` was installed for exactly this and then never wired in.

**Fix.** `bidiRuns()` resolves embedding levels, applies the reorder segments to get visual order, groups characters into runs of equal level, and hands each run to the shaper **in logical order with its own direction**. `shapeLine()` walks those runs left to right. `measure()` and `outlinePath()` both go through it, so no caller can accidentally take the old single-run path.

Isolate marks (U+2066–2069) are stripped after the levels are computed — they inform the algorithm but must never reach the shaper.

**Why the assertions missed it.** They tested *fitting* — sizes, line counts, widths, truncation — all of which were correct. Nothing asserted on the **order of characters in the output**, because the reversal was invisible to every quantity being measured. Eleven assertions now cover it, including that `449.500` survives intact and never appears as `005.944`.

**The general lesson, worth more than the fix.** This is the exact failure the plan predicted in words — *"a price inside an Arabic run is a bidi-neutral sequence that reorders wrongly; this is the bug that shows up on demo day"* — and it still shipped, because knowing about a bug is not the same as testing for it. For anything with a visual output, **render it and look at it.** No amount of green assertions substitutes for one screenshot, and this one cost thirty seconds.

---

## D25 — Templates can be raster artwork, and the safe area is measured

**Decided.** A template is the brand artwork plus slot rectangles, whether the artwork is vector or raster. The supplied file is a 465 × 659 JPEG, so it is embedded in the template SVG as a base64 `<image>` and the slots sit over it.

**What this costs, said plainly.** The artwork itself is not vector-editable in Illustrator — only the text placed over it is. And at 465 px wide it is **19% of the resolution A4 needs at 300 dpi**, so it will look blocky in print. Fine for screen and social. If a vector or high-resolution original exists, it is worth having.

**The safe area is measured, not eyeballed.** `scripts/measure-safe-area.mjs` grows the largest all-white rectangle out from the centre: **x 15.7%–89.9%, y 25.6%–78.5%**. Stored as fractions so it survives a resolution change. Nothing can be placed on top of the decoration by accident.

**The architecture held.** Even for raster artwork, geometry lives in the SVG as `<rect id="slot-…">` elements and the manifest holds only policy — exactly what a designer's file would produce, so the renderer needs no special case. D13 stands.

---

## D26 — resvg takes font paths, not buffers, and fails silently otherwise

**Found while wiring the render API.** `@resvg/resvg-js` accepts `fontFiles` and `fontDirs` — arrays of paths. It has no `fontBuffers` option. Passing one is not an error: the option is ignored, and with `loadSystemFonts: false` it quietly falls back to whatever it can find.

**Why this is worth an entry.** The renders looked *correct* the whole time it was wrong. The text appeared, the layout was right, the Arabic was properly shaped — because Arabic goes out as outlined paths and needs no font at all, and the English happened to land on a system font. Switching to `fontDirs` changed the PNG from 66 KB to 187 KB, which is the only reason it was caught.

The failure mode this would have produced: output that looks right on this machine and wrong on the on-prem server, where the system fonts are different. **Deterministic rendering was the entire reason for choosing resvg over a browser**, and passing buffers silently gave that away.

`lib/template/store.ts` now exposes `fontDir()`, with the reason in a comment beside it.

---

## D27 — Every design that needed attention is named

**Decided.** `renderProduct` returns a `report` alongside the SVG: which slot was truncated, which shrank and to what size, which was empty, which had no photo. A missing image renders a visible `IMAGE MISSING` placeholder rather than a blank space.

**Why.** A design that had to cut a product name is wrong, and the only thing worse than producing it is producing it quietly. In a 200-item batch nobody inspects every output, so the system has to say which ones to look at.

It is also the more credible claim. *"12 of 200 needed attention, here they are"* survives someone finding the broken one; *"200 designs, all perfect"* does not.

---

## D28 — Stock template previews are not templates

**Two AVIF files were supplied as candidate templates.** Both are 740 × 740 stock *preview mockups*: the poster shown standing on a grey backdrop with a drop shadow. Measured, **51% and 53% of each file is backdrop rather than artwork.**

Neither is usable as delivered:

- **pop-color-poster** has `POSTER TEMPLATE` burned into the design, and the layout is dominated by one large circle leaving little usable area.
- **abstract-flyer** has a `loremipsum.com/username` social bar baked into the bottom.

**What was salvageable.** `scripts/extract-poster.mjs` finds the poster face by scanning inward from each edge for the first bright pixel, and crops the mockup away. For the flyer, trimming a further 38px removed the placeholder bar, leaving a clean 442 × 550 artwork that measured a safe area of x 17.9%–79.0%, y 27.1%–74.2% and rendered correctly on the first attempt.

**The useful result is what this proved about the architecture.** A second template, a different shape and a different palette, needed **no code changes at all** — only an artwork file and four measured numbers. Geometry in the SVG, policy in the manifest, one renderer. D13 is now demonstrated rather than argued.

**What to actually ask a designer for**, in order of preference: the vector source (AI, EPS, or SVG); failing that, a flat high-resolution export of the artwork alone with no mockup, no shadow, and no placeholder text. At 442px wide these are around 18% of the resolution A4 needs at 300 dpi.

**Licensing is a real question, not a formality.** Files named like stock-library downloads carry a licence that governs commercial use, and a preview thumbnail is generally not the licensed asset. Worth confirming before a customer-facing campaign is built on one.

---

## D29 — AVIF is converted to PNG on import

**Decided.** `scripts/import-artwork.mjs` converts incoming artwork to PNG. sharp decodes AVIF happily, but embedding AVIF inside an SVG is a bet on every downstream renderer supporting it, and the artwork here is flat colour that compresses well as PNG regardless.

**Reverses if.** Artwork appears that is photographic enough for the size difference to matter, and every renderer in the chain is confirmed to handle AVIF.

---

## D30 — The layout editor, and the two-stage model behind it

**Decided.** `/templates/[id]/edit` is a direct-manipulation editor: drag boxes to move, corner handles to resize, a palette to add any column from the sheet, and a properties panel for font, size, colour, alignment, max lines and image fit. The rendered result sits beside the canvas and updates as you move things.

The reviewers argued this should be deferred as the largest permanent maintenance surface in the project. It was asked for three times and is central to how the user expects to work, so it is built. Recording the disagreement rather than pretending it was never raised.

**The two-stage model, which the user specified and which is better than what was planned.**

1. **Template stage.** Lay out the design against *placeholders*, before any catalogue exists. This is the style of the post: where the photo sits, where the price goes. It belongs to the template and applies to every product.
2. **Per-product stage.** After a batch renders, adjust a single design — or several — without disturbing the rest.

Stage one is built. Stage two is not, and it needs a real decision when it comes: overrides stored per SKU against a template version, with an obvious way back to the template default, or fifty products quietly become fifty different layouts and the grid stops looking like a set.

**Placement is unconstrained, by request.** The measured clean area is available as a toggleable guide, off by default. No warnings, no snapping. Text on top of the artwork is sometimes exactly what is wanted.

**The architecture held again.** The editor writes the same two files a designer's export would produce: geometry into the SVG's slot rects, policy into the manifest. The renderer is untouched and does not know an editor exists — which is the whole point of D13.

**One thing worth watching.** The live preview re-renders on a 220 ms debounce, server-side, at full quality. It is fast enough on a four-slot template on this machine. A twenty-slot template or a slower machine will need the preview downscaled or moved to a coarser client-side approximation while dragging.

---

## D31 — Selection was cleared by the click that follows a drag

**The bug.** Clicking a box selected it and showed its resize handles, but the moment the mouse was released the selection vanished — so nothing could be resized and the properties panel never stayed open.

**Cause.** The canvas had `onClick={() => setSelected(null)}` to deselect on empty space. `stopPropagation()` was called in `onPointerDown`, which stops the *pointerdown* from bubbling — it does nothing about the **click** event that fires afterwards. That click bubbled to the canvas and cleared the selection every time.

**Fix.** The canvas only deselects when the click actually landed on the canvas itself (`e.target === e.currentTarget`). Slots and handles also stop their own click events, and pointer capture is released on `pointerup` so the next gesture starts clean.

**Worth remembering:** pointer events and mouse events are separate streams. Suppressing one says nothing about the other, and a bug like this is invisible to a typecheck and to every assertion in the project — it only exists in the interaction.

**Also changed.** The properties panel now sits above the result preview rather than below it. On a laptop screen it was under the fold, so the controls appeared not to exist at all — which is likely why the report was "the options disappear" rather than "I cannot resize".

---

## D32 — Real catalogue data, and the three problems it exposed in one run

**60 real products** from a Kuwait electronics retailer — `scripts/build-retailer-sheet.mjs` turns the scraped folder into a product sheet with 22 columns and every photo embedded and anchored to its own row. The importer read it with **zero errors and zero warnings**, matched all 60 photos, and `scripts/extract-images.mjs` wrote them back out by SKU. Spot-checked: SKU 657276 really is the iPad Pro. Anchor reading is verified against real data, not a fixture.

Rendering all 60 takes **1.6 seconds, 27 ms per design**.

Three things surfaced that no amount of sample data would have shown.

**1. A template whose geometry could not do what its manifest asked.** The English-name box was 52 px tall with `maxLines: 2` at 30 pt. Two lines need 81 px; even at the shrink floor they need 53 px. **The box could never hold two lines**, so every long name truncated — 60 of 60. Three hand-picked sample products all had short names, which hid it completely.

Fixed by deriving slot heights from `ceil(size × lineHeight × lines)` rather than typing a number that looked about right. Truncations fell from **60 to 17**. The editor now exposes line height and shrink floor so the relationship is visible while editing.

**2. Product names are catalogue titles, not headlines.** Median 66 characters, longest **177**: *"HP OmniBook X Flip 2-in-1 Convertible Laptop Next Gen AI, AMD Ryzen AI 7, 24 GB, 1TB, AM…"*. 53 of 60 exceed 40 characters. The remaining 17 truncations are not a layout bug — no geometry rescues a 177-character name. This needs a content answer, not an engineering one.

**3. Every poster advertised the wrong price.** All 60 products are discounted, the sheet carries both figures, and the template binds only `price_kwd`. The iPad Pro poster read **759.900 KD** when the selling price is **499.800 KD**. A poster quoting a price the customer will not be charged is a commercial problem, not a cosmetic one. **Unresolved** — the template contract needs a way to make binding "price" on a discounted product impossible to get wrong by accident.

**The specs confirmed a prediction.** The same attribute appears under several names across the catalogue — `Colour` and `Color`, `RAM` and `Laptop Memory (RAM)`, `Screen Size` and `Laptop Display Size`, `Processor` and `Laptop Processor`. The sheet builder normalises them into single columns, which is exactly why the plan insists the assistant answer comparisons from typed columns rather than from raw jsonb.

---

## D33 — The preview applies on demand, and never flatters the data

**Decided.** The editor renders when **Apply** is pressed, not on every drag. A `live` toggle restores continuous rendering for anyone who wants it, off by default. The button shows whether there are unapplied changes.

**Why.** Rendering on every pointer move is a server round trip per pixel, and it makes it harder to see what a deliberate change actually did. An explicit apply also makes the cost of a change visible.

**Preview with a real product.** The editor offers twelve products from the last import, **longest name first** — a layout that survives the worst case survives the rest. The typography controls (line height, shrink floor, Arabic text mode) now live in the editor beside the slot they affect, rather than on a separate page.

**A preview must not fill gaps from placeholders.** Previewing a real product initially merged placeholder samples underneath it, which painted Arabic onto a catalogue that has none — hiding the single most important fact about this data. A real-product preview now shows that product and nothing else. The empty Arabic line is the truth, and the truth is what the preview is for.

---

## D34 — There is no field called "price"

**Decided.** A template can bind `price_now` (what the customer pays) or `price_was` (the struck original). Binding `price_kwd`, `sale_price_kwd`, or `price` **throws** at render time with a message naming the correct field.

**Why a hard error and not a sensible default.** A default just means the wrong binding gets made again next quarter and works by accident until it doesn't. Every product in this catalogue is discounted, and a poster carrying the pre-discount price advertises a number the customer will not be charged. That is a commercial exposure, not a cosmetic bug — and the 60-product render showed it on every single poster before it was caught.

The sheet keeps saying "Price" and "Sale Price", because that is what a retail sheet says. `parse.ts` derives `price_now`, `price_was`, `on_sale`, and `discount_pct` from them, so the template vocabulary describes the poster rather than the spreadsheet.

**The discount badge is computed, never bound.** `discount_label` is derived at render from the two prices, so a badge cannot disagree with the numbers printed beside it. Checked against all 60 source values: zero mismatches, so the data is clean — computing removes the chance of a stale one.

**Strike-through is drawn, not styled.** `text-decoration` is not honoured by resvg, and a was-price that silently fails to render struck is the original bug wearing a different hat. The line is emitted as geometry, positioned from the measured text width.

The layout follows the retailer's own product page: struck original, prominent current price, percentage badge.

---

## D35 — Arabic names come from the retailer's own Arabic storefront

**Verified before building on it.** Every Retailer product page exists under `/ar-KW/`, and its `<h1>` carries the Arabic name. Sampled five products across all three groups: **5/5 returned a genuine Arabic product name.**

- `Apple AirTag (4 Pack)` → `جهاز التعقب ابل اير تاج (4 قطع)`
- `Apple Pencil 2nd Generation, MU8F2ZM/A - White` → `قلم اّبل الجيل الثاني - MU8F2ZM/A - أبيض`
- `Blueair 3610 Prefilter Night Waves` → `مرشح التصفية المسبقة بلو إير 3610 - أزرق داكن`

**A correction to the advice this came from.** The report said the name is in the JSON-LD `"name"` field. It is not — the first `"name"` in the page is the site title (`اكسايت | موقع اكس سايت للتسوق اون لاين في الكويت`), and a naive extraction returns that for every product, which looks like a 100% success rate while producing identical wrong output 60 times. The name is in the `<h1>`. Worth recording because it is the difference between a working scraper and one that appears to work.

This is the retailer's own approved copy, better than any translation and far better than asking marketing to retype sixty rows. The sheet column stays as an override: the scraped value is the default, a manual entry wins.

**It makes the layout problem worse, not better.** Measured, Arabic names run *longer* than English. The empty Arabic line gets filled and the geometry pressure increases.

**Identity is the URL, not the folder name.** At least two folder slugs in the dataset disagree with their live page, and one folder named for a 12.9-inch Magic Keyboard contains a 13-inch Arabic keyboard. The scraper keys on `manifest.url`.

---

## D36 — Per-product overrides, and the way back

**Decided.** Every design in the grid has an **Edit this one** link. It opens the editor at `?sku=…`, where changes are saved to `data/templates/<id>.overrides.json` keyed by SKU instead of to the template. A banner states which mode you are in, cards carry an **own layout** badge, and an overridden product has a **Follow the template again** button that deletes its exception.

**Why the reset matters more than the override.** Without an obvious way back, fifty products quietly become fifty layouts and the catalogue stops looking like a set. Overrides live in their own file so it is always visible which products have drifted, and removing one restores the template exactly.

**A slot can carry literal text.** Set on an override it rewrites that one poster; set on the template it is a static label for every product. This is the answer to the long-name problem — a marketer shortens `Apple iPad Pro (M4) 5G Tablet, 1TB, 16GB RAM, 13-inch, MWRY3AB/A – Black` to `iPad Pro M4 13-inch` on the poster without touching the sheet. Clearing the field returns the slot to its column. The editor shows the resolved value and a character count beside it, because 16–35 characters is the poster range and 66 is the catalogue median.

---

## D37 — Export: four formats, and the report ships inside the ZIP

**Decided.** `/api/export` builds a ZIP with a folder per format. PNG for screens and social; JPG for WhatsApp and email, flattened onto white because JPEG has no alpha and an unflattened one turns into black edges; SVG for the designer, with Arabic already outlined; PDF for approvals and the print house.

**`README.txt` goes in the ZIP**, listing every design that needed a look. A folder of sixty designs with no note about which ones to check is how a bad one reaches a customer.

**PDF is drawn with `pdfkit`, not a browser.** The plan called for headless Chrome, but no Chrome is installed — only Brave — and driving somebody's daily browser as a build step is fragile. Since the artwork is itself a raster file, a vector PDF gains nothing, so the page carries the rendered image. It is RGB: an approval artifact, not a print master, and the ZIP says so.

**`pdfkit` had to be added to `serverExternalPackages`.** It loads `.afm` font metrics by relative path, and bundling rewrites that path to a directory that does not exist — the export failed with `ENOENT … /ROOT/node_modules/pdfkit/js/data/Helvetica.afm`. `sharp` and `harfbuzzjs` were added alongside it for the same reason.

---

## D38 — The same geometry mistake, twice, so the class got fixed

**What happened.** The flyer template was migrated to the new price fields by hand, and its price boxes were given heights that were typed rather than derived — 20 px for 15 pt text needing 20.3, and 27 px for 30 pt needing 40.5. Exactly the fault recorded in D32, made again by the same person a day later.

**Fix.** `requiredHeight(size, lines, lineHeight)` and `boxFits(...)` now live in `layout.ts`, and `render.ts` reports **`boxTooShort: { need, have }`** when a slot's box cannot hold its own settings. That distinction matters: previously this surfaced as a mysterious shrink or truncation, which reads as a data problem when it is a template fault. Template-building scripts derive every height from the helper.

**The general lesson.** A number that can be computed and is instead typed will eventually be typed wrong, and the failure will look like something else. Two occurrences of the same bug is a missing function, not carelessness.

**Also fixed:** the render and export routes returned a bare 500 when the price-bind guard threw, which surfaced in the UI as `Unexpected end of JSON input`. They now return the guard's message as JSON, so the person who can fix the template reads what is wrong with it.

---

## D39 — An adversarial audit found the same class of bug in nine live places

A code review was asked to hunt for one *class* of fault rather than a list of nits: **a quantity with one true derivation, computed a second time by hand somewhere else, with nothing but output comparison to catch the drift.** It found nine live instances. Two were the box-height bug from D32 and D38 shipped a third and fourth time — one of them inside the fix itself.

**Fixed, in order of how quietly they were wrong:**

- **A saved override took the whole workspace down.** `readdirSync().filter(f => f.endsWith('.json'))` matched `brand-poster.overrides.json`, then read a `.overrides.svg` that does not exist — unhandled throw, 500, empty template list. Dormant only because no override had been saved yet. Verified by writing one: the page went from 200 to 500 immediately.
- **The editor offered only the two forbidden price fields.** `price_kwd` and `sale_price_kwd` were in the palette; `price_now`, `price_was`, and `discount_label` were derived in `parse.ts` and appeared in no vocabulary the editor could see. Building a price slot in the UI was guaranteed to throw the D34 guard, with no correct alternative on offer. The palette now excludes the forbidden names and always offers the derived ones.
- **`boxTooShort` printed as `shrunk to undefinedpt`** in all four consumers — the fix for "reports a symptom rather than a cause" reported itself as the symptom it replaced. It is now handled in each reader, and hoisted to a `templateFaults` list: a template fault is identical for every product, and reporting it per product flagged 200 of 200 and buried the real truncations, collapsing D27's credibility argument.
- **The strike-through landed ~110px from an RTL was-price.** `render.ts` derived the line's range from `slot.align`; `render-text.ts` derived the text anchor from `slot.align` **and** the resolved direction. They agreed only for LTR. The line now comes back from `renderText` as `lastLine`, taken from where the text was actually painted — one derivation, not two.
- **The discount badge could disagree with the prices beside it.** It was derived from `discount_pct` rather than from the two prices, and a hand-supplied `discount_label` won outright. It is now computed at render from `price_now` and `price_was`, and any incoming label or percentage is discarded — including the sheet's own `Discount %` column.
- **`isolateNumbers` isolated the number out of its own Latin phrase.** It absorbed a trailing suffix but never a leading one, so `معالج AMD Ryzen AI 7 بذاكرة` rendered as `7 AMD Ryzen AI`. Widths are identical either way, which is exactly why all 30 layout assertions stayed green — the same reason D24 shipped. The whole Latin phrase is isolated now.
- **`fitText` never tested the floor.** The binary search only evaluated strictly-interior midpoints, so text that fits exactly at `minScale` was truncated anyway. The floor is now a candidate.
- **`fitsAt` had its own height formula**, a second derivation of `requiredHeight`. It calls the helper.
- **`scripts/make-template.mjs` shipped both old bugs**: `size = boxHeight × 0.52` with `maxLines: 2` needs 1.4× the box it was cut from, so it could never fit **at any safe-area size** — a ratio wrong by construction, not a bad number. It also still emitted `bind: 'price_kwd'`, making every template it built a guaranteed error. Both builders now derive sizes first and heights from `requiredHeight`.
- **A `$&` in a product name corrupted the SVG** — string-form `replace` treats it as a substitution pattern. Now a function replacement.

**Recorded as accepted risk rather than fixed:** memory at 200 products (the export holds every buffer, then the ZIP, then a copy), `readSlots` ignoring ancestor transforms on an uploaded designer SVG, and the header-matching regexes being order-dependent. Each is real; none produces wrong output at the current scale.

**The structural lesson the reviewer put better than I would have:** make the second derivation impossible rather than checked. That is why `SlotReport` variants, the strike range, and the price vocabulary were all moved to a single source instead of being kept in sync.

---

## D40 — One workspace, not two pages

**Decided.** `/templates` becomes **Designs**: the catalogue strip, the template picker, add and delete, the layout editor, the grid, and the export all on one screen. `/import` remains as the detailed view, reached when the column mapping needs checking.

**Why.** Importing a sheet and building a design are one task, and splitting them across two pages made the user hop mid-flow. The strip collapses to a single line once a sheet is loaded — `60 products · retailer-products.xlsx · 8 columns understood` — and expands on demand, so the mapping check stays available without occupying the screen.

**Also changed:** the Arabic slot now defaults to two lines. With Arabic names scraped in, the one-line default cut 32 of 60 — Arabic runs *longer* than English on this catalogue, and the default was built before there was any Arabic to test against.

---

## D41 — Fonts are read from disk, and brand fonts can be uploaded

**Decided.** `data/fonts/` is the font list. The editor offers whatever is in it, with **+ add a font…** in the same dropdown. Uploads accept `.ttf` and `.otf` and are **parsed before being kept** — a font that cannot be shaped is worse than no font, because it would otherwise fail during somebody's batch rather than here where the person who uploaded it is watching.

**Why not a fixed list.** The previous hardcoded map would have accepted an upload and then silently failed to render with it — the exact shape of failure recorded in D39.

**Aliases, so existing templates keep working.** `Cairo-Variable.ttf` answers to *Cairo Variable*, *Cairo*, and its bare first word; a designer uploading `MyBrand-Bold.otf` can write either *MyBrand Bold* or *MyBrand*. Specific names are registered last so they win a collision. `scripts/check-fonts.mjs` asserts every font any template binds actually resolves — an unresolvable name would otherwise render silently in the wrong face.

**Typography lives on the slot now.** Font, size, alignment, colour, line height, shrink floor, and Arabic text mode are all in the layout editor beside the box they affect. The standalone typography page remains as a bench for testing a string against a box, but it is no longer where the work happens.

---

## D42 — Handoff

`HANDOFF.md` at the repository root carries current state, open problems in priority order, the footguns that have already cost time, and what is still needed from the user. `docs/decisions.md` remains the authority on *why*; the handoff is *where things stand*.

Four memories were also written to the user's durable memory: the project and its local-only constraint, the derive-don't-retype bug class, the user's UI preferences, and the Retailer `/ar-KW/` finding including the trap that `/ar/` is the Saudi store.

---

## D43 — Copy carries placeholders, never figures

**Decided.** Generated copy is stored with `{price_now}`, `{price_was}`, `{discount_pct}` and the sheet's own column names in it, and those are substituted at read time through `lib/money.ts`. The model is told a price *exists* and is never shown the figure. A bare digit anywhere in a draft fails the `no invented numbers` check and the draft cannot be approved.

**Why the model is not shown the number.** A figure it has seen is a figure it will paraphrase — into the wrong currency convention, into a rounded version, into a different sentence next time. Telling it only that the field exists removes the option.

**Why storage keeps the placeholder.** Copy approved in March and posted in June should carry June's price. Substituting at generation time would freeze a number into an approved string, and nothing downstream would know it had gone stale.

**The placeholder vocabulary is the sheet's own column names**, minus descriptions and other prose fields. Two measured reasons. The model writes `{name_en}` because `name_en` is what the fact sheet showed it — a separate friendlier alias like `{name}` produced a rejected draft on the first real run. And a substituted `description_en` reads as a parts list: *"Experience seamless Bluetooth Wireless Connectivity. Transmits Position, Angle, Force. Compatible with Mail and Notes Apps with the Apple Pencil…"*. Descriptions are source material the model reads and rewrites, never something dropped into a sentence.

**Reverse this if** a channel needs copy where the price is genuinely fixed at approval time — a printed catalogue, a paid ad locked for a flight. That would want a second stored field, not a change to this one.

## D44 — Checks are the approval gate, and they run in TypeScript

**Decided.** Every draft carries named binary checks with the exact span that failed: `no invented numbers`, `every placeholder is a real field`, `every placeholder has a value`, `no unsubstantiable superlative`, `no comparison to a competitor`, `no guarantee the company has not made`, `nothing religious or political`. Approval is refused while any of them fails, and the checks are re-run against the current text at approval rather than trusted from the stored draft.

**Why not a model.** Asking a model whether its own caption invented a price is asking the thing that invented it. Every one of these is a string operation, which is the same reasoning as `isQuoted` and `isGrounded` in `lib/ai/generate.ts`.

**Deliberately over-eager.** A false positive costs one glance from the person approving. A false negative is a published claim the company cannot substantiate, and `knowledge/kuwait/compliance-guardrails.md` says that class of mistake is not recoverable by an edit.

**No score, per CLAUDE.md rule 4.** The word does not appear in the studio, the schema, or the stored piece.

## D45 — Content is files, with the columns the table will have

**Decided.** Drafts live in `data/state/content/<sku>.json`, one file per product, each piece carrying `status`, `source`, `model`, `prompt_version`, `campaign_id`, `lang`, and timestamps — the vocabulary `docs/architecture.md` names for `content_pieces`. Still no database.

**Why now and not at the migration.** Threaded from the start these fields are free and real. Bolted on later, `campaign_id` is a backfilled number and `source` is a guess about who wrote a line. The studio is what settles this vocabulary, so writing the schema before running it would freeze the wrong columns.

**Editing a draft sets `source: 'human'` and returns it to `draft`.** The approval that follows is approval of the person's words, not the model's, and the distinction is the whole provenance claim.

**Regenerating keeps approved pieces.** Losing an approval to a click meant to produce alternatives is not recoverable from the UI.

**Reverse this when** a second consumer needs to query across products — an export, the campaign view, or the advisor looking for past approved copy. Reading sixty files to answer one question is the signal.

---

## D46 — `display_name`, and the check that makes it safe

**Decided.** Products carry an optional short name for posters and captions. It comes from a `Display Name` column in the sheet or from the app, the app's version wins, and clearing it returns the product to the sheet. It falls back to `name_en`, so a template binding `display_name` is always safe to bind. The brand poster now binds it, and the content studio writes about it instead of `name_en`.

**Why a model may propose these at all.** Mechanical shortening was measured and rejected — cutting at the first comma produced `HP Laptop` for two different laptops. A model proposes and a person approves, with four binary checks between them: **every word comes from the product name** (a selection, never an addition — verified in TypeScript, the same reasoning as `isQuoted`), **fits a poster at 35 characters**, **shorter than the catalogue title**, and **not shared with another product**.

**The collision check is the one that earns the feature.** On the first real run it caught eleven names: three iPhone Air bumpers differing only in colour, two MacBook Pros differing only in model code, and four Vivobooks differing only in CPU, each pair collapsed to one identical headline. That is the `HP Laptop` failure reproducing itself live, and it is why automatic shortening cannot be trusted without a whole-catalogue check.

**Batches are sorted by name.** The instruction to keep two products apart is worthless if the model cannot see both. Sorting puts near-duplicates in the same batch of eight; that alone took collisions from eleven to two.

**A cut order beats a length limit.** Told only "35 characters maximum", the model kept the distinguishing spec and overshot on fourteen products. Given an explicit order — everything after a comma, then model codes and capacities, then generic category words the brand already implies, then colour last — it produced 53 of 56 clean at a median of 28 characters. `Asus Vivobook 16 Core Ultra 5`, not `Asus Vivobook 16 Laptop Intel Core Ultra 5`.

**Saving accepts the passing subset.** Refusing fifty-three reviewed names because three are one character too long throws away work that would simply be redone. The refused ones come back into the edit boxes.

**Measured.** Slot flags on the real 60-product catalogue: `name_en` **29 → 0**. The remaining 27 are all `name_ar` — Arabic is a separate column and a separate problem.

**Reverse this if** Arabic needs the same treatment. That is `display_name_ar` and a second reviewing pass, not a change to this one — and no open model can judge whether a shortened Kuwaiti name still reads right.

## D47 — The fallback lives in the renderer, not in the loader

**Decided.** `renderProduct` resolves `display_name` to `name_en` when it is empty, beside where `discount_label` is derived. `lib/template/columns.ts` still applies the saved override, but the fallback itself is the renderer's.

**Why.** It was in the loader first, and `scripts/render-catalogue.mjs` — which reads a sheet straight off disk — rendered **60 of 60 posters with an empty name slot**. Every path that binds a slot has to get the same answer, and a fallback that lives in one of several loaders is a fallback that one caller has. The renderer is the only place all of them pass through.

---

## D48 — The copy guard's vocabulary is the sheet's, so the sheet's hazards are its problem

**Decided.** A placeholder may reference a product's own columns, and four classes are refused whatever a particular sheet calls them: **availability** (`Stock`, `Availability`, `Qty`), **financing** (`Monthly Installment`, `Instalment`, `Tabby`), **the discount column** (derived from the two prices, never read), and **links and paths** (`Product URL`, `Category Path`). The forbidden price fields are the same list the renderer and the template palette use — one list now, `FORBIDDEN_PRICE_FIELDS` in `lib/money.ts`, where it used to be three and the copy guard had none.

**Why this is the sheet's structure and not the model's fault.** `parse.ts` keeps every unmapped column verbatim, deliberately, so nothing is silently lost. The real Retailer sheet carries `Stock: Yes`, `Monthly Installment: 5.000 KWD`, `Discount %`, `Category Path` and `Product URL`. A template slot binding one of those is a human dragging it there; a caption is the model choosing it. Measured before the fix: `Only {price_kwd} today.` filled to **`Only 40.5 today.`** on a product selling for 19.900 KD — the pre-discount price, unformatted, straight into a caption.

**The token pattern had to widen to catch them.** It matched `[a-z_]+`, so `{Stock}` substituted, and `{Monthly Installment}` and `{Discount %}` matched nothing at all and printed as literal braces — not flagged, not substituted, shipped. A real retailer names columns in prose. Anything brace-shaped is now examined.

**Reverse this if** a column in one of these classes is genuinely safe for a given retailer — a stock figure the company does commit to, say. That is a per-deployment allowance, not a change to the default.

## D49 — A figure that is part of the product's name is not an invented number

**Decided.** `no invented numbers` allows a digit-bearing word that appears verbatim in the product's **identity** fields — `name_en`, `display_name`, `brand`, `category`. Not the description.

**Why.** `M4`, `iPhone 16`, `Wi-Fi 6`, `RT-AX88U` are what the product *is*. Blocking them fired on **three of eight** real drafts for one iPad Pro, on the product's own model name. A check that cries wolf on the thing being sold is a check people learn to click past, and then it is not protecting anything.

**Why the description is excluded.** A figure lifted out of a spec paragraph — `32GB of memory` — is exactly what CLAUDE.md rule 2 is about. The line is between the name on the box and a number in the specs.

**Same mechanism as everywhere else here:** verified in TypeScript against the row, not trusted from the model. `isQuoted` for spans, `isGrounded` for SKUs, this for figures.

## D50 — Request bodies are read through `lib/http.ts`

**Decided.** `readJson` returns `{}` on an unparseable body; `readForm` returns a ready-made 400. Routes validate fields as they already did.

**Why.** `req.json()` and `req.formData()` throw on an empty, truncated, or mislabelled body. Six routes handled that by becoming a **500 with an empty response body** — the caller told nothing, the log saying "unhandled rejection" rather than "someone posted junk". Found by posting `{oops` at every mutating route.

---

## D51 — Approved copy exports as one spreadsheet, and the export freezes the prices

**Decided.** *Studio → Export* produces `approved-copy-<date>.xlsx`: one row per approved piece, columns SKU, Product, Channel, Type, Copy, Do not say, Approved, Written by, Model, Prompt. Plus a **Read me** sheet carrying the export timestamp and the caveat below. Excel rather than a ZIP of text files — it is the tool the team already has open, a caption is one cell to copy, and the set sorts and filters with nothing installed.

**Only approved pieces leave.** Drafts are suggestions, and a suggestion inside a file that looks like a deliverable gets posted by somebody eventually. With nothing approved the export refuses with a message rather than handing over an empty file.

**The export is where the placeholder guarantee ends, and it says so.** Inside the system a caption stores `{price_now}` and is filled at read time, so it cannot go stale. The moment it is exported that stops being true — the file carries figures fixed at the export timestamp. The Read me sheet states the date and says to re-export rather than edit. This is the one honest weakness of the whole placeholder design and it belongs in the file, not in a doc nobody opens.

**`Do not say` is its own column**, not part of the copy. It is guidance for whoever is on camera, and a script's warnings pasted into a caption would be worse than useless.

**Provenance travels.** `Written by` reads "you" for a line somebody edited and "model" otherwise, alongside the model name and prompt version — so an odd line months later can be traced to how it was asked for.

**Reverse this if** the team wants copy per channel in a scheduler's own import format. That is a second exporter beside this one, not a change to it.

---

## D52 — `/import` and `/typography` are deleted, not just unlinked

**Decided.** Both pages and `app/api/typography` are removed. Designs is the only
door to loading a sheet, and the layout editor is the only door to typography.

**Why.** D40 kept `/import` as "the detailed view, reached when the column mapping
needs checking" — but Designs already shows that mapping and every skipped row
behind *check them*, and the layout editor already carries font, size, alignment,
line height, shrink floor and Arabic text mode per slot, plus font upload. Two
doors into one workflow is the thing D40 set out to remove, and keeping the second
one open finished the job halfway.

The routes had no inbound links at all until a sidebar rebuild listed them under a
"Tools" group. That is how a merged page comes back: not by anyone deciding to
un-merge it, but by a later change re-surfacing a route that was never deleted.
Leaving them reachable-but-unlinked would let it happen again.

`app/api/typography` goes with the page — nothing else called it. `/api/import`
stays; Designs uses it.

**Reverses if.** Somebody needs the layout engine on its own to debug a shaping
bug without a template around it. That is a script, not a page — `scripts/` is
where the other one-off probes live.

---

## D53 — Two catalogues, and which one each pillar reads

**Decided.** The **campaign sheet** (`data/state/last-import.json`, a file, ~60
rows) says WHICH products a promotion is about. The **catalogue** (Postgres
`products`, everything the shop sells) says WHAT THEY COST and whether they are
in stock. Designs and the content studio read the sheet. The assistant and the
advisor read the catalogue. `campaignProducts()` overlays the editable fields —
price, name, short name, stock — onto the sheet rows and nothing else.

**Why.** Conflating them was a real bug in two directions. The assistant knew
only the sixty products in the current campaign and escalated on everything
else — correct, and useless. And the sheet said `19.9` while the catalogue said
`19.900` for the same product, so editing a price on the Products tab changed
nothing on a poster, which would have made "12 designs are out of date"
describe a price the design never read.

**Reverses if.** Somebody wants posters for the whole catalogue, which is not
what a promotion is.

---

## D54 — Postgres, and what actually justified it

**Decided.** Postgres 17 in Docker (`pgvector/pgvector:pg17`, pinned, bound to
127.0.0.1) holds `products` and `assets`. Everything else stays a file.

**Why.** **Writes**, not size. Editing one price must not rewrite twenty
megabytes and two people editing must not lose one of each other's changes.
Second: vectors surviving a restart — measured, 60 rows embed in 2.2s but 5,000
take about three minutes and 20 MB, and in memory that cost is paid again on
every restart.

**What did NOT justify it.** "A second consumer needs to query across products"
was the trigger HANDOFF named, and it was the weaker argument. Neither did any
bug found that day: the missing MacBooks were an unread column and the invented
"4 laptops" was a substring comparison.

**Docker over Homebrew** for three concrete reasons: pgvector was not installed
at all (`pg_available_extensions` had no `vector` row); a clone runs one command
instead of installing a database by hand; and a pinned tag cannot be dragged to
Postgres 18 by an unrelated `brew upgrade`, which CLAUDE.md warns about by name.

**Reverses if.** Never for `products`. The remaining file stores move when they
have the same problem — concurrent writes — not before.

---

## D55 — Price and sale price, not "now" and "was"

**Decided.** The Products tab shows **Price** and **Sale price**. Leave the sale
price empty and the product simply costs what it costs — the poster prints one
figure with no strike-through and no discount badge. `price_now`/`price_was`
are unchanged everywhere else; `asShopPrices`/`asRenderPrices` is the only place
the two vocabularies meet.

**Why.** "Now" and "was" is poster language. A product that costs 20 is not "now
20", it is 20 — and it never was anything else. Renaming the schema to save two
labels would be a migration touching the renderer, the assistant, the advisor
and the drift check, for no gain.

Also: a sale price that is not below the price is not a sale and is not stored
as one, or the poster strikes through a figure identical to the one beside it.

**Reverses if.** Never. This is vocabulary, and the shop's is the right one.

---

## D56 — Last write wins, and it has to be visible

**Decided.** A hand fix beats the sheet that came before it; a newer sheet beats
the fix that came before IT. `products.sheet_values` records what the last sheet
supplied, so an edited field carries a mark whose hover says what the sheet
said, the import reports which corrections it replaced, and an **edited by hand**
filter lists everything that disagrees with the supplier.

**Why.** Both simpler alternatives fail. "The sheet always wins" throws away a
correction made after reviewing it. "Hand edits always win" means a real price
change never lands for any product anyone has ever touched. The most recent
action winning is what a person expects and needs no rule to remember — but
doing it silently is how somebody re-fixes the same field three weeks running
and never learns their supplier's file is the problem.

**Nothing saves on its own.** Edits stage, a bar counts them, Save writes all of
them in one transaction or none.

**Reverses if.** Never per-field-precedence. If people find themselves undoing
the same overwrite repeatedly, the upgrade is remembering per-field intent, not
changing who wins.

---

## D57 — One representation of a price, not a tolerant comparison

**Decided.** Prices are canonical three-decimal text on every path that stores
or compares them: `canonicalPrice()` in, `price_now::text` out, never
`to_jsonb(products)`. `sameValue()` is exact string equality.

**Why.** A re-import claimed to have overwritten **119** corrections nobody had
made. Postgres was consistent throughout — the column, `sheet_values` and
`to_jsonb` all say `5.500`. The break was in what reached JavaScript:
`to_jsonb` makes it a JSON *number*, so `JSON.parse` returns `5.5`, while
`sheet_values` holds the string `"5.500"`.

The first fix made the comparison tolerate both. That works and leaves the
second representation alive to cause the next bug. One representation is the
fix; a test asserts the three paths agree, and another asserts `to_jsonb` STILL
returns a number so reintroducing it fails a test rather than printing 119 false
reports.

**The general lesson, again.** This is D32/D38/D39 in a new costume: the same
value derived two ways, with nothing but output comparison to catch the drift.

**Reverses if.** Never.

---

## D58 — `assets.bound_values`, and what "stale" means

**Decided.** `assets` records one row per product per template — the latest
export is the one that is out there — holding **what the renderer actually
painted**, slot by slot. Staleness is answered by re-rendering in memory and
comparing, not by checking prices.

**Why.** architecture.md calls this the sharpest gap in the system, and the
Products tab is what turned it from theoretical into live: you can now change a
price, and every poster already exported with the old one is wrong.

Storing what was painted rather than the row it came from means the comparison
never re-derives the formatting — the fault above. And re-rendering rather than
comparing prices catches everything a slot binds: a fixed name, a shortened one,
a product taken off sale. Measured: one price change surfaced the price **and**
the discount badge, `-51%` to `-64%`, which a price-only check would have missed.

**Reverses if.** Keeping every export rather than the latest, which answers "what
did we send in June" — a question nobody has asked yet.

---

## D59 — The glass restyle, and the two token bugs its structure produced

**Decided.** Applied the blue/white glassmorphism handoff. `app/globals.css` is
now three sections in one file: tokens (Light on bare `:root`, Deep on
`:root[data-theme="deep"]`), the original repo styles untouched, and a "glass
layer" appended at the end that restyles the same selectors and wins by source
order. The sidebar is permanently fixed — the collapse toggle, its `data-side`
head script and its ~32 lines of CSS are gone. `app/page.tsx` moved into
`(staff)` so `/` gets the shell; `/chat` stays outside it, unchanged.

Fonts are Barlow / Barlow Condensed through **`next/font`**, not the `<link>` to
fonts.googleapis.com the handoff specified. Next's own docs settle it: fonts are
"included as static assets and served from the same domain … no requests are
sent to Google by the browser". A `<link>` would have put a third-party request
on every page view, which rule 1 forbids.

**The failure mode this structure has, twice demonstrated.** The Deep scheme is
defined in *two* places — `:root[data-theme="deep"]` and a duplicate inside
`@media (prefers-color-scheme: dark)` for the first visit with no stored choice.
Any rule that corrects for Deep by keying on the **attribute alone** is silently
wrong on the media path:

- `.btn.danger-btn` kept `color:#fff` while `--err` became `#ff9a94` — a
  destructive button at **2.04:1**, on the default path for any dark-OS user.
- `.slot-label` had `color: var(--paper)` on `background: var(--accent)`; in Deep
  both resolve near-white.

Both are now tokens (`--err-ink`, `--btn-ink`) that invert with the scheme, so
the correction lives with the palette instead of in a selector that can miss a
path. **Never write `:root[data-theme="deep"] .foo` — put the value in a token
and define it in both Deep blocks.**

**Contrast, measured not eyeballed.** Panels are semi-transparent over three
bright blooms, so a panel's effective background varied ~2.4x (Light) and ~35x
(Deep) depending on where it sat. Small text over a bloom centre measured
**1.90:1** (sidebar hints), 2.57:1 (muted body), 2.1–3.4:1 (links, warnings,
errors) — against 4.5:1. Fixed by damping the blooms (44/48.4/37.4% → 22/24/19%),
weakening `--tone` while raising panel opacity so the panel keeps its colour but
stops transmitting the bloom, and darkening/lightening the secondary text tokens.
Deep additionally needed `--tone` inverted from a pale grey-blue to a genuinely
dark pane (45% → 90% accent) — with a pale tone, raising opacity made panels
*lighter*, which is why the handoff read 18% as a floor. Every pair now clears
its threshold at the worst point on the page.

`--line` stayed decorative; controls got `--line-strong` (3.22:1 Light, 3.93:1
Deep) because a field's border is the only thing that says where the field is.

**The theme switch stays on an effect.** A lazy `useState` initialiser reading
`data-theme` off the DOM was tried and reverted. It makes the first client
render correct but disagree with the server HTML, and the only way to quiet
that is `suppressHydrationWarning` — which does **not** patch the text, it keeps
the server's. The switch then reads "Light" on a deep page until clicked.
Measured both ways in the browser. The effect costs one extra render and is
right after it.

**Reverses if.** Someone wants the original bloom intensity back — but then the
secondary text tokens have to go darker still to compensate, and the sidebar
hints are the pair that runs out of room first.

---

## D60 — The palette is defined once, because defining it twice kept producing bugs

**Decided.** The head script in `app/layout.tsx` now **always** writes
`data-theme`, falling back to `prefers-color-scheme` when nothing is stored. It
used to write nothing when there was no stored choice, and that abstention is
the whole reason the stylesheet needed a second copy of the deep palette under
`@media (prefers-color-scheme: dark)`.

With the attribute always present, that duplicate block is deleted. The deep
palette exists once, under `:root[data-theme="deep"]`.

**Why it matters more than the 46 lines it saved.** Three bugs came from the
duplication, each the same shape — a correction keyed on the attribute alone,
silently skipped on the media path:

- `.btn.danger-btn` kept `color:#fff` while `--err` went salmon: **2.04:1** on a
  destructive button, for any dark-OS first visit.
- `.slot-label` had `--paper` on `--accent`; in deep both are near-white.
- The `@supports not (backdrop-filter)` branch listed
  `:root:not([data-theme="glass"])` **outside** any dark media query, so a
  *light* first visit without backdrop-filter got the *deep* panel opacities.
  Found only by an outside review; the comment above it asserted it was "the
  same shape as the @media block above", which it was not.

The rule this replaces — "never write `:root[data-theme='deep'] .foo`, put it in
a token" — depended on discipline. There is now only one path to write, so the
bug class is structurally gone rather than merely documented.

**`color-scheme` follows the choice too.** It was declared once on bare `:root`
as `light dark`, so scrollbars, native selects and autofill followed the **OS**,
not the switch: pick Deep on a light-OS machine and the scrollbars stayed light
on a navy page. Now `[data-theme="glass"]` sets `light` and the deep block sets
`dark`.

**Cost, accepted.** With JavaScript off the app renders Light rather than
OS-dark — in an app whose theme switch, chat and staged edits all need JS. And
the OS flipping theme mid-session no longer repaints without a reload; every
link is a plain `<a>` full page load, so the window is small.

**On the duplicated selectors.** The handoff's "append a layer that wins by
source order" left 108 selectors defined twice. 63 are merged. The remaining 45
must be merged in ONE direction only: delete the dead declaration from the
**earlier** rule and leave the later one where it is. Identical selector text
means identical specificity, so the later rule always wins — the earlier
declaration of that property can never apply, in any state or scheme, and
deleting it is inert by construction. Merging the other way (hoisting the later
rule up) changes source order and needs verification that a computed-style
snapshot cannot give, because it cannot see `:hover`, `:focus` or `:disabled`.
Three bulk attempts in the unsafe direction each corrupted the file and were
reverted.

**Reverses if.** Someone needs the app to theme correctly with JavaScript
disabled, which would bring back the second palette and the bug class with it.

**Follow-up to D60 — the fold, and the parser bug that cost three attempts.**
All 141 remaining dead declarations are gone. The rule that made it safe is the
one above: delete the dead declaration from the EARLIER duplicate, never hoist
the later one. `scripts/css-dead-decls.py` does it and now runs first in
`npm test`, exiting non-zero if a dead declaration ever reappears.

Three earlier attempts corrupted the file and were reverted. All three had the
same root cause, found only after writing the invariant that catches it: a rule
head preceded by a comment. `/* … */ @media (max-width: 900px)` fails a naive
`head.startswith('@')`, so every rule inside that block looked top-level and got
grouped with an unrelated rule of the same selector — producing edit spans that
ran into neighbouring rules' selector text.

The script now asserts three things before writing, and any one of them would
have caught it on the first run:

1. no two edit spans overlap;
2. the surviving selectors are a subsequence of the originals — nothing that
   stays may have its selector text altered;
3. every surviving declaration's text appears verbatim in the original, and the
   count dropped by exactly the number deleted.

64 selectors are still written twice, and that is now harmless: their property
sets are disjoint, so neither copy is redundant and neither shadows the other.
Collapsing them further would mean moving declarations — the unsafe direction —
for a cosmetic gain. Left alone deliberately.

Verified: computed styles IDENTICAL across /products, /templates and /studio in
both schemes, measured with one page load per scheme rather than by flipping the
attribute in place (flipping it mid-turn reads stale values — it produced a
false regression report during this work).
