# Domain docs

How the engineering skills should consume this repo's domain documentation.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root, if it exists
- **`docs/decisions.md`** — this project's decision log. Append-only, one entry
  per non-obvious decision, each carrying the condition that would reverse it.
  It is the authority on *why*; read the entries touching the area you are about
  to work in. There is no `docs/adr/` and there should not be a second log.
- **`HANDOFF.md`** — where things currently stand, as distinct from why.

If `CONTEXT.md` does not exist, **proceed silently**. Don't flag its absence and
don't suggest creating it upfront; `/domain-modeling` creates it lazily when
terms actually need resolving.

## Structure

Single-context repo:

```
/
├── CONTEXT.md          (does not exist yet — created lazily)
├── CLAUDE.md           the rules
├── HANDOFF.md          where things stand
├── docs/decisions.md   why, append-only
└── lib/  app/  scripts/
```

## Use the project's vocabulary

Name domain concepts as `CONTEXT.md` and `docs/decisions.md` define them. This
codebase is specific about a few: there is no field called `price` — it is
`price_now` or `price_was`; the advisor reports **checks**, never a score,
rating, or grade. Drifting to a synonym here is a real error, not a style note.

## Flag conflicts with a decision

If your output contradicts an entry in `docs/decisions.md`, say so explicitly
rather than silently overriding it — and check the entry's reversal condition
first, because each one names what would make reopening it correct.

> _Contradicts D43 (copy carries placeholders, never figures), but its reversal
> condition may now hold because…_
