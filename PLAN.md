# AImarketing — Planning Deliverable

## Context

`<repo>` is empty. This task produces **planning artifacts only** — no application code. Output: the vision, architecture, build order, folder skeleton, Kuwait knowledge base, and a `CLAUDE.md` that tells every future Claude session how to build this and what it must never do.

**The product:** one system closing the loop between marketing and sales for a Kuwait retailer.

1. **Template studio** — define a template once, upload an Excel sheet of products with images and specs, get filled designs as SVG + PNG + PDF.
2. **Content studio** — the same product data drives slogans, captions, hashtags, and video scripts.
3. **Creative advisor** — reviews a hook, caption, script, or post, including work the team wrote themselves.
4. **Sales chatbot** — answers repetitive product questions from the catalog, then hands hot leads to a human mid-conversation.
5. **The loop** — a campaign ties them together in both directions.

### Locked decisions

| Decision | Choice |
|---|---|
| Design output | SVG + PNG + PDF |
| Stack | Next.js + TypeScript. **No Python anywhere** |
| Database | **Postgres 17.11 — already installed and running via Homebrew.** `brew install pgvector` when needed |
| Chat channel | Web widget — **this is the product**, the whole thing is a website |
| Real data | **Local inference only.** Catalog and customer data never leave the machine |
| Cloud free tiers | **Invented sample data only**, for measuring the quality ceiling |
| Generated copy | **English-first.** Arabic generation deferred |
| Arabic rendering | **In scope from day one** — deterministic, no model involved |
| Arabic quality gate | The user personally |
| Handoff | Silent takeover is in |
| Auth | None (single user). Staff pages grouped in one route folder so a guard is one line later |
| Timeline | No deadline — solo developer with Claude Code |

---

## Verified machine state

Checked directly. Several findings contradicted earlier drafts:

- **MacBook Pro, M5 Pro, 24 GB unified, 842 GB free.**
- **Postgres 17.11 is already installed and running** as a Homebrew service. No Docker needed, no Postgres install needed. `brew install pgvector && brew services restart postgresql@17`, then `CREATE EXTENSION vector;`. **Do not `brew upgrade postgresql`** — pgvector has an open issue on Postgres 18.
- **Ollama is not installed.** The local stack is less stood up than assumed.
- **No Adobe apps, no Inkscape, no Figma desktop, no Affinity.**
- **None of the real assets are on this disk.**
- **Realistic resident LLM budget is ~12–15 GB, not 20.** macOS gives the GPU ~75% of unified memory, and Postgres, Next.js, Chrome, screen sharing and the embedding model all sit alongside. **A dense 27B is not viable while the app is running.** State this unambiguously so nobody tries it on demo day.

### Blocking prerequisites — none are code

1. Get the real Excel, images, and brand templates onto this machine.
2. Identify the brand's Arabic font. **An embeddable licence is necessary but not sufficient — outlining may be separately restricted**, and outlining is now the likely default path. Ask the licensor about outlines specifically.
3. Collect 30–50 of the company's best past Arabic posts as few-shot exemplars.
4. Check whether Instagram/Snapchat insights export **with captions joined to per-post reach**.
5. Check the sheet for any accessory/bundle/compatible-with column.
6. Measure the baseline: how long does producing 50 product posts take today?

---

## The finding that changes the product's positioning

**As of 31 July 2026, Snapchat no longer recommends wholly AI-generated video on Spotlight.** Content *enhanced* with AI stays eligible, with transparency indicators. Snapchat reaches **48.2% of Kuwait's population** — unusually high by global standards and culturally significant in the Gulf.

This is a direct threat to an end-to-end "AI makes your video" pitch on one of Kuwait's biggest platforms, and a strong signal about where other platforms are heading. **Position the system as assistive throughout** — human-shot footage, AI-assisted script and caption, AI-assisted layout — not end-to-end generation. Add a rubric check flagging content indistinguishable from wholly-synthetic, as a **policy-risk flag, not a quality score**.

This reframing costs nothing and protects the product from a policy change already in force.

---

## Architecture

### Template engine

A template is `base.svg` + `manifest.json`. **The manifest stores no geometry.** Slots reference SVG elements by id — `{ ref: "#slot-price", bind, font, size, align, fit, format, ... }` — and geometry is read from the SVG at render time.

Two reasons this pays for itself repeatedly: a designer nudges a box, re-exports, and coordinates in the manifest are silently stale; and an Illustrator SVG is nested `<g transform="matrix(...)">` all the way down, so absolute coordinates require flattening the transform matrix at parse time and re-flattening on every re-upload. A ref inherits the transform for free. **Bonus: four SVGs at four sizes can share one manifest** — Instagram square, story, and A4 stop being three copies that drift.

