# The database

Everything about Postgres in this project: what is in it, why it exists at all,
and the decisions that cannot be taken again later.

`CLAUDE.md` caps this project at four docs on the grounds that a stale doc is
worse than a missing one. This is a fifth, and the justification is that it is a
**runbook plus an irreversibility list** — the class of thing that gets lost
between sessions and is expensive to rediscover. It stays short, and it points
at the files that are the real source of truth rather than copying them:

| Question | The actual answer lives in |
|---|---|
| What columns exist | `db/001_products.sql` |
| How Postgres is run | `docker-compose.yml` |
| How the app connects | `lib/db.ts` |
| What reads and writes it | `lib/catalogue.ts` |

Last verified 2026-08-20 against a running container: PostgreSQL 17.11 in
`pgvector/pgvector:pg17`, pgvector 0.8.6 available, 60 products with 60 vectors,
592 kB on disk.

---

## There are two catalogues

Conflating them was a real bug, and the words are easy to mix up.

| | **The campaign sheet** | **The full catalogue** |
|---|---|---|
| What | ~60 products a campaign is about | Everything the shop sells |
| Where | `data/state/last-import.json`, a file | Postgres, `products` table |
| Loaded on | *Designs* | *Products* |
| Read by | Designs, the content studio | The assistant, the advisor |
| Changes | Weekly, wholesale | Continuously, a row at a time |

Designs and the studio keep the file on purpose. Nobody wants to render five
thousand posters, and the sheet is what a campaign *is*.

Before the split, the assistant knew only the sixty products in the current
campaign and escalated on everything else. Correct, and useless.

---

## Why a database, and why not sooner

**Writes, not size.** A person editing one price must not rewrite twenty
megabytes, and two people editing must not silently lose one of each other's
changes. That is the whole argument. Everything else is secondary.

**The second reason is vectors surviving a restart.** Measured on this machine
with `bge-m3`, 1024 dimensions:

| Rows | Time to embed | Vectors on disk |
|---|---|---|
| 60 | 2.2 s | 240 KB |
| 1,000 | ~37 s | 4 MB |
| 5,000 | ~3 min | 20 MB |
| 20,000 | ~12 min | 78 MB |

Held in memory, that cost is paid again on every server restart. A column pays
it once. At sixty rows nobody notices; at five thousand it is a three-minute
dead start.

**What did NOT justify it.** "Four consumers need to query across products" was
the trigger `HANDOFF.md` originally named, and it turned out to be the weaker
argument — four consumers reading sixty rows from a file is fine. Neither did
any bug found in August 2026: the missing MacBooks were an unread column and the
invented "4 laptops" was a substring comparison. A database would have fixed
neither.

---

## Running it

```sh
npm run db:up        # pgvector/pgvector:pg17, 127.0.0.1:5432
npm run db:migrate   # once, and after any change to db/*.sql
npm run db:down      # stops it, KEEPS the data
```

`docker compose down -v` is the one that destroys the catalogue. The volume is
named `catalogue` precisely so the destructive form has to be typed on purpose.

**Ports.** 5432 by default, so a fresh clone needs no `.env`. On the machine
this was built on, 5432 is a Homebrew Postgres and 5433 is an unrelated
container, so `.env` sets `DB_PORT=5434`. `.env` is gitignored; a colleague gets
5432 and nothing to configure.

**Bound to `127.0.0.1`, never `0.0.0.0`.** The catalogue is competitive
information. That port must not be reachable from the office wifi, and
`lib/db.ts` refuses at module load if `DATABASE_URL` points off this machine —
the same shape as the loopback assert in `lib/ai/generate.ts`.

**Why Docker rather than Homebrew.** Three concrete things, none of them taste:

1. pgvector was not installed at all — `pg_available_extensions` had no row for
   `vector`, so the extension `architecture.md` calls for was simply absent.
2. A clone runs one command instead of installing a database, creating a role
   and applying a schema by hand.
3. `CLAUDE.md` warns *"Do not `brew upgrade postgresql` — pgvector has an open
   issue on Postgres 18."* A pinned tag cannot be dragged there by an unrelated
   upgrade of something else.

---

## pgvector: present, unused, and that is deliberate

The image ships **0.8.6**. Nothing turns it on.

Vectors are a `real[]` column and cosine runs in TypeScript, which is
microseconds at a few thousand rows and needs no index. `architecture.md`:
*"embed them, store as a `real[]` column, cosine in TypeScript. Microseconds, no
extension, no index. Add pgvector when the corpus is thousands of rows."*

