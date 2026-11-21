-- Age the stored cohort at 18 (docs/age-cohort-at-18.md has the scope, the readers inventory and the open decisions).
--
-- PROBLEM. profiles.age_cohort is written when a birthday is saved and nothing moves it on. A person who registered at 14
-- still carries 'teen_13_15' at 19. 20261125200000 made the guardian readers and the guardian's switches independent of
-- that stale value, but everything else keyed on the cohort still treats the adult as a teen: the 'adult' checks for
-- reviews, hosting, events, payments and host payment methods, the AI allowance, the teen-to-adult DM rule, team youth
-- status, availability visibility. A stale cohort only ever errs stricter, but it errs on an adult who cannot fix it.
--
-- WHAT THIS DOES
--   1. private_sec.cohort_due_to_age(user): the one rule. A stored 'teen_13_15' or 'teen_16_17' cohort whose person is a
--      known adult (stored birthday, age() >= 18: private_sec.is_known_adult, the same computation the pay RPC and the
--      guardian rule use), whom age_cohort_from_birthday also calls 'adult' (so a changed adult_age policy is honoured),
--      who is NOT a managed account (the handover stream owns those) and has no age review pending (a moderator decides
--      those). Never 'unknown', never 'child_under_13', never downward, never the 13 or 16 thresholds.
--   2. private_sec.age_adult_cohorts(cap): a separate, idempotent, capped daily sweep (pg_cron when it exists; by hand
--      otherwise: SELECT private_sec.age_adult_cohorts();). One person at a time in one savepoint, so a failure leaves that
--      person exactly as they were (fail closed: still the stricter cohort) and the next run tries again. For each person:
--        a. the stored privacy row is made explicit BEFORE the flip. The cohort decides two things when no row exists
--           (the default profile visibility and require_follow_approval), so a missing row is created with the values
--           the cohort gave. A stored row was already clamped to the minor floor by trigger and stays as it was.
--        b. a teen_13_15 whose allow_messages is 'everyone' becomes 'shared' (what the shared-game rule gave them with
--           adults): an ordinary adult default would otherwise let any adult message them from the day they flip.
--        c. their reels become drafts (is_draft = true, visible only to the owner, posted with the existing Post action),
--           and their open availability posts are paused (the owner resumes with the existing switch). The audience of a
--           reel and the visibility of an availability post are decided by the cohort alone, so without this every
--           earlier reel would turn public (16-17: members; 13-15: nobody) and every open post would be listed to all
--           members the day they flip. The ids are kept in private_sec.age_cohort_flips.
--        d. profiles.age_cohort and age_category become 'adult' (under openrun.age_sync, the same switch the birthday sync
--           uses), an age_change_events row says so, and a profile that would read wider than before (visibility, follow
--           approval) is put back, or the whole person is rolled back. Aging never widens.
--        e. the person is told once, in app, that their account now has adult settings and where to review privacy.
--   3. A person whose birthday is corrected so that they are a minor again is already recomputed downward: the birthday
--      sync (sync_age_category_from_birthdays) lowers the cohort when the new one ranks lower, and trg_reclamp_privacy_on_
--      cohort_change re-applies the minor floor to the stored row. This migration only records it (reverted_at) in the
--      audit table, so a later 18th birthday flips and tells them again.
--
-- WHAT THIS DELIBERATELY DOES NOT DO
--   * No 13 or 16 threshold, nothing for under-13 (consent rules: legal territory, owner decision). A 19-year-old with a
--     stale child_under_13 cohort is left as they are (stricter).
--   * Nothing for managed accounts, nothing for an unknown birthday, nothing while age_review_required is set.
--   * No change to any reader function: the stored value is what moves.
--   * Reviews, rosters, host statistics and the age shown with an adult's profile are adult behaviour with no stored
--     setting to carry over; they are listed in the doc as open decisions.
--   * The migration changes no row by itself. The first sweep runs from cron, or by hand.
--
-- Rollback: docs/rollbacks/20261128110000_age_cohort_at_18.down.sql (guarded). It cannot un-flip a cohort the sweep
-- already moved, nor re-open the reels and posts it put aside; private_sec.age_cohort_flips lists them and is kept.

