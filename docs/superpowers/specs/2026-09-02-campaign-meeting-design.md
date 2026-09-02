# The campaign meeting

**Date:** 2026-09-02
**Status:** approved, not yet implemented
**Decision entry:** D92 (to be written when this lands)

---

## The problem

Making a campaign is the first thing anybody does in this system, and today it is
a form. `suggest()` in `lib/campaigns.ts` improved on a blank form considerably —
it is grounded in the real catalogue, where today sits in the retail year, the
closed list of offer mechanics and the last two campaigns' voice — but it is
still **one shot in, one brief out**. It cannot ask what makes this phone worth
buying, it does not know what the shop is willing to spend, and it has no opinion
about how the money should be divided.

A marketer with an idea does not want a form filled in. They want the meeting
they would have had with an agency: someone who asks what is special about the
thing, what the budget is, whether there is a photographer, whether anyone has
booked a mall screen — and *then* says what to do with it.

This spec describes that meeting.

## Scope

**In:** an interactive planning conversation on `/campaigns` that interviews the
person, advises as it goes, produces a plan including a budget split, and creates
the campaign when they say so.

**Out, deliberately:**

- No change to the `campaigns` table. It stays four columns (CLAUDE.md §6).
- No scheduling, no statuses, no approvals. Those are the CRM this project refuses to become.
- No replacement of `suggest()`. It stays as the fast path for someone who wants a brief and not a meeting; the meeting reuses its grounding helpers rather than forking them.
- No sourced offline-channels knowledge file. See *Offline channels* below.

---

## The interaction

One screen, one thread, on `/campaigns`.

The person opens with the idea in their own words. From then on **every planner
turn carries three things at once**:

1. **A read-back.** One or two sentences of what it now understands. A wrong
   assumption must die on turn two, not in the finished plan.
2. **One question**, with two to four suggested answers the person can click.
   One question, never a form — this is the same rule the rest of the UI follows.
   The suggestions are drawn from real data (catalogue rows, the retail calendar,
   the trends file), which is what makes them answerable by someone who could not
   phrase the answer cold.
3. **The plan so far**, beside the thread, updating every turn.

It advises *while* it interviews rather than after. The person can stop at any
turn and take what is on screen.

When enough slots are filled the planner stops asking and says so. **The person
presses "Write the plan", not the planner** — the meeting ends when they are
satisfied, not when a slot counter fills.

After the plan, one more button: **"Create the campaign"**.

### Slots

The checklist lives in TypeScript, not on screen. The planner asks for whichever
slot is missing and matters most given what it already knows.

| Slot | Why it is asked |
|---|---|
| `pushing` | What is being promoted, in plain words |
| `special` | **What is different about it.** The slot that decides whether the campaign is about a phone or about *this* phone |
| `objective` | Closed list — see below. "More sales" is not an objective |
| `audience` | Who, and what they already believe or worry about |
| `budget` | A figure the person types. Never one the model writes |
| `channels` | What they actually have access to, including offline |
| `when` | The window, in words |
| `offer` | One of `OFFER_MECHANICS` from `lib/brief.ts` |
| `constraints` | Anything that rules an option out |

```ts
export const OBJECTIVES = [
  'Sell it',        // move units now
  'Launch it',      // a thing nobody knows exists yet
  'Clear it',       // stock that must go
  'Bring people in' // footfall to a branch
] as const
```

A closed list because "what is the objective" has a small real answer set in
retail, and an open string here produces "increase brand awareness and drive
sales", which is two campaigns and no objective.

`special` has no closed list and is the most important slot. It is asked early,
grounded in the catalogue rows that matched the idea, and the planner is
instructed to push back once if the answer is a spec sheet rather than a reason
to buy.

---

## The budget split

This is the part that collides with **CLAUDE.md rule 2 — the model never emits a
number** — and the resolution is the core design decision of this spec.

The person types the total. The model proposes **line items with a weight word**,
never an amount and never a percentage:

```ts
export const LINE_ITEMS = [
  'Boosting',
  'Photography and production',
  'Influencer',
  'Print and OOH',
  'Event',
  'Contingency',
] as const

export const WEIGHTS = ['dominant', 'large', 'moderate', 'small', 'minimal'] as const

export type PlanLine = {
  item: (typeof LINE_ITEMS)[number]
  weight: (typeof WEIGHTS)[number]
  /** One sentence. Why this line gets this much. */
  why: string
}
```

