---
name: marketing-campaigns
description: How to plan, brief, critique and run a real marketing campaign in this repo — objective, audience, single-minded proposition, offer mechanic, channels, timing and how success is actually measured, with the Kuwait retail calendar, channel reality and compliance rules that override generic marketing advice. Use this whenever someone is creating or naming a campaign, writing or reviewing a campaign brief, filling in "this week's context", choosing an offer or a channel, asking "what should we run for Hala Febrayer / National Day / Back to School / Ramadan", critiquing a proposition or a caption angle, reading a campaign report, or touching anything under app/(staff)/campaigns, lib/brief.ts or lib/campaigns.ts — even when they only say "what should we post about the new laptops" and never use the word campaign.
---

# Marketing campaigns, in this system

A campaign is **a sequence of activities designed to achieve one business outcome** — a
media-driven effort promoting a specific product or brand over a defined period
([Adobe](https://business.adobe.com/blog/basics/marketing-campaigns)). Not one touchpoint:
a series of orchestrated interactions.

The distinction that matters here:

| Posting things | A campaign |
|---|---|
| Each post decided on its own day | Every post is a different way of saying one thing |
| Product chosen by whatever arrived | Products chosen because they serve the objective |
| "Did it get likes?" | A success measure written down *before* it ran |
| Ends when someone gets bored | Runs a stated window, then gets reported |

Adobe calls the governing constraint the **Rule of One**: one campaign, one primary
objective. A campaign without a central purpose fragments the budget and dilutes the
message ([Adobe, campaign phases](https://business.adobe.com/blog/basics/how-to-create-marketing-campaign)).
In this repo the Rule of One has teeth — `suggest()` in `lib/campaigns.ts` flags a
proposition containing "and" as *two campaigns wearing one name*.

---

## The brief

Eight things a brief must settle. Seven of them are fields on the create form
(`lib/brief.ts`, `composeContext`); the eighth is not a field and that is deliberate.

| # | The classic question | Field here | What a good answer looks like |
|---|---|---|---|
| 1 | Objective | *(no field — goes in Notes)* | One outcome. "Move the sub-200 KD laptops before term starts." Not "raise awareness." |
| 2 | Audience | `audience` | Who, and what they already believe or worry about. "Students starting the year, and the parents actually paying" beats "18–24". |
| 3 | What is being promoted | `pushing` | Two to six plain words: "laptops and tablets". Not the shop's category labels, not one SKU. |
| 4 | Single-minded proposition | `say` | One sentence, under fifteen words, **one idea**. See below — this is the field that decides whether the campaign exists. |
| 5 | Reason to believe | *(inside `say` or Notes)* | Why the claim is true. In retail it is usually the offer or a spec that traces to a catalogue row. |
| 6 | Offer mechanic | `offer` + `offerDetail` | One of `OFFER_MECHANICS`, plus the specifics **a person types**: "Bundle — laptop, backpack and a 64GB drive at one price." |
| 7 | Channels and timing | `channels`, `runs` | Up to three channels. `runs` is a phrase, never dates: "through the first week of September". |
| 8 | Success measure | *(no field — Notes, then the report)* | Phrase it only as something the campaign report can actually show. |

**Why 1 and 8 have no field.** A campaign is four columns and stays four columns
(`CLAUDE.md`). Adding `objective` and `kpi` columns is how this grows into a CRM. Write
them into Notes as sentences, and hold yourself to the report: `report()` in
`lib/campaigns.ts` returns designs exported, drafts written, drafts approved, which
products customers **asked about**, products customers asked about that you never
promoted, and the questions the assistant could not answer. A success measure the report
cannot show is a wish.

Good: *Worked if customers ask about the tablets, not only the laptops.*
Bad: *Worked if engagement rises 20%* — nothing in this system can see that, and Adobe's
own advice is to measure business metrics rather than vanity metrics like likes.

### The one-page rule

If the brief does not fit on one screen, the campaign is not decided yet — it is a list
of hopes. Everything above composes into one labelled plain-text string, and that string
is pasted verbatim into the studio prompt under `THIS WEEK, FROM MARKETING`. Labelled
lines, not prose: a person scans it and a model parses it, and both do better with named
lines.

### Worked example

```
Pushing: Laptops and tablets under 200 KD, plus the bags and drives that go with them.
For: Students starting the year, and the parents actually paying.
Offer: Bundle — laptop with a backpack and a 64GB drive at one price.
Say: Everything for the first day, in one box.
Channels: Snapchat, Instagram
Runs: through the first week of September
Notes: Objective — clear sub-200 KD laptop stock before term starts. Worked if customers
ask about the tablets, not only the laptops. Term starts late September so the deadline is
real. Thursday evening onward is the weekend here. Nothing on exam stress as an angle.
```

---

## The single-minded proposition

The one thing the audience should take away. Every caption, script and poster in the
campaign is a different way of saying it, so **it has to be worth saying twenty times.**

Tests, in order — a proposition failing any one of these is not ready:

1. **One idea.** No "and", no comma-joined list. If it needs an "and", it is two campaigns.
2. **About what the customer gets**, not what the shop is doing.
3. **No superlative.** "best", "fastest", "number one", "ultimate" — these are blocked
   downstream as compliance blockers, not style notes, so kill them at brief time. One
   superlative typed here becomes sixty rejected drafts later.
4. **Survives twenty rewrites.** If you cannot imagine twenty different captions saying
   it, it is a slogan, not a proposition.
5. **Could a competitor say it?** If yes, it says nothing.

**The measured failure in this repo:**

> "Power your gaming and studies with high-performance laptops and headsets"

Four faults in one line: two audiences (gaming, studies) joined by "and"; two product
categories (laptops, headsets) joined by another "and"; "high-performance" is an
unsubstantiable claim; and it describes the shop's inventory rather than the customer's
outcome. It is a category page with a verb in front of it. Pick one:

- *A laptop that lasts the whole degree.* (studies, durability)
- *Your first frame drop is not the laptop's fault.* (gaming, performance — but needs a spec from a catalogue row as the reason to believe)

More pairs:

| Not a proposition | Why | A proposition |
|---|---|---|
| "Get great deals on our laptop range" | Announcement; the shop is the subject | "Everything for the first day, in one box." |
| "The best prices in Kuwait this February" | Blocker-grade superlative | "The February price is the price you pay in instalments." |
| "Premium sound and stylish design for every lifestyle" | Three ideas, zero specifics | "Hear the doorbell over the game." |
| "Upgrade your home entertainment experience" | True of any TV ad ever written | "Trade the old TV in; walk out with the new one today." |

`suggest()` already runs two of these checks for you and returns them in `weak` — the
"and" test and the superlative/competitor-comparison test from `lib/content/guard.ts`.
Fix a `weak` line before saving; it is cheaper than sixty blocked drafts.

---

## Campaign types

Adobe's basics name these types
([types](https://business.adobe.com/blog/basics/digital-marketing-campaign),
[marketing campaigns](https://business.adobe.com/blog/basics/marketing-campaigns)):
**product marketing** (features, benefits, value of one offering), **brand development**
(identity, values, emotional connection, loyalty), **email marketing** (targeted,
personalised, nurture and conversion), **social media marketing** (reach and community
across platforms), plus seasonal, user-generated-content, and rebrand/launch campaigns.

What a Kuwait electronics retailer actually runs, in rough order of frequency:

1. **Seasonal / calendar** — Hala Febrayer, National Day, Back to School, Ramadan and the
   two Eids, Black Friday. The default and the highest-value type here, because the
   calendar is the part of "knowing Kuwait" that is stable for years.
2. **Offer / price-led** — a was/now, a bundle, instalments. In retail the offer *is* the
   campaign. `OFFER_MECHANICS` is a closed list for exactly this reason.
3. **Product launch** — a new phone, console or laptop generation arriving.
4. **Category push / clearance** — moving stock in one category before a season turns.
5. **Brand development** — real but slow, and it does not fit a two-week window. Do not
   dress a brand campaign as an offer campaign; it will fail the success measure.

Not run here, and do not plan for them: **email** (no list, no sending in this system) and
**WhatsApp** (every message would transit Meta — forbidden by the data-locality rule, see
D4). Paid media budget is out of scope entirely: this is not an ad-spend manager
(`docs/vision.md`). Adobe treats budget as a phase that moves with the goals; here the
lever is which channels get the team's shooting and editing time, not money.

---

## Kuwait overrides generic advice

`knowledge/kuwait/evergreen/` is the source; these are the points that change a plan.

**Calendar** (`retail-calendar.md`)
- **Hala Febrayer, through February — the biggest fixed retail window in the year.** If
  you plan one campaign well, plan this one.
- **National Day 25 Feb and Liberation Day 26 Feb** run as one two-day patriotic period.
- **Back to School** — late summer into September.
- **Summer travel** (June–July) — much of the audience is abroad; electronics move
  *earlier* than the trip.
- **Black Friday** is observed; some retailers frame it as White Friday.
- Hijri dates shift ~11 days earlier each year. **Never compute Ramadan or Eid dates —
  confirm them.** `whereInTheYear()` deliberately refuses to assert them.
- **The 2027 collision:** Ramadan falls roughly February–March 2027, overlapping National
  Day, Liberation Day and Hala Febrayer. Plan for it rather than discovering it.
- During Ramadan the daily rhythm inverts — heavy evening and late-night activity, with
  smartphone usage peaking 9 PM–1 AM (Ipsos MENA 2023, directional and now several years
  old). Treat it as a mode, not a one-off.

**The weekend is Friday and Saturday.** Thursday evening behaves like a Friday evening
elsewhere. A launch scheduled for "the weekend" by a model trained on Saturday–Sunday
markets lands on the wrong days.

**Channels** (`channels-and-platforms.md`, DataReportal *Digital 2026: Kuwait*)
- **Snapchat reaches ~48% of the population and is not a secondary channel in this
  market.** Any plan treating it as an afterthought is wrong for Kuwait. TikTok, YouTube
  and Instagram all matter; X is a minority channel used for announcements and service.
- Reach figures are **ad-reach, not user counts** — never quote them as "this many people
  use it", and never let them into copy.
- Format: vertical, full-screen, **sound-independent** (much viewing is muted, so on-screen
  text is not optional). Watch time and completion dominate ranking. The first ~3 seconds
  decide distribution; Snapchat's own guidance is a hook in 1–2 seconds.
- **As of 31 July 2026 Snapchat no longer recommends wholly AI-generated video on
  Spotlight.** Content enhanced or edited with AI stays eligible. Plan human-shot footage
  with assisted script and layout — this is why the whole system is assistive.

**Offers** (`pricing-and-offers.md`) — the five mechanics that exist here: straight
percentage off, **was/now pairs (the strongest performer in electronics)**, bundles
(device plus accessory at a combined price), instalment framing (widespread in Gulf
electronics retail), and trade-in. Prices carry **three decimals**: `119.500 KD`, never
`119.50`.

**Tone** (`tone-and-dialect.md`) — code-switching is the normal case; product names and
model numbers stay in English inside Arabic copy. No model writes convincing Kuwaiti
dialect and none can judge whether a draft reads Kuwaiti or reads translated. Arabic
authenticity is a human review step, permanently, and Kuwaiti register comes from the
company's own past posts used as exemplars.

**Compliance** (`compliance-guardrails.md`) — blockers, not advice:
- **Nothing political.** No topics, figures, parties, events or positions; not as a joke,
  hook or analogy.
- **Religion is never a marketing angle.** Religious occasions may be referenced only as
  neutral calendar facts — "Eid hours", "Ramadan offers", the register of a shop sign.
  Ramadan and Eid are commercially enormous and normal to run offers around; the line is
  between *acknowledging the season* and *using the faith*. Two easy accidents: food and
  drink imagery during Ramadan daylight hours, and a loud celebratory promotion during
  national or public mourning.
- **No unsubstantiable superlatives, no comparison to a named competitor, no guarantees
  the company has not committed to.**
- **Every price, spec and availability claim traces to a catalogue row.** If it is not in
  the data it does not go in the copy. The model never emits a figure at all.

---

## Running one, end to end

1. **Campaigns → create.** Type the rough idea, press assist if you want a starting point.
   `suggest()` grounds itself in four things you do not have in front of you: the products
   actually in the catalogue matching your idea, where today sits in the retail year,
   the offer mechanics that exist here, and what the last campaign said. It **never writes
   a figure** — anything numeric it returns comes back in `invented` for you to see and
   remove. The offer specifics are yours to type. Fix everything in `weak` before saving.
   The name is stamped on every design and caption for months: make it a label somebody
   recognises later ("Back to school — laptops"), not a slogan.

2. **The newest campaign is the current one.** There is no status column and no start
   date. Creating a campaign makes it current, and everything stamped from then on carries
   its id. Two campaigns cannot both be live — if you need that, you have found the
   reversal condition written in `db/004_campaigns.sql` and D68, not a missing feature.

3. **Products & designs.** Load the Excel sheet, render the template over the rows you are
   promoting. Every exported asset carries `campaign_id`. This is how membership gets
   decided — by doing the work, not by ticking boxes.

4. **Social media (content studio).** The campaign's `context` is pasted into the prompt
   as steer, not fact: it sets angle, tone and offer, and it cannot change a price or a
   spec. Drafts carry the campaign id; a human approves each one before it reaches a
   printed asset.

5. **Advisor.** For copy the team wrote themselves. Named binary checks with the exact
   quoted span that triggered each one — the highest-value check being *your caption says
   129 KD, the catalogue says 119.500*. No score, no rating, no grade: those words do not
   appear, and no such column exists.

6. **The report closes the loop.** `report(id)` shows, per product: designs exported,
   drafts, approved drafts, and how many conversations the assistant **answered** about it
   (cited, not merely retrieved). Then the two lines that pay for the whole system:
   **products customers asked about that you never promoted**, and **the questions the
   assistant could not answer**. `docs/vision.md` calls the second the most valuable
   byproduct in the system, because it tells marketing exactly what the catalogue is
   missing. Read it before planning the next campaign — that is the feedback loop Adobe's
   final phase is describing, and it is the one measurement here that is real.

**The Kuwait screen is a person's job, not the assist's.** Trends and topic search are a
staff click, never fed into the brief prompt: this system will never tell you what is
trending, and a news story must not become a campaign angle with nobody having read it.
If a headline belongs in the brief, a person pastes a line into Notes.

---

## Constraints a campaign here must respect

- **Four columns: `id, name, context, created_at`.** Guard this against your future self.
  It grows into scheduling, budgets, statuses and approval workflows, and that is a CRM.
- **Membership is derived, never stored.** The products a campaign promoted are the ones
  whose designs and drafts carry its id. A `campaign_products` table is a second answer to
  the same question, and the two disagree the first time somebody forgets a checkbox. A
  SKU-bound product multi-select is the same table in a costume — do not add it.
- **No `starts_on` / `ends_on`, no `status`, no `budget`, no `owner`.** Timing lives in the
  `runs` phrase. The real cost is stated and accepted: `report()` has no window, so results
  are counted over all time since `created_at`.
- **The form gets structure; the column does not.** Seven questions compose into one
  string. There is no parser and no round-trip — reopening a campaign does not repopulate
  the questions, and building that is the step that turns a composer into a schema.
- **`lib/brief.ts` stays dependency-free** — no database, no filesystem, no model. The
  create form is a client component, and importing `lib/campaigns.ts` there ships a
  Postgres driver to the browser.
- **A person's figure in `offerDetail` is fine.** Rule 2 forbids *the model* emitting a
  number. "Up to 40% off" typed by a marketer is a person stating their own offer, and it
  still cannot put a digit into a caption downstream.

---

## Quick checklist before saving a brief

- [ ] One objective, written as one outcome, in Notes.
- [ ] `say` is one sentence, one idea, no "and", no superlative, about what the customer gets.
- [ ] `pushing` names kinds of thing that exist in the catalogue.
- [ ] `audience` says what they believe or worry about, not an age bracket.
- [ ] Offer mechanic is one of the five; the specifics are typed by a person.
- [ ] Snapchat considered on its merits, not by habit; format is vertical and readable muted.
- [ ] `runs` fits the Kuwait calendar and the Friday–Saturday weekend. No computed Hijri dates.
- [ ] Nothing political; any religious occasion appears only as a neutral calendar fact.
- [ ] No superlative, no named competitor, no guarantee, no figure the catalogue cannot back.
- [ ] Success measure is something `report()` can actually show.
- [ ] The whole thing fits on one screen.

## Sources

- Adobe, *Marketing campaigns: how to create and benefits* — https://business.adobe.com/blog/basics/marketing-campaigns
- Adobe, *Plan your marketing campaign in 6 simple steps* — https://business.adobe.com/blog/basics/how-to-create-marketing-campaign
- Adobe, *Digital marketing campaigns: types, channels, and examples* — https://business.adobe.com/blog/basics/digital-marketing-campaign
- Repo: `CLAUDE.md`, `docs/vision.md`, `lib/brief.ts`, `lib/campaigns.ts`, `knowledge/kuwait/evergreen/*.md`, `knowledge/kuwait/compliance-guardrails.md`

**How the Adobe material got here, so nobody over-trusts it.** The three Adobe pages could
not be fetched from this machine — `WebFetch` timed out twice and `curl` returns `000`, so the
host appears to refuse us outright. Everything attributed to Adobe above came from search
results *about* those pages, not from reading them. The definition, the Rule of One, the
six-phase framing and the vanity-metrics point are consistent across several summaries and are
safe to rely on; **the campaign-type list is probably a subset of what the article names.** If
the page ever becomes reachable, read it and widen §Campaign types.

Everything Kuwait-specific, every code reference and every worked example above comes from this
repo and its own `knowledge/kuwait/` files, which were read directly. Those are the parts to
trust without qualification.