-- ============================================================ 1. the audit table
CREATE TABLE IF NOT EXISTS private_sec.age_cohort_flips (
  id                      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id                 uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  from_cohort             text NOT NULL,
  from_category           text,
  flipped_at              timestamptz NOT NULL DEFAULT now(),
  reverted_at             timestamptz,
  privacy_row_added       boolean NOT NULL DEFAULT false,
  messages_tightened      boolean NOT NULL DEFAULT false,
  drafted_reel_ids        uuid[] NOT NULL DEFAULT '{}',
  paused_availability_ids uuid[] NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS age_cohort_flips_user_idx ON private_sec.age_cohort_flips (user_id);
ALTER TABLE private_sec.age_cohort_flips ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private_sec.age_cohort_flips FROM PUBLIC, anon, authenticated, service_role;

-- ============================================================ 2. the rule
CREATE OR REPLACE FUNCTION private_sec.cohort_due_to_age(_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.profiles p
      JOIN public.profile_birthdays pb ON pb.user_id = p.id AND pb.birthday IS NOT NULL
     WHERE p.id = _user
       AND p.age_cohort IN ('teen_13_15', 'teen_16_17')
       AND NOT p.age_review_required
       AND private_sec.is_known_adult(p.id)
       AND public.age_cohort_from_birthday(pb.birthday) = 'adult'
       AND NOT EXISTS (SELECT 1 FROM public.managed_accounts m WHERE m.child_user_id = p.id)
  );
$$;
REVOKE ALL ON FUNCTION private_sec.cohort_due_to_age(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- ============================================================ 3. the sweep
CREATE OR REPLACE FUNCTION private_sec.age_adult_cohorts(_limit integer DEFAULT 200)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _cap          integer := LEAST(GREATEST(COALESCE(_limit, 200), 1), 1000);
  r             record;
  _flipped      integer := 0;
  _failed       integer := 0;
  _notified     integer := 0;
  _reels        integer := 0;
  _posts        integer := 0;
  _remaining    integer;
  _held         integer;
  _vis_before   text;
  _vis_after    text;
  _follow_before boolean;
  _follow_after  boolean;
  _row_added    boolean;
  _msg_tight    boolean;
  _n            integer;
  _reel_ids     uuid[];
  _post_ids     uuid[];
  _body         text;
BEGIN
  FOR r IN
    SELECT p.id, p.age_cohort, p.age_category
      FROM public.profiles p
     WHERE p.age_cohort IN ('teen_13_15', 'teen_16_17')
       AND private_sec.cohort_due_to_age(p.id)
     ORDER BY p.id
     LIMIT _cap
       FOR UPDATE OF p SKIP LOCKED
  LOOP
    BEGIN
      -- What the person's profile reads like today. Compared again after the flip.
      _vis_before := private_sec.profile_visibility_of(r.id);
      _follow_before := public.follow_approval_required(r.id);

      -- a. The stored privacy row, explicit before the cohort stops supplying its defaults. A row that exists was
      -- already clamped by trigger and is not touched; a missing one gets what the cohort gave (the trigger applies the
      -- rest of the minor floor to the insert, since the cohort is still the teen one here).
      INSERT INTO public.privacy_preferences (user_id, profile_visibility, require_follow_approval)
      VALUES (r.id, private_sec.default_profile_visibility_for(r.id), true)
      ON CONFLICT (user_id) DO NOTHING;
      GET DIAGNOSTICS _n = ROW_COUNT;
      _row_added := _n = 1;

      -- b. The shared-game rule a 13-15 had with adults, kept as the stored choice 'shared'.
      _msg_tight := false;
      IF r.age_cohort = 'teen_13_15' THEN
        UPDATE public.privacy_preferences SET allow_messages = 'shared'
         WHERE user_id = r.id AND allow_messages = 'everyone';
        GET DIAGNOSTICS _n = ROW_COUNT;
        _msg_tight := _n = 1;
      END IF;

      -- c. Content whose audience the cohort alone decides: reels back to drafts, listed availability posts paused.
      WITH d AS (
        UPDATE public.highlight_reels SET is_draft = true
         WHERE user_id = r.id AND NOT is_draft AND subject_child_id IS NULL
        RETURNING id)
      SELECT COALESCE(array_agg(id), '{}') INTO _reel_ids FROM d;
      WITH d AS (
        UPDATE public.player_availabilities SET status = 'paused'
         WHERE user_id = r.id AND status = 'open' AND hidden_at IS NULL
        RETURNING id)
      SELECT COALESCE(array_agg(id), '{}') INTO _post_ids FROM d;

      -- d. The flip. openrun.age_sync is the switch the birthday sync uses to write these two fields.
      PERFORM set_config('openrun.age_sync', 'on', true);
      UPDATE public.profiles SET age_cohort = 'adult', age_category = 'adult'
       WHERE id = r.id AND age_cohort = r.age_cohort;
      GET DIAGNOSTICS _n = ROW_COUNT;
      PERFORM set_config('openrun.age_sync', 'off', true);
      IF _n <> 1 THEN RAISE EXCEPTION 'cohort changed under the sweep'; END IF;

      -- Never wider than before: put a stored value back if the adult default would now read wider. Narrower is fine
      -- (a guardian's public-profile switch stops applying with the link, so that one reads members).
      _vis_after := private_sec.profile_visibility_of(r.id);
      IF (CASE _vis_after WHEN 'public' THEN 2 WHEN 'members' THEN 1 ELSE 0 END)
         > (CASE _vis_before WHEN 'public' THEN 2 WHEN 'members' THEN 1 ELSE 0 END) THEN
        UPDATE public.privacy_preferences SET profile_visibility = _vis_before WHERE user_id = r.id;
      END IF;
      _follow_after := public.follow_approval_required(r.id);
      IF _follow_before AND NOT _follow_after THEN
        UPDATE public.privacy_preferences SET require_follow_approval = true WHERE user_id = r.id;
      END IF;
      IF (CASE private_sec.profile_visibility_of(r.id) WHEN 'public' THEN 2 WHEN 'members' THEN 1 ELSE 0 END)
         > (CASE _vis_before WHEN 'public' THEN 2 WHEN 'members' THEN 1 ELSE 0 END)
         OR (_follow_before AND NOT public.follow_approval_required(r.id)) THEN
        RAISE EXCEPTION 'profile would read wider after the flip';
      END IF;

      INSERT INTO public.age_change_events (user_id, from_cohort, to_cohort, outcome)
      VALUES (r.id, r.age_cohort, 'adult', 'aged_to_adult');
      INSERT INTO private_sec.age_cohort_flips
        (user_id, from_cohort, from_category, privacy_row_added, messages_tightened, drafted_reel_ids, paused_availability_ids)
      VALUES (r.id, r.age_cohort, r.age_category, _row_added, _msg_tight, _reel_ids, _post_ids);

      -- e. Told once, kindly, with nothing claimed beyond what changed.
      _body := 'You are 18 or over, so your account now uses adult settings. Your privacy choices stay as they were until you change them.';
      IF cardinality(_reel_ids) > 0 THEN
        _body := _body || ' Your earlier reels are saved as drafts: post the ones you want to share.';
      END IF;
      IF cardinality(_post_ids) > 0 THEN
        _body := _body || ' Your open availability posts are paused: resume the ones you want listed.';
      END IF;
      _body := _body || ' You can review who sees your profile, reels and messages in Privacy settings.';
      INSERT INTO public.notifications (user_id, type, title, body, link)
      VALUES (r.id, 'age_review', 'Your account now has adult settings', _body, '/account/privacy');

      _flipped := _flipped + 1;
      _notified := _notified + 1;
      _reels := _reels + cardinality(_reel_ids);
      _posts := _posts + cardinality(_post_ids);
    EXCEPTION WHEN OTHERS THEN
      -- The savepoint undoes everything for this person: still the stricter cohort, still every setting as it was.
      PERFORM set_config('openrun.age_sync', 'off', true);
      _failed := _failed + 1;
      RAISE WARNING 'age_adult_cohorts: one account not aged: %', SQLERRM;   -- never the id
    END;
  END LOOP;

  SELECT count(*)::int INTO _remaining FROM public.profiles p
   WHERE p.age_cohort IN ('teen_13_15', 'teen_16_17') AND private_sec.cohort_due_to_age(p.id);
  -- Known adults the sweep deliberately leaves, for the owner's attention.
  SELECT count(*)::int INTO _held FROM public.profiles p
   WHERE p.age_cohort IN ('child_under_13', 'teen_13_15', 'teen_16_17')
     AND private_sec.is_known_adult(p.id)
     AND NOT private_sec.cohort_due_to_age(p.id)
     AND NOT EXISTS (SELECT 1 FROM public.managed_accounts m WHERE m.child_user_id = p.id);

  RETURN jsonb_build_object('aged', _flipped, 'notified', _notified, 'failed', _failed, 'remaining', _remaining,
                            'reels_drafted', _reels, 'posts_paused', _posts, 'adults_left_alone', _held);
END $$;
REVOKE ALL ON FUNCTION private_sec.age_adult_cohorts(integer) FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION private_sec.age_adult_cohorts(integer) IS
  'Moves a stored teen_13_15 / teen_16_17 cohort to adult for a known, unmanaged adult with no age review pending, keeping every stored privacy setting at least as private (privacy row made explicit, reels back to drafts, open availability posts paused), and tells them once. Idempotent, capped per run, one savepoint per person. Counts only. Never under-13, never the 13 or 16 thresholds, never downward. Called by the daily job; callable by hand by a person with database access, not by clients.';

DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule('age-adult-cohorts', '47 4 * * *',
      $j$SELECT private_sec.age_adult_cohorts()$j$);
  ELSE
    RAISE NOTICE 'pg_cron is not installed: age-adult-cohorts not scheduled (run private_sec.age_adult_cohorts() by hand)';
  END IF;
EXCEPTION WHEN others THEN
  RAISE NOTICE 'age-adult-cohorts not scheduled: %', SQLERRM;
END
$cron$;

-- ============================================================ 4. a correction back to a minor is recorded
-- The birthday sync already lowers the cohort (and trg_reclamp_privacy_on_cohort_change re-applies the minor floor to the
-- stored row) when a support-approved correction makes the person a minor again. This only closes the audit row, so the
-- next 18th birthday is a new flip with a new notice. It changes nothing about the person.
CREATE OR REPLACE FUNCTION private_sec.close_age_cohort_flip()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE private_sec.age_cohort_flips SET reverted_at = now()
   WHERE user_id = NEW.id AND reverted_at IS NULL;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION private_sec.close_age_cohort_flip() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_close_age_cohort_flip ON public.profiles;
CREATE TRIGGER trg_close_age_cohort_flip
  AFTER UPDATE OF age_cohort ON public.profiles
  FOR EACH ROW WHEN (OLD.age_cohort = 'adult' AND NEW.age_cohort IS DISTINCT FROM 'adult')
  EXECUTE FUNCTION private_sec.close_age_cohort_flip();
