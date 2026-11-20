-- ROLLBACK for supabase/migrations/20261125200000_guardian_links_end_at_18.sql (owner decision 2026-11-20: a guardian
-- link ends when the child turns 18; docs/guardian-link-age-18.md).
-- NOT a migration. It puts back the eleven readers exactly as they were before (guardian links count while status is
-- 'active', whatever the child's age; the guardian's child_controls switches bind by the stored cohort alone), puts back
-- the consent-record policy, drops the birthday-correction trigger, unschedules the daily sweep and drops the functions
-- the migration added.
--
-- WHAT IT CANNOT UNDO: a link the sweep already ended (status 'revoked'). The old rule would not bring it back by
-- itself, so an 18-year-old whose link was ended stays unlinked after this rollback. private_sec.guardian_link_age_events
-- lists exactly which links the sweep ended (kind 'ended') and which managing guardians it told ('managed_notice'), and
-- THIS ROLLBACK KEEPS THAT TABLE for that reason. A person who decides to restore those links runs, deliberately and
-- separately (it re-gives each guardian access to an adult's account, so it is an owner decision):
--     UPDATE public.guardian_links gl SET status = 'active'
--       FROM private_sec.guardian_link_age_events e
--      WHERE e.kind = 'ended' AND gl.child_user_id = e.child_user_id AND gl.parent_user_id = e.parent_user_id
--        AND gl.status = 'revoked';
-- (the existing triggers write the audit rows). Notifications the sweep sent stay where they are. Drop the table by
-- hand (DROP TABLE private_sec.guardian_link_age_events) once nobody needs the list.
-- Also gone with the rollback: the trigger that put swept links back when a support-approved birthday correction made a
-- person a minor again. After the rollback a link the sweep ended stays ended whatever a correction says, so if the
-- rollback is kept for long, check birthday corrections (public.birthday_correction_requests approved since) by hand and
-- restore the link of anyone who became a minor with the statement above.
-- Effect on the app that shipped with the migration: public.my_guardian_link_in_force, public.guardian_links_in_force and
-- public.guardian_authority_has_ended disappear. The app falls back to reading guardian_links directly (the old
-- behaviour) and the push curfew keeps the stored cohort and the guardian's switch when they are missing, so nothing
-- fails, but a guardian again sees and acts for an adult whose link is still 'active'. Roll the app back too if that is
-- not wanted.
-- It stops, changing nothing, if any function the migration touched no longer has the definition the migration gave it
-- (a later migration changed it): a person needs to look first.
-- It refuses to run unless the session sets the confirmation first:
--     SET app.confirm_guardian_links_end_at_18_rollback = 'yes';
--     (or PGOPTIONS="-c app.confirm_guardian_links_end_at_18_rollback=yes")
BEGIN;
DO $guard$
DECLARE
  _want jsonb := '{
    "private_sec.is_guardian_of(uuid, uuid)": "5f234f55ae7f307f8467b9e3c5634d44",
    "private_sec.child_game_participation_allowed(uuid)": "f18bfcf810e65d44d948346ea5f6c375",
    "private_sec.guardian_payment_approval_missing(uuid, text)": "08b5ce5ba7ba1386fd0606a3e92fe925",
    "private_sec.team_chat_member(text, uuid)": "66bfe4c1ebe2f08d9fa678bb74768dfd",
    "public.notify_guardians(uuid, text, text, text, text)": "31c483efac1a97c83f04af75423fc3a3",
    "public.notify_guardians_of(uuid, text, text, text, text)": "2e8ece03cc63a51b4799cf9cf7e36e21",
    "public.guardian_children_overview()": "45fa65eae905e1728a9955daf156136f",
    "private_sec.ai_analysis_allowed(uuid)": "2ab131c25a00dd9219a6d723b42d63f4",
    "public.clamp_ai_processing_for_minors()": "3d2064e38080f8b0048388f3cac38ac0",
    "public.public_xp_enabled(uuid)": "e5c1e67934b0190ec1e0f9022221bb9b",
    "public.minor_messaging_block(uuid, uuid)": "08fe60a501574895244e469c440b5e47",
    "private_sec.is_known_adult(uuid)": "d4470d29cf1fb2ce9d2331e73763d3e9",
    "private_sec.guardian_authority_ended(uuid)": "27b3184a69a735961376b7decebb6cce",
    "private_sec.guardian_link_in_force(uuid, text)": "da0f62698259be928a7e06a8232b4795",
    "private_sec.guardian_switches_apply(uuid)": "8062e06227feddaa7461fb1e4a2ca05e",
    "private_sec.end_adult_guardian_links(integer)": "70a31fe4cdd5914cd419528c9cfa4496",
    "private_sec.restore_links_on_birthday_correction()": "46e34085e690ddd0931ec037e5647c16",
    "public.guardian_links_in_force(uuid[])": "9299a26b722da2e8f33de0b0f35e1768",
    "public.guardian_authority_has_ended(uuid)": "18e7398aea94368f72e9e5b92a01ac94",
    "public.my_guardian_link_in_force()": "eb4405359475f050558c4103662081fe"
  }'::jsonb;
  _k text;
  _got text;