Both are Zod enums, so a constrained decode cannot return a sixth line item or
an invented weight for the UI to silently drop — the same reason `offer` is an
enum in `SuggestSchema` today.

**TypeScript does every digit:**

```ts
const SHARE: Record<Weight, number> = {
  dominant: 8, large: 5, moderate: 3, small: 2, minimal: 1,
}

export function split(totalKwd: number, lines: PlanLine[]): SpendLine[]
```

- Reject a total that is not a finite number greater than zero. `Number.isFinite`
  first, then the range — a `NaN` total passes `total > 0 || total < MAX` style
  checks in both directions and would flow on as a number.
- Work in **fils** (integers), never in floating-point KWD. `Math.round(total * 1000)`.
- Allocate `Math.round(totalFils * SHARE[w] / sumOfShares)` per line.
- Push the rounding remainder onto the **largest** line, so the parts sum exactly
  to the whole. Not the last line — that is usually Contingency, and a contingency
  that quietly absorbs rounding error is the line nobody audits.
- Format through `formatKwd()` in `lib/money.ts`. One formatter, three decimals,
  `250.000 KD`. There is no second implementation of this rule anywhere.

The screen shows `Boosting — 250.000 KD` with the model's `why` beside it. The
model wrote `Boosting / dominant / "Snapchat reaches nearly half the country and
this is a launch"`. It did not write `250.000`, and it did not write `40%`.

**A percentage is a digit.** This is why weights are words and not shares. An
enum of `'40%' | '30%'` would be the model emitting numbers with extra steps.

Secondary benefit: the splits become consistent and explicable across campaigns
rather than whatever proportion a model felt like on the day.

---

## Where the expertise comes from

A 9–12B model running on localhost is not a Kuwait marketing expert. Asked to be
one, it produces confident generic advice, which is worse than no advice because
it is indistinguishable from the real thing. So the expertise is **retrieved
every turn, never remembered**:

| Source | What it supplies | Already exists |
|---|---|---|
| `retrieve(idea, 15)` | The real rows on the shelf, names and categories only — no price, no specs | yes |
| `whereInTheYear()` | Where today sits in the Kuwait retail year | yes, private in `lib/campaigns.ts` — **export it** |
| `WEEKEND` | Friday–Saturday, Thursday evening behaves like a Friday | yes, same file — **export it** |
| `guardrails()` | `compliance-guardrails.md` read from source, not paraphrased | yes, same file — **export it** |
| `OFFER_MECHANICS` | The mechanics that exist in this market | yes, `lib/brief.ts` |
| `knowledge/kuwait/evergreen/channels-and-platforms.md` | Channel behaviour and reach | file exists, no reader |
| `knowledge/kuwait/timely/trending-searches.md` | What Kuwait is actually searching for | file exists, no reader |
| `report()` on past campaigns | **What customers asked about and what the bot could not answer** | yes |

That last row is the one nothing else can do. `report()` already returns
`unpromoted` — products customers asked about that the last campaign never
promoted — and `unanswered`, the questions the assistant handed to a human.
`vision.md` calls the second one the most valuable byproduct in the system.
Feeding it into the next campaign's plan is the loop paying out, and it is the
only input here that a generic marketing tool could not also have.

### Reading the knowledge files

`lib/kuwait.ts` — one new file, one read function. CLAUDE.md §Layout permits
exactly this and no more: *"`lib/kuwait` does not exist; it is markdown plus one
read function."* No directory, no module, no abstraction over the folder.

```ts
export type KuwaitNote = { text: string; last_verified: string | null; source: string | null }
export function readKnowledge(file: string): KuwaitNote | null
```

Parses the frontmatter that `timely/README.md` already mandates
(`last_verified`, `source`), returns the body, returns `null` rather than
throwing when a file is missing — a plan without a trends section is still a
plan.

### Dates travel with the facts

`timely/README.md` is explicit that `last_verified` **is displayed in the UI**.
The meeting honours that:

- Any fact the planner uses from `timely/` is stated with its date attached —
  *"Kuwait was searching for vehicle impoundment on 1 September"* — and the plan
  carries a `Kuwait context as of 2026-09-01` line.
