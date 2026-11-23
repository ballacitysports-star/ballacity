-- ROLLBACK for supabase/migrations/20261128110000_age_cohort_at_18.sql (age the stored cohort at 18;
-- docs/age-cohort-at-18.md).
-- NOT a migration. It unschedules the daily sweep, drops the audit trigger, the hold trigger and the functions the migration
-- added, and puts back the two functions and the two read policies the migration replaced (profile_ages,
-- roster_row_visible, and the select policies on post_comments and post_reactions) exactly as they were.
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
--
-- WHAT IT OPENS. The migration held three things for every person it had aged: what other people wrote on their content
-- before the flip, their age, and their roster row. Putting the old readers back ENDS EVERY HOLD: the old comments and
-- reactions on a flipped person's games, posts and reels become readable by everyone (as an adult's are), their age follows
-- their profile visibility, and their roster row is visible to every viewer. Because that widens what is visible about
-- people who were promised otherwise, the rollback asks for a SECOND confirmation whenever an audit row exists (a person was
-- aged, and still is): read the counts it prints, then
--     SET app.confirm_age_cohort_at_18_rollback_opens_holds = 'yes';
-- To keep the holds and stop only the daily job, unschedule it by hand (SELECT cron.unschedule('age-adult-cohorts');) and
-- leave this file alone.
-- It stops, changing nothing, if any function or policy the migration created or replaced no longer has the definition the
-- migration gave it (a later migration changed it): a person needs to look first.
-- It refuses to run unless the session sets the confirmation first:
--     SET app.confirm_age_cohort_at_18_rollback = 'yes';
--     (or PGOPTIONS="-c app.confirm_age_cohort_at_18_rollback=yes")
BEGIN;
DO $guard$
DECLARE
  _want jsonb := '{
    "private_sec.cohort_due_to_age(uuid)": "795eef00c350b78de87a51586f5b8983",
    "private_sec.age_adult_cohorts(integer)": "34d8d283af5cc010bd6c56342aa103c3",
    "private_sec.close_age_cohort_flip()": "8fbceec6833409307a6c1b196b19d213",
    "private_sec.age_hold_cohort(uuid)": "1dd21f0c6055465d8d9fc587f436d00d",
    "private_sec.release_age_hold()": "81bb05650b2347fdab38cd1abdfb95d3",
    "private_sec.can_read_engagement(uuid, uuid, timestamp with time zone)": "ca79e073746e5dd006bd5478ea84bd8c",
    "public.profile_ages(uuid[])": "5c3c4b72adcef5e536946b02b1db839f",
    "private_sec.roster_row_visible(text, uuid)": "02a37e3f5c28207ad45ef068771cc227"
  }'::jsonb;
  _k text;
  _got text;
  _flips bigint;
  _held bigint;
  _pol text;
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
  FOR _pol IN SELECT tablename || '.' || policyname FROM pg_policies
               WHERE (tablename, policyname) IN (('post_comments', 'Comments are readable by permitted viewers'),
                                                 ('post_reactions', 'Reactions are readable by permitted viewers'))
                 AND md5(qual) IS DISTINCT FROM 'bb24470df624631b96378c1c1fed1fad' LOOP
    RAISE EXCEPTION 'Refusing to run: the policy % is not the one 20261128110000 created. A later change needs a person to look first.', _pol;
  END LOOP;
  IF (SELECT count(*) FROM pg_policies WHERE (tablename, policyname) IN (('post_comments', 'Comments are readable by permitted viewers'),
                                                 ('post_reactions', 'Reactions are readable by permitted viewers'))) <> 2 THEN
    RAISE EXCEPTION 'Refusing to run: one of the two comment/reaction read policies is missing. A person needs to look first.';
  END IF;
  SELECT count(*) INTO _flips FROM private_sec.age_cohort_flips WHERE reverted_at IS NULL;
  SELECT count(*) INTO _held FROM private_sec.age_cohort_flips WHERE reverted_at IS NULL AND hold_released_at IS NULL;
  RAISE NOTICE 'age_cohort_flips: % open rows are kept, % of them still hold their age and roster row (counts only: no ids are printed)', _flips, _held;
  IF _flips > 0 AND current_setting('app.confirm_age_cohort_at_18_rollback_opens_holds', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'Refusing to run: % people were aged and are still adults. Putting the old readers back ends the hold on what others wrote on their content (always), and on their age and roster row (% of them still held): all of it becomes visible as an adult''s is. Set app.confirm_age_cohort_at_18_rollback_opens_holds = ''yes'' only if that is wanted (read the header).', _flips, _held;
  END IF;
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

-- The audit trigger and its function; the hold trigger and its function.
DROP TRIGGER IF EXISTS trg_close_age_cohort_flip ON public.profiles;
DROP FUNCTION private_sec.close_age_cohort_flip();
DROP TRIGGER IF EXISTS trg_release_age_hold ON public.privacy_preferences;
DROP FUNCTION private_sec.release_age_hold();

-- The two read policies as they were, then the function the new ones called.
DROP POLICY "Comments are readable by permitted viewers" ON public.post_comments;
CREATE POLICY "Comments are readable by permitted viewers"
ON public.post_comments FOR SELECT TO anon, authenticated
USING (private_sec.can_comment_on_minor_content(auth.uid(), private_sec.comment_subject_owner(subject_type, subject_id)));

DROP POLICY "Reactions are readable by permitted viewers" ON public.post_reactions;
CREATE POLICY "Reactions are readable by permitted viewers"
ON public.post_reactions FOR SELECT TO anon, authenticated
USING (private_sec.can_comment_on_minor_content(auth.uid(), private_sec.comment_subject_owner(subject_type, subject_id)));
DROP FUNCTION private_sec.can_read_engagement(uuid, uuid, timestamptz);

-- The age and the roster row as they were (then nothing calls the hold lookup any more).
CREATE OR REPLACE FUNCTION public.profile_ages(_ids uuid[])
 RETURNS TABLE(id uuid, age integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT b.user_id,
         date_part('year', age(b.birthday))::int
  FROM public.profile_birthdays b
  WHERE b.user_id = ANY(_ids)
    AND b.birthday IS NOT NULL
    AND public.profile_visibility_of(b.user_id) IN ('public','members')
    -- 20261125100000: not for a profile a block or a suspension hides from the caller
    AND (auth.uid() IS NULL OR NOT private_sec.profile_hidden_from_viewer(b.user_id))
    AND (
      -- an adult's age follows their visibility setting, as before
      public.age_cohort_of(b.user_id) = 'adult'
      -- the server (service role, workers, migrations) has no auth.uid()
      OR auth.uid() IS NULL
      -- a minor's age: the minor, a verified guardian, or a moderator
      OR b.user_id = auth.uid()
      OR public.is_guardian_of(auth.uid(), b.user_id)
      OR public.is_moderator(auth.uid())
    );
$function$;

CREATE OR REPLACE FUNCTION private_sec.roster_row_visible(_team_id text, _member_user_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE cohort text; caller uuid;
BEGIN
  IF _member_user_id IS NULL THEN RETURN true; END IF;

  cohort := public.age_cohort_of(_member_user_id);

  IF cohort NOT IN ('child_under_13','teen_13_15','teen_16_17') THEN
    RETURN true;
  END IF;

  caller := auth.uid();

  IF cohort = 'teen_16_17' AND caller IS NOT NULL THEN RETURN true; END IF;

  IF caller IS NULL THEN RETURN false; END IF;
  IF caller = _member_user_id THEN RETURN true; END IF;
  IF public.is_guardian_of(caller, _member_user_id) THEN RETURN true; END IF;
  IF public.is_team_manager(_team_id, caller) THEN RETURN true; END IF;

  RETURN false;
END $function$;

DROP FUNCTION private_sec.age_hold_cohort(uuid);

-- What the migration added (the table private_sec.age_cohort_flips stays: see the header; the failure list is only a queue).
DROP FUNCTION private_sec.age_adult_cohorts(integer);
DROP FUNCTION private_sec.cohort_due_to_age(uuid);
DROP TABLE private_sec.age_cohort_attempts;

COMMIT;
