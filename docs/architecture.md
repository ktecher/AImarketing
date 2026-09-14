# Architecture

Everything runs on one MacBook Pro (M5 Pro, 24 GB unified). Postgres is local, inference is local, files are local. Nothing in the runtime makes an outbound request.

```
Excel + images ──▶ lib/excel ──▶ products ──┬──▶ lib/template ──▶ SVG / PNG / PDF
                                            │
                                            ├──▶ lib/rag ──▶ chatbot ──▶ leads
                                            │
                             past posts ──▶ lib/advisor ──▶ review
                                            │
                                       lib/ai ──▶ Ollama @ localhost:11434
```

---

## The template engine

This is the highest-value component and the one with the most novel work in it.

### The contract

A template is two files: a `base.svg` exported by a designer, and a `manifest.json` describing what goes where.

**The manifest stores no geometry.** Slots reference SVG elements by id and the renderer reads position from the SVG itself:

```json
{
  "v": 1,
  "slots": [
    { "ref": "#slot-name", "bind": "name_en", "font": "Cairo",
      "size": 48, "minSize": 31, "maxLines": 2, "align": "start",
      "fit": "shrink", "fallback": "" },
    { "ref": "#slot-price", "bind": "price_kwd", "format": "kwd",
      "numerals": "latn" },
    { "ref": "#slot-sale", "bind": "sale_price_kwd", "visible": "sale_price_kwd" },
    { "ref": "#slot-image", "type": "image", "bind": "image_path",
      "fit": "cover" }
  ]
}
```

Two reasons geometry stays in the SVG. A designer nudges a box and re-exports, and stored coordinates are silently stale with nothing to detect it. And an Illustrator SVG is nested `<g transform="matrix(...)">` all the way down, so absolute coordinates would need the transform matrix flattened at parse time and re-flattened on every re-upload. A reference inherits the transform for free.

The payoff: **four SVGs at four sizes can share one manifest.** Instagram square, story, and A4 stop being three copies that drift apart.

`templates.manifest_version` is a column because this schema will change, and "I have forty templates and the slot format moved" must not be manual JSON surgery.

**This contract is provisional.** It is derived from the real Excel's column vocabulary, from what the fit algorithm turns out to need, and from the Arabic output mode decision. Freeze it after the first full-catalogue batch render over real data, not before.

### It is a text layout engine

SVG `<text>` has no box — only a baseline and an anchor. `<foreignObject>` would give real CSS layout but Illustrator will not open it. So line breaking is ours, emitted as `<tspan x dy>`. That is the bulk of the work; the SVG plumbing is the easy part.

Auto-fit, in this order:

1. **Measure with shaped advances.** An English product name is eight characters and its Arabic equivalent is forty.
2. **Wrap before shrinking.** Never shrink a line that could have been two.
3. **Binary-search the size down** to roughly 65% of nominal, re-wrapping at each step. Six iterations covers any range.
4. **Truncate last — and write every overflow into the batch report.** "12 of 200 designs overflowed" is the same needs-attention mechanism as the image-fit flag and shares it.

`fitMode: "uniform-batch"` computes the smallest size that fits every row and applies it to all of them. Per-row shrinking makes 200 posts look broken when they sit in a grid at different type sizes.

### Arabic is a bidi problem, not an RTL problem

Kuwaiti retail copy is heavily code-switched — *MacBook Pro 14 بوصة* — and a price inside an Arabic run is a bidi-neutral sequence that reorders wrongly. Wrap numeric runs in U+2068/U+2069 (isolate/pop). This is the bug that appears on demo day rather than in the spike.

Two Arabic parameters belong in the manifest rather than being discovered visually: Arabic reads smaller at the same nominal size, so an `arScale` of roughly +10–20% is normal; and every Arabic slot is a bidi slot.

### Output mode: outline the Arabic, keep the Latin live

`textMode: "live" | "outline" | "auto"`, where auto outlines any string containing Arabic-range codepoints.

The reasoning is that Illustrator's Arabic support is conditional in ways we do not control. Its Middle Eastern text engine is **not enabled by default** — without it, Arabic renders disconnected and reversed. A non-Arabic language build of Illustrator hides the RTL controls from the palettes entirely. Illustrator's *own* SVG export loses RTL ordering, a standing bug whose official answer is "convert to outlines." A paid RTL-fixing product exists across Illustrator and Affinity, which is itself evidence the native path is unreliable.

