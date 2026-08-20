# Tone, dialect, and language mix

## The register question

Three registers appear in Kuwaiti retail material:

- **Modern Standard Arabic (MSA)** — formal, pan-Arab, correct everywhere and warm nowhere. Fine for specifications, terms, and formal announcements.
- **Kuwaiti / Gulf dialect (Khaliji)** — how people actually speak. Warmer, closer, and what distinguishes local brands from regional ones.
- **English** — widespread, especially in electronics where product names, specs, and model numbers are English by default.

**Code-switching is the normal case, not an edge case.** Real Kuwaiti retail copy mixes freely: *MacBook Pro 14 بوصة*. Any system treating a caption as monolingual will get the layout wrong (see the bidi note in `pricing-and-offers.md`) and the tone wrong.

## The hard limit

**No available model writes convincing Kuwaiti dialect**, and none can reliably judge whether a draft reads Kuwaiti or reads translated. "Gulf" is the finest granularity any open model claims, and even that claim is thinly evidenced — see `docs/decisions.md` D7.

Mediocre Arabic from a model does not look broken. It looks **grammatically correct and tonally foreign**, which reads worse to a Kuwaiti audience than English does, because it reads like translation.

Two consequences, both structural:

1. Arabic *generation* is deferred. Arabic *rendering* from the Excel is not — that is deterministic and carries no model risk.
2. Dialect authenticity is judged by a human, permanently. This is the judgement the marketing team most wants outsourced and the one that cannot be.

## Where Kuwaiti voice actually comes from

Not from a model, and not from a prompt describing the dialect. From **30–50 of the company's own best past posts**, used verbatim as few-shot exemplars. Human-written, on-brand, already approved, and already local. This is the highest-value asset available for this project and it costs a request rather than a build.

## Practical notes

- Product names, model numbers, and specifications stay in English inside Arabic copy. Translating them is wrong and reads as amateur.
- Arabic runs longer than English for the same content — an eight-character English name can be forty characters in Arabic. This drives the auto-fit design.
- Arabic reads smaller at the same nominal point size; the template carries an `arScale` adjustment of roughly +10–20%.
- Formal MSA in a casual channel reads as an advertisement. Dialect in a formal announcement reads as careless. Match the register to the channel.