Slot spec also needs `maxLines`, `lineHeight`, `minSize`, `overflow`, `visible: "<column>"` (hide the SALE badge when there is no sale price), `numerals: latn|arab`, per-language font stack, and `fallback` for empty cells. Plus `manifest_version` as a column, because the schema will change and "I have 40 templates and the slot format changed" must not be manual JSON surgery.

**The template engine is a text layout engine.** SVG `<text>` has no box — only a baseline and an anchor — and `<foreignObject>` would give CSS layout but Illustrator will not open it. So you do your own line breaking and emit `<tspan x dy>`. That is the bulk of the work, not the SVG plumbing.

Auto-fit order: measure with **shaped** advances → wrap before shrinking (never shrink a line that could have been two) → binary-search size down to ~65% → truncate last, **and write every overflow into the batch report**. Add `fitMode: "uniform-batch"`: per-row shrinking makes 200 posts look broken in a grid, so compute the smallest size that fits all rows and apply it to all. Ten lines.

**Every Arabic slot is a bidi slot, not an RTL slot.** Kuwaiti retail copy is heavily code-switched — "MacBook Pro 14 بوصة" — and a price inside an Arabic run is a bidi-neutral sequence that reorders wrongly. Wrap numeric runs in U+2068/U+2069. This is the bug that shows up on demo day, not in the spike.

**Parse with a real XML DOM** (`svgson` or `cheerio` in `xmlMode`), never string templating. Uploaded SVGs have namespaces, `<defs>`, CDATA, duplicate ids — and product names contain `&` constantly ("QuietComfort & Ultra"), which is malformed XML unescaped. **Avoid jsdom and any HTML-mode parser: they lowercase attributes and turn `viewBox` into `viewbox`**, silently destroying the file.

**Excel: `exceljs`, not Python.** `worksheet.getImages()` returns `{imageId, range:{tl:{nativeRow,nativeCol}}}` — exactly the image-to-row mapping. SheetJS cannot do this at all, so the reflex choice is the wrong one. A second toolchain for one script is pure cost for a solo maintainer.

**Export: `resvg-js` for PNG**, not a browser — it uses `rustybuzz` (a HarfBuzz port) plus a real bidi implementation, and takes explicit font files, which is better than Chrome's opaque font matching given you are bundling fonts. **Do not use `sharp` for SVG→PNG**; its librsvg path has weak font control and is the classic source of "text renders wrong on the server."

**PDF from headless Chrome is a proof artifact, not a print master** — RGB only, no CMYK, no spot colours, no bleed, no crop marks, and font subsetting means the recipient cannot retype text. Say this in one line in the UI rather than letting a marketing manager discover it. If a real print master is needed: SVG → `rsvg-convert -f pdf` → Ghostscript for CMYK, or hand the printer the SVG. If a browser is used at all, use the **already-installed Chrome** via `puppeteer-core` with `executablePath` — no 180 MB Chromium download.

### Arabic in SVG — the highest-risk item, and the fallback list was wrong

**Delete the pre-shaped-HarfBuzz-runs option.** It emits Arabic Presentation Forms, which Unicode deprecates for interchange; text stops being searchable or copyable; it breaks catastrophically if the receiving app *does* shape; and the designer typing one character corrupts the run. It is also not a separate implementation from outlining — both need HarfBuzz and differ only at the last step.

**HarfBuzz is infrastructure in every branch, not a fallback**, because measurement needs shaped advances. Use **`harfbuzzjs`, not `opentype.js`** — `opentype.js` advance widths are wrong for Arabic, since ligatures collapse glyphs (لا is one glyph), so naive measurement overestimates and shrinks text that would have fit. The shaping decision and the measurement decision are the same decision.

**The primary deliverable is a fourth option the earlier plan did not have: outline the Arabic, keep the Latin live.** `textMode: "live" | "outline" | "auto"`, where auto outlines any string containing Arabic-range codepoints. About five lines. The designer gets editable English — the copy they actually tweak — and Arabic immune to their Illustrator version, their composer setting, and whether they have the font. Carry the logical string as `data-text` for provenance.

Research confirmed why this matters:

- **Illustrator's Middle Eastern text engine is not enabled by default.** Without it Arabic renders disconnected and reversed. And when a non-Arabic language version of Illustrator is installed, the RTL options are **missing from the palettes entirely** — so "it didn't work on the designer's machine" may mean their install is wrong, not your file.
- **Illustrator's own SVG export loses RTL ordering** — a standing bug. Adobe's own community answer is: convert to outlines, or switch the SVG profile from Tiny 1.2 to 1.1.
- **Converting to outlines is Adobe's own first recommendation** and the only reliable path. A paid "RTL Fixer" product exists across Illustrator and Affinity — the existence of that market is itself evidence the native path is unreliable.