So the designer gets **editable English** — the copy they actually tweak — and Arabic that is immune to their Illustrator version, their composer setting, and whether they have the font installed. The logical string is carried as `data-text` for provenance.

**Reframe rather than concede.** Editability was never going to mean a designer retyping Arabic in Illustrator. It means fixing the Excel cell and re-rendering. **The template is the editable artifact; the output is a rendering.** That is defensible, and it needs designer buy-in as a workflow decision rather than being presented as a technical limitation.

Ship both files — live-text and outlined — with outlined as the default.

### Toolchain, with the reasons

| Job | Use | Not |
|---|---|---|
| Excel | `exceljs` — `getImages()` returns `{imageId, range.tl.nativeRow}`, exactly the image-to-row mapping | SheetJS, which cannot read image anchors at all |
| Shaping and measurement | `harfbuzzjs` | `opentype.js` — its advance widths are **wrong for Arabic**, because ligatures collapse glyphs (لا is one glyph), so naive measurement overestimates and shrinks text that would have fit |
| SVG parsing | `svgson` or `cheerio` with `xmlMode: true` | String templating (product names contain `&` constantly, which is malformed XML unescaped, and user-uploaded XML rendered in Chrome is an injection surface). Also **never jsdom or any HTML-mode parser** — they lowercase attributes and turn `viewBox` into `viewbox`, silently destroying the file |
| PNG | `resvg-js` — uses `rustybuzz` plus a real bidi implementation, and takes explicit font files | `sharp`, whose librsvg path has weak font control and is the classic source of "text renders wrong on the server" |
| PDF | Installed Chrome via `puppeteer-core` with `executablePath` | Playwright's 180 MB Chromium download |

Shaping and measurement are the same decision, because measurement needs shaped advances. HarfBuzz is infrastructure in every branch, not a fallback.

**PDF from Chrome is a proof artifact, not a print master.** RGB only — no CMYK, no spot colours, no bleed, no crop marks — and font subsetting means the recipient cannot retype text. Say this in the UI rather than letting a marketing manager discover it at the print house. A real print master would be SVG → `rsvg-convert -f pdf` → Ghostscript for CMYK, or handing the printer the SVG.

If a browser is used, inline the SVG and `@font-face` the actual files and await `document.fonts.ready`. Screenshotting a page that loads the SVG via `<img>` silently drops fonts and produces unselectable PDF text.

### Images

SVG already does the fitting: `preserveAspectRatio="xMidYMid slice"` is `object-fit: cover`, `meet` is `contain`. The `fit` value maps one-to-one with no custom math.

Aspect ratio is not the real problem though. Retail product images have inconsistent **subject scale and padding**, which cover and contain cannot fix and which is what makes a grid look amateur. The deterministic fix, no ML: trim to the content bounding box (non-white, non-transparent, with tolerance), then apply uniform padding.

A missing image renders a visible `IMAGE MISSING` placeholder. A blank box that says MISSING is recoverable; a silently blank design that gets published is not.

---

## The AI layer

**Ollama**, on `localhost:11434`, OpenAI-compatible. The decisive argument is not convenience — the production target is an on-prem server, almost certainly x86 with NVIDIA, and **MLX does not exist there**. Building on MLX would mean rewriting the runtime for production. MLX stays in reserve for a possible LoRA, noting that MLX-finetune to Ollama-serve is not a straight line: fuse, convert to GGUF, requantise. It works, it is lossy, it is fiddly.

Every model call goes through either `lib/ai/generate.ts` (local, default) or `lib/ai/route.ts`, which dispatches per-feature to `generate.ts` or to `lib/ai/cloud.ts` for a Settings-configured cloud provider (D97). Those are the files the localhost guardrail is enforced around, and having exactly this pair is what makes the guardrail real.

### Models and the memory budget

| Role | Model | 4-bit |
|---|---|---|
| Arabic reading and critique | `QCRI/Fanar-1-9B-Instruct` | ~5.5 GB |
| English generation and JSON | `google/gemma-4-12B-it` or `Qwen/Qwen3.5-9B` | ~5.5–7.5 GB |
| Embeddings | `bge-m3` | ~1.2 GB |