Having it installed means switching later is `CREATE EXTENSION vector`, an
`ALTER TABLE` adding `vector(1024)`, and a backfill from the `real[]` column that
already holds the floats. The raw floats are kept rather than only an index for
exactly this reason — it is an afternoon, not a re-import.

**The signal to switch:** the catalogue is in the thousands *and* a question
takes long enough to notice. Not one without the other.

---

## Decisions that cannot be taken again

`architecture.md` calls these irrecoverable, because no migration recovers a
history that was never written. They are settled in `db/001_products.sql`,
before the first row existed.

| Decision | Why it cannot wait |
|---|---|
| `numeric(10,3)` for money | Kuwaiti fils is three decimals. Float, or two decimals, is a data migration *and* a wrong price on a poster in the meantime |
| `timestamptz` for every time | Kuwait is UTC+3 with no DST. `timestamp` loses the offset and there is no way back to what was meant |
| `sku` as primary key | Upsert by SKU. A re-imported sheet **updates** a product rather than creating a second one |
| A row the sheet omits is **left alone** | A supplier sending a partial price list must not empty the shop |
| `in_stock` a real column | Not a spare sheet column. The assistant may speak this and may not speak those — D48 |
| `sheet_values jsonb` | What the last sheet supplied, so a hand edit is visible and reversible. Prices stored as **text** — see below |
| `category_path` stored | The sheet's own tree. The only thing separating a laptop from a laptop sleeve, and how "do you sell laptops" finds a MacBook whose name never says laptop |

### Deliberately absent, and not oversights

- **No `score`, `rating` or `grade`** — here or on any future advisor table.
  Rule 4: you cannot hallucinate into a field that does not exist. `leads.score`
  would be fine, being an internal sales metric rather than a claim about
  creative quality. A test greps for these words; keep it passing.
- **No `product_versions` table.** Product history is snapshotted at the
  consumer through provenance columns. Two answers to "what did this cost in
  June" is worse than one.
- **No column called `price`.** Templates and copy bind `price_now` or
  `price_was`. A single `price` is the pre-discount figure a customer will not
  be charged.

---

## Who wins, the sheet or a person

**Last write wins, by time.** A hand fix beats the sheet that came before it; a
newer sheet beats the fix that came before *it*. That is what somebody expects
from the most recent thing they did, and it needs no rule to remember.

What it does need is to be **visible**. `sheet_values` holds what the last sheet
supplied, so:

- a field a person changed carries a mark, and the hover says what the sheet said
- the import reports *"this sheet replaced 4 fields you had edited"*, listing them
- the **edited by hand** filter shows everything that disagrees with your supplier

### One representation of a price, everywhere

A re-import once claimed to have overwritten **119** corrections nobody had
made. Postgres was consistent throughout — the column, `sheet_values` and
`to_jsonb` all say `5.500`. The break was in what reaches JavaScript:

```
to_jsonb(products)->'price_now'   JSON number  5.500  ->  JS gets 5.5
sheet_values->'price_now'         JSON string "5.500" ->  JS gets "5.500"
```

One price, two representations, so every untouched row compared unequal to
itself. The first fix was a comparison that tolerated both — which works, and
leaves the second representation alive to cause the next bug.

The real fix is **one representation**. Prices are canonical three-decimal text
on every path that stores or compares them: `canonicalPrice()` on the way in,
`price_now::text` on the way out, never `to_jsonb(products)`. `sameValue()` is
exact string equality because it can be, and a test asserts the three paths
agree — including one that asserts `to_jsonb` still returns a number, so nobody
reintroduces it by accident.

Display is separate and always was: `formatKwd` adds the `KD`. A stored value
carrying a currency word is a value that cannot be compared to a number.

**Deleting is real.** A later sheet carrying the same SKU brings the product
back, and the import says so — suppliers keep discontinued items in their files
for months, and knowing that is more useful than a tool that silently
re-deletes. What the product already made is kept: posters exported, copy
approved, conversations that cited it.

---

## Embedding

Rows arrive with no vector. `embedPending()` works through them in batches of
32, driven from the Products tab rather than from inside the import request — a
few thousand rows is minutes of model time and a browser gives up long before
that. Each call reports what is left, so a dropped request leaves the finished
rows finished.

**When a vector is dropped and re-queued:**