**So reframe rather than concede.** Editability was never going to mean "the designer retypes Arabic in Illustrator" — it means "fix the Excel cell and re-render." **The template is the editable artifact; the output is a rendering.** That is defensible to a marketing manager, and it needs designer buy-in as a workflow decision, not just a technical one. Ship both files: live-text and outlined, outlined by default.

**What actually proves it, given no Illustrator here.** Browsers, Inkscape, and Figma all prove nothing about Adobe — Inkscape and Figma each have their own documented Arabic bugs, so they are different bug surfaces, not evidence. Only a designer with Illustrator proves it. So split the spike:

- **A1 — runs here today.** Render, open in Chrome and Safari and resvg, compare against a reference. Proves the *generator* is correct and isolates which side any bug is on. Unblocks the build order immediately.
- **A2 — a fifteen-minute email, not a machine you must acquire.** Send the designer three files (live-text SVG, outlined SVG, PNG reference) and ask: which Illustrator language variant is installed; does Type → Language Options show Middle Eastern; a screenshot **before** enabling World-Ready Layout; a screenshot **after**. Before-versus-after tells you whether the file is fine and the *setup* is the variable — which decides whether you ship live text with instructions or ship outlines and stop fighting it.

### Local AI

**Ollama.** The decisive argument is not convenience: the production target is an on-prem server, which will almost certainly be x86 + NVIDIA, and **MLX does not exist there.** Building on MLX means rewriting the runtime for production. Keep MLX in reserve for a possible LoRA, and record that MLX-finetune → Ollama-serve is not a straight line (fuse → GGUF → requantise; lossy and fiddly).

**The "no guaranteed JSON mode" premise was out of date.** Ollama has schema-constrained structured output — `format` accepts a full JSON Schema, implemented as GBNF grammars in llama.cpp, reachable through the OpenAI-compatible endpoint as `response_format`. Tokens that would violate the schema are masked at decode time. Output is *structurally* guaranteed. Layer four things on top:

1. Constrain with the schema — guarantees shape, not truth.
2. **Zod on the way out, plus set-membership checks in TypeScript** — `cited_skus ⊆ retrieved_skus`. Never ask the model to verify its own grounding; that is a set operation, do it in code. Verify quoted spans with `input.includes(span)`.
3. **One retry** with the validation error appended, then fail visibly. **No tolerant parser** — for a solo maintainer with nobody watching logs, a partial result that looks complete is worse than an error.
4. **Keep constrained calls small and separate from prose.** Grammar-constrained decoding measurably degrades writing quality — generate copy freely, then a second cheap constrained call to structure it.

Two settings belong in `lib/ai/generate.ts` with a comment saying why. **`num_ctx: 8192` explicitly** — Ollama's default is 2048–4096 and it **silently truncates**, eating your retrieved rows and producing "the model ignored the context" bugs that look exactly like model-quality problems. This is the single most common local-RAG footgun. And `temperature: 0` for anything factual. Also `OLLAMA_KEEP_ALIVE=-1` and pre-warm before any demo — the default 5-minute unload means a 20–60 second dead pause mid-presentation.

**Model shortlist — the earlier one was a generation stale and had two non-starters.**

| Model | Size | 4-bit | Licence | Arabic |
|---|---|---|---|---|
| **`QCRI/Fanar-1-9B-Instruct`** | 8.7B | ~5.5 GB | Apache-2.0 | ~410B Arabic training tokens. ArabicMMLU 67.69, OALL ~70.32 |
| **`google/gemma-4-12B-it`** | 12B | ~7.5 GB | **Apache-2.0** | Official QAT q4_0 GGUF, in Ollama |
| `Qwen/Qwen3.5-9B` | 9B | ~5.5 GB | Apache-2.0 | Multilingual, two generations newer than Fanar's base |
| `QCRI/Fanar-2-27B-Instruct` | 27B | **~17–18 GB resident** | Apache-2.0 | **Does not fit alongside Postgres, Next.js, Chrome and the embedder** |

**Recommendation: `Fanar-1-9B-Instruct` as the Arabic reader/critic, plus Gemma-4-12B or Qwen3.5-9B for English generation and JSON.** Both fit together inside the 12–15 GB budget. GGUF exists for all of them; **no MLX conversion of Fanar exists**, and none is needed on Ollama. Fanar is not in the Ollama registry — pull via `ollama pull hf.co/<repo>` and write a Modelfile. The available GGUFs are community uploads, not official QCRI, so spot-check output before trusting one.

