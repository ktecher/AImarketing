-- Migration four: the loop, which is four columns.
--
-- `campaign_id` has been threaded through `assets`, `content_pieces` and
-- `conversations` since each was written, per architecture.md — "bolted on later
-- it is backfilled numbers". Every one of them has been null, because there was
-- nothing to point at. This is that thing.
--
-- CLAUDE.md: **campaigns are four columns, guard this against your future self.**
-- What it grows into is scheduling, budgets, statuses and approval workflows,
-- and that is a CRM. So, in order, and nothing else:
--
--   id          stamped on a poster, a caption, a conversation and a lead
--   name        what marketing calls it out loud
--   context     architecture.md's "this week's context" — the free-text box
--               where marketing pastes what they already know is trending,
--               because nothing offline can know it and a model asked will
--               confidently invent a dead sound
--   created_at  which campaign is the current one
--
-- **No membership table.** Which products a campaign promoted is not typed in
-- twice — it is the products whose designs and copy were stamped with it. A
-- campaign_products join would be a second answer to the same question, and the
-- two would disagree the first time somebody exported a design and forgot.
--
-- **No status, no dates, no owner.** The current campaign is the newest one.
-- That is a rule rather than a column, and it holds until campaigns get planned
-- weeks ahead — at which point a dated window replaces it, and the reversal
-- condition is exactly that.
--
-- **No foreign key**, deliberately. `content_pieces` and `conversations` are
-- still files (docs/db.md), so a constraint here would guarantee referential
-- integrity for one of the three consumers and none of the others — which reads
-- as a guarantee the system does not have. When those tables land, the FK lands
-- with them, on all three at once.

create table if not exists campaigns (
  id         text        primary key,
  name       text        not null,
  context    text        not null default '',
  created_at timestamptz not null default now()
);

comment on table campaigns is
  'Four columns. The loop between marketing and sales: an id stamped on a design,
   a caption and a conversation, so afterwards you can ask "we promoted these
   twelve products — what did customers ask about, and what could the bot not
   answer?" Adding a fifth column is the beginning of a CRM. See CLAUDE.md.';

comment on column campaigns.context is
  'What marketing knows and the machine cannot: this week''s trending sound, the
   offer, the reason. Read by the content studio as context, never as fact.';

create index if not exists assets_campaign_idx on assets (campaign_id);
