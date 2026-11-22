-- WP 5.3 (Phase 5, docs/product/phase-5-validation-plan.md): keep the funnel's history, so hard deletes and leaves do not
-- rewrite past weeks. Must be live before pilot day 1.
--
-- WHY. Authors hard-delete availability posts, leaving deletes the roster row, cancelling a request deletes it, and deleting a
-- game deletes its invites (ON DELETE CASCADE). superadmin_funnel (20261127100000) counts the rows that exist now, so every one
-- of those lowers a past week's numbers. A nightly snapshot keeps the totals.
--
-- WHAT.
-- 1. private_sec.funnel_daily(day date, metrics jsonb, computed_at timestamptz): one row per America/New_York day, the raw adult
--    counts of private_sec.funnel_day_metrics for that day. No user id, game id, invite id or any other identifier: a CHECK
--    allows only an object of whole, non-negative numbers under short lower-case keys. Raw, not masked: masking 1-4 per day would
--    make weekly totals impossible to add up; nothing leaves the database unmasked because superadmin_funnel masks every weekly
--    total it returns. Adults only: the under-18 column is never stored. private_sec is not exposed through the API; RLS is on
--    with no policies and no API role has any privilege (the app_error_events model, one schema further in).
-- 2. private_sec.snapshot_funnel_daily(_now): recomputes and upserts every day from the frozen line
--    (private_sec.funnel_frozen_before: the Monday of the week holding today - 21 days) to yesterday. Days before the line are
--    frozen: never rewritten. Weeks freeze whole: a frozen week the table holds only part of (the first run, or enough
--    missed nights that the line passed a week the job had begun) is recomputed and written whole, all seven days in one run,
--    from what exists then, and is frozen from then on. Filling only the missing days would count a person again on a later
--    day of the same week (posters are attributed to their first post day in the week). The first run covers 2026-11-16
--    onward (the week the invites went live). For the scheduler only.
-- 3. private_sec.schedule_funnel_snapshot(): schedules job 'snapshot-funnel-daily' at 08:47 UTC (03:47 or 04:47 in New York,
--    after the day has ended) where pg_cron is installed (cron.schedule exists), and does nothing with a notice otherwise.
-- 4. private_sec.funnel_forget_lowered_adult() and trigger funnel_forget_lowered_adult_trg on public.profiles (AFTER UPDATE OF
--    age_cohort, age_review_required, only when a confirmed adult stops being one). "Adult" is judged when a day is computed,
--    and a frozen day is never rewritten, so an account counted as an adult and later found to be a minor (a corrected
--    birthday lowers the cohort at once; so does an admin correction) would stay in the adults' numbers of every frozen week
--    for good: a minor's activity in a product metric without counsel's sign-off. The stored days hold no identifiers, so the
--    account cannot be taken out of them. Instead the trigger deletes every stored day from the Monday of the week the
--    account was created on (nothing it did can be older). Those weeks are then computed live, without the account, and the
--    next night writes them whole again. The cost: in those weeks the history no longer protects rows deleted since. Test
--    and staff accounts, never counted, delete nothing. The snapshot takes a SHARE ROW EXCLUSIVE lock on the table first, so
--    a lowering that commits while a snapshot runs waits for it and then deletes what it wrote.
-- 5. The first snapshot runs now, so the history starts with this migration rather than the first night.
--
-- superadmin_funnel already reads private_sec.funnel_daily when the table exists (20261127100000); it reads frozen weeks from
-- here when all seven days are present and computes every other week live and whole. Limits: a post deleted before the first
-- snapshot that saw it is still lost (on the day it was created, or before this migration); outcomes that happen after a day
-- froze (a game more than about three weeks after its invitation) are not counted in that day; "adult" is judged when the day
-- is computed, except that an adult found later to be a minor is taken out (4.). A later staff role or test address is not:
-- those accounts were pilot users when the day was counted.
--
-- Locks: CREATE TRIGGER takes SHARE ROW EXCLUSIVE on public.profiles (writers wait, readers do not) for milliseconds; the
-- wait for it is limited to 5 s.
--
-- Rollback: docs/rollbacks/20261127110000_funnel_daily_history.down.sql (refuses while rows exist unless they were exported).

SET lock_timeout = '5s';