**Two corrections that reverse an earlier assumption in this plan, verified by grepping the full text of both Fanar papers:**

1. **Fanar is not a from-scratch Arabic model.** Both text models are *continual pretraining on Google bases* — Fanar-1-9B on Gemma-2-9B, Fanar-2-27B on `gemma-3-27b-pt`. The from-scratch model (Fanar Star 7B) is not published anywhere findable. So "Gulf-built Arabic-first versus multilingual with Arabic bolted on" was the wrong reason to prefer it.
2. **The Gulf-dialect claim lives on the model card, not in the research.** In the Fanar 2 paper, *Kuwait* appears zero times; *Khaliji* zero; *Gulf* exactly once, in an image-generation caption about traditional attire. Per-dialect benchmarks are **Egyptian and Levantine only**. Gulf appears solely as one of six subsets inside an aggregate *reading-comprehension* score (Belebele). Neither paper discloses dialect-level token allocation at all.

**What survives, and it fits this plan cleanly:** Fanar's dialect evidence is for *understanding* Arabic (comprehension benchmarks), not *writing* it. That maps exactly onto the critique-versus-generation split. **Fanar is the best-evidenced Arabic reader available under Apache-2.0 — which is what the chatbot and the advisor actually need — and it is not the Kuwaiti copywriter.** No open model is. That gap closes with few-shot exemplars from the company's own past posts plus the user's review, not with a model swap. This is confirmation that deferring Arabic generation was correct.

**Also prefer the 9B over the 27B on Arabic grounds, not just memory:** Fanar-1-9B trained on ~410B Arabic tokens; Fanar-2-27B had only ~120B tokens of continual pretraining at ~45% Arabic, so roughly 54B. **The 9B has had 7–8× more Arabic training in absolute terms.** The 27B's advantage is Gemma 3's stronger base, not Arabic depth — and it is not on any leaderboard yet, so its numbers are self-reported.

**Do not make Fanar do the English.** Its base is Gemma-2-era; Gemma 4 and Qwen3.5 are two generations newer. Since generated copy is English-first, that is the load-bearing axis.

**Skip the vision model (`Fanar-2-Oryx-IVU`) for v1.** It is a fine-tune of Qwen2.5-VL-7B with Arabic cultural alignment, and its published evidence is descriptive captioning and cultural-object recognition — *image understanding*, not *design critique*, which is a different task it was not trained for. And the template engine already knows deterministically when text overflowed, when a slot was empty, and when a font shrank below `minSize`: **the overflow report catches real visual defects with zero model involved and zero false positives.** Park the vision model as a v2 item for a genuinely different job — reviewing a photo the team *shot*: "is the lighting flat, is the logo occluded."

**Hugging Face Inference Providers is not an eval option:** the free tier is **$0.10 per month** in credits — a few dozen small-model requests, exhausted inside one run of a 50-item eval. Its training policy is also undisclosed, since routing hands the prompt to a third-party provider under that provider's terms. Use Gemini's free tier on invented data, or just run Fanar locally, which is free and unlimited and is what ships anyway.

**Ruled out, with reasons:** Aya Expanse 32B is **CC-BY-NC-4.0 — non-commercial, disqualified.** Jais-2-70B is 70B and gated. **Falcon-H1-Arabic, which every "best Arabic LLM" blog names as leader, has no public weights** — the claims trace to a press release. ALLaM's licence is contradictory (HF metadata says Apache-2.0, the LICENSE file 404s, secondary sources say research-only) — get written clarification or just use Fanar, whose Apache-2.0 is unambiguous.

**No model is Kuwaiti-dialect-aware.** "Gulf" is the finest granularity available. Kuwaiti register must come from prompts, few-shot exemplars from the company's own past posts, and optionally a LoRA.

**Embeddings: `bge-m3`** (~1.2 GB, MIT, in Ollama). Chosen for reasons in this order: the corpus is bilingual and queries cross languages; 8K context versus e5-large's 512, which matters because Arabic tokenises at 1.5–4× English; and it produces **sparse vectors as well as dense from one model** — lexical matching for SKUs, model numbers, and brand names, which dense embeddings are notoriously bad at and which would otherwise mean bolting on BM25. Worth a two-hour bake-off against `Qwen3-Embedding-0.6B` on the real catalog.

**The advisor does not need pgvector.** Fifty posts: embed them, store as a `real[]` column, cosine in TypeScript. Microseconds, no extension, no index. Add pgvector when the corpus is thousands of rows.

### Gemini free tier — confirmed, from Google's own terms

> Unpaid: *"Google uses the content you submit to the Services and any generated responses to provide, improve, and develop Google products and services"* and *"Human reviewers may read, annotate, and process your API input and output."*
> Paid: *"Google doesn't use your prompts or responses to improve our products."*