**Resident budget is 12–15 GB, not 24.** macOS gives the GPU roughly 75% of unified memory, and Postgres, Next.js, Chrome, screen sharing, and the embedder share what is left. A dense 27B needs 17–18 GB — it loads on a quiet machine and does not survive a demo.

Fanar is not in the Ollama registry; pull with `ollama pull hf.co/<repo>` and write a Modelfile. The available GGUFs are community uploads rather than official QCRI builds, so spot-check output before trusting one.

**What Fanar is and is not.** Both Fanar text models are continual pretraining on Google bases — the 9B on Gemma-2-9B, the 27B on `gemma-3-27b-pt`. The Gulf-dialect claim appears on the model card but not in either paper: *Kuwait* occurs zero times in the Fanar 2 paper, and *Gulf* occurs once, in an image-generation caption about traditional attire. Per-dialect benchmarks cover Egyptian and Levantine only, and Gulf exists solely as one of six subsets inside an aggregate reading-comprehension score.

What that leaves is real and useful: Fanar's evidence is for **understanding** Arabic, not writing it. It is the best-evidenced Arabic reader available under Apache-2.0, which is exactly what the chatbot and the advisor need. It is not the Kuwaiti copywriter, and no open model is.

Prefer the 9B over the 27B on Arabic grounds and not only memory: the 9B trained on roughly 410B Arabic tokens, while the 27B had about 120B tokens of continual pretraining at ~45% Arabic, so roughly 54B. **Seven to eight times more Arabic in absolute terms.** The 27B's edge is Gemma 3's stronger base.

**Do not make Fanar do the English.** Its base is Gemma-2-era, two generations behind the alternatives.

Ruled out: Aya Expanse is CC-BY-NC and therefore non-commercial. Jais-2-70B is too large and gated. Falcon-H1-Arabic, which the blogs name as leader, has no public weights — the claims trace to a press release. ALLaM's licence contradicts itself between its HF metadata and its documentation.

### Settings that are not optional

- **`num_ctx: 8192` explicitly.** Ollama's default is 2048–4096 and it *silently truncates*, eating retrieved rows and producing bugs indistinguishable from model-quality problems. The most common local-RAG footgun there is.
- **`temperature: 0`** for anything factual.
- **`OLLAMA_KEEP_ALIVE=-1`**, and pre-warm before any demo. The default five-minute unload is a 20–60 second dead pause mid-presentation.

### Structured output

Ollama's `format` takes a full JSON Schema, implemented as GBNF grammars, with violating tokens masked at decode time. Output is *structurally* guaranteed — and nothing more. Four layers on top:

1. Constrain with a Zod-generated schema.
2. **Check grounding in TypeScript, never by asking the model.** `cited_skus ⊆ retrieved_skus` is a set operation. Verify quoted spans with `input.includes(span)`.
3. **One retry** with the validation error appended, then fail visibly. No tolerant parser — a partial result that looks complete is worse than an error when nobody is reading logs.
4. **Keep constrained calls small and separate from prose.** Grammar-constrained decoding measurably degrades writing quality. Generate copy freely, then structure it in a second cheap call.

---

## Retrieval

Postgres full-text search over the real product rows, with the three or four spec dimensions customers actually ask about **normalised into typed columns at ingest**. Comparisons are answered by SQL, not by a 9B reasoning across jsonb where one brand writes `wifi_standard: "Wi-Fi 6"` and another writes `speed: "AC1200"`.

`bge-m3` for embeddings: the corpus is bilingual and queries cross languages; its 8K context matters because Arabic tokenises 1.5–4× heavier than English and e5-large would silently truncate at 512; and it emits **sparse vectors alongside dense from one model**, which gives lexical matching for SKUs, model numbers, and brand names that dense embeddings are notoriously bad at — otherwise that means bolting on BM25 separately.

**pgvector is not needed yet.** Fifty past posts: embed them, store as a `real[]` column, cosine in TypeScript. Microseconds, no extension, no index. Add pgvector when the corpus is thousands of rows.

---

## The advisor

Deliberately separate from the generator, and the signature enforces it: `review(text, {channel, lang})` takes **text, not a draft object**, so there is nowhere to put the generator's context and the compiler enforces what would otherwise be discipline.

### The checks have no model. The advice does. (D75)