| Change | Vector |
|---|---|
| Price edited | **Kept.** A price is never in the embedded text, and re-embedding the catalogue every time somebody runs a sale is minutes for no change |
| Stock toggled | **Kept**, same reason |
| Name or display name edited | **Dropped.** The row means something different now, and a stale vector answers questions about a product that no longer exists |
| Sheet re-imported | **Dropped**, same reason |

`embedded_text` records what was actually embedded, so a stale vector is
detectable rather than merely suspected.

---

## When Postgres is not there

`retrieve()` falls back to the campaign sheet, and the Products tab says so
plainly. Nothing that worked before the database stops working without it. That
is why the catalogue is additive rather than a migration of the file store.

---

## Designs that have gone out of date

A rendered poster is pixels. Prices move weekly, so a folder of two hundred
designs rots quietly and the first person to notice is a customer reading last
month's figure off an ad. `architecture.md` calls this **the sharpest gap in the
system**. The Products tab is what turned it from theoretical into live.

`assets` records one row per product per template — the latest export is the one
that is out there. `bound_values` holds **what the renderer actually painted**,
slot by slot, not the row it painted from: comparing anything else means
formatting a second time, and a quantity derived twice is the bug this project
has shipped four times.

**Staleness is a re-render, not a price comparison.** `drifted()` runs the
export's own code path in memory and stops one step short of writing a file. A
design can go stale because a price moved, but equally because somebody fixed a
name, shortened it for the poster, or took a product off sale — anything a slot
binds. A price-only check reports clean on a poster carrying the wrong name.
Verified: changing one price surfaced both the price **and** the discount badge,
which `-51%` to `-64%` would have hidden.

**The rule that makes any of it coherent:** the sheet says WHICH products are in
the campaign, the catalogue says WHAT THEY COST. Before it, the sheet held
`19.9` and the catalogue `19.900` for the same product, designs rendered from
the sheet, and editing a price changed nothing on a poster — so "12 designs are
out of date" would have been describing a price the design never read.
`campaignProducts()` overlays the editable fields and nothing else. A product
the catalogue has not heard of keeps the sheet's price, so a campaign still runs
before the full catalogue is uploaded.

Re-exporting clears the warning, because the export rewrites the row. Verified
both directions.

---

## Traps

- **A node script does not load `.env`; Next does.** The catalogue test suite
  connected to the wrong server, failed to authenticate, and **skipped** —
  seventeen assertions quietly stopped running while `npm test`'s total still
  looked healthy. `scripts/test-catalogue.mjs` calls `process.loadEnvFile` for
  this reason. A suite that skips silently is worse than one that fails.
- **`docker compose down -v` destroys the catalogue.** `down` alone does not.
- **Prices come back from `numeric` as strings**, not numbers. Everything
  downstream does `Number()` on them and `formatKwd` is the only thing that
  prints one. A string that looks like a number is how `19.9` becomes `19.9`
  instead of `19.900`.
- **The old Homebrew database still exists** on 5432 with a stale copy of the 60
  products. Nothing reads it. It is a fallback until somebody drops it, and a
  trap if somebody points `DATABASE_URL` back at it and wonders why an edit
  disappeared.

---

## Not in the database yet

Everything except `products`, `assets` and `campaigns`. The chat store is still
files under `data/state/chat/`, and the campaign sheet, templates, short names and
content drafts are all still files.

**When each of those moves, its first migration must already carry these** —
from `architecture.md`, and each is irrecoverable for the same reason:

| Table | Must have from row one |
|---|---|
| `messages` | `provenance jsonb` — `{retrieved_ids, cited_ids, model, prompt_version}`; `sender ∈ customer\|bot\|rep`; `channel`; `external_id` |
| `content_pieces` | `status`, `source`, `model`, `prompt_version`, `campaign_id` |
| `leads` | `campaign_id` |
| `templates` | `manifest_version` |
| `post_performance` | `n` |

The shapes already exist in TypeScript — `lib/chat/store.ts` writes exactly the
`messages` columns above — so moving them is a translation rather than a design.

`assets` is **done** — `db/002_assets.sql`. See below.

`campaigns` is **done** — `db/004_campaigns.sql`, and it is four columns with a
suite assertion that fails on a fifth (D68). It carries no foreign key on
purpose: `content_pieces` and `conversations` are still files, so a constraint
would guarantee referential integrity for one of the three consumers of
`campaign_id` and none of the others, which reads as a guarantee the system does
not have. The FK lands when those tables do, on all three at once.
