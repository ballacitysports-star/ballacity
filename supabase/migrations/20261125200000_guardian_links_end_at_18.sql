-- Owner decision 2026-11-20 ("Guardian link end after 18"): a guardian link ends when the child turns 18.
-- docs/guardian-link-age-18.md has the scope (every reader), the design and the managed-account question.
--
-- WHAT THIS DOES
--   1. One rule. private_sec.guardian_link_in_force(child, status): the link is in force while status = 'active' AND
--      the child is not a known adult. "Known adult" is the computation the pay RPC (game_payment_guardian_ready) and
--      is_minor already use: a stored birthday (profile_birthdays) whose age() is 18 or more. An unknown birthday is
--      NOT an adult (fail closed: the link stays). A managed (credential-less) child is NOT ended either: the managing
--      guardian is the only way into that account, so its link stays in force until the owner decides on a handover.
--      The day the birthday passes the link is out of force in every reader below, with no job needing to have run.
--   2. The readers use it: private_sec.is_guardian_of (which every guardian RLS policy, RPC and server check goes
--      through), child_game_participation_allowed, guardian_payment_approval_missing (the payment trigger, PayPal and
--      the manual-claim check all ask it), team_chat_member, notify_guardians, notify_guardians_of,
--      guardian_children_overview. The "Linked parent reads child consent record" policy on parental_consents stops
--      showing an adult's consent record to the guardian who held it.
--      The guardian's child_controls switches (private_sec.guardian_switches_apply: minor cohort AND a guardian still has
--      authority) bind only while the rule says so: ai_analysis_allowed, clamp_ai_processing_for_minors,
--      public_xp_enabled and the control part of minor_messaging_block. The stored cohort never ages, so without this a
--      switch left off would hold an 18-year-old that nobody can change.
--   3. A sweep, private_sec.end_adult_guardian_links(cap): records status = 'revoked' on links already out of force
--      (the existing triggers write the family audit row and clear that guardian's approvals on requests that are not
--      yet a place), tells the new adult and the guardian once each in the app, and reports how many managed accounts
--      are waiting on an owner decision (it notifies the managing guardian once per account; it never ends them).
--      Idempotent, capped per run, touches only active links of known, unmanaged adults. Scheduled daily when pg_cron
--      exists (production); on a database without it, run it by hand: SELECT private_sec.end_adult_guardian_links();
--   3b. A birthday correction that makes the person a minor (or unknown) again puts the links the sweep ended back
--      (trigger on profile_birthdays), so a minor is never left without a link by the order jobs ran in.
--   4. public.guardian_links_in_force(children) (service role only) and public.my_guardian_link_in_force() (a signed-in
--      user about themself): the same rule for server code and the app, so no client keeps its own copy.
--
-- WHAT THIS DELIBERATELY DOES NOT DO
--   * It does not revoke parental_consents. revoke_guardian_link does, but the stored age_cohort never ages (it is set
--     when a birthday is saved), so an 18-year-old can still carry a consent-required cohort; a revoked record would
--     then lock them out (platform_status, child_features_locked) and tell them "Approval was withdrawn". The record
--     stays as history; the guardian's read of it ends (policy above).
--   * It does not change profiles.age_cohort, privacy settings, reels or anything an adult's cohort drives.
--   * It does not touch managed accounts, and does not build the handover (owner decision, see the doc).
--   * enforce_child_game_participation and team_respond_invite are unchanged: both already apply only to is_minor.
--
-- Rollback: docs/rollbacks/20261125200000_guardian_links_end_at_18.down.sql (guarded). It cannot un-revoke a link the
-- sweep already ended; private_sec.guardian_link_age_events lists which ones, and the rollback keeps that table.