The checking half — price drift, claim safety, compliance — is string operations and catalogue lookups, and stays that way: no hallucination surface, nothing to be wrong about, and most of the value. It is the ground truth, and the model is shown its results as settled facts it may not contradict.

The advice half was empty for a while, and it was the half people opened the screen for: v1 listed *hook, clarity, retention, CTA* under **not looked at**. `lib/advisor/converse.ts` answers those now, and asks — which product, which channel, which price belongs to which — when it cannot tell what it is looking at. Those questions are computed in TypeScript from what is actually missing, never asked of the model, because either a row matched or it did not.

Answering "which product" pins the row and skips retrieval, so the checking half also answers with Ollama stopped.

### When commentary is added

The evidence shaped this. Research measuring evaluation against generation found **generation beat evaluation on three of four datasets, worst on the 8B model** — and mechanistically, in evaluation mode a model gives 3–5× less attention to context and only 0.3–0.5% of its attention to the candidate it is judging.

But that measures verification against ground truth. A rubric decomposes an unbounded judgement ("is this a good hook?") into bounded named checks ("does it state a benefit in the first five words?"), and that genuinely is easier than free generation. **Rubric-scored critique is achievable; unstructured "rate this and tell me what is wrong" is not.**

The Arabic ceiling is hard: multilingual LLM-as-judge research measured average Fleiss' κ around 0.3 with **Arabic significantly worse than European languages**, approaching zero on harder tasks — and found that neither multilingual training nor model scale improves judgement consistency. Scaling does not fix it. Ship English critique with confidence, Arabic critique labelled as lower-confidence, and dialect authenticity stays human.

Rules that follow:

- **Binary yes/no named checks, never a 1–10 scale.** Any headline figure is a sum of binary checks.
- **Anchor every judgement to a quoted span** — this directly counters the attention failure above.
- **Randomise order when comparing versions**, running A/B and B/A. Position bias reaches 0.192 in small models, enough to flip verdicts. If the orderings disagree, report **"too close to call"**, which is honest and useful. One trap worth remembering: a model measured with the *highest* test-retest reliability also had severe position bias. **Consistency is not evidence the judge works.**
- **Never let the same model grade its own output** — self-preference bias is documented.
- **Max three fixes, ranked, enforced in the schema.** Twelve suggestions equals no suggestions. Offer three hook rewrites rather than one, since a rewrite is a generation task embedded in a critique task and will be the weakest part of the output.
- Verbosity bias measured below 0.011 across every judge tested — not worth engineering around.

### Advice versus checks

The structural split, and the UI must respect it:

- **Advice** — hook, clarity, retention, CTA, platform fit. Opinions. They top out at "needs work".
- **Checks** — factual grounding against the catalog, claim safety, cultural compliance. These can return **`problem — do not publish`** and block export. A superlative claim is not a style note.

```
verdicts:     { dimension: ok | needs work | problem }
blockers:     [ { quote, criterion, why } ]        -> publish disabled
fixes:        [ { quote, change, why, criterion } ] -> max 3, ranked
not_assessed: [ "trend fit — no live feed; Kuwait context: 2026-07" ]
```

The prose paragraph is capped at 120 words and asked for, not schema-shaped — grammar-constrained decoding measurably degrades writing, so the judgement is written freely and a second cheap call pulls the rewrites out of it. The essay is prevented by asking for less, not by a schema that also flattens the judgement (D75). Every rewrite is verified to quote the draft (`isQuoted`) and run through the studio's own `check()` before it is shown.

The most valuable check needs no cleverness: *your caption says 129 KD; the catalog says 119.500 as of yesterday.* That is a call to `lib/rag` which the chatbot builds anyway.

### post_performance

Seeded from the existing Instagram and Snapchat export, not accumulated by hand from zero by people who will stop after three weeks. Its payoff is a leaderboard and few-shot exemplars — *here are your five best posts, here is the draft, what is different* — which works at n=20 where regression needs n=2000.

**Never let the model read performance data and derive verdicts from it.** That smuggles a fabricated number back in wearing a data costume, which is worse than an obvious guess because it looks sourced. Performance data feeds **examples**, never **scores**.

---

## Trend freshness

Three layers that decay at completely different rates, and conflating them is how the tool loses trust:

