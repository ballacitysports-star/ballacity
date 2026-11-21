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
--      person exactly as they were (fail closed: still the stricter cohort). A person who fails is remembered in
--      private_sec.age_cohort_attempts and goes to the back of the next run's queue, so a handful of stuck accounts can never
--      starve everyone behind them (the daily result has 'failed' and 'failing_people': either above 0 needs a person to
--      look). For each person:
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
--        e. the person is told once, in app, what changed and where to review privacy (what is held, what is now open).
--   3. THE READERS THE FLIP WOULD OTHERWISE WIDEN (this migration changes exactly four, and only for a person who has an
--      open private_sec.age_cohort_flips row; for everyone else each one returns what it returned before):
--        * comments and reactions that OTHER people wrote on the person's content. The two read policies on post_comments
--          and post_reactions asked only "may this viewer comment on this owner's content", which is a cohort question, so
--          the day the owner became an adult every comment a teammate or guardian had left on their games, posts and reels
--          would have become readable to anyone, signed-out visitors included. They now ask private_sec.can_read_engagement:
--          a comment or reaction written BEFORE the flip stays readable by the same people as before (the owner, a verified
--          guardian, a teammate); one written after follows the adult rule. Nothing is lost, nothing is deleted.
--        * profile_ages: the person's age. Until the person saves their Privacy settings it is shown to the same people as
--          before (the person, a verified guardian, a moderator), not to every viewer of a members or public profile.
--        * roster_row_visible: the person's roster row on a team. Until the same moment it keeps the rule of the cohort
--          the person had (13-15: the person, a guardian, the team's managers; 16-17: signed-in members).
--        The "same moment" is the person saving their own Privacy settings (trg_release_age_hold on privacy_preferences;
--        the page saves the whole row on every change). It is the person's own act, so nothing the server does releases it.
--   4. A person whose birthday is corrected so that they are a minor again is already recomputed downward: the birthday
--      sync (sync_age_category_from_birthdays) lowers the cohort when the new one ranks lower, and trg_reclamp_privacy_on_
--      cohort_change re-applies the minor floor to the stored row. This migration only records it (reverted_at) in the
--      audit table, so a later 18th birthday flips and tells them again; with the row closed, the three held readers go
--      back to plain cohort rules (the person is a minor again: the cohort rule is the stricter one).
--
-- WHAT THIS DELIBERATELY DOES NOT DO
--   * No 13 or 16 threshold, nothing for under-13 (consent rules: legal territory, owner decision). A 19-year-old with a
--     stale child_under_13 cohort is left as they are (stricter).
--   * Nothing for managed accounts, nothing for an unknown birthday, nothing while age_review_required is set.
--   * No change to any other reader function: the stored value is what moves.
--   * New comments and reactions: from the flip on, anyone may comment and react on the person's games, posts and reels, as
--     on any adult's (the insert policies are unchanged). The notice says so. Reviews, host statistics and the rest of
--     the adult behaviour with no stored setting are listed in the doc as open decisions.
--   * The migration changes no row by itself. The first sweep runs from cron, or by hand.
--
-- Rollback: docs/rollbacks/20261128110000_age_cohort_at_18.down.sql (guarded). It cannot un-flip a cohort the sweep
-- already moved, nor re-open the reels and posts it put aside; private_sec.age_cohort_flips lists them and is kept.
-- It puts the four readers back as they were, which ends every hold: it asks for a second confirmation when flipped people exist.

-- ============================================================ 1. the audit table
CREATE TABLE IF NOT EXISTS private_sec.age_cohort_flips (
  id                      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id                 uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  from_cohort             text NOT NULL,
  from_category           text,
  flipped_at              timestamptz NOT NULL DEFAULT now(),
  reverted_at             timestamptz,
  hold_released_at        timestamptz,     -- set when the person saves their own Privacy settings (see section 3)
  privacy_row_added       boolean NOT NULL DEFAULT false,
  messages_tightened      boolean NOT NULL DEFAULT false,
  drafted_reel_ids        uuid[] NOT NULL DEFAULT '{}',
  paused_availability_ids uuid[] NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS age_cohort_flips_user_idx ON private_sec.age_cohort_flips (user_id);
-- The readers below look a person up here on every roster row, age and comment they evaluate: only the open rows matter.
CREATE INDEX IF NOT EXISTS age_cohort_flips_open_idx ON private_sec.age_cohort_flips (user_id) WHERE reverted_at IS NULL;
ALTER TABLE private_sec.age_cohort_flips ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private_sec.age_cohort_flips FROM PUBLIC, anon, authenticated, service_role;

-- Who the sweep could not age, and when it last tried. The sweep serves people it has never failed on first, then the one
-- it tried longest ago, so a stuck account never sits at the front of the queue. Ids only, no content.
CREATE TABLE IF NOT EXISTS private_sec.age_cohort_attempts (
  user_id        uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  failures       integer NOT NULL DEFAULT 1,
  last_failed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE private_sec.age_cohort_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private_sec.age_cohort_attempts FROM PUBLIC, anon, authenticated, service_role;

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


-- ============================================================ 2b. what the flip must not widen
-- The cohort a person had before the flip, while their age and roster row are still held. NULL when nothing is held: no
-- open audit row, or the person has saved their Privacy settings since.
CREATE OR REPLACE FUNCTION private_sec.age_hold_cohort(_user uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT f.from_cohort
    FROM private_sec.age_cohort_flips f
   WHERE f.user_id = _user AND f.reverted_at IS NULL AND f.hold_released_at IS NULL
   ORDER BY f.id DESC
   LIMIT 1;
$$;
REVOKE ALL ON FUNCTION private_sec.age_hold_cohort(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- The person saving their own Privacy settings releases the hold. Only their own save (auth.uid() is them): the sweep,
-- support and the reclamp trigger run without it and never release anything.
CREATE OR REPLACE FUNCTION private_sec.release_age_hold()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() = NEW.user_id THEN
    UPDATE private_sec.age_cohort_flips SET hold_released_at = now()
     WHERE user_id = NEW.user_id AND reverted_at IS NULL AND hold_released_at IS NULL;
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION private_sec.release_age_hold() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_release_age_hold ON public.privacy_preferences;
CREATE TRIGGER trg_release_age_hold
  AFTER INSERT OR UPDATE ON public.privacy_preferences
  FOR EACH ROW EXECUTE FUNCTION private_sec.release_age_hold();

-- Comments and reactions other people left on the owner's content. The old read rule (can_comment_on_minor_content) is a
-- question about the owner's cohort alone: once the owner reads as an adult it answers yes for everybody, which would open
-- every comment a teammate or guardian left while the owner was a teen. For an owner with an open flip, what was written
-- before the flip stays readable by the people who could read it then; what is written after follows the adult rule.
CREATE OR REPLACE FUNCTION private_sec.can_read_engagement(_viewer uuid, _owner uuid, _written_at timestamptz)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT private_sec.can_comment_on_minor_content(_viewer, _owner)
     AND (
       _owner IS NULL
       OR NOT EXISTS (SELECT 1 FROM private_sec.age_cohort_flips f
                       WHERE f.user_id = _owner AND f.reverted_at IS NULL AND _written_at < f.flipped_at)
       OR (_viewer IS NOT NULL
           AND (_viewer = _owner OR public.is_guardian_of(_viewer, _owner) OR public.shares_team(_viewer, _owner)))
     );
$$;
REVOKE ALL ON FUNCTION private_sec.can_read_engagement(uuid, uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private_sec.can_read_engagement(uuid, uuid, timestamptz) TO anon, authenticated, service_role;

DROP POLICY IF EXISTS "Comments are readable by permitted viewers" ON public.post_comments;
CREATE POLICY "Comments are readable by permitted viewers"
ON public.post_comments FOR SELECT TO anon, authenticated
USING (private_sec.can_read_engagement(
  auth.uid(), private_sec.comment_subject_owner(subject_type, subject_id), created_at));

DROP POLICY IF EXISTS "Reactions are readable by permitted viewers" ON public.post_reactions;
CREATE POLICY "Reactions are readable by permitted viewers"
ON public.post_reactions FOR SELECT TO anon, authenticated
USING (private_sec.can_read_engagement(
  auth.uid(), private_sec.comment_subject_owner(subject_type, subject_id), created_at));

-- The person's age: unchanged except that an adult whose age is still held is read by the minor rule.
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
      -- an adult's age follows their visibility setting, as before; 20261128110000: not while the age of a person who just
      -- aged to adult is held (until they save their Privacy settings), which is read as the minor's was
      (public.age_cohort_of(b.user_id) = 'adult' AND private_sec.age_hold_cohort(b.user_id) IS NULL)
      -- the server (service role, workers, migrations) has no auth.uid()
      OR auth.uid() IS NULL
      -- a minor's age: the minor, a verified guardian, or a moderator
      OR b.user_id = auth.uid()
      OR public.is_guardian_of(auth.uid(), b.user_id)
      OR public.is_moderator(auth.uid())
    );
$function$;

-- The roster row: unchanged except that a person whose row is still held keeps the rule of the cohort they had.
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
    -- 20261128110000: a person who just aged to adult keeps the cohort they had until they save their Privacy settings
    cohort := private_sec.age_hold_cohort(_member_user_id);
    IF cohort IS NULL OR cohort NOT IN ('child_under_13','teen_13_15','teen_16_17') THEN RETURN true; END IF;
  END IF;

  caller := auth.uid();

  IF cohort = 'teen_16_17' AND caller IS NOT NULL THEN RETURN true; END IF;

  IF caller IS NULL THEN RETURN false; END IF;
  IF caller = _member_user_id THEN RETURN true; END IF;
  IF public.is_guardian_of(caller, _member_user_id) THEN RETURN true; END IF;
  IF public.is_team_manager(_team_id, caller) THEN RETURN true; END IF;

  RETURN false;
END $function$;

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
  _failing      integer;
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
    -- Never-failed people first, then whoever it tried longest ago: a person who keeps failing goes to the back, so a
    -- run's cap can never be used up by the same stuck accounts day after day.
    SELECT p.id, p.age_cohort, p.age_category
      FROM public.profiles p
      LEFT JOIN private_sec.age_cohort_attempts a ON a.user_id = p.id
     WHERE p.age_cohort IN ('teen_13_15', 'teen_16_17')
       AND private_sec.cohort_due_to_age(p.id)
     ORDER BY a.last_failed_at NULLS FIRST, p.id
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

      -- e. Told once, kindly, saying exactly what changed and what did not (nothing here claims "nothing changed").
      _body := 'You are 18 or over, so your account now uses adult settings.';
      IF cardinality(_reel_ids) > 0 THEN
        _body := _body || ' Your earlier reels are saved as drafts: post the ones you want to share.';
      END IF;
      IF cardinality(_post_ids) > 0 THEN
        _body := _body || ' Your open availability posts are paused: resume the ones you want listed.';
      END IF;
      _body := _body || ' Your age and your team listing stay hidden from other people until you save your Privacy settings.'
                     || ' From now on other people can comment and react on your games, posts and reels;'
                     || ' what was said before stays as private as it was.'
                     || ' You can review who sees your profile, reels and messages in Privacy settings.';
      INSERT INTO public.notifications (user_id, type, title, body, link)
      VALUES (r.id, 'age_review', 'Your account now has adult settings', _body, '/account/privacy');

      DELETE FROM private_sec.age_cohort_attempts WHERE user_id = r.id;

      _flipped := _flipped + 1;
      _notified := _notified + 1;
      _reels := _reels + cardinality(_reel_ids);
      _posts := _posts + cardinality(_post_ids);
    EXCEPTION WHEN OTHERS THEN
      -- The savepoint undoes everything for this person: still the stricter cohort, still every setting as it was.
      PERFORM set_config('openrun.age_sync', 'off', true);
      _failed := _failed + 1;
      -- Remember the failure (the handler runs after the savepoint was undone, so this row is kept) and go to the back.
      INSERT INTO private_sec.age_cohort_attempts (user_id) VALUES (r.id)
      ON CONFLICT (user_id) DO UPDATE SET failures = private_sec.age_cohort_attempts.failures + 1, last_failed_at = now();
      -- The SQLSTATE only: the message text comes from whatever trigger failed and could carry a name or an id.
      RAISE WARNING 'age_adult_cohorts: one account not aged (SQLSTATE %)', SQLSTATE;
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

  -- People still failing (tried and not aged, still due). Above 0 for more than a day, someone has to look.
  SELECT count(*)::int INTO _failing FROM private_sec.age_cohort_attempts a
   WHERE EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = a.user_id AND p.age_cohort IN ('teen_13_15', 'teen_16_17')
                    AND private_sec.cohort_due_to_age(p.id));

  RETURN jsonb_build_object('aged', _flipped, 'notified', _notified, 'failed', _failed, 'failing_people', _failing,
                            'remaining', _remaining, 'reels_drafted', _reels, 'posts_paused', _posts,
                            'adults_left_alone', _held);
END $$;
REVOKE ALL ON FUNCTION private_sec.age_adult_cohorts(integer) FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION private_sec.age_adult_cohorts(integer) IS
  'Moves a stored teen_13_15 / teen_16_17 cohort to adult for a known, unmanaged adult with no age review pending, keeping every stored privacy setting at least as private (privacy row made explicit, reels back to drafts, open availability posts paused), and tells them once. Idempotent, capped per run, one savepoint per person, people who fail go to the back of the queue. Counts only. Never under-13, never the 13 or 16 thresholds, never downward. Called by the daily job; callable by hand by a person with database access, not by clients.';

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