- The file's own warning travels with it into the prompt: most days the feed is
  sport, weather and world news, and whether a trend is usable for retail is the
  person's judgement, not the model's.
- The planner may **offer** a trend as an angle. It may not assert that a trend
  is relevant to electronics retail.
- Rule 5 is already enforced upstream — `pull-trends.mjs` drops political and
  religious trends before they reach the file — and `check()` enforces it again
  on anything the planner writes.

### Offline channels

There is nothing in `knowledge/kuwait/` about billboards, mall activations,
events, cinema or radio. The entire knowledge base is social, and a model asked
about Kuwaiti out-of-home will invent reach figures and costs — rule 3's exact
failure.

**The planner therefore asserts nothing about offline channels in Kuwait.** It
may say a mall activation suits a launch better than a clearance, which is
structural and true in any market. It may not name a mall, quote a cost, or
estimate a reach. What it does instead is **ask what the shop has access to** and
plan around the answer.

`Print and OOH` and `Event` remain line items — the person may well be spending
there, and a plan that cannot allocate to a channel the person already booked is
useless. The planner allocates to them on the person's say-so, not its own.

Reversal condition: a sourced `knowledge/kuwait/evergreen/offline-channels.md`
with one source URL per claim, per the rules in `SOURCES.md`. Until that file
exists, this restriction stands.

---

## Data model and persistence

**No schema change.** `campaigns` stays four columns.

The meeting persists as a file store beside `lib/chat/store.ts` and
`lib/content/studio.ts` — the same precedent, the same `data/state/` root, the
same filename-safety check (`/^[A-Za-z0-9_-]{1,64}$/`, because ids are
filenames and a traversal here reads or writes anywhere on disk).

```ts
// lib/campaign/meeting.ts
export type Turn = { role: 'you' | 'planner'; text: string; at: string }

export type Meeting = {
  id: string
  /** Set once "Create the campaign" is pressed. Null while it is still a meeting. */
  campaign_id: string | null
  started_at: string
  turns: Turn[]
  /** What the planner has established. Filled in any order. */
  known: Partial<Record<Slot, string>>
  /** The plan so far. Rewritten every turn, never appended to. */
  plan: Plan | null
  model: string
  prompt_version: string
}
```

`prompt_version` is stamped for the same reason `content/v3` and `advisor/v2`
are: an old plan must stay explicable after the prompt changes.

The finished plan composes into the campaign's `context` through the existing
`composeContext()` in `lib/brief.ts`, extended with the plan's extra lines
(`Objective`, `Spend`, `Measure`). Same labelled-plain-text format, same
no-parser rule — reopening a campaign does not repopulate the meeting. Parsing
the context back into structure is the step that turns a composer into a schema,
and a schema here is the CRM.

The meeting file is the record; `context` is the handoff.

---

## Guards

Everything the planner writes goes through the checks that already exist. None
of them are reimplemented.

| Rule | Enforcement |
|---|---|
| **2 — no model-written number** | Every planner turn and every plan field is scanned for figures with the same extraction `suggest()` uses. Tokens carrying a letter that `isProductIdentity()` recognises are exempt (`M4` is what the product is called); bare digits never are. Anything found is surfaced as `invented[]`, visibly, never silently kept. |
| **3 — no fact not in a row** | Product facts come from `retrieve()`. The planner is shown names and categories only — no price, no specs — because a figure it has seen is a figure it paraphrases. |
| **4 — no score** | No aggregate, no rating, no readiness percentage on the plan. The words *score*, *rating* and *grade* do not appear. A plan is a plan. |
| **5 — no political or religious content** | `check()` from `lib/content/guard.ts` runs over the planner's prose; trends arrive pre-filtered by `pull-trends.mjs`. |
| **Superlatives** | `blockers(check(...))` on the proposition, exactly as `suggest()` already does. A superlative in a plan propagates into every caption written under it. |
| **Hijri dates** | Never computed, never asserted. `retail-calendar.md` says confirm them; the prompt says so too. |
| **Localhost** | One model call per turn through `lib/ai/generate.ts`. Nothing new reaches the network, so `check-localhost.mjs` is unaffected. |

The model's own prose is checked and any failure is shown as `caution[]` rather
than swallowed — the same shape `converse.ts` uses today.

