-- When an attempt to publish actually began, so a crash cannot strand a row.
--
-- `startPost` writes `publishing` before the request leaves, and `claim` writes
-- it again. That is right: the status is the evidence that an attempt started,
-- and it is what stops two sweeps sending the same post twice.
--
-- But nothing could reach a row that stayed there. `claim` and `upcoming` match
-- scheduled and missed; `unschedule` matches those two and failed. So if the
-- process died between writing `publishing` and writing the result — a dev
-- server reloading mid-publish, a closed laptop, Ctrl-C — the row could not be
-- retried, listed, or dropped, and the images it had already uploaded stayed on
-- a paid host with only that unreachable row able to name them.
--
-- ── why a column and not a clock arithmetic on created_at ──
--
-- The obvious fix is "anything that has been `publishing` for ten minutes is
-- abandoned", and the obvious column to measure that with is `created_at`. It
-- is wrong, and dangerously so: a post scheduled for next Friday is created
-- today, so `created_at` is already days old when the sweep legitimately claims
-- it. Measuring from there marks a publish that started four seconds ago as
-- abandoned — and the recovery would then run against a post that is still in
-- flight, which is how the same thing gets posted twice as the shop.
--
-- So the moment the attempt began is recorded, and nothing infers it.
--
-- Null except while publishing, and left in place afterwards: a row that failed
-- keeps the time its attempt started, which is the one thing a person reading
-- the error wants to know.
--
-- Idempotent: migrations here re-run from the top every time.

alter table social_posts add column if not exists publishing_at timestamptz;

comment on column social_posts.publishing_at is
  'When an attempt to publish this row began — set together with
   status = ''publishing''. Read only by the sweep, to retire rows abandoned by a
   crash. Never inferred from created_at: a scheduled post is created long
   before its attempt starts, and measuring from there would retire a publish
   that is still running.';

-- The sweep asks for abandoned rows every minute, unattended. Partial, because
-- `publishing` is a handful of rows at most and the index should not carry the
-- whole history.
create index if not exists social_posts_publishing_idx
  on social_posts (publishing_at)
  where status = 'publishing';