-- ============================================================ 1. the rule
CREATE OR REPLACE FUNCTION private_sec.is_known_adult(_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  -- The same computation as game_payment_guardian_ready and is_minor: a stored birthday, age() >= 18. Unknown: false.
  SELECT EXISTS (SELECT 1 FROM public.profile_birthdays pb
                  WHERE pb.user_id = _user AND pb.birthday IS NOT NULL
                    AND date_part('year', age(pb.birthday))::int >= 18);
$$;
REVOKE ALL ON FUNCTION private_sec.is_known_adult(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private_sec.guardian_authority_ended(_child uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  -- A known adult who is not a managed (credential-less) account: no guardian has authority over them any more.
  SELECT private_sec.is_known_adult(_child)
     AND NOT EXISTS (SELECT 1 FROM public.managed_accounts m WHERE m.child_user_id = _child);
$$;
REVOKE ALL ON FUNCTION private_sec.guardian_authority_ended(uuid) FROM PUBLIC, anon;
-- Row level security policies (parental_consents) call it as the signed-in user, as they call is_guardian_of.
GRANT EXECUTE ON FUNCTION private_sec.guardian_authority_ended(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION private_sec.guardian_link_in_force(_child uuid, _status text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT _status = 'active' AND NOT private_sec.guardian_authority_ended(_child);
$$;
REVOKE ALL ON FUNCTION private_sec.guardian_link_in_force(uuid, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private_sec.guardian_switches_apply(_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  -- Do a guardian's child_controls switches (AI analysis, messaging, public XP, notifications) bind this person? Yes for a
  -- minor cohort, unless no guardian has authority over them any more. The stored cohort never ages (it is set when a
  -- birthday is saved), so an 18-year-old can still carry a teen cohort: without the second test a switch the guardian
  -- left off would keep blocking them while nobody could change it (set_child_controls refuses once the link is out of force).
  SELECT public.age_cohort_of(_user) IN ('child_under_13', 'teen_13_15', 'teen_16_17')
     AND NOT private_sec.guardian_authority_ended(_user);
$$;
REVOKE ALL ON FUNCTION private_sec.guardian_switches_apply(uuid) FROM PUBLIC, anon, authenticated;

-- ============================================================ 2. the readers
CREATE OR REPLACE FUNCTION private_sec.is_guardian_of(_parent uuid, _child uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.guardian_links gl
    WHERE gl.parent_user_id = _parent AND gl.child_user_id = _child
      AND private_sec.guardian_link_in_force(gl.child_user_id, gl.status) AND gl.verified_at IS NOT NULL
  );
$function$;

CREATE OR REPLACE FUNCTION private_sec.child_game_participation_allowed(_user uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    -- A known adult with no guardian authority is never held by a switch a guardian left off (the stored cohort can lag).
    WHEN private_sec.guardian_authority_ended(_user) THEN true
    WHEN public.child_features_locked(_user) THEN false
    WHEN public.age_cohort_of(_user) = 'child_under_13' THEN
      COALESCE((SELECT game_participation FROM public.child_controls WHERE child_user_id = _user), false)
    WHEN public.is_minor(_user)
         AND EXISTS (SELECT 1 FROM public.guardian_links gl
                      WHERE gl.child_user_id = _user
                        AND private_sec.guardian_link_in_force(gl.child_user_id, gl.status)) THEN
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
            WHERE gl.child_user_id = _player
              AND private_sec.guardian_link_in_force(gl.child_user_id, gl.status)
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
      -- The stored cohort does not age. A known adult no guardian has authority over is a member like any adult, not a
      -- teen whose guardian link and messaging switch are required.
      IF private_sec.guardian_authority_ended(_user) THEN RETURN true; END IF;
      RETURN EXISTS (SELECT 1 FROM public.guardian_links g
                      WHERE g.child_user_id = _user AND private_sec.guardian_link_in_force(g.child_user_id, g.status)
                        AND g.verified_at IS NOT NULL)
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

CREATE OR REPLACE FUNCTION private_sec.ai_analysis_allowed(_user uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE guardian_ok boolean; own boolean;
BEGIN
  IF private_sec.guardian_switches_apply(_user) THEN
    SELECT ai_analysis INTO guardian_ok FROM public.child_controls WHERE child_user_id = _user;
    IF guardian_ok IS DISTINCT FROM true THEN RETURN false; END IF;
  END IF;
  SELECT ai_processing INTO own FROM public.privacy_preferences WHERE user_id = _user;
  RETURN COALESCE(own, true);
END $function$;

CREATE OR REPLACE FUNCTION public.clamp_ai_processing_for_minors()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE guardian_ok boolean;
BEGIN
  IF private_sec.guardian_switches_apply(NEW.user_id) THEN
    SELECT ai_analysis INTO guardian_ok FROM public.child_controls WHERE child_user_id = NEW.user_id;
    IF guardian_ok IS DISTINCT FROM true THEN
      NEW.ai_processing := false;
      NEW.ai_training_opt_in := false;
    END IF;
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.public_xp_enabled(_user uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE((SELECT c.public_xp FROM public.child_controls c WHERE c.child_user_id = _user), false)
     AND private_sec.guardian_switches_apply(_user)
     AND NOT public.child_features_locked(_user);
$function$;

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
  -- reachable through the shared-context fallbacks further down. They bind only while a guardian has authority:
  -- a known adult is not held by a messaging switch left over from the link that ended.
  IF private_sec.guardian_switches_apply(_a) THEN
    SELECT messaging INTO ctrl FROM public.child_controls WHERE child_user_id = _a;
    IF ctrl = 'off' THEN RETURN 'messaging_off:self'; END IF;
    IF ctrl = 'guardian_only' AND NOT public.is_guardian_of(_b, _a) THEN
      RETURN 'guardian_only:self';
    END IF;
    IF ctrl = 'teammates'
       AND NOT public.is_guardian_of(_b, _a)
       AND NOT public.shares_team(_a, _b) THEN RETURN 'teammates_only:self'; END IF;
  END IF;
  IF private_sec.guardian_switches_apply(_b) THEN
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
END $function$;

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
  WHERE gl.child_user_id = _child AND private_sec.guardian_link_in_force(gl.child_user_id, gl.status);
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
      SELECT parent_user_id AS g FROM public.guardian_links gl
       WHERE gl.child_user_id = _player AND private_sec.guardian_link_in_force(gl.child_user_id, gl.status)
         AND gl.verified_at IS NOT NULL
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
    WHERE gl.parent_user_id = auth.uid()
      AND private_sec.guardian_link_in_force(gl.child_user_id, gl.status)
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

-- The guardian who held an adult's consent record can no longer read it (the record itself is kept as history).
DROP POLICY "Linked parent reads child consent record" ON public.parental_consents;
CREATE POLICY "Linked parent reads child consent record" ON public.parental_consents
  FOR SELECT TO authenticated
  USING (parent_user_id = auth.uid() AND NOT private_sec.guardian_authority_ended(child_user_id));

-- ============================================================ 3. the record and the sweep
CREATE TABLE IF NOT EXISTS private_sec.guardian_link_age_events (
  child_user_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  parent_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind           text NOT NULL CHECK (kind IN ('ended', 'managed_notice')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (child_user_id, parent_user_id, kind)
);
ALTER TABLE private_sec.guardian_link_age_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private_sec.guardian_link_age_events FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON TABLE private_sec.guardian_link_age_events IS
  'Which guardian links the 18 sweep ended (kind ended) and which managing guardians it told (managed_notice). Not readable through the API. Lists exactly what a rollback would need to restore.';

CREATE OR REPLACE FUNCTION private_sec.end_adult_guardian_links(_limit integer DEFAULT 200)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _cap        integer := LEAST(GREATEST(COALESCE(_limit, 200), 1), 1000);
  r           record;
  _ended      integer := 0;
  _failed     integer := 0;
  _notices    integer := 0;
  _inserted   integer;
  _remaining  integer;
  _managed    integer;
  _name       text;
  _first      boolean;
BEGIN
  -- 1. Active links whose child is a known, unmanaged adult. Nothing else is selected, so nothing else can be touched.
  FOR r IN
    SELECT gl.id, gl.parent_user_id, gl.child_user_id
      FROM public.guardian_links gl
     WHERE gl.status = 'active'
       AND private_sec.guardian_authority_ended(gl.child_user_id)
     ORDER BY gl.created_at, gl.id
     LIMIT _cap
       FOR UPDATE OF gl SKIP LOCKED
  LOOP
    BEGIN
      -- The existing triggers write the family audit row ('link.revoked') and clear this guardian's approvals on
      -- requests that are not yet a place.
      UPDATE public.guardian_links SET status = 'revoked' WHERE id = r.id AND status = 'active';
      IF NOT FOUND THEN CONTINUE; END IF;
      _ended := _ended + 1;

      -- The adult is told once however many guardians they had and however the runs fell (the cap, or a locked row, can
      -- split one adult's guardians across runs): only when no link of theirs was recorded as ended before this one.
      _first := NOT EXISTS (SELECT 1 FROM private_sec.guardian_link_age_events e
                             WHERE e.child_user_id = r.child_user_id AND e.kind = 'ended');
      INSERT INTO private_sec.guardian_link_age_events (child_user_id, parent_user_id, kind)
      VALUES (r.child_user_id, r.parent_user_id, 'ended')
      ON CONFLICT DO NOTHING;
      GET DIAGNOSTICS _inserted = ROW_COUNT;

      -- The guardian is told once per child.
      IF _inserted = 1 THEN
        SELECT COALESCE(NULLIF(btrim(p.display_name), ''), 'Your family member') INTO _name
          FROM (SELECT 1) s LEFT JOIN public.profiles p ON p.id = r.child_user_id;
        INSERT INTO public.notifications (user_id, type, title, body, link)
        VALUES (r.parent_user_id, 'guardian_link', 'Family link ended',
                _name || ' is 18 or over, so your family link with them has ended. They no longer appear in your Parent Center.',
                '/parent');
        IF _first THEN
          INSERT INTO public.notifications (user_id, type, title, body, link)
          VALUES (r.child_user_id, 'guardian_link', 'Your family link has ended',
                  'You are 18 or over, so the link to your parent or guardian has ended. They can no longer see or change your account settings.',
                  '/settings');
        END IF;
        _notices := _notices + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      _failed := _failed + 1;   -- left active and still out of force in every reader; the next run tries again
      RAISE WARNING 'end_adult_guardian_links: link % not ended: %', r.id, SQLERRM;
    END;
  END LOOP;

  -- 2. Managed accounts that have turned 18: never ended here. Tell the managing guardian once.
  FOR r IN
    SELECT m.child_user_id, m.managed_by
      FROM public.managed_accounts m
     WHERE private_sec.is_known_adult(m.child_user_id)
       AND NOT EXISTS (SELECT 1 FROM private_sec.guardian_link_age_events e
                        WHERE e.child_user_id = m.child_user_id AND e.parent_user_id = m.managed_by
                          AND e.kind = 'managed_notice')
     ORDER BY m.created_at, m.child_user_id
     LIMIT _cap
  LOOP
    BEGIN
      INSERT INTO private_sec.guardian_link_age_events (child_user_id, parent_user_id, kind)
      VALUES (r.child_user_id, r.managed_by, 'managed_notice')
      ON CONFLICT DO NOTHING;
      GET DIAGNOSTICS _inserted = ROW_COUNT;
      IF _inserted = 1 THEN
        SELECT COALESCE(NULLIF(btrim(p.display_name), ''), 'Your family member') INTO _name
          FROM (SELECT 1) s LEFT JOIN public.profiles p ON p.id = r.child_user_id;
        INSERT INTO public.notifications (user_id, type, title, body, link)
        VALUES (r.managed_by, 'guardian_link', 'A managed account has turned 18',
                _name || ' is 18 or over. Their account has no sign-in of its own, so it stays linked to you for now. Contact support to plan handing it over.',
                '/parent');
        _notices := _notices + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      _failed := _failed + 1;
      RAISE WARNING 'end_adult_guardian_links: managed notice for % not sent: %', r.child_user_id, SQLERRM;
    END;
  END LOOP;

  SELECT count(*)::int INTO _remaining FROM public.guardian_links gl
   WHERE gl.status = 'active' AND private_sec.guardian_authority_ended(gl.child_user_id);
  SELECT count(*)::int INTO _managed FROM public.managed_accounts m WHERE private_sec.is_known_adult(m.child_user_id);

  RETURN jsonb_build_object('ended', _ended, 'notified', _notices, 'failed', _failed,
                            'remaining', _remaining, 'managed_waiting', _managed);
END $$;
REVOKE ALL ON FUNCTION private_sec.end_adult_guardian_links(integer) FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION private_sec.end_adult_guardian_links(integer) IS
  'Records status revoked on active guardian links whose child is a known, unmanaged adult (already out of force in every reader), tells both sides once, reports managed accounts that reached 18 (never ends them). Idempotent, capped per run. Scheduler or by hand.';

DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule('end-adult-guardian-links', '41 4 * * *',
      $j$SELECT private_sec.end_adult_guardian_links()$j$);
  ELSE
    RAISE NOTICE 'pg_cron is not installed: end-adult-guardian-links not scheduled (run private_sec.end_adult_guardian_links() by hand)';
  END IF;
EXCEPTION WHEN others THEN
  RAISE NOTICE 'end-adult-guardian-links not scheduled: %', SQLERRM;
END
$cron$;

-- ============================================================ 4. the same rule for server code and the app
CREATE OR REPLACE FUNCTION public.guardian_links_in_force(_children uuid[])
RETURNS TABLE (parent_user_id uuid, child_user_id uuid, verified_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT gl.parent_user_id, gl.child_user_id, gl.verified_at
    FROM public.guardian_links gl
   WHERE gl.child_user_id = ANY (_children)
     AND private_sec.guardian_link_in_force(gl.child_user_id, gl.status);
$$;
REVOKE ALL ON FUNCTION public.guardian_links_in_force(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guardian_links_in_force(uuid[]) TO service_role;
COMMENT ON FUNCTION public.guardian_links_in_force(uuid[]) IS
  'Server code only: the guardian links in force for these children (active, and the child not a known adult unless managed).';

CREATE OR REPLACE FUNCTION public.guardian_authority_has_ended(_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT private_sec.guardian_authority_ended(_user);
$$;
REVOKE ALL ON FUNCTION public.guardian_authority_has_ended(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guardian_authority_has_ended(uuid) TO service_role;
COMMENT ON FUNCTION public.guardian_authority_has_ended(uuid) IS
  'Server code only: true for a known adult who is not a managed account (no guardian has authority over them), so the stored teen cohort and the guardian''s child_controls switches no longer apply (push curfew).';

CREATE OR REPLACE FUNCTION public.my_guardian_link_in_force()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT auth.uid() IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.guardian_links gl
                  WHERE gl.child_user_id = auth.uid()
                    AND private_sec.guardian_link_in_force(gl.child_user_id, gl.status));
$$;
REVOKE ALL ON FUNCTION public.my_guardian_link_in_force() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.my_guardian_link_in_force() TO authenticated;
COMMENT ON FUNCTION public.my_guardian_link_in_force() IS
  'Whether the signed-in user has a guardian link in force (a minor with a linked guardian, or a managed account). Answers only about the caller.';

-- ============================================================ 5. a corrected birthday puts the links back
-- The sweep's end is a recorded status, so it is not undone by the rule the way an un-swept link is. A support-approved
-- birthday correction (review_birthday_correction writes profile_birthdays under openrun.birthday_review) can make a
-- user a minor again. Without this trigger that user would be left with no guardian link: no payment gate, approval,
-- participation switch, messaging switch or Parent Center, whereas before the sweep the rule alone would have brought
-- the link back. So the answer must not depend on whether the daily job ran first: when a birthday change leaves the
-- person not a known adult, the links the sweep ended for them (recorded in guardian_link_age_events) go back to active.
-- Fail closed: an unknown birthday also restores them. Only links the sweep recorded are touched, never one a guardian
-- ended by hand. Both sides are told. The events are cleared so a later 18th birthday ends and tells again.
CREATE OR REPLACE FUNCTION private_sec.restore_links_on_birthday_correction()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  r      record;
  _n     integer := 0;
  _name  text;
BEGIN
  IF NEW.birthday IS NOT DISTINCT FROM OLD.birthday THEN RETURN NULL; END IF;
  IF private_sec.is_known_adult(NEW.user_id) THEN RETURN NULL; END IF;

  SELECT COALESCE(NULLIF(btrim(p.display_name), ''), 'Your family member') INTO _name
    FROM (SELECT 1) s LEFT JOIN public.profiles p ON p.id = NEW.user_id;

  FOR r IN
    UPDATE public.guardian_links gl SET status = 'active'
      FROM private_sec.guardian_link_age_events e
     WHERE e.kind = 'ended' AND e.child_user_id = NEW.user_id
       AND gl.child_user_id = e.child_user_id AND gl.parent_user_id = e.parent_user_id
       AND gl.status = 'revoked'
    RETURNING gl.parent_user_id
  LOOP
    _n := _n + 1;
    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (r.parent_user_id, 'guardian_link', 'Family link restored',
            _name || '''s date of birth on file was corrected, so your family link with them is back.',
            '/parent');
  END LOOP;

  DELETE FROM private_sec.guardian_link_age_events WHERE child_user_id = NEW.user_id;

  IF _n > 0 THEN
    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (NEW.user_id, 'guardian_link', 'Your family link is back',
            'Your date of birth on file was corrected, so the link to your parent or guardian is back.',
            '/settings');
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION private_sec.restore_links_on_birthday_correction() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_birthday_correction_restores_links ON public.profile_birthdays;
CREATE TRIGGER trg_birthday_correction_restores_links
  AFTER UPDATE OF birthday ON public.profile_birthdays
  FOR EACH ROW WHEN (OLD.birthday IS DISTINCT FROM NEW.birthday)
  EXECUTE FUNCTION private_sec.restore_links_on_birthday_correction();