### Model settings

`think: false`, `temperature: 0` for the structured half, `num_ctx: 8192` — all
already mandatory in `lib/ai/generate.ts`. The turn is **two calls**, following
the rule that grammar-constrained decoding degrades writing:

1. **Prose, free** — the read-back and the question. This is what the person reads.
2. **Structure, constrained** — the slot being filled, and the plan so far.

Small and separate, per CLAUDE.md §Calling the model. One retry with the
validation error appended, then fail visibly.

---

## Files

**New**

| File | What |
|---|---|
| `lib/campaign/meeting.ts` | Types, the file store, `reply()` — one turn of the meeting |
| `lib/campaign/spend.ts` | `LINE_ITEMS`, `WEIGHTS`, `split()`. Pure arithmetic, no model, no I/O |
| `lib/kuwait.ts` | The one read function, frontmatter and body |
| `app/api/campaigns/meeting/route.ts` | POST a turn, returns the reply and the plan so far |
| `app/(staff)/campaigns/meeting.tsx` | The thread, the question with its suggestions, the plan beside it |
| `scripts/test-meeting.mjs` | See below |

**Changed**

| File | Change |
|---|---|
| `lib/campaigns.ts` | Export `whereInTheYear`, `WEEKEND`, `guardrails`. No behaviour change |
| `lib/brief.ts` | `composeContext()` learns the plan's extra lines |
| `app/(staff)/campaigns/page.tsx` | The meeting replaces the create form as the front door; the form stays reachable |

CLAUDE.md says **five lib modules, not seven**, so `lib/campaign/` needs
justifying. It is not a sixth module: `lib/campaigns.ts` already exists at the
`lib/` root and does not move. `lib/campaign/` would be a folder for two new
files that belong to it.

If that reads as a distinction without a difference — and it might — put both
files at the `lib/` root as `lib/meeting.ts` and `lib/spend.ts` instead. The rule
counts modules, not directories, and neither placement changes the count.
**Decide once at implementation and do not revisit.**

---

## Testing

Follows the project's existing script-based harness (`scripts/test-*.mjs`, run by
`npm test`, currently 714 assertions).

**`split()` is the part with real arithmetic, so it gets real tests:**

- Parts sum exactly to the total, in fils, across a table of totals and weight
  combinations — including totals that do not divide evenly.
- A `NaN` total is rejected, not allocated. A `0` total is rejected. A negative
  total is rejected.
- One line gets the whole budget.
- The remainder lands on the largest line, not on Contingency.
- Output goes through `formatKwd` and is always three decimals.

**Guards:**

- A plan containing a model-written figure surfaces it in `invented[]`.
- `M4` in a product name is not reported as invented; a bare `40` is.
- A proposition with a superlative produces a `caution`.

**Store:**

- A meeting round-trips through disk unchanged.
- A traversal id (`../../etc/passwd`) is refused.

**Knowledge:**

- `readKnowledge()` returns `last_verified` from real frontmatter.
- A missing file returns `null` and does not throw.

**Not tested by unit tests, and named here so nobody claims otherwise:** whether
the advice is any good. That is judged by using it. Per this project's own
history — *trust the live run over the code read* — the acceptance test is a real
meeting about a real product, held by a person, ending in a campaign they would
actually run.

---

## Not building

- **No `campaign_plans` table, no fifth column.** The plan lives in the meeting file and lands in `context`.
- **No plan versioning.** Rewritten every turn; the turns are the history.
- **No parser from `context` back to structure.** Stated twice in `lib/brief.ts` and it holds here.
- **No score, no readiness meter, no "plan completeness: 80%".** Rule 4, and the plan is not creative work being graded either way.
- **No multi-user meeting, no comments, no assignment.** One person, one thread.
- **No offline-channel knowledge invented to fill the gap.** Ask instead.
- **No second model.** One local model, two calls per turn.

---

## Open items

1. **`lib/campaign/` vs `lib/` root** — decided at implementation, per the note above. Does not change the module count either way.
2. **Where the meeting sits on `/campaigns`** — the tab layout from D90 is recent; the meeting should not reintroduce the "go somewhere else to do one thing" problem it fixed.
3. **A sourced offline-channels knowledge file** — not in this spec. The reversal condition is written above.
