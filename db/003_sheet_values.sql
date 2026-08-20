-- Migration three: what the last sheet said, so a hand edit is visible.
--
-- The rule is **last write wins, by time**. A hand fix beats the sheet that came
-- before it; a newer sheet beats the fix that came before IT. Simple, and it
-- matches what a person expects from the most recent thing they did.
--
-- But "the sheet replaced your correction" has to be visible or somebody
-- re-fixes the same field three weeks running and never learns that their
-- supplier's file is the problem. That needs one thing: what the sheet supplied,
-- kept beside what is current.
--
--   edited            current value differs from sheet_values[field]
--   the hover         "you set 17.250 — the sheet says 19.900"
--   use sheet value   copy it back from here
--   after an import   which edited fields this sheet overwrote
--
-- One jsonb column answers all four. A per-field timestamp column would answer
-- them too and cost six columns and a migration every time a field is added.

alter table products
  add column if not exists sheet_values jsonb not null default '{}'::jsonb;

comment on column products.sheet_values is
  'What the last imported sheet supplied, field by field. Not history — only the
   most recent sheet. Comparing it to the live row is what makes a hand edit
   visible and reversible.';
