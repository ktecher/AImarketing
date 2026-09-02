-- Migration five: publishing, and what came back.
--
-- The first four pillars all stop at a file on disk — a rendered poster, an
-- approved caption. A person then opens Meta's app and types it in again, which
-- is both the boring part of the job and the place the loop breaks: nothing in
-- here knows a design was ever published, so `campaigns.report()` can say twelve
-- designs were exported and nothing at all about which ones went out.
--
-- Two tables close that. An account is a Page or an IG business account somebody
-- connected once; a post is one publish attempt and its outcome.
--
-- **The token is encrypted at rest, not stored raw.** A long-lived Page token is
-- a standing grant to post as the shop — it outlives the laptop it was issued
-- on, and a `pg_dump` in a backup folder is a plain-text copy of it. The column
-- is named `token_cipher` rather than `token` so that a query written in a hurry
-- cannot look like it returned something usable. The key lives in
-- APP_ENCRYPTION_KEY and never in this database; see lib/social/tokens.ts.
--
-- **Three statuses and no fourth.** `publishing` is written before the request
-- leaves, so a crash mid-publish leaves evidence rather than silence, and the
-- row is then moved to `posted` or `failed`. There is no `scheduled` and no
-- `scheduled_at`: nothing runs when the laptop is shut, so a scheduled post is a
-- promise this system cannot keep until it is hosted. That is a later phase and
-- it arrives with a runner, not with a column.
--
-- **No media_assets table.** What was uploaded is two text arrays on the post
-- that used them. `image_public_ids` exists only so the media can be deleted
-- later — the ids are the host's, not ours, and they are useless apart from the
-- post they belong to. A table would be a second place to ask which post owns
-- which image, and CLAUDE.md is explicit about what a second answer costs.
--
-- **campaign_id from row one**, per architecture.md: bolted on later it is
-- backfilled numbers. Unlike `assets` it carries a real foreign key, because
-- unlike the studio and the inbox both sides of this one are already in
-- Postgres. `on delete set null` matches what `campaigns.remove()` does by hand
-- everywhere else — deleting a label must not delete the work done under it.

create table if not exists social_accounts (
  -- 'facebook:<page_id>' or 'instagram:<ig_user_id>'. Derived rather than
  -- generated, so reconnecting the same Page updates the row it already has
  -- instead of leaving two accounts that post to the same place.
  id           text        primary key,
  platform     text        not null check (platform in ('facebook','instagram')),
  external_id  text        not null,
  name         text        not null,

  -- AES-256-GCM, base64, IV and auth tag carried with it. Never selected by any
  -- listing query — only `tokenFor()` reads this column.
  token_cipher text        not null,

  connected_at timestamptz not null default now()
);

comment on column social_accounts.token_cipher is
  'AES-256-GCM ciphertext of the long-lived access token, base64, with the IV and
   auth tag prefixed. The key is APP_ENCRYPTION_KEY and is not in this database.
   Do not select this column into anything a person or a log can see.';

create table if not exists social_posts (
  id               text        primary key,
  campaign_id      text        references campaigns(id) on delete set null,

  -- Which product this was about, when it was about one. Not a foreign key to
  -- `products`: a post that went out is a fact about the past, and a SKU leaving
  -- the catalogue must not take the history of promoting it with it.
  sku              text,

  -- Cascades: a disconnected account cannot be re-read for permalinks or
  -- deletions, and rows pointing at a token that no longer exists are a history
  -- nothing can act on.
  account_id       text        not null references social_accounts(id) on delete cascade,

  caption          text        not null,
  image_urls       text[]      not null default '{}',
  image_public_ids text[]      not null default '{}',

  status           text        not null check (status in ('publishing','posted','failed')),
  platform_post_id text,
  permalink_url    text,
  error            text,
  posted_at        timestamptz,
  created_at       timestamptz not null default now()
);

comment on table social_posts is
  'One publish attempt, and how it ended. Written as `publishing` before the
   request leaves so a crash leaves evidence, then moved to `posted` or `failed`.
   No scheduling: nothing here runs while the laptop is shut.';

-- The two questions asked of this table: the campaign report joins by campaign,
-- and the history screen reads newest first.
create index if not exists social_posts_campaign_idx on social_posts (campaign_id);
create index if not exists social_posts_created_at_idx on social_posts (created_at desc);