Categorical, not a matter of degree — the free tier is a training corpus with human eyes on it, and there is no delete button on a prompt already used for training. **Assume every free tier trains on your data unless you have read its terms yourself**; NVIDIA, Groq, Mistral, and Cerebras terms could not be primary-verified, and Mistral's free tier reportedly *requires* opting into training.

Free tiers therefore touch **invented data only**, under three conditions: the synthetic data must be genuinely synthetic (real SKUs, price points, and category structure are competitive information even with names changed); never tune prompts against a cloud model you will not ship; and enforce it with a separate module and separate credentials whose only data source is a synthetic fixture — a README rule gets violated within a month.

Quota is not the constraint: a 50-item eval across 4 configs is 200 requests, well under one day of Gemini Flash's free allowance. The data rule is the constraint.

### The advisor — the evidence changed the design

The research contradicted the working assumption in a way that matters. "Can LLMs Judge Better Than They Generate?" (Jun 2026) found **generation beat evaluation on three of four datasets, worst on the 8B model** — and mechanistically, in evaluation mode a model allocates 3–5× *less* attention to context and only 0.3–0.5% of attention to the candidate it is judging.

But that tests verification of factual answers against ground truth. **A rubric decomposes an unbounded judgment ("is this a good hook?") into bounded named checks ("does it state a benefit in the first five words? yes/no"), and that genuinely is easier than free generation.** So: **rubric-scored critique is more achievable than free generation; unstructured "rate this and tell me what's wrong" is not.** That distinction drives the whole design.

**The Arabic ceiling is hard and must be stated.** Multilingual LLM-as-judge research (EMNLP 2025) measured **average Fleiss' κ ≈ 0.3 across models, with Arabic significantly worse than European languages** and approaching zero on harder tasks — and found that **neither multilingual training nor model scale improves judgment consistency.** Scaling does not save you. So: ship English critique with confidence, Arabic critique hedged and labelled, and **dialect authenticity stays human, permanently.** That is exactly the judgment the marketing team most wants outsourced, and it is the one thing that cannot be.

Design rules that follow directly from the evidence:

1. **Binary yes/no named checks, never a 1–10 scale.** This is the published practitioner recommendation for consistency, and it happens to produce the explainable output we wanted anyway. Any headline figure is a *sum of binary checks*, never a model-generated number.
2. **No aggregate score, and no `score` column in the schema.** The architect's point is the cheapest enforcement available: **you cannot hallucinate into a field that does not exist.** `leads.score` is fine — an internal sales metric, not a claim about creative quality.
3. **Never let the same model grade its own output in the same pass** — self-preference bias is documented. Generate with one model, critique with the other.
4. **Randomise order when comparing versions, run A/B and B/A.** Position bias reaches 0.192 in small models, large enough to flip verdicts. If the two orderings disagree, report **"too close to call"** — honest and genuinely useful. Note one trap: Qwen 3 8B showed the *highest* test-retest reliability (0.992) *and* severe position bias. **Consistency is not evidence the judge works.**
5. **Anchor every judgment to a quoted span** — directly counteracts the 0.3–0.5% attention failure.
6. **Max three fixes, ranked, enforced in the schema.** Twelve suggestions equals no suggestions. Offer three hook rewrites rather than one, since the rewrite is a generation task embedded in a critique task and will be the weakest part.
7. Stop worrying about verbosity bias — measured below 0.011 across all 21 judges tested.

**Structural split: advice versus checks.** Hook, clarity, retention, CTA, platform fit are advice and top out at "needs work". Factual grounding against the catalog, claim safety, and cultural compliance are **checks that can return `problem — do not publish` and block export.** A superlative claim is not a style note and the UI must not render it as one.

**v1 contains no model and no score:** paste a draft → show the five most similar past posts with their real reach. **The advisor takes text, not a draft object** — `review(text, {channel, lang})` — so the "generator does not grade its own output" rule is enforced by the compiler rather than by discipline.

**Its most valuable check needs no network and no trend data:** *"Your caption says 129 KD; the catalog says 119.500 as of yesterday."* No other tool can say that about this company's post.

### Trend freshness — three layers, not one

Trend knowledge decays at wildly different rates, and conflating them is how the tool loses trust:

| Layer | Shelf life | Handling |
|---|---|---|
| Viral specifics — sounds, memes, formats | **3–14 days** | Unreachable offline. Label with capture date, or a human pastes it in |
| Seasonal and cultural — Ramadan, Eid, National Day | **Months, and predictable** | A calendar, not a model |
| Structural — hook mechanics, format conventions | **6–18 months** | Where the model is reliable. **Scope the promise here** |