| Layer | Shelf life | Handling |
|---|---|---|
| Viral specifics — sounds, memes, formats | 3–14 days | Unreachable offline. A human pastes it in |
| Seasonal and cultural | Months, predictable | A calendar, not a model |
| Structural — hook mechanics, format conventions | 6–18 months | Where the model is reliable. **Scope the promise here** |

**Do not hardcode platform-mechanics claims.** The online corpus is contaminated: precise-sounding ranking percentages that propagate by citing each other, with primary docs unreachable. Encode only what is robust — hook in the first three seconds, watch time dominates, one clear CTA, vertical, sound-independence — in `knowledge/kuwait/timely/` as dated entries with a source URL per rule, retrieved through the same path as the catalog so a stale entry is visible rather than silently baked in.

**Never fine-tune trend data into weights.** It is the fastest-decaying knowledge in the system.

The resolution: a free-text **"this week's context"** field on the campaign, where marketing pastes what they already know is trending. Zero network calls, and it puts trend-spotting with the humans who already do it.

---

## Schema

The irrecoverable decisions, which must exist before anything writes rows because no migration recovers a history that never happened:

| Column | Why |
|---|---|
| `messages.provenance jsonb` — `{retrieved_ids, model, prompt_version}` | A customer says "your bot told me 40 KD" and you can find out why |
| `messages.sender ∈ {customer, bot, rep}`, `.channel`, `.external_id` | Adding a human sender later changes the message shape in every consumer |
| `assets.bound_values jsonb` | Which published designs carry a stale price. **The sharpest gap in the system** — see below |
| `templates.manifest_version` | Forty saved templates survive a manifest schema change |
| `content_pieces.status`, `.source`, `.model`, `.prompt_version` | Approval gate, and which output came from which model |
| `post_performance.n` | The honesty rule enforced by the data rather than by remembering |
| `numeric(10,3)` for price, `timestamptz` for dates | Kuwait is UTC+3 with no DST; fils is three decimals. Getting either wrong is a data migration |
| `campaign_id` on `content_pieces` and `leads`, from migration one | Threaded from the start it is free and real; bolted on later it is backfilled numbers |

**The stale-price problem.** Prices move weekly, and once 200 designs are rendered the price is baked into pixels. With `bound_values` it is one query — mark affected assets stale, show *"12 assets are out of date"*, offer re-render. Without it the flagship output rots silently, and the first real failure is an ad carrying last month's price. That is the kind of failure that gets a system switched off permanently.

### Ingest is a weekly pipeline, not an import

Upsert on SKU. A diff preview — *14 prices changed, 3 new, 2 gone*. Soft delete via `active`. Skip-and-report so one bad row never kills a 200-row batch. And **re-embed changed rows**, without which the vector describes the old spec while SQL returns the new one and the two halves of the retriever silently disagree.

Real retail sheets have merged cells, headers below row 1, blank and duplicate SKUs, prices as text with "KD" in the string, filename-case mismatches, and missing images. The contract is skip-and-report, always.

### Deliberately not generalised

`products` uses column-per-language; `content_pieces` uses row-per-language. Inconsistent, and it does not matter — there is no third language coming. **No i18n abstraction.** Recorded here so nobody "fixes" it.

---

## Module boundaries

`lib/excel`, `lib/template`, `lib/ai`, `lib/rag`, `lib/advisor`. Five, not seven — `lib/render` shares the manifest type, font loading, and measurement with `lib/template`, and `lib/kuwait` is markdown plus one read function.

The boundary that pays off over months is inside `lib/template`: **`layout.ts` must be pure.** Shaping, measurement, wrapping, fitting. No I/O, no database, no sibling imports. It is the hardest code in the project and purity is what makes it testable.

One runnable check: roughly fifteen fixtures rendered to committed SVG snapshots — short and long English, short and long Arabic, mixed Arabic with a Latin brand name, a price, a string containing `&`, an empty cell. **Text-layout regressions are invisible until you are looking at 200 bad posts.**

---

## Enforcing the localhost rule

A boot-time assert that `OLLAMA_BASE_URL`'s host is loopback, throwing with an actionable message, plus ESLint `no-restricted-imports` on HTTP clients everywhere except `lib/ai/generate.ts`. About twenty lines, and it makes the offline proof true by construction rather than by luck.

Note the rule bans *requests leaving localhost*, not the `openai` package — Ollama's endpoint is OpenAI-compatible, so that client pointed at localhost is the correct implementation.
