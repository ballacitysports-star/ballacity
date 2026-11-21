-- ROLLBACK for supabase/migrations/20261128110000_age_cohort_at_18.sql (age the stored cohort at 18;
-- docs/age-cohort-at-18.md).
-- NOT a migration. It unschedules the daily sweep, drops the audit trigger and the three functions the migration added.
-- The migration changed no existing function, policy or trigger, so there is nothing to put back.
--
-- WHAT IT CANNOT UNDO. Everything a sweep already did stays:
--   * a cohort moved to 'adult' (profiles.age_cohort and age_category), and the age_change_events row ('aged_to_adult');
--   * the privacy rows it added, and 'shared' on allow_messages for stale 13-15 accounts that had 'everyone';
--   * the reels it put back to drafts and the availability posts it paused, and the notice it sent each person.
-- private_sec.age_cohort_flips lists exactly which people, which reels and which posts (ids only, no names), and THIS
-- ROLLBACK KEEPS THAT TABLE for that reason. Putting a cohort back is an owner decision, never automatic: these people are
-- known adults, and a stale lower cohort only errs stricter on them. If the owner wants it anyway, run deliberately and
-- separately (each statement is the inverse of one step; none of them re-publishes anything by itself):
--     SET LOCAL openrun.age_sync = 'on';
--     UPDATE public.profiles p SET age_cohort = f.from_cohort, age_category = COALESCE(f.from_category, p.age_category)
--       FROM private_sec.age_cohort_flips f
--      WHERE f.user_id = p.id AND f.reverted_at IS NULL AND p.age_cohort = 'adult';
-- (the trigger that re-applies the minor floor to the stored privacy row then runs for each person). Reels and posts are
-- the owner's to re-open by hand from drafted_reel_ids / paused_availability_ids once the person has chosen. Drop the table
-- (DROP TABLE private_sec.age_cohort_flips) once nobody needs the list.
-- Notices already sent stay where they are. Without the daily sweep a person who turns 18 keeps the cohort they were saved
-- with (the behaviour before the migration): nothing else changes.
-- It stops, changing nothing, if any of the three functions no longer has the definition the migration gave it (a later
-- migration changed it): a person needs to look first.
-- It refuses to run unless the session sets the confirmation first:
--     SET app.confirm_age_cohort_at_18_rollback = 'yes';
--     (or PGOPTIONS="-c app.confirm_age_cohort_at_18_rollback=yes")
BEGIN;
DO $guard$
DECLARE
  _want jsonb := '{
    "private_sec.cohort_due_to_age(uuid)": "795eef00c350b78de87a51586f5b8983",
    "private_sec.age_adult_cohorts(integer)": "b5a9efd5635a753c39e366056781681e",
    "private_sec.close_age_cohort_flip()": "8fbceec6833409307a6c1b196b19d213"
  }'::jsonb;
  _k text;
  _got text;
  _flips bigint;
BEGIN
  IF current_setting('app.confirm_age_cohort_at_18_rollback', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'Refusing to run: this stops the daily job that ages stored cohorts at 18 and does NOT put back any cohort, reel, availability post or privacy row it already changed (private_sec.age_cohort_flips lists them). Set app.confirm_age_cohort_at_18_rollback = ''yes'' once you have read the header.';
  END IF;
  FOR _k IN SELECT jsonb_object_keys(_want) LOOP
    SELECT md5(pg_get_functiondef(p.oid)) INTO _got FROM pg_proc p WHERE p.oid = to_regprocedure(_k);
    IF _got IS DISTINCT FROM _want ->> _k THEN
      RAISE EXCEPTION 'Refusing to run: % is not the definition 20261128110000 created (md5 %, expected %). A later change needs a person to look first.', _k, _got, _want ->> _k;
    END IF;
  END LOOP;
  SELECT count(*) INTO _flips FROM private_sec.age_cohort_flips WHERE reverted_at IS NULL;
  RAISE NOTICE 'age_cohort_flips: % open rows are kept (counts only: no ids are printed)', _flips;
END
$guard$;

SET LOCAL lock_timeout = '5s';

-- The daily sweep, when pg_cron is there.
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('age-adult-cohorts');
  END IF;
EXCEPTION WHEN others THEN
  RAISE NOTICE 'age-adult-cohorts not unscheduled (it may not exist): %', SQLERRM;
END
$cron$;

-- The audit trigger and its function.
DROP TRIGGER IF EXISTS trg_close_age_cohort_flip ON public.profiles;
DROP FUNCTION private_sec.close_age_cohort_flip();

-- What the migration added (the table private_sec.age_cohort_flips stays: see the header).
DROP FUNCTION private_sec.age_adult_cohorts(integer);
DROP FUNCTION private_sec.cohort_due_to_age(uuid);

COMMIT;