A monthly refresh is useless for layer 1 and unnecessary for layer 3. **Do not hardcode platform-mechanics claims into the rubric** — research found the online corpus is contaminated: precise-sounding ranking percentages that propagate by citing each other with no primary source, and primary docs for TikTok and Instagram were unreachable. Encode only what is robust (hook in first 3 seconds, watch time dominates, one clear CTA, vertical, sound-independence) in a **versioned dated config file with a source URL per rule**, retrieved through the same RAG path as the catalog so a stale entry is visible rather than silently baked in. Never fine-tune trend data into weights — it is the fastest-decaying knowledge you have.

**The resolution the earlier plan missed: a free-text "this week's context" field on the campaign**, where marketing pastes what they already know is trending. Zero network calls, and it puts trend-spotting with the humans who already do it.

Kuwait platform reach, DataReportal *Digital 2026* (published Nov 2025, figures reference Oct 2025): TikTok 4.44M, YouTube 3.31M, Instagram 3.00M, Facebook 2.45M, **Snapchat 2.43M (48.2%)**, X 1.42M. These are **ad-reach figures, not user counts** — they include duplicate and inactive accounts, which is why TikTok exceeds 100% of adults. Use one source consistently; NapoleonCat reports materially different numbers, including a Facebook figure exceeding Kuwait's population.

### Schema — the irrecoverable decisions

These must exist before anything writes rows; no migration recovers them because the history never existed.

| Decision | Cost now | Cost of reversal |
|---|---|---|
| **Message provenance** — `{retrieved_ids, model, prompt_version}` on bot messages | one column | Customer says "your bot told me 40 KD" and you cannot find out why |
| **`assets.bound_values`** — what was actually rendered into that design | one column | You cannot find which published designs carry a stale price |
| **`messages.sender ∈ {customer, bot, rep}`**, `channel`, `external_id` | three columns | Adding a human sender later changes the message shape in every consumer |
| **`"v": 1` in the manifest**, `templates.manifest_version` | one field, one column | Orphans every saved template |
| `content_pieces.model`, `.prompt_version`, `.status`, `.source` | four columns | Cannot tell which output came from which model |
| `post_performance` with a real `n` column | one table | Cannot backfill last quarter; the honesty rule becomes a thing to remember |
| **`numeric(10,3)` for price, `timestamptz` for dates** | free | Data migration, not a code fix |

**The stale-price problem is the sharpest gap.** Prices move weekly; once 200 designs are rendered the price is baked into pixels. With `bound_values` it is one query — mark affected assets stale, show *"12 assets are out of date"*, offer re-render. Without it the flagship output rots silently, and the first real-world failure is an ad carrying last month's price. That is the kind of failure that gets a system switched off permanently.

**Ingest is a weekly pipeline, not a one-shot import:** upsert on SKU, a diff preview (*"14 prices changed, 3 new, 2 gone"*), skip-and-report so one bad row never kills a 200-row batch, and **re-embedding of changed rows** — without that the vector describes the old spec while SQL returns the new one, and the two halves of the retriever silently disagree.

**Product history: snapshot at the consumer** via the provenance columns. Do not build `product_versions` — that is a rewrite of the ingest path and every reader, for history you will rarely query.

**Deliberately not generalised:** `products` uses column-per-language, `content_pieces` uses row-per-language. There is no third language coming. **No i18n abstraction** — recorded as intentional so nobody "fixes" it.

### Requirements the earlier drafts dropped

