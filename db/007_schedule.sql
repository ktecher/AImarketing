-- Posting later, and admitting when later never came (D89).
--
-- This widens D83, which said publishing is "never automatic, not on a timer".
-- It now can be — but only for a post a person built, read and set a time on,
-- and never for one nobody chose. The opt-in moved from the moment of sending to
-- the moment of scheduling; it did not disappear.
--
-- ── two new statuses, and the second one is the point ──
--
-- `scheduled`  the images are already rendered and uploaded, the caption is
--              fixed, and one Instagram call is all that is left. Nothing about
--              it is decided later.
--
-- `missed`     its time passed while nothing was running to send it.
--
-- `missed` exists because this runs on a laptop that sleeps, and it is the whole
-- reason scheduling is safe to add here at all. Without it a post whose moment
-- passed either sits saying `scheduled` forever — a screen reporting a future
-- that will not happen — or fires whenever the machine next wakes, which puts a
-- "tonight only" offer in front of customers the following morning. Both are the
-- shape of failure this project keeps refusing: a confident statement that is
-- not true. So the sweep publishes inside a grace window and gives up outside
-- it, visibly, and a person decides whether it still makes sense to send.
--
-- Idempotent: migrations here re-run from the top every time.

alter table social_posts add column if not exists scheduled_at timestamptz;

do $$
begin
  -- Constraints cannot be replaced in place, and the name is the only handle.
  alter table social_posts drop constraint if exists social_posts_status_check;
  alter table social_posts add constraint social_posts_status_check
    check (status in ('scheduled','publishing','posted','failed','missed'));
end $$;

comment on column social_posts.scheduled_at is
  'When this should go out. Null for a post sent by hand. Set together with
   status = ''scheduled'', and read only by the sweep — nothing else in the app
   waits on a clock.';

-- The sweep asks one question every minute: what is due and not yet sent. Cheap
-- already at this size, but it runs on a timer rather than on a person, so it is
-- the one query here that should never become a seq scan nobody is watching.
create index if not exists social_posts_due_idx
  on social_posts (scheduled_at)
  where status = 'scheduled';
