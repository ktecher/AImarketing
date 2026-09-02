-- One post can be about several products (D88).
--
-- Instagram carousels carry up to ten images under ONE caption, and a carousel
-- promoting five products promoted five products. `social_posts.sku` held one,
-- so it stopped being able to say what happened.
--
-- The column is REPLACED rather than joined by a second one. Keeping `sku` for
-- single posts and `skus` for carousels means every reader forever needs
-- `coalesce(nullif(skus,'{}'), array[sku])`, and the first one to forget gets a
-- number that is wrong rather than absent — which is the failure CLAUDE.md rule
-- 4 exists to prevent, and the same argument 005 already makes against a second
-- place to ask which post owns which image.
--
-- A single-image post is a one-element array. There is no second shape.
--
-- Migrations here re-run from the top every time, so this is idempotent: it
-- looks for the old column rather than assuming which side of the change it is
-- on, and the backfill only touches rows nothing has filled in yet.

do $$
begin
  alter table social_posts add column if not exists skus text[] not null default '{}';

  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'social_posts' and column_name = 'sku'
  ) then
    -- Order matters: copy before dropping, and only into rows that are still
    -- empty, so re-running after a partial failure cannot blank a good value.
    update social_posts
       set skus = case when sku is null then '{}'::text[] else array[sku] end
     where skus = '{}';
    alter table social_posts drop column sku;
  end if;
end $$;

comment on column social_posts.skus is
  'Every product this post was about, in the order their images appear. Empty for
   a post about nothing in particular. Not foreign keys to `products`: a post
   that went out is a fact about the past, and a SKU leaving the catalogue must
   not take the history of promoting it with it.';

-- No GIN index on `skus`. The two questions asked of this table are still by
-- campaign and by recency, both already indexed, and a per-SKU lookup scans a
-- table with a few hundred rows in it. Add `using gin (skus)` when that stops
-- being true, not before.
