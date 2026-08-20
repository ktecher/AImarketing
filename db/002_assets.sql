-- Migration two: what was exported, and what was baked into it.
--
-- Once a design is rendered the price is pixels. Prices move weekly, so a
-- folder of two hundred posters silently rots and the first person to notice is
-- a customer reading last month's figure off an ad.
--
-- architecture.md calls `assets.bound_values` **the sharpest gap in the
-- system**: "mark affected assets stale, show '12 assets are out of date',
-- offer re-render. Without it the flagship output rots silently, and the first
-- real failure is an ad carrying last month's price. That is the kind of
-- failure that gets a system switched off permanently."
--
-- It was theoretical until the Products tab made prices editable. Now it is not.

create table if not exists assets (
  sku           text        not null,
  template_id   text        not null,

  -- What the renderer ACTUALLY painted, slot by slot: `{"price": "19.900 KD",
  -- "name_en": "Apple Pencil", ...}`. Not the row it was rendered from — the
  -- resolved strings. A poster is stale when these stop matching what the same
  -- product resolves to now, and comparing anything else means re-deriving the
  -- formatting a second time and eventually getting it wrong.
  bound_values  jsonb       not null,

  formats       text[]      not null default '{}',
  width         integer,

  -- The loop, threaded from the start. architecture.md: bolted on later it is
  -- backfilled numbers.
  campaign_id   text,

  exported_at   timestamptz not null default now(),
  exported_by   text,

  -- One row per product per template: the latest export is the one that is out
  -- there. Keeping every export would answer a question nobody asks ("what did
  -- we send in June") while burying the one they do ("is what we have now
  -- wrong"). Re-exporting updates the row.
  primary key (sku, template_id)
);

create index if not exists assets_template_idx on assets (template_id);
create index if not exists assets_exported_at_idx on assets (exported_at desc);