BEGIN
  IF current_setting('app.confirm_guardian_links_end_at_18_rollback', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'Refusing to run: this puts guardian authority back over every linked adult whose link is still active, and cannot restore links the sweep already ended (private_sec.guardian_link_age_events lists them). Set app.confirm_guardian_links_end_at_18_rollback=yes for the session to proceed deliberately.';
  END IF;
  FOR _k IN SELECT jsonb_object_keys(_want) LOOP
    SELECT md5(pg_get_functiondef(p.oid)) INTO _got FROM pg_proc p WHERE p.oid = to_regprocedure(_k);
    IF _got IS DISTINCT FROM _want ->> _k THEN
      RAISE EXCEPTION 'Refusing to run: % is not the definition 20261125200000 created (md5 %, expected %). A later change needs a person to look first.', _k, _got, _want ->> _k;
    END IF;
  END LOOP;
END
$guard$;

SET LOCAL lock_timeout = '5s';

-- The daily sweep, when pg_cron is there.
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('end-adult-guardian-links');
  END IF;
EXCEPTION WHEN others THEN
  RAISE NOTICE 'end-adult-guardian-links not unscheduled (it may not exist): %', SQLERRM;
END
$cron$;

-- The birthday-correction trigger and its function.
DROP TRIGGER IF EXISTS trg_birthday_correction_restores_links ON public.profile_birthdays;
DROP FUNCTION private_sec.restore_links_on_birthday_correction();

-- The consent-record policy as it was.
DROP POLICY "Linked parent reads child consent record" ON public.parental_consents;
CREATE POLICY "Linked parent reads child consent record" ON public.parental_consents
  FOR SELECT TO authenticated
  USING (parent_user_id = auth.uid());

-- The eleven readers as they were.
CREATE OR REPLACE FUNCTION private_sec.is_guardian_of(_parent uuid, _child uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.guardian_links
    WHERE parent_user_id = _parent AND child_user_id = _child
      AND status = 'active' AND verified_at IS NOT NULL
  );
$function$;

CREATE OR REPLACE FUNCTION private_sec.child_game_participation_allowed(_user uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN public.child_features_locked(_user) THEN false
    WHEN public.age_cohort_of(_user) = 'child_under_13' THEN
      COALESCE((SELECT game_participation FROM public.child_controls WHERE child_user_id = _user), false)
    WHEN public.is_minor(_user)
         AND EXISTS (SELECT 1 FROM public.guardian_links gl
                      WHERE gl.child_user_id = _user AND gl.status = 'active') THEN
      COALESCE((SELECT game_participation FROM public.child_controls WHERE child_user_id = _user), true)
    ELSE true
  END;
$function$;

CREATE OR REPLACE FUNCTION private_sec.guardian_payment_approval_missing(_player uuid, _game_id text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
           SELECT 1 FROM public.guardian_links gl
            WHERE gl.child_user_id = _player AND gl.status = 'active'
         )
     AND NOT EXISTS (
           SELECT 1 FROM public.join_requests jr
            WHERE jr.game_id = _game_id
              AND jr.player_id = _player
              AND jr.guardian_approved_at IS NOT NULL
              AND private_sec.guardian_approval_valid(_player, jr.guardian_approved_by)
              AND jr.status IN ('pending', 'approved')
         );
$function$;

CREATE OR REPLACE FUNCTION private_sec.team_chat_member(_team text, _user uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  _cohort text;
BEGIN
  IF _team IS NULL OR _user IS NULL THEN RETURN false; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.teams t WHERE t.id = _team AND t.moderator_hidden_at IS NULL) THEN
    RETURN false;
  END IF;
  _cohort := public.age_cohort_of(_user);
  IF public.is_team_member(_team, _user) THEN
    IF _cohort = 'adult' THEN RETURN true; END IF;
    IF _cohort IN ('teen_13_15', 'teen_16_17') THEN
      RETURN EXISTS (SELECT 1 FROM public.guardian_links g
                      WHERE g.child_user_id = _user AND g.status = 'active' AND g.verified_at IS NOT NULL)
         AND EXISTS (SELECT 1 FROM public.child_controls c
                      WHERE c.child_user_id = _user AND c.messaging IN ('teammates', 'peers'));
    END IF;
    RETURN false;
  END IF;
  IF _cohort = 'adult' AND EXISTS (
       SELECT 1 FROM public.team_members m
        WHERE m.team_id = _team AND m.user_id <> _user AND public.is_guardian_of(_user, m.user_id)) THEN
    RETURN true;
  END IF;
  RETURN false;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notify_guardians(_child uuid, _type text, _title text, _body text, _link text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE allowed boolean;
BEGIN
  SELECT COALESCE(notifications, true) INTO allowed
  FROM public.child_controls WHERE child_user_id = _child;
  IF allowed IS FALSE THEN RETURN; END IF;

  INSERT INTO public.notifications (user_id, type, title, body, link)
  SELECT gl.parent_user_id, _type, _title, _body, _link
  FROM public.guardian_links gl
  WHERE gl.child_user_id = _child AND gl.status = 'active';
END $function$;

CREATE OR REPLACE FUNCTION public.notify_guardians_of(_player uuid, _type text, _title text, _body text, _link text)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  INSERT INTO public.notifications (user_id, type, title, body, link)
  SELECT DISTINCT x.g, _type, left(_title, 200), _body, _link
    FROM (
      SELECT parent_user_id AS g FROM public.guardian_links
       WHERE child_user_id = _player AND status = 'active' AND verified_at IS NOT NULL
      UNION
      SELECT managed_by FROM public.managed_accounts WHERE child_user_id = _player
    ) x
   WHERE x.g IS NOT NULL AND x.g <> _player;
$function$;

CREATE OR REPLACE FUNCTION public.guardian_children_overview()
 RETURNS TABLE(child_user_id uuid, display_name text, username text, avatar_url text, age_cohort text, age_review_required boolean, consent_status text, consent_method text, consent_requested_at timestamp with time zone, consent_approved_at timestamp with time zone, consent_revoked_at timestamp with time zone, consent_reverify_at timestamp with time zone, consent_parent_email text, relationship text, linked_at timestamp with time zone, upcoming_games integer, next_game_title text, next_game_at timestamp with time zone, team_count integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH kids AS (
    SELECT gl.child_user_id, gl.relationship, gl.created_at AS linked_at
    FROM public.guardian_links gl
    WHERE gl.parent_user_id = auth.uid() AND gl.status = 'active'
  ),
  games AS (
    SELECT gp.user_id,
           count(*)::int AS upcoming_games,
           (array_agg(hg.title ORDER BY hg.date))[1] AS next_game_title,
           min(hg.date) AS next_game_at
    FROM public.game_participants gp
    JOIN public.hosted_games hg ON hg.id = gp.game_id
    WHERE gp.user_id IN (SELECT child_user_id FROM kids)
      AND hg.date >= now()
      AND coalesce(hg.status, 'scheduled') NOT IN ('cancelled', 'completed')
    GROUP BY gp.user_id
  ),
  teams AS (
    SELECT tm.user_id, count(*)::int AS team_count
    FROM public.team_members tm
    WHERE tm.user_id IN (SELECT child_user_id FROM kids)
    GROUP BY tm.user_id
  )
  SELECT
    k.child_user_id,
    coalesce(p.display_name, 'Child account'),
    p.username,
    p.avatar_url,
    coalesce(p.age_cohort, 'unknown'),
    coalesce(p.age_review_required, false),
    pc.status,
    pc.method,
    pc.requested_at,
    pc.approved_at,
    pc.revoked_at,
    pc.reverify_at,
    pc.parent_email,
    k.relationship,
    k.linked_at,
    coalesce(g.upcoming_games, 0),
    g.next_game_title,
    g.next_game_at,
    coalesce(t.team_count, 0)
  FROM kids k
  LEFT JOIN public.profiles p ON p.id = k.child_user_id
  LEFT JOIN public.parental_consents pc ON pc.child_user_id = k.child_user_id
  LEFT JOIN games g ON g.user_id = k.child_user_id
  LEFT JOIN teams t ON t.user_id = k.child_user_id
  ORDER BY coalesce(p.display_name, 'Child account');
$function$;

CREATE OR REPLACE FUNCTION private_sec.ai_analysis_allowed(_user uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE cohort text; guardian_ok boolean; own boolean;
BEGIN
  cohort := public.age_cohort_of(_user);
  IF cohort IN ('child_under_13','teen_13_15','teen_16_17') THEN
    SELECT ai_analysis INTO guardian_ok FROM public.child_controls WHERE child_user_id = _user;
    IF guardian_ok IS DISTINCT FROM true THEN RETURN false; END IF;
  END IF;
  SELECT ai_processing INTO own FROM public.privacy_preferences WHERE user_id = _user;
  RETURN COALESCE(own, true);
END $function$
;

CREATE OR REPLACE FUNCTION public.clamp_ai_processing_for_minors()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE cohort text; guardian_ok boolean;
BEGIN
  cohort := public.age_cohort_of(NEW.user_id);
  IF cohort IN ('child_under_13','teen_13_15','teen_16_17') THEN
    SELECT ai_analysis INTO guardian_ok FROM public.child_controls WHERE child_user_id = NEW.user_id;
    IF guardian_ok IS DISTINCT FROM true THEN
      NEW.ai_processing := false;
      NEW.ai_training_opt_in := false;
    END IF;
  END IF;
  RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.public_xp_enabled(_user uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE((SELECT c.public_xp FROM public.child_controls c WHERE c.child_user_id = _user), false)
     AND public.age_cohort_of(_user) IN ('child_under_13', 'teen_13_15', 'teen_16_17')
     AND NOT public.child_features_locked(_user);
$function$
;

CREATE OR REPLACE FUNCTION public.minor_messaging_block(_a uuid, _b uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE ca text; cb text; ctrl text; side text;
BEGIN
  ca := public.age_cohort_of(_a);
  cb := public.age_cohort_of(_b);

  -- Guardian-set controls, checked first so a restricted child is never
  -- reachable through the shared-context fallbacks further down.
  IF ca IN ('child_under_13','teen_13_15','teen_16_17') THEN
    SELECT messaging INTO ctrl FROM public.child_controls WHERE child_user_id = _a;
    IF ctrl = 'off' THEN RETURN 'messaging_off:self'; END IF;
    IF ctrl = 'guardian_only' AND NOT public.is_guardian_of(_b, _a) THEN
      RETURN 'guardian_only:self';
    END IF;
    IF ctrl = 'teammates'
       AND NOT public.is_guardian_of(_b, _a)
       AND NOT public.shares_team(_a, _b) THEN RETURN 'teammates_only:self'; END IF;
  END IF;
  IF cb IN ('child_under_13','teen_13_15','teen_16_17') THEN
    SELECT messaging INTO ctrl FROM public.child_controls WHERE child_user_id = _b;
    IF ctrl = 'off' THEN RETURN 'messaging_off:other'; END IF;
    IF ctrl = 'guardian_only' AND NOT public.is_guardian_of(_a, _b) THEN
      RETURN 'guardian_only:other';
    END IF;
    IF ctrl = 'teammates'
       AND NOT public.is_guardian_of(_a, _b)
       AND NOT public.shares_team(_b, _a) THEN RETURN 'teammates_only:other'; END IF;
  END IF;

  -- Adult <-> under-13. The side is the child's.
  IF (ca = 'child_under_13' AND cb = 'adult') OR (cb = 'child_under_13' AND ca = 'adult') THEN
    side := CASE WHEN ca = 'child_under_13' THEN 'self' ELSE 'other' END;
    IF public.is_guardian_of(CASE WHEN ca = 'child_under_13' THEN _b ELSE _a END,
                             CASE WHEN ca = 'child_under_13' THEN _a ELSE _b END) THEN
      RETURN NULL;
    END IF;
    IF public.age_policy_flag('child_adult_dm_requires_guardian_link', true) THEN
      RETURN 'child_needs_guardian:' || side;
    END IF;
    IF public.shares_game_or_chat(_a, _b) THEN RETURN NULL; END IF;
    RETURN 'child_needs_shared_game:' || side;
  END IF;

  -- Adult <-> 13-15 requires a shared game or an existing conversation. The
  -- side is the teen's.
  IF (ca = 'teen_13_15' AND cb = 'adult') OR (cb = 'teen_13_15' AND ca = 'adult') THEN
    -- A guardian never needs a shared game to reach their own child.
    IF public.is_guardian_of(CASE WHEN ca = 'teen_13_15' THEN _b ELSE _a END,
                             CASE WHEN ca = 'teen_13_15' THEN _a ELSE _b END) THEN
      RETURN NULL;
    END IF;
    IF public.age_policy_flag('teen_adult_dm_requires_shared_context', true) THEN
      IF public.shares_game_or_chat(_a, _b) THEN RETURN NULL; END IF;
      RETURN 'teen_needs_shared_game:' || CASE WHEN ca = 'teen_13_15' THEN 'self' ELSE 'other' END;
    END IF;
    RETURN NULL;
  END IF;

  RETURN NULL;
END $function$
;

-- What the migration added (the table private_sec.guardian_link_age_events stays: see the header).
DROP FUNCTION public.guardian_links_in_force(uuid[]);
DROP FUNCTION public.my_guardian_link_in_force();
DROP FUNCTION public.guardian_authority_has_ended(uuid);
DROP FUNCTION private_sec.end_adult_guardian_links(integer);
DROP FUNCTION private_sec.guardian_switches_apply(uuid);
DROP FUNCTION private_sec.guardian_link_in_force(uuid, text);
DROP FUNCTION private_sec.guardian_authority_ended(uuid);
DROP FUNCTION private_sec.is_known_adult(uuid);

COMMIT;
