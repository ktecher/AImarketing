-- Migration one: the full catalogue.
--
-- This is what the shop SELLS, which is a different thing from the handful of
-- products a campaign is about. Designs and the content studio keep working
-- from the campaign sheet — nobody wants to render five thousand posters. The
-- assistant and the advisor read this, because a customer or a caption can be
-- about anything in stock.
--
-- The decisions below are the ones architecture.md calls irrecoverable: no
-- migration recovers a history that was never written. They are settled here,
-- before the first row exists.
--
--   numeric(10,3)   Kuwaiti fils is three decimals. Storing money as float, or
--                   at two decimals, is a data migration and a wrong price on a
--                   poster in the meantime.
--   timestamptz     Kuwait is UTC+3 with no DST. `timestamp` loses that and
--                   there is no way back to what was meant.
--   sku primary key Upsert by SKU. A re-imported sheet UPDATES a product, it
--                   does not create a second one, and it must not silently
--                   delete a row a later sheet happens to omit.
--
-- Deliberately absent, and not oversights:
--
--   No `score`, `rating` or `grade`, here or on any advisor table. Rule 4: you
--   cannot hallucinate into a field that does not exist.
--   No product_versions table. Product history is snapshotted at the consumer
--   through provenance columns — decided, and re-deciding it here would give
--   two answers to "what did this cost in June".
--   No `price` column. Templates and copy bind price_now or price_was; a single
--   `price` is the pre-discount figure a customer will not be charged.

create table if not exists products (
  sku             text primary key,

  name_en         text,
  name_ar         text,
  -- A catalogue title is not a headline. Falls back to name_en at read time.
  display_name    text,
  brand           text,
  category        text,
  -- The sheet's own tree: "Computers & Tablets > Laptops > Apple MacBook".
  -- The only thing that separates a laptop from a laptop sleeve, and the reason
  -- "do you sell laptops" can find a MacBook whose name never says laptop.
  category_path   text,
  description_en  text,
  description_ar  text,

  price_now       numeric(10,3),
  price_was       numeric(10,3),

  -- First class, not a spare column. The assistant may say "out of stock";
  -- it may not read the sheet's other spare columns, which are hazards (D48).
  in_stock        boolean     not null default true,

  -- Everything else the sheet carried, kept but never spoken.
  extra           jsonb       not null default '{}'::jsonb,

  -- bge-m3, 1024 dimensions. A real[] rather than a pgvector column: at a few
  -- thousand rows cosine in TypeScript is microseconds and an index buys
  -- nothing. Adding `vector(1024)` later is an ALTER and a backfill from this
  -- column — no destructive migration, which is why the raw floats are kept
  -- rather than only an index.
  embedding       real[],
  embedded_at     timestamptz,
  -- What was embedded. If the row's text changes the vector is stale, and a
  -- stale vector answers questions about a product that no longer exists.
  embedded_text   text,

  source          text        not null default 'sheet',
  updated_at      timestamptz not null default now(),
  -- Who last touched it, so an edited price is attributable. A person editing
  -- a price in the app is not the same event as a sheet re-import.
  updated_by      text
);

-- Substring search over names and the category tree. The chat's lexical pass
-- runs in TypeScript today; this is what it becomes when the row count makes
-- that stop being free.
create index if not exists products_category_path_idx on products (category_path);
create index if not exists products_brand_idx on products (brand);
create index if not exists products_in_stock_idx on products (in_stock);

-- Rows whose vector no longer matches their text, which is the work queue for
-- re-embedding after an edit.
create index if not exists products_needs_embedding_idx on products (embedded_at)
  where embedding is null;