-- 1. The table -----------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private_sec.funnel_metrics_are_counts(_m jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT jsonb_typeof(_m) = 'object'
     AND (SELECT count(*) FROM jsonb_object_keys(_m)) <= 40
     AND NOT EXISTS (SELECT 1 FROM jsonb_each(_m) e
                      WHERE e.key !~ '^[a-z][a-z0-9_]{0,40}$'
                         OR jsonb_typeof(e.value) <> 'number'
                         OR (e.value #>> '{}') !~ '^[0-9]{1,9}$')
$$;
REVOKE ALL ON FUNCTION private_sec.funnel_metrics_are_counts(jsonb) FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS private_sec.funnel_daily (
  day         date PRIMARY KEY,
  metrics     jsonb NOT NULL CONSTRAINT funnel_daily_counts_only CHECK (private_sec.funnel_metrics_are_counts(metrics)),
  computed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE private_sec.funnel_daily ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private_sec.funnel_daily FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON TABLE private_sec.funnel_daily IS
  'WP 5.3: the funnel''s adult daily totals (America/New_York days). Counts only, no identifiers. Written by snapshot_funnel_daily.';

-- 2. The snapshot --------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private_sec.snapshot_funnel_daily(_now timestamptz DEFAULT now())
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SET search_path = ''
AS $$
DECLARE
  _first         CONSTANT date := date '2026-11-16';   -- Monday of the week game_invites went live
  _yesterday     date := (_now AT TIME ZONE 'America/New_York')::date - 1;
  _frozen_before date := private_sec.funnel_frozen_before(_now);
  _incomplete    date[];   -- Mondays of frozen weeks with a day missing: recomputed whole
  _from          date;
  _written       integer := 0;
BEGIN
  -- Taken first: a profile lowered from adult while this runs waits for it, then deletes what it wrote (4.). Two runs queue.
  LOCK TABLE private_sec.funnel_daily IN SHARE ROW EXCLUSIVE MODE;
  SELECT COALESCE(array_agg(DISTINCT date_trunc('week', g.d)::date), '{}') INTO _incomplete
    FROM generate_series(_first::timestamp, (LEAST(_frozen_before, _yesterday + 1) - 1)::timestamp, interval '1 day') g(d)
   WHERE NOT EXISTS (SELECT 1 FROM private_sec.funnel_daily f WHERE f.day = g.d::date);
  _from := GREATEST(_first, LEAST(COALESCE((SELECT min(x) FROM unnest(_incomplete) x), _frozen_before), _frozen_before));
  IF _from > _yesterday THEN
    RETURN jsonb_build_object('written', 0, 'frozen_before', _frozen_before);
  END IF;

  WITH m AS (
         SELECT x.day, x.metrics FROM private_sec.funnel_day_metrics(_from, _yesterday, _now, true) x
       ),
       up AS (
         INSERT INTO private_sec.funnel_daily AS f (day, metrics, computed_at)
         SELECT m.day, m.metrics, now() FROM m
         ON CONFLICT (day) DO UPDATE SET metrics = EXCLUDED.metrics, computed_at = EXCLUDED.computed_at
          -- a day of a complete frozen week is never rewritten; an incomplete one is written whole, once
          WHERE f.day >= _frozen_before OR date_trunc('week', f.day::timestamp)::date = ANY (_incomplete)
         RETURNING f.day
       )
  SELECT count(*) INTO _written FROM up;

  RETURN jsonb_build_object('written', _written, 'from', _from, 'to', _yesterday, 'frozen_before', _frozen_before);
END $$;
REVOKE ALL ON FUNCTION private_sec.snapshot_funnel_daily(timestamptz) FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION private_sec.snapshot_funnel_daily(timestamptz) IS
  'WP 5.3: writes the funnel''s adult daily totals; days before funnel_frozen_before are frozen once written. Scheduler only.';

-- 3. The schedule --------------------------------------------------------------------------------------------------------------------
-- cron.schedule exists exactly when pg_cron is installed (the extension creates the cron schema). Called by name, so this
-- function also exists where it is not.
CREATE OR REPLACE FUNCTION private_sec.schedule_funnel_snapshot()
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SET search_path = ''
AS $$
BEGIN
  IF to_regprocedure('cron.schedule(text,text,text)') IS NULL THEN
    RAISE NOTICE 'pg_cron is not installed: snapshot-funnel-daily not scheduled';
    RETURN false;
  END IF;
  EXECUTE 'SELECT cron.schedule($1, $2, $3)'
    USING 'snapshot-funnel-daily', '47 8 * * *', 'SELECT private_sec.snapshot_funnel_daily()';
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION private_sec.schedule_funnel_snapshot() FROM PUBLIC, anon, authenticated, service_role;

DO $cron$
BEGIN
  PERFORM private_sec.schedule_funnel_snapshot();
EXCEPTION WHEN others THEN
  RAISE NOTICE 'snapshot-funnel-daily not scheduled: %', SQLERRM;
END
$cron$;

-- 4. An adult found later to be a minor leaves the history --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private_sec.funnel_forget_lowered_adult()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _created timestamptz;
BEGIN
  SELECT u.created_at INTO _created
    FROM auth.users u
   WHERE u.id = NEW.id
     AND lower(split_part(COALESCE(u.email, ''), '@', 2)) <> 'lovable.test'
     AND NOT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = u.id);
  IF NOT FOUND THEN
    RETURN NULL;   -- a test or staff account was never counted
  END IF;
  DELETE FROM private_sec.funnel_daily f
   WHERE f.day >= COALESCE(date_trunc('week', (_created AT TIME ZONE 'America/New_York')::date::timestamp)::date, '-infinity'::date);
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION private_sec.funnel_forget_lowered_adult() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS funnel_forget_lowered_adult_trg ON public.profiles;
CREATE TRIGGER funnel_forget_lowered_adult_trg
  AFTER UPDATE OF age_cohort, age_review_required ON public.profiles
  FOR EACH ROW
  WHEN (OLD.age_cohort = 'adult' AND NOT OLD.age_review_required AND NOT (NEW.age_cohort = 'adult' AND NOT NEW.age_review_required))
  EXECUTE FUNCTION private_sec.funnel_forget_lowered_adult();

RESET lock_timeout;

-- 5. The first snapshot --------------------------------------------------------------------------------------------------------------
SELECT private_sec.snapshot_funnel_daily();
