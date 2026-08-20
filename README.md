# AImarketing

One system connecting marketing and sales for a Kuwait retailer: fill brand
templates from an Excel product sheet, draft social copy from the same rows,
review drafts the team wrote, and answer customer product questions from the
catalog — with a campaign record tying the four together.

Everything runs on one machine. No catalog row, customer message, or
unpublished draft reaches an outside service.

## Read first

| File | What it covers |
|---|---|
| `CLAUDE.md` | The rules. Read before writing any code |
| `docs/vision.md` | What this is for and what it will never do |
| `docs/architecture.md` | How it works, and why each choice over the alternative |
| `docs/decisions.md` | Append-only decision log with reversal conditions |
| `docs/demo-script.md` | The ten-minute walkthrough |
| `PLAN.md` | The full planning document this was built from |

## Machine setup

Postgres 17.11 is already installed and running via Homebrew.

```sh
brew install ollama && brew services start ollama
ollama pull bge-m3
ollama pull gemma-4-12b
ollama pull hf.co/mradermacher/Fanar-1-9B-Instruct-GGUF

```

The full catalogue runs in Docker, pinned and bound to loopback:

```sh
npm run db:up        # pgvector/pgvector:pg17 on 127.0.0.1:5432
npm run db:migrate   # once, and after any change to db/*.sql
```

Set `DB_PORT` and `DATABASE_URL` in `.env` if 5432 is already taken.

pgvector ships in the image, unused for now: vectors are a `real[]` column and
cosine runs in TypeScript, which is microseconds at a few thousand rows. Turn it
on when the corpus reaches thousands — `CREATE EXTENSION vector`, an `ALTER`, and
a backfill from the column that already holds the floats.

The image tag is pinned, which is what keeps CLAUDE.md's warning about Postgres
18 from mattering.

Resident model budget is 12–15 GB, not 24. A dense 27B loads on a quiet machine
and does not survive a demo.

## The product sheet

Marketing does not need to guess at column names. Serve the app and hand them
`http://localhost:3000/api/template` — a blank sheet whose columns are the exact
ones the importer reads, with two example rows to delete and a second page
explaining each field, the SKU rule, and why prices carry three decimals.

`scripts/test-template.mjs` asserts the template still round-trips through the
parser, so the two cannot drift apart silently.

## Before writing code

Six things, none of them code, and two of them can delete work:

1. Get the real Excel, product images, and brand templates onto this machine.
2. Ask the brand-font licensor about **outlining**, not only embedding.
3. Collect 30–50 of the best past Arabic posts — the source of Kuwaiti voice.
4. **Export the last 100 posts' insights and check captions come out joined to
   reach.** If they do not, the advisor is not built in its planned form.
5. Check the sheet for an accessory or bundle column.
6. Measure the baseline: how long does producing 50 product posts take today?
   It stops being measurable once the manual process stops.

## Status

The template pillar works end to end: product sheet in, finished designs out, in
SVG, PNG, JPG and PDF. See **`HANDOFF.md`** for current state, open problems, and
what is still needed.