- **"What to say and what not to say"** was silently converted to the standard hook/body/**CTA** triad. The user said *say* and *not say*. Video script output is `{ hook, body, say, avoid[] }`, with `avoid[]` populated by calling the advisor's check dimensions before returning. CTA lives inside `say`. Calling the rubric at generation time is reuse, not self-grading.
- **"Does this come with that"** has no data model. Pending the sheet check: `product_relations(sku_a, sku_b, kind)` if a column exists; otherwise the bot quotes description text and the limitation is stated rather than faked.
- **The loop's return leg** is a `GROUP BY`: which products get asked about, which questions the bot could not answer, which campaigns produced leads. **The log of unanswered questions is the highest-value byproduct in the system** — it tells marketing exactly what the catalog is missing.

---

## Files to create

**Root:** `CLAUDE.md`, `README.md`, `.gitignore`, `.env.example`.

**The guardrails, rewritten to be enforceable.** The earlier "never import `@anthropic-ai/sdk` / `openai`" rule was simultaneously unenforceable (any HTTP client reaches any API) and too strict (Ollama's endpoint *is* OpenAI-compatible, so the `openai` client pointed at localhost is the correct implementation, and a session reading that rule literally would hand-roll HTTP for no reason). Replace with:

- **No request may leave localhost** — enforced by a boot-time assert that `OLLAMA_BASE_URL`'s host is loopback, throwing with an actionable message, plus ESLint `no-restricted-imports` on HTTP clients everywhere except `lib/ai/generate.ts`. About 20 lines, and it makes the offline-proof step true by construction rather than by luck.
- Never send catalog rows, customer messages, images, or Excel contents to any external service, including while debugging.
- **The model never emits a number.** Prices and specs come from SQL through one formatter with one assertion test. KWD is three-decimal fils.
- **No aggregate score, and no `score` column on advisor tables.**
- Campaigns are four columns.
- Never generate political or religious content.
- Never state a spec, price, or stock level not in a retrieved row — escalate.
- No `ChannelAdapter` interface until a second channel exists. No i18n abstraction.

**`docs/` — four files.** `vision.md`, `architecture.md`, `decisions.md` (append-only), `demo-script.md`. A fifteen-document corpus is a second codebase, and **stale docs are worse than absent ones because Claude Code will follow them.**

**`knowledge/kuwait/`** — `evergreen/` (retail calendar including **Ramadan 2027 falling roughly Feb–Mar**, National and Liberation Day 25–26 February, Hala Febrayer; dialect and code-switching; KWD fils formatting; Snapchat's outsized weight; Ramadan's 9PM–1AM usage peak per Ipsos MENA) and `timely/` (dated, sourced, one URL per rule), plus `compliance-guardrails.md` and `SOURCES.md`.

**Fonts, all SIL OFL — free commercial use, embeddable:** Cairo or IBM Plex Sans Arabic for headlines, Tajawal or Almarai for body, Noto Naskh Arabic as no-tofu fallback. **Download and self-host — Google Fonts web-serving is an external request** and conflicts with the offline requirement. Verify the Arabic axis actually ships the weights you need; some families ship fewer Arabic weights than Latin.

**Modules — five, not seven.** `lib/excel`, `lib/template`, `lib/ai`, `lib/rag`, `lib/advisor`. `lib/render` merges into `lib/template` (they share the manifest type, font loading, and measurement). `lib/kuwait` is data — it is `knowledge/kuwait/*.md` plus one read function. **`lib/ai` must exist**: deleting `provider.ts` was right, deleting the directory left nothing owning the model call, and the localhost guardrail is only enforceable if exactly one file makes it.

**The boundary that pays off over months is inside `lib/template`: `layout.ts` must be pure** — shaping, measurement, wrapping, fitting, no I/O, no DB, no sibling imports. It is the hardest code in the project and purity is what makes it testable. Leave one runnable check: ~15 fixtures (short/long EN, short/long AR, mixed AR+Latin brand, a price, a string with `&`, an empty cell) rendered to committed SVG snapshots. **Text-layout regressions are invisible until you are looking at 200 bad posts.**

```
AImarketing/
├── CLAUDE.md, README.md, .gitignore, .env.example
├── docs/            (4 files)
├── knowledge/kuwait/evergreen/  knowledge/kuwait/timely/
├── data/samples/  data/fonts/
├── evals/           frozen test sets — the substitute for a deadline
├── app/(staff)/     studio, advisor, templates, sales-inbox, campaigns
├── app/chat/        public widget
├── lib/excel/  lib/template/  lib/ai/  lib/rag/  lib/advisor/
├── db/  └── scripts/
```

---

## Build order

**Spike B runs first** — zero code, half a day, and it is the only spike that can *delete an entire pillar*. Export the last 100 posts' insights to CSV and read it by hand. Are captions joined to reach? Is variance visible by eye? If not, no model will find a pattern. Killing work is worth more than validating work.

**Spike A1** — render one real row into one real brand SVG, open in Chrome, Safari, and resvg. Proves the generator. Runs here today.
**Spike A2** — the fifteen-minute designer email described above. Parallel, not a gate.
**Spike C** — install Ollama, pull Fanar-1-9B and Gemma-4-26B-A4B, compare English generation and Arabic *comprehension*. Measure first-token latency alongside quality.

**The dependency graph** — the real Excel's **column vocabulary is the spine of the whole project**. It becomes the manifest's `bind` vocabulary *and* the normalised spec columns *and* therefore the chatbot's SQL comparison surface. Nothing on either track can be frozen before it is known, and it costs one afternoon.

```
Excel reality (column vocabulary)
  ↓
Shaping + measurement        ← deepest node; everything visual is downstream
  ↓
Arabic output mode (live | outline | hybrid)
  ↓
MANIFEST FREEZE              ← the gate
  ↓
Renderer → full-catalogue batch → export
```

Parallel and unblocked: **Spike B → the advisor**, which is the least-coupled component in the project — it needs the embedder and the post export and nothing else. No Excel, no schema gate, no templates. That makes it the right first thing to build once Spike B passes, and it doubles as the fastest honest read on whether the local stack works at all. Then Spike C → content studio → chatbot. Campaign FKs exist from migration one.

**Do not write `architecture.md`'s template contract early** — the manifest is a derived artifact of the Excel vocabulary, the fit algorithm's needs, and the Arabic mode decision. Sketch it, freeze it after the first full-catalogue batch render over real data.

Deferred on merit: visual editor, Arabic generation, WhatsApp adapters, LoRA.

**With no deadline there is no forcing function.** Nothing in a solo-plus-Claude-Code arrangement says "stop, this is done." Substitutes: the frozen eval sets below, recurring contact with a marketing colleague and a salesperson, and a v1 definition of done in `decisions.md` with the rule that nothing is added without something removed. **Finish one pillar to "a real colleague used it for real work" before starting the next** — four pillars at 70% is the most likely failure mode now.

---

## Acceptance criteria

Frozen, repeatable, run on every change.

**Templates.** Real Excel, ≥50 products, ≥95% clean import with every failure naming its row and reason. All 50 render in one batch. **A named designer opens 3 random SVGs in the company's own Illustrator** — the one criterion no automated check replaces. Zero outputs with an empty image box, missing price, or overflowing text, asserted over the batch. Batch throughput measured.

**Content studio.** Every video script ships `avoid[]`, and a planted case — a product tempting a religious-holiday angle — is correctly avoided *and visibly so*. Nothing exports without `status = approved`.

**Advisor — the blind historical test.** Ten already-published posts, five that did well and five that flopped. The team knows which; the advisor does not. Does marketing read the feedback on the flops and say *"yes, that's what was wrong"*? Not "did it predict the numbers" — did it identify what a human with hindsight agrees was the problem. **The best acceptance test in the project: free, real, runnable in week one, needs no other pillar.** Plus three planted errors returning as blockers 3/3; plus the marketer actually changing something; plus grep for any forecast-shaped number, which is a bug. Also run the **calibration check**: does the model's ordering of ~40 past posts correlate at all with actual reach? Near-zero Spearman means the advisor is decoration — a result worth knowing.

**Chatbot.** 30 questions written by an actual salesperson, including 5 the catalog cannot answer — half Gulf dialect, half MSA, some English, some code-switched. ≥90% of the answerable correct. **Zero fabricated specs or prices — one fabrication is a failure**, because that is the entire grounding claim. All 5 unanswerable ones escalate. Median latency under 5s. **Handoff verified blind:** someone reads a transcript and cannot tell where the human took over. Score retrieval separately from generation, and **run pairwise blind comparisons rather than absolute 1–10 scoring** — both humans and judge models are far more reliable at "which is better".

**Non-functional.** **Run the whole thing with the wifi off** — repeatable, thirty seconds, the strongest single piece of evidence this project can produce. Runtime cost: 0 KWD, no per-token bill, no vendor.

---

## Known risks

- **Mediocre Arabic will not look broken — it will be grammatically correct and tonally foreign**, which reads worse to a Kuwaiti audience because it reads like translation.
- **A correct bot sounds like a form**, and a robotic bot makes the takeover *more* noticeable, defeating the requirement. Voice consistency between bot and rep is a design requirement; cheap fix is 3–4 canned rep openers matching the bot's register.
- **The advisor is the only pillar with no falsifiable output**, therefore no natural improvement loop, therefore the most likely thing to absorb months. Its stop rule goes in `decisions.md` before it is started.
- **It is also the only pillar whose user is defensive rather than willing.** Nobody has ego in resizing 200 posters; someone has ego in the hook they wrote.
- **Nobody owns it after the demo** — knowledge refresh, model re-eval, weekly import, copy approval is a real part-time job.
- **Frame local-only as the product's best feature.** It is the reason to build rather than buy. And the strongest unmade pitch: **marketing drafts are unpublished commercial strategy** — pricing, launch timing, positioning. *"Review your unpublished campaign without it leaving the building"* is a stronger argument than any other pillar has.

---

## Verification of this planning task

1. `tree AImarketing` matches the skeleton; all four `docs/` files exist and are non-empty.
2. `CLAUDE.md` read back against the locked-decision table, with attention to the localhost assert, the no-number rule, and the no-`score`-column rule.
3. **No deadline language anywhere** — a fresh session reading one will re-derive deferral decisions that no longer apply.
4. Spikes B and A1 have recorded results before application code begins.
5. The user reviews `vision.md` and the build order and confirms they match intent.
