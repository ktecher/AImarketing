# Sources

Every factual claim in `knowledge/kuwait/` traces to a line here, with the date it was verified. When a claim cannot be traced, it is marked unverified in place rather than quietly dropped.

Re-verify anything in `timely/` before relying on it. `evergreen/` is stable but not immortal.

---

## Verified 2026-08-18

**Kuwait platform reach** — DataReportal, *Digital 2026: Kuwait*.
https://datareportal.com/reports/digital-2026-kuwait
Published November 2025; figures reference October 2025. All figures are **ad-reach**, sourced from platform advertising tools: they include duplicate and inactive accounts, and are quoted against total population while measuring adults 18+. This is why TikTok exceeds 100%.

*Conflicting source, deliberately not used:* NapoleonCat reports materially higher Instagram and Facebook figures for the same period, including a Facebook number exceeding Kuwait's population. Different methodology, same underlying Meta ad tools. One source used consistently; DataReportal's methodology notes are more transparent.

**Snapchat AI-content policy** — wholly AI-generated video no longer recommended on Spotlight as of 31 July 2026; AI-*enhanced* content remains eligible with transparency indicators.
https://techcrunch.com/2026/07/31/snapchat-no-longer-rewards-fully-ai-generated-spotlight-content/
https://www.socialmediatoday.com/news/snapchat-will-no-longer-recommend-ai-slop/826782/

**Ramadan usage timing** — smartphone usage in Kuwait peaks 9 PM – 1 AM during Ramadan, later than any other month. Ipsos MENA, 2023. The most credible timing figure found; now several years old.

**Arabic LLM judging reliability** — average Fleiss' κ ≈ 0.3 across models, Arabic significantly worse than European languages, approaching zero on harder tasks; neither multilingual training nor model scale improves judgement consistency.
"How Reliable is Multilingual LLM-as-a-Judge?" — https://arxiv.org/html/2505.12201v1 (EMNLP 2025 Findings)

**Evaluation versus generation in small models** — generation beat evaluation on three of four datasets, worst on the 8B model; in evaluation mode models allocate 3–5× less attention to context and 0.3–0.5% to the candidate being judged.
"Can LLMs Judge Better Than They Generate?" — https://arxiv.org/html/2606.28050

**Judge bias measurements** — position bias up to 0.192 in smaller models; verbosity bias below 0.011 across all 21 judges tested; the consistency-bias paradox (highest test-retest reliability co-occurring with severe position bias).
"Reliability without Validity" — https://arxiv.org/html/2606.19544v1

**Fanar model family** — Fanar 1 (https://arxiv.org/abs/2501.13944) and Fanar 2 (arxiv 2603.16397). Full text of both read directly. *Kuwait* appears zero times in the Fanar 2 paper; *Gulf* appears once, in an image-generation caption. Per-dialect benchmarks cover Egyptian and Levantine only. Both text models are continual pretraining on Google Gemma bases.
https://huggingface.co/QCRI/Fanar-1-9B-Instruct

**Gemini API free-tier data usage** — https://ai.google.dev/gemini-api/terms
Unpaid tier: submitted content and generated responses are used to "provide, improve, and develop Google products and services", and "human reviewers may read, annotate, and process your API input and output." Paid tier states the opposite. Categorical, not a matter of degree.

**Illustrator Arabic handling** — the Middle Eastern text engine requires explicit enablement (World-Ready Layout plus the Middle Eastern composer); a non-Arabic language build hides RTL controls from the palettes entirely; Illustrator's own SVG export loses RTL ordering, with "convert to outlines" as the official answer.
https://helpx.adobe.com/indesign/desktop/language-and-proofing/arabic-and-hebrew/set-up-arabic-and-hebrew.html
https://community.adobe.com/t5/illustrator-discussions/issue-with-reversed-text-in-svg-files-using-adobe-illustrator/td-p/15058075

**Arabic fonts, all SIL OFL 1.1** — free commercial use, embeddable, modifiable with rename.
Cairo, IBM Plex Sans Arabic, Tajawal, Almarai, Readex Pro, Noto Sans / Naskh / Kufi Arabic — all via https://fonts.google.com
Self-host the files. Hotlinking Google Fonts is an external request and breaks the offline requirement.

---

## Explicitly unverified

Recorded so nobody mistakes absence of a source for absence of doubt.

- **Peak posting times for Kuwait outside Ramadan.** Every result was an agency blog with no underlying data. The company's own analytics will beat any published figure.
- **Ramadan video consumption uplift** (commonly cited as +30–40%). No primary source found.
- **Quantitative data on Arabic vs English vs code-switched performance in Gulf retail social content.** None published that could be found. This is a gap to fill from the company's own posts, and it would be the single most valuable proprietary dataset available here.
- **Platform ranking mechanics with precise numbers** — engagement weightings, view-count phase thresholds, reply-versus-like multipliers. The online corpus is contaminated: precise-sounding figures propagating by citing each other, with primary platform documentation unreachable. Only robust, repeatedly-confirmed mechanics are recorded in `channels-and-platforms.md`.
- **Claimed 2026 updates to X's public ranking algorithm.** Only the 2023-era repository could be found.
