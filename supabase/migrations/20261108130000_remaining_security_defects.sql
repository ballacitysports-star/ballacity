-- SEC-7 (Approval E): remaining security defects from the R7, SEC-1 and PAY-1 final reviews. Applied after every other release migration.
--
--  1. Unknown age no longer counts as "not a minor" for participation. Sign-up always asks for a date of birth (the root age gate, and
--     provision_managed_child requires one), so an account without one is a legacy account: it must declare an age before it joins a game or a
--     team, whoever asks for it (the player, a host approving a request, a guardian approving an invite, the service role). Organization
--     administrators can add only an account with a declared adult age. team_invite_player already treated unknown age as a minor.
--  2. After coarsening activation a blank location (or the coarse value sent back) on a youth game is not a change, so an older client can no
--     longer wipe the only exact copy in hosted_game_private. A host removes a location explicitly with clear_hosted_game_location.
--  3. get_game_host_payment_methods no longer returns a guardian payee's handles for a minor-hosted game to anyone who can see the listing: only
--     the host, the payee, an approved requester, a participant, their verified guardian, or staff. Paid minor-hosted games therefore always
--     require approval before payment (forced on their settings, existing rows included), so the pay flow is request -> approval -> pay.
--  4. The host-to-participant messaging context ends 30 days after a server-kept anchor (public.game_contact_windows), not after the editable
--     date: the anchor follows the game's end while the game is still upcoming, and is frozen once that time has passed or the game is completed
--     or cancelled. Editing the date of a past game no longer extends messaging.
--  5. guardian_reapprove_team_membership lets a current verified guardian re-approve a child's existing team membership in place (after a
--     guardian change the old approval no longer counts and a new invite fails with ALREADY_MEMBER); audited in family_audit_log, the child's
--     guardians are notified. guardian_team_reapprovals lists the memberships waiting for it (Guardian page).
-- Items 6 (moderator evidence) and 7 (account purge of image-staging) are application changes. See docs/privacy/sec7-remaining-defects.md.
-- Final review (780eaf8f) corrections, marked "SEC-7 final review (n)" where they apply; section 6 at the end holds the new definitions:
--  (1) an accepted teen-to-teen contact request counts only while the recipient still has a verified guardian, peers messaging and the sender's
--      age band, and a guardian's approval re-checks those; (2) the messaging-window anchor freezes for good (frozen_at), a cancelled game is no
--      context, postponements move the anchor at most 30 days past the original, and a client cannot clear cancelled_at / completed_at;
--  (3) re-approving a membership needs a declared age; (4) revoke_parental_consent checks authorization before looking anything up;
--  (5) team_invite_player answers a manager the same way for a blocked, an adult and a minor invitee (a blocked one is written but suppressed),
--      and invitees and guardians read invitations through team_invites_inbox(), which never shows a non-adult free text;
--  (6) a caller who is not a confirmed adult gets no age-derived refusal reason; (8) no privacy row means 'private', and profile_ages shows a
--      non-adult's age only to them, their guardian or staff; (9) a blank or coarse save never overwrites the exact copy of a youth game;
--  (10) the dependency guard checks PAY-1; (11) the requires_approval backfill no longer trips the payment-mode check on legacy rows.
--  (7) is an application change (notification server functions).
-- Definitions are taken from the integration base (c637ec5e) by pg_get_functiondef of a replayed database. Forward-only.

DO $guard$ BEGIN
  IF to_regprocedure('private_sec.messaging_connection(uuid,uuid)') IS NULL OR to_regprocedure('private_sec.team_membership_authorizes(text,uuid)') IS NULL
     OR to_regprocedure('private_sec.game_payee(text)') IS NULL OR to_regprocedure('private_sec.age_verified(uuid)') IS NULL
     OR to_regprocedure('private_sec.is_minor(uuid)') IS NULL OR to_regprocedure('private_sec.child_game_participation_allowed(uuid)') IS NULL
     OR to_regprocedure('public.sync_hosted_game_private()') IS NULL OR to_regprocedure('private_sec.coarse_game_label(text)') IS NULL
     OR to_regprocedure('public.clear_team_post_venue(uuid,text[])') IS NULL OR to_regprocedure('public.guardian_approve_team_invite(uuid,boolean)') IS NULL
     OR to_regprocedure('public.team_respond_invite(uuid,boolean)') IS NULL OR to_regprocedure('public.get_game_host_payment_methods(uuid,text)') IS NULL
     OR to_regclass('public.location_report_evidence') IS NULL OR to_regclass('public.family_audit_log') IS NULL
     -- SEC-7 final review (10): PAY-1 is named below, so check it (item 3 relies on its payee and payment-settings helpers)
     OR to_regprocedure('private_sec.is_game_host(text)') IS NULL OR to_regprocedure('private_sec.can_read_game_payment_settings(text,uuid)') IS NULL THEN
    RAISE EXCEPTION 'SEC-7: a required earlier release migration (SEC-1, SEC-2, R7, PAY-1) has not been applied';
  END IF;
END $guard$;

-- ============================================================================================================ 1. unknown age fails closed
CREATE OR REPLACE FUNCTION private_sec.child_game_participation_allowed(_user uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN public.child_features_locked(_user) THEN false
    -- SEC-7: no declared age, no participation (unknown age used to fall through to "true")
    WHEN NOT private_sec.age_verified(_user) THEN false
    WHEN public.age_cohort_of(_user) = 'child_under_13' THEN
      COALESCE((SELECT game_participation FROM public.child_controls WHERE child_user_id = _user), false)
    WHEN public.is_minor(_user)
         AND EXISTS (SELECT 1 FROM public.guardian_links gl
                      WHERE gl.child_user_id = _user AND gl.status = 'active') THEN
      COALESCE((SELECT game_participation FROM public.child_controls WHERE child_user_id = _user), true)
    ELSE true
  END;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_child_game_participation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE subject uuid;
BEGIN
  IF TG_TABLE_NAME = 'join_requests' THEN
    subject := NEW.player_id;
  ELSE
    subject := NEW.user_id;
  END IF;
  subject := COALESCE(subject, auth.uid());

  -- SEC-7: a declared age is required whoever writes the row (the player, a host approving a request, a guardian, the service role);
  -- previously only the player's own write was checked and unknown age then passed as "not a minor".
  IF subject IS NOT NULL AND NOT private_sec.age_verified(subject) THEN
    IF subject = auth.uid() THEN
      RAISE EXCEPTION 'AGE_VERIFICATION_REQUIRED: add your date of birth before joining games.';
    END IF;
    RAISE EXCEPTION 'AGE_VERIFICATION_REQUIRED: this player must add their date of birth before joining games.';
  END IF;
  IF subject IS NOT NULL AND NOT public.child_game_participation_allowed(subject) THEN
    RAISE EXCEPTION 'CHILD_GAME_PARTICIPATION_BLOCKED: a parent or guardian must approve this account and allow game participation.';
  END IF;

  -- NEW: per-request guardian approval, game_participants only — the actual
  -- grant of participation. join_requests itself (the pending ask) stays
  -- ungated, so there's something for the guardian to approve in the first
  -- place; the inner EXISTS also means a non-approval-queue game's direct
  -- self-serve join (no join_requests row at all) is untouched by this.
  IF TG_TABLE_NAME = 'game_participants'
     AND subject IS NOT NULL
     AND public.is_minor(subject)
     AND EXISTS (SELECT 1 FROM public.guardian_links WHERE child_user_id = subject AND status = 'active')
     AND EXISTS (SELECT 1 FROM public.join_requests jr WHERE jr.game_id = NEW.game_id AND jr.player_id = subject)
     AND NOT EXISTS (
       SELECT 1 FROM public.join_requests jr
       WHERE jr.game_id = NEW.game_id AND jr.player_id = subject AND jr.guardian_approved_at IS NOT NULL
     )
  THEN
    RAISE EXCEPTION 'GUARDIAN_APPROVAL_REQUIRED: a parent or guardian must approve this join request first.';
  END IF;

  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.team_respond_invite(_invite uuid, _accept boolean)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _me uuid := auth.uid();
  _row public.team_invites;
  _team_name text;
  _who text;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  SELECT * INTO _row FROM public.team_invites WHERE id = _invite;
  IF _row.id IS NULL THEN RAISE EXCEPTION 'INVITE_NOT_FOUND'; END IF;
  IF _row.invitee_id <> _me THEN RAISE EXCEPTION 'NOT_INVITEE'; END IF;
  -- SEC-7 final review (5): an invitation written for a manager the invitee blocked (or who blocked them) does not exist for the invitee
  IF EXISTS (SELECT 1 FROM public.team_invite_suppressions s WHERE s.invite_id = _invite) THEN RAISE EXCEPTION 'INVITE_NOT_FOUND'; END IF;
  IF _row.status <> 'pending' THEN RAISE EXCEPTION 'INVITE_NOT_PENDING'; END IF;
  IF _row.expires_at <= now() THEN
    UPDATE public.team_invites SET status = 'expired', updated_at = now() WHERE id = _invite;
    RAISE EXCEPTION 'INVITE_EXPIRED';
  END IF;

  IF _accept AND public.child_features_locked(_me) THEN
    RAISE EXCEPTION 'CHILD_ACTIVITY_LOCKED';
  END IF;

  -- SEC-7: unknown age is not "not a minor": joining needs a declared age (declining stays open)
  IF _accept AND NOT private_sec.age_verified(_me) THEN
    RAISE EXCEPTION 'AGE_VERIFICATION_REQUIRED: add your date of birth before joining a team.';
  END IF;

  -- NEW: guardian approval, for any minor with an active guardian link
  -- (managed or self-operating alike — see verification doc for why this
  -- is a same-actor double-confirmation for a managed child, not a gap).
  IF _accept
     AND public.is_minor(_me)
     AND EXISTS (SELECT 1 FROM public.guardian_links WHERE child_user_id = _me AND status = 'active')
     AND _row.guardian_approved_at IS NULL THEN
    RAISE EXCEPTION 'GUARDIAN_APPROVAL_REQUIRED: a parent or guardian must approve this invite first.';
  END IF;

  -- NEW: waiver signature, for everyone, only when the team has a
  -- currently published one. Declining stays ungated in both new checks —
  -- only joining needs either gate.
  IF _accept AND EXISTS (
    SELECT 1 FROM public.team_waivers w
    WHERE w.team_id = _row.team_id AND w.published
      AND NOT EXISTS (
        SELECT 1 FROM public.team_waiver_signatures s
        WHERE s.waiver_id = w.id AND s.signer_user_id = _me
      )
  ) THEN
    RAISE EXCEPTION 'WAIVER_REQUIRED: this team requires a signed waiver before you can join.';
  END IF;

  SELECT name INTO _team_name FROM public.teams WHERE id = _row.team_id;
  SELECT coalesce(display_name, username, 'A player') INTO _who FROM public.profiles WHERE id = _me;

  IF _accept THEN
    INSERT INTO public.team_members (team_id, user_id, role)
    VALUES (_row.team_id, _me, _row.role)
    ON CONFLICT (team_id, user_id) DO UPDATE SET role = excluded.role, updated_at = now();
    UPDATE public.team_invites SET status = 'accepted', responded_at = now(), updated_at = now()
    WHERE id = _invite;
  ELSE
    UPDATE public.team_invites SET status = 'declined', responded_at = now(), updated_at = now()
    WHERE id = _invite;
  END IF;

  INSERT INTO public.notifications (user_id, type, title, body, link)
  SELECT m.user_id,
         CASE WHEN _accept THEN 'team_invite_accepted' ELSE 'team_invite_declined' END,
         CASE WHEN _accept THEN 'Invitation accepted' ELSE 'Invitation declined' END,
         _who || CASE WHEN _accept THEN ' joined ' ELSE ' declined the invite to ' END
           || coalesce(_team_name, 'your team'),
         '/teams/' || _row.team_id
  FROM public.team_members m
  WHERE m.team_id = _row.team_id AND m.role IN ('owner','manager','coach') AND m.user_id <> _me;

  RETURN CASE WHEN _accept THEN 'accepted' ELSE 'declined' END;
END $function$;

CREATE OR REPLACE FUNCTION public.guardian_approve_team_invite(_invite uuid, _approve boolean DEFAULT true)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _me uuid := auth.uid();
  _row public.team_invites;
  _team_name text;
  _who text;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  SELECT * INTO _row FROM public.team_invites WHERE id = _invite;
  IF _row.id IS NULL THEN RAISE EXCEPTION 'INVITE_NOT_FOUND'; END IF;
  IF NOT public.is_guardian_of(_me, _row.invitee_id) THEN RAISE EXCEPTION 'NOT_GUARDIAN'; END IF;
  -- SEC-7 final review (5): nor for their guardians
  IF EXISTS (SELECT 1 FROM public.team_invite_suppressions s WHERE s.invite_id = _invite) THEN RAISE EXCEPTION 'INVITE_NOT_FOUND'; END IF;
  IF _row.status <> 'pending' THEN RAISE EXCEPTION 'INVITE_NOT_PENDING'; END IF;

  IF NOT _approve THEN
    UPDATE public.team_invites
       SET status = 'declined', responded_at = now(), updated_at = now()
     WHERE id = _invite AND status = 'pending';
    RETURN;
  END IF;

  IF _row.expires_at <= now() THEN
    UPDATE public.team_invites SET status = 'expired', updated_at = now() WHERE id = _invite;
    RAISE EXCEPTION 'INVITE_EXPIRED';
  END IF;
  IF public.child_features_locked(_row.invitee_id) THEN
    RAISE EXCEPTION 'CHILD_ACTIVITY_LOCKED';
  END IF;
  -- SEC-7: a team membership needs a declared age (age-dependent rules such as reel audience and messaging read it)
  IF NOT private_sec.age_verified(_row.invitee_id) THEN
    RAISE EXCEPTION 'AGE_VERIFICATION_REQUIRED: your player must add their date of birth before joining a team.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.team_waivers w
    WHERE w.team_id = _row.team_id AND w.published
      AND NOT EXISTS (
        SELECT 1 FROM public.team_waiver_signatures s
        WHERE s.waiver_id = w.id AND s.signer_user_id = _row.invitee_id
      )
  ) THEN
    RAISE EXCEPTION 'WAIVER_REQUIRED: this team requires a signed waiver before you can join.';
  END IF;

  INSERT INTO public.team_members (team_id, user_id, role)
  VALUES (_row.team_id, _row.invitee_id, _row.role)
  ON CONFLICT (team_id, user_id) DO UPDATE SET role = excluded.role, updated_at = now();

  UPDATE public.team_invites
     SET guardian_approved_at = now(), guardian_approved_by = _me,
         status = 'accepted', responded_at = now(), updated_at = now()
   WHERE id = _invite AND status = 'pending';

  SELECT name INTO _team_name FROM public.teams WHERE id = _row.team_id;
  SELECT coalesce(display_name, username, 'A player') INTO _who FROM public.profiles WHERE id = _row.invitee_id;

  INSERT INTO public.notifications (user_id, type, title, body, link)
  VALUES (_row.invitee_id, 'team_invite_guardian_approved', 'You joined ' || coalesce(_team_name, 'the team'),
          'Your parent or guardian approved your invite.', '/teams/' || _row.team_id);

  INSERT INTO public.notifications (user_id, type, title, body, link)
  SELECT m.user_id, 'team_invite_accepted', 'Invitation accepted',
         _who || ' joined ' || coalesce(_team_name, 'your team') || ' (guardian approved)',
         '/teams/' || _row.team_id
  FROM public.team_members m
  WHERE m.team_id = _row.team_id AND m.role IN ('owner','manager','coach') AND m.user_id <> _row.invitee_id;
END;
$function$;

-- Organization administrators may add only an account with a declared ADULT age (same rule as team_members_manager_write).
DROP POLICY IF EXISTS "Admins can insert org members" ON public.org_members;
CREATE POLICY "Admins can insert org members" ON public.org_members FOR INSERT TO authenticated
  WITH CHECK (private_sec.is_trainer_org_admin(org_id, auth.uid()) AND private_sec.age_verified(user_id) AND NOT private_sec.is_minor(user_id));

-- ============================================================================================ 2. blank saves never wipe a youth game's exact location
CREATE OR REPLACE FUNCTION public.sync_hosted_game_private()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _youth boolean := NOT public.game_age_range_is_adult_only(NEW.min_age, NEW.max_age);
  _was_youth boolean;
  _changed boolean;
  _coarsen boolean := COALESCE(
    (SELECT (value ->> 'coarsen')::boolean FROM public.app_settings WHERE key = 'youth_location_privacy'), false);
  _existing boolean := COALESCE(current_setting('app.coarsening_existing', true), '') = '1';
  _p public.hosted_game_private%ROWTYPE;
  _looks_coarse boolean;
  _after_activation boolean := false;   -- a youth game staying youth after activation: the public columns are coarse, the private copy is the only exact one
  _c_loc boolean := true; _c_lat boolean := true; _c_lng boolean := true;
  _old_coarse text;
  _keep_loc boolean := false;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    _old_coarse := private_sec.coarse_game_label(OLD.neighborhood);
    _was_youth := NOT public.game_age_range_is_adult_only(OLD.min_age, OLD.max_age);
    _c_loc := NEW.location IS DISTINCT FROM OLD.location;
    _c_lat := NEW.lat IS DISTINCT FROM OLD.lat;
    _c_lng := NEW.lng IS DISTINCT FROM OLD.lng;
    _after_activation := _coarsen AND _youth AND _was_youth AND NOT _existing;
    -- SEC-7: after activation a blank location, or the coarse label sent back, is not a change (the same rule as team facilities and posts);
    -- missing coordinates are not a change either unless the location itself changed (a new address that could not be geocoded). The public
    -- columns keep their coarse values. Removing a location is explicit: clear_hosted_game_location.
    IF _after_activation THEN
      IF NULLIF(btrim(COALESCE(NEW.location, '')), '') IS NULL
         OR NEW.location = private_sec.coarse_game_label(NEW.neighborhood)
         OR NEW.location = private_sec.coarse_game_label(OLD.neighborhood) THEN
        _c_loc := false;
        NEW.location := OLD.location;
      END IF;
      IF NEW.lat IS NULL AND NOT _c_loc THEN _c_lat := false; NEW.lat := OLD.lat; END IF;
      IF NEW.lng IS NULL AND NOT _c_loc THEN _c_lng := false; NEW.lng := OLD.lng; END IF;
    END IF;
    _changed := _c_loc OR _c_lat OR _c_lng;
  ELSE
    _was_youth := false;
    _changed := true;
  END IF;

  IF NOT _youth THEN
    -- Adult-only: exact values live in hosted_games. Restore them if the game was youth-inclusive.
    IF TG_OP = 'UPDATE' AND _was_youth AND NOT _changed AND NOT _coarsen THEN
      SELECT * INTO _p FROM public.hosted_game_private WHERE game_id = NEW.id;
      IF FOUND THEN
        NEW.location := _p.location; NEW.lat := _p.lat; NEW.lng := _p.lng;
      END IF;
    END IF;
    -- after activation the private copy is kept and the public columns stay coarse: widening the age range can never publish the exact venue
    IF TG_OP = 'UPDATE' AND NOT _coarsen THEN DELETE FROM public.hosted_game_private WHERE game_id = NEW.id; END IF;
    RETURN NEW;
  END IF;

  IF _after_activation THEN
    -- Write only the columns this statement changed: an unchanged column holds the coarse value, never the exact one.
    IF _changed THEN
      INSERT INTO public.hosted_game_private AS x (game_id, location, lat, lng)
      VALUES (NEW.id, CASE WHEN _c_loc THEN NEW.location END, CASE WHEN _c_lat THEN NEW.lat END, CASE WHEN _c_lng THEN NEW.lng END)
      ON CONFLICT (game_id) DO UPDATE
        SET location = CASE WHEN _c_loc THEN EXCLUDED.location ELSE x.location END,
            lat      = CASE WHEN _c_lat THEN EXCLUDED.lat      ELSE x.lat      END,
            lng      = CASE WHEN _c_lng THEN EXCLUDED.lng      ELSE x.lng      END,
            updated_at = now();
    END IF;
  ELSE
    -- Youth-inclusive: store the submitted values as the exact location (see the header), unless they
    -- ARE the coarse form (an operator's coarsening update, or a client that sent back what it was
    -- given): a coarse value must never be stored as the exact one.
    _looks_coarse := NEW.location IS NOT DISTINCT FROM private_sec.coarse_game_label(NEW.neighborhood)
                     AND NEW.lat IS NOT DISTINCT FROM round(NEW.lat, 2)
                     AND NEW.lng IS NOT DISTINCT FROM round(NEW.lng, 2);
    IF (_changed OR (TG_OP = 'UPDATE' AND NOT _was_youth))
       AND NOT _looks_coarse
       AND NOT _existing THEN
      -- SEC-7 final review (9): after activation the private copy may be the only exact one (an adult-only interval keeps it and leaves the
      -- public columns as they were), so whatever the age-range transition a blank or coarse value never replaces a stored one, and missing
      -- coordinates replace a stored point only together with a new location (an address that could not be geocoded).
      IF _coarsen THEN
        SELECT * INTO _p FROM public.hosted_game_private WHERE game_id = NEW.id;
        IF FOUND THEN
          _keep_loc := _p.location IS NOT NULL
                       AND (NULLIF(btrim(COALESCE(NEW.location, '')), '') IS NULL
                            OR NEW.location = private_sec.coarse_game_label(NEW.neighborhood)
                            OR NEW.location IS NOT DISTINCT FROM _old_coarse
                            OR NEW.location = _p.location);
          IF _keep_loc THEN NEW.location := _p.location; END IF;
          IF _p.lat IS NOT NULL AND ((NEW.lat IS NULL AND _keep_loc) OR NEW.lat = round(_p.lat, 2)) THEN NEW.lat := _p.lat; END IF;
          IF _p.lng IS NOT NULL AND ((NEW.lng IS NULL AND _keep_loc) OR NEW.lng = round(_p.lng, 2)) THEN NEW.lng := _p.lng; END IF;
        END IF;
      END IF;
      INSERT INTO public.hosted_game_private (game_id, location, lat, lng)
      VALUES (NEW.id, NEW.location, NEW.lat, NEW.lng)
      ON CONFLICT (game_id) DO UPDATE
        SET location = EXCLUDED.location, lat = EXCLUDED.lat, lng = EXCLUDED.lng, updated_at = now();
    END IF;
  END IF;

  IF _coarsen AND NOT _existing
     AND (TG_OP = 'INSERT' OR _changed OR NOT _was_youth
                   OR (TG_OP = 'UPDATE' AND NEW.neighborhood IS DISTINCT FROM OLD.neighborhood)) THEN
    NEW.location := private_sec.coarse_game_label(NEW.neighborhood);
    NEW.lat := round(NEW.lat, 2);
    NEW.lng := round(NEW.lng, 2);
  END IF;
  RETURN NEW;
END $function$;

-- The host removes a game's location deliberately. The text becomes 'TBD' (hosted_games.location is NOT NULL; 'TBD' is what a new game
-- without a location gets) and the coordinates are removed, in the exact copy and in the public columns.
CREATE OR REPLACE FUNCTION public.clear_hosted_game_location(_game text, _fields text[] DEFAULT ARRAY['location'::text, 'lat'::text, 'lng'::text])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _host uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in to change this game.' USING ERRCODE = '42501'; END IF;
  SELECT g.host_id INTO _host FROM public.hosted_games g WHERE g.id = _game;
  IF NOT FOUND OR _host IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Only the game''s host can change its location.' USING ERRCODE = '42501';
  END IF;
  IF _fields IS NULL OR cardinality(_fields) = 0
     OR EXISTS (SELECT 1 FROM unnest(_fields) f WHERE f IS NULL OR f NOT IN ('location', 'lat', 'lng')) THEN
    RAISE EXCEPTION 'Unknown location field.' USING ERRCODE = '22023';
  END IF;
  UPDATE public.hosted_game_private SET
    location = CASE WHEN 'location' = ANY (_fields) THEN NULL ELSE location END,
    lat      = CASE WHEN 'lat'      = ANY (_fields) THEN NULL ELSE lat END,
    lng      = CASE WHEN 'lng'      = ANY (_fields) THEN NULL ELSE lng END,
    updated_at = now()
   WHERE game_id = _game;
  PERFORM set_config('app.coarsening_existing', '1', true);        -- the public columns are cleared too, without re-copying
  UPDATE public.hosted_games SET
    location = CASE WHEN 'location' = ANY (_fields) THEN 'TBD' ELSE location END,
    lat      = CASE WHEN 'lat'      = ANY (_fields) THEN NULL ELSE lat END,
    lng      = CASE WHEN 'lng'      = ANY (_fields) THEN NULL ELSE lng END
   WHERE id = _game;
  PERFORM set_config('app.coarsening_existing', '', true);
END $function$;
REVOKE ALL ON FUNCTION public.clear_hosted_game_location(text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clear_hosted_game_location(text, text[]) TO authenticated, service_role;

-- ============================================================================== 3. a guardian payee's handles are for involved people only
CREATE OR REPLACE FUNCTION public.get_game_host_payment_methods(_host_id uuid, _game_id text)
 RETURNS TABLE(id uuid, host_id uuid, payment_type text, label text, username text, payment_url text, contact_info text, instructions text, is_enabled boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _settings public.game_payment_settings%ROWTYPE;
  _me uuid := auth.uid();
BEGIN
  IF _me IS NULL THEN RETURN; END IF;
  IF public.age_cohort_of(_host_id) IS DISTINCT FROM 'adult' THEN RETURN; END IF;
  IF _host_id IS DISTINCT FROM private_sec.game_payee(_game_id) THEN RETURN; END IF;
  -- PAY-1: someone who can see the listing, or who is involved with the game (host, payee, approved requester, participant, or their guardian).
  -- SEC-7: for a game whose host is not a confirmed adult the payee is a guardian or an organization administrator whose handles often carry
  -- a real name: seeing the listing is not enough there, only involvement (or staff) is.
  IF NOT EXISTS (SELECT 1 FROM public.hosted_games g WHERE g.id = _game_id
                  AND ((NOT COALESCE(g.is_private, false) AND g.hidden_at IS NULL AND public.age_cohort_of(g.host_id) = 'adult')
                       OR g.host_id = _me OR _me = _host_id
                       OR private_sec.is_moderator(_me) OR private_sec.is_superadmin(_me)
                       OR EXISTS (SELECT 1 FROM public.join_requests jr WHERE jr.game_id = g.id AND jr.status = 'approved'   -- a self-made request is not involvement
                                   AND (jr.player_id = _me OR public.is_guardian_of(_me, jr.player_id)))
                       OR EXISTS (SELECT 1 FROM public.game_participants gp WHERE gp.game_id = g.id
                                   AND (gp.user_id = _me OR public.is_guardian_of(_me, gp.user_id))))) THEN
    RETURN;
  END IF;

  SELECT * INTO _settings FROM public.game_payment_settings gps
   WHERE gps.game_id = _game_id AND gps.host_id = _host_id
   ORDER BY gps.created_at DESC LIMIT 1;
  IF _settings.id IS NULL THEN RETURN; END IF;

  RETURN QUERY
    SELECT hpm.id, hpm.host_id, hpm.payment_type, hpm.label, hpm.username, hpm.payment_url, hpm.contact_info, hpm.instructions, hpm.is_enabled
    FROM public.host_payment_methods hpm
    WHERE hpm.host_id = _host_id
      AND hpm.is_enabled = true
      AND (COALESCE(array_length(_settings.accepted_method_ids, 1), 0) = 0 OR hpm.id = ANY(_settings.accepted_method_ids));
END;
$function$;

-- A paid game hosted by someone who is not a confirmed adult always needs approval before payment: a player first asks to join, and only an
-- approved requester sees where to pay (above). Applies to every writer; existing rows are brought in line below.
CREATE OR REPLACE FUNCTION public.require_approval_for_minor_hosted_payment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF (COALESCE(NEW.entry_fee, 0) > 0 OR NEW.payment_mode = 'ballacity_processed')
     AND EXISTS (SELECT 1 FROM public.hosted_games g WHERE g.id = NEW.game_id AND COALESCE(public.age_cohort_of(g.host_id), 'unknown') <> 'adult') THEN
    NEW.requires_approval := true;
  END IF;
  RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION public.require_approval_for_minor_hosted_payment() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS z_minor_hosted_payment_approval_trg ON public.game_payment_settings;
CREATE TRIGGER z_minor_hosted_payment_approval_trg BEFORE INSERT OR UPDATE ON public.game_payment_settings
  FOR EACH ROW EXECUTE FUNCTION public.require_approval_for_minor_hosted_payment();
-- SEC-7 final review (11): enforce_direct_host_payment_mode raised on ANY write of a row whose mode is 'ballacity_processed' while that mode is
-- switched off, so the backfill below aborted the migration on a legacy row. Choosing the mode (an insert, or a change of mode) is what the
-- switch gates; other updates of an existing legacy row go through. Otherwise unchanged (definition from the integration base).
CREATE OR REPLACE FUNCTION public.enforce_direct_host_payment_mode()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  enabled boolean := false;
  _choosing boolean := true;
BEGIN
  IF NEW.payment_mode IS NULL THEN
    NEW.payment_mode := 'direct_host';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    _choosing := NEW.payment_mode IS DISTINCT FROM OLD.payment_mode;
  END IF;

  IF NEW.payment_mode = 'ballacity_processed' AND _choosing THEN
    SELECT COALESCE((value->>'ballacityProcessedPaymentsEnabled')::boolean, false)
      INTO enabled
      FROM public.app_settings
     WHERE key = 'monetization';

    IF NOT COALESCE(enabled, false) THEN
      RAISE EXCEPTION 'ballaCity does not process game payments yet — hosts collect directly';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

UPDATE public.game_payment_settings s SET requires_approval = true
 WHERE NOT COALESCE(s.requires_approval, false)
   AND (COALESCE(s.entry_fee, 0) > 0 OR s.payment_mode = 'ballacity_processed')
   AND EXISTS (SELECT 1 FROM public.hosted_games g WHERE g.id = s.game_id AND COALESCE(public.age_cohort_of(g.host_id), 'unknown') <> 'adult');

-- ============================================================================= 4. the game messaging window is anchored to a server-kept time
-- One row per game, server-only (row security on, no policies, no client grants). anchor_at starts as the game's end (ends_at, else date) and
-- follows the game's end only while the game is still upcoming; after that it never moves.
-- SEC-7 final review (2): the host can write status, cancelled_at and completed_at directly ("Hosts can update their games"), so a freeze that
-- read only the game's current state could be undone by reverting it first. frozen_at is set, permanently, the first time the game is seen
-- cancelled, completed or past its anchor; a frozen row never moves again. Postponing an upcoming game moves the anchor at most 30 days past
-- original_anchor_at (the end the game was created with): a game postponed further gets no extra messaging time; the context ends 30 days
-- after that capped anchor, and the host and the participant can reconnect through a later game or a team. A client also cannot clear
-- cancelled_at or completed_at (no flow in the app does; moderators restore a game through its status).
CREATE TABLE IF NOT EXISTS public.game_contact_windows (
  game_id text PRIMARY KEY REFERENCES public.hosted_games(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  anchor_at timestamptz NOT NULL,
  original_anchor_at timestamptz NOT NULL,
  frozen_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.game_contact_windows ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.game_contact_windows FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.game_contact_windows TO service_role;

CREATE OR REPLACE FUNCTION public.track_game_contact_window()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  _w public.game_contact_windows%ROWTYPE;
  _ended boolean;
  _end timestamptz;
BEGIN
  IF TG_OP = 'INSERT' THEN
    _end := COALESCE(NEW.ends_at, NEW.date);
    INSERT INTO public.game_contact_windows (game_id, anchor_at, original_anchor_at, frozen_at)
    VALUES (NEW.id, _end, _end,
            CASE WHEN NEW.cancelled_at IS NOT NULL OR NEW.completed_at IS NOT NULL OR COALESCE(NEW.status, '') IN ('completed', 'cancelled')
                 THEN now() END)
    ON CONFLICT (game_id) DO NOTHING;
    RETURN NULL;
  END IF;
  IF NOT (NEW.date IS DISTINCT FROM OLD.date OR NEW.ends_at IS DISTINCT FROM OLD.ends_at OR NEW.status IS DISTINCT FROM OLD.status
          OR NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at OR NEW.completed_at IS DISTINCT FROM OLD.completed_at) THEN
    RETURN NULL;
  END IF;
  -- either side of the statement counts: cancelling and moving the date in one write freezes without moving
  _ended := COALESCE(OLD.status, '') IN ('completed', 'cancelled') OR COALESCE(NEW.status, '') IN ('completed', 'cancelled')
            OR OLD.cancelled_at IS NOT NULL OR NEW.cancelled_at IS NOT NULL OR OLD.completed_at IS NOT NULL OR NEW.completed_at IS NOT NULL;
  SELECT * INTO _w FROM public.game_contact_windows w WHERE w.game_id = NEW.id FOR UPDATE;
  IF NOT FOUND THEN
    -- a game written with triggers off: the earlier of the old and the new end is the conservative anchor
    _end := LEAST(COALESCE(OLD.ends_at, OLD.date), COALESCE(NEW.ends_at, NEW.date));
    INSERT INTO public.game_contact_windows (game_id, anchor_at, original_anchor_at, frozen_at)
    VALUES (NEW.id, _end, _end, CASE WHEN _ended OR _end <= now() THEN now() END)
    ON CONFLICT (game_id) DO NOTHING;
    RETURN NULL;
  END IF;
  IF _w.frozen_at IS NOT NULL THEN RETURN NULL; END IF;
  IF _ended OR _w.anchor_at <= now() THEN
    UPDATE public.game_contact_windows SET frozen_at = now(), updated_at = now() WHERE game_id = NEW.id;
    RETURN NULL;
  END IF;
  _end := LEAST(COALESCE(NEW.ends_at, NEW.date), _w.original_anchor_at + interval '30 days');
  IF _end IS DISTINCT FROM _w.anchor_at THEN
    UPDATE public.game_contact_windows SET anchor_at = _end, updated_at = now() WHERE game_id = NEW.id;
  END IF;
  RETURN NULL;
END $function$;
REVOKE ALL ON FUNCTION public.track_game_contact_window() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS zz_track_game_contact_window_trg ON public.hosted_games;
CREATE TRIGGER zz_track_game_contact_window_trg AFTER INSERT OR UPDATE ON public.hosted_games
  FOR EACH ROW EXECUTE FUNCTION public.track_game_contact_window();
-- existing games: the current end is the best record there is (an earlier extension cannot be detected); a game already cancelled, completed
-- or over is frozen now
INSERT INTO public.game_contact_windows (game_id, anchor_at, original_anchor_at, frozen_at)
SELECT g.id, COALESCE(g.ends_at, g.date), COALESCE(g.ends_at, g.date),
       CASE WHEN g.cancelled_at IS NOT NULL OR g.completed_at IS NOT NULL OR COALESCE(g.status, '') IN ('completed', 'cancelled')
                 OR COALESCE(g.ends_at, g.date) <= now() THEN now() END
  FROM public.hosted_games g
ON CONFLICT (game_id) DO NOTHING;

-- A cancelled or completed game stays that way for clients (the service role and definer code are not limited).
CREATE OR REPLACE FUNCTION public.guard_game_end_state()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF auth.uid() IS NOT NULL
     AND ((OLD.cancelled_at IS NOT NULL AND NEW.cancelled_at IS NULL) OR (OLD.completed_at IS NOT NULL AND NEW.completed_at IS NULL)) THEN
    RAISE EXCEPTION 'GAME_ENDED: a cancelled or completed game cannot be reopened.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION public.guard_game_end_state() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS a0_guard_game_end_state_trg ON public.hosted_games;
CREATE TRIGGER a0_guard_game_end_state_trg BEFORE UPDATE OF cancelled_at, completed_at ON public.hosted_games
  FOR EACH ROW EXECUTE FUNCTION public.guard_game_end_state();

CREATE OR REPLACE FUNCTION private_sec.messaging_connection(_a uuid, _b uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT _a IS NOT NULL AND _b IS NOT NULL AND _a <> _b AND (
       public.is_guardian_of(_a, _b) OR public.is_guardian_of(_b, _a)
    -- two members of one team, each through a membership that counts (see team_membership_authorizes)
    OR EXISTS (SELECT 1 FROM public.team_members ma JOIN public.team_members mb ON mb.team_id = ma.team_id
                WHERE ma.user_id = _a AND mb.user_id = _b
                  AND private_sec.team_membership_authorizes(ma.team_id, _a)
                  AND private_sec.team_membership_authorizes(ma.team_id, _b))
    -- an ADULT host and a confirmed participant of an approved request, until 30 days after the game; a non-adult participant counts only when
    -- a verified guardian approved that participation (a stranger cannot create this context by publishing a public game, and a minor host is
    -- never reachable this way). SEC-7: "after the game" is the server-kept anchor in game_contact_windows, which the host cannot move once
    -- the game has ended (falls back to the game's dates only for a row written with triggers off).
    OR EXISTS (SELECT 1 FROM public.hosted_games g JOIN public.game_participants p ON p.game_id = g.id
                WHERE ((g.host_id = _a AND p.user_id = _b) OR (g.host_id = _b AND p.user_id = _a))
                  AND public.age_cohort_of(g.host_id) = 'adult'
                  -- SEC-7 final review (2): a cancelled game is no context
                  AND g.cancelled_at IS NULL AND COALESCE(g.status, '') <> 'cancelled'
                  AND COALESCE((SELECT w.anchor_at FROM public.game_contact_windows w WHERE w.game_id = g.id), g.ends_at, g.date)
                        > now() - interval '30 days'
                  AND (public.age_cohort_of(p.user_id) = 'adult'
                       OR EXISTS (SELECT 1 FROM public.join_requests jr
                                   WHERE jr.game_id = g.id AND jr.player_id = p.user_id AND jr.status = 'approved'
                                     AND jr.guardian_approved_at IS NOT NULL
                                     AND public.is_guardian_of(jr.guardian_approved_by, p.user_id))))
    -- an accepted request FROM a non-adult that their verified guardian approved (an adult sender cannot manufacture one: see the gate trigger)
    OR EXISTS (SELECT 1 FROM public.availability_contact_requests r
                WHERE r.status = 'accepted' AND r.needs_guardian AND r.guardian_approved_at IS NOT NULL
                  AND ((r.from_user_id = _a AND r.to_user_id = _b) OR (r.from_user_id = _b AND r.to_user_id = _a))
                  AND COALESCE(public.age_cohort_of(r.from_user_id), 'unknown') <> 'adult'
                  AND public.is_guardian_of(r.guardian_approved_by, r.from_user_id)
                  -- SEC-7 final review (1): a non-adult recipient's side is re-checked at use time, as when the request was made: a verified
                  -- guardian, controls on 'peers', and the sender's age band (so the recipient's guardian revoking, or changing the controls, ends it)
                  AND (public.age_cohort_of(r.to_user_id) = 'adult'
                       OR (public.age_cohort_of(r.to_user_id) IN ('teen_13_15', 'teen_16_17')
                           AND public.age_cohort_of(r.to_user_id) = public.age_cohort_of(r.from_user_id)
                           AND private_sec.has_guardian_link(r.to_user_id)
                           AND EXISTS (SELECT 1 FROM public.child_controls c WHERE c.child_user_id = r.to_user_id AND c.messaging = 'peers'))))
  )
$function$;

-- =================================================================== 5. a current guardian re-approves an existing team membership in place
-- After a guardian change the approval on the child's accepted invitation was given by someone who is no longer a verified guardian, so the
-- membership stops counting for messaging (team_membership_authorizes), and a new invitation fails with ALREADY_MEMBER. A current verified
-- guardian re-approves the accepted invitation itself. Nothing else about the membership changes.
CREATE OR REPLACE FUNCTION public.guardian_reapprove_team_membership(_team text, _child uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  _me uuid := auth.uid();
  _inv public.team_invites;
  _team_name text;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '42501'; END IF;
  IF NOT private_sec.is_guardian_of(_me, _child) THEN RAISE EXCEPTION 'NOT_GUARDIAN' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.team_members m WHERE m.team_id = _team AND m.user_id = _child) THEN
    RAISE EXCEPTION 'NOT_MEMBER: your player is not on this team.';
  END IF;
  IF COALESCE(public.age_cohort_of(_child), 'unknown') = 'adult' THEN
    RAISE EXCEPTION 'NOT_NEEDED: an adult''s membership needs no guardian approval.';
  END IF;
  -- SEC-7 final review (3): the same declared-age rule as every other way onto a team
  IF NOT private_sec.age_verified(_child) THEN
    RAISE EXCEPTION 'AGE_VERIFICATION_REQUIRED: your player must add their date of birth before their membership can be approved.';
  END IF;
  IF public.child_features_locked(_child) THEN RAISE EXCEPTION 'CHILD_ACTIVITY_LOCKED'; END IF;
  IF private_sec.team_membership_authorizes(_team, _child) THEN RETURN 'already_approved'; END IF;

  SELECT * INTO _inv FROM public.team_invites i
   WHERE i.team_id = _team AND i.invitee_id = _child AND i.status = 'accepted'
   ORDER BY i.responded_at DESC NULLS LAST, i.updated_at DESC LIMIT 1
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NO_ACCEPTED_INVITE: this membership was not made through an invitation; ask the team to remove and re-invite your player.';
  END IF;

  UPDATE public.team_invites SET guardian_approved_at = now(), guardian_approved_by = _me, updated_at = now() WHERE id = _inv.id;

  INSERT INTO public.family_audit_log (actor_user_id, child_user_id, action, context)
  VALUES (_me, _child, 'team_membership_reapproved',
          jsonb_build_object('team_id', _team, 'invite_id', _inv.id,
                             'previous_approver', _inv.guardian_approved_by, 'previous_approved_at', _inv.guardian_approved_at));

  SELECT t.name INTO _team_name FROM public.teams t WHERE t.id = _team;
  -- every current verified guardian of the child (the approving one included) gets the record in their inbox
  INSERT INTO public.notifications (user_id, type, title, body, link)
  SELECT gl.parent_user_id, 'team_membership_reapproved', 'Team membership approved',
         'A parent or guardian approved your player''s membership of ' || COALESCE(_team_name, 'a team') || '.', '/guardian'
    FROM public.guardian_links gl
   WHERE gl.child_user_id = _child AND gl.status = 'active' AND gl.verified_at IS NOT NULL;

  RETURN 'approved';
END $function$;
REVOKE ALL ON FUNCTION public.guardian_reapprove_team_membership(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.guardian_reapprove_team_membership(text, uuid) TO authenticated, service_role;

-- The caller's children's memberships that a guardian approval would restore: accepted through an invitation, not counting now.
CREATE OR REPLACE FUNCTION public.guardian_team_reapprovals()
 RETURNS TABLE(child_user_id uuid, team_id text, team_name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT m.user_id, m.team_id, t.name
    FROM public.guardian_links gl
    JOIN public.team_members m ON m.user_id = gl.child_user_id
    JOIN public.teams t ON t.id = m.team_id
   WHERE auth.uid() IS NOT NULL AND gl.parent_user_id = auth.uid() AND gl.status = 'active' AND gl.verified_at IS NOT NULL
     AND COALESCE(public.age_cohort_of(m.user_id), 'unknown') <> 'adult'
     AND EXISTS (SELECT 1 FROM public.team_invites i WHERE i.team_id = m.team_id AND i.invitee_id = m.user_id AND i.status = 'accepted')
     AND NOT private_sec.team_membership_authorizes(m.team_id, m.user_id)
   ORDER BY t.name
$function$;
REVOKE ALL ON FUNCTION public.guardian_team_reapprovals() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.guardian_team_reapprovals() TO authenticated, service_role;

-- ======================================================================================== 6. final review (780eaf8f) corrections
-- ------------------------------------------------------------------- (1) a guardian's approval re-checks the recipient's side of a peer request
-- Unchanged from 20261106140000 except the last re-check: a request from a non-adult to a non-adult needs, at approval time as at sending time,
-- an authorized context or the peer conditions (same age band, a verified guardian, controls on 'peers'). Otherwise it is withdrawn ('blocked').
CREATE OR REPLACE FUNCTION public.guardian_decide_contact_request(_request uuid, _approve boolean)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _r record; _mode text; _key text; _cf text; _ct text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in required' USING ERRCODE = 'insufficient_privilege'; END IF;
  SELECT * INTO _r FROM public.availability_contact_requests WHERE id = _request AND status = 'awaiting_guardian';
  IF NOT FOUND OR NOT public.is_guardian_of(auth.uid(), _r.from_user_id) THEN
    RAISE EXCEPTION 'REQUEST_NOT_FOUND: nothing to decide.' USING ERRCODE = 'no_data_found';
  END IF;
  PERFORM set_config('app.guardian_decide_request', 'on', true);
  IF NOT _approve THEN
    UPDATE public.availability_contact_requests SET status = 'withdrawn' WHERE id = _request;
    PERFORM set_config('app.guardian_decide_request', '', true);
    RETURN 'declined';
  END IF;
  -- the world may have changed since the child sent it: re-check blocks, the recipient's privacy settings and the controls
  _key := CASE WHEN _r.kind = 'invite' THEN 'allow_invites' ELSE 'allow_messages' END;
  _mode := COALESCE(public.privacy_text(_r.to_user_id, _key), 'everyone');
  _cf := COALESCE(public.age_cohort_of(_r.from_user_id), 'unknown');
  _ct := COALESCE(public.age_cohort_of(_r.to_user_id), 'unknown');
  IF public.blocks_exist_between(_r.from_user_id, _r.to_user_id)
     OR _mode = 'nobody'
     OR (_mode = 'shared' AND NOT private_sec.messaging_connection(_r.from_user_id, _r.to_user_id))
     OR private_sec.messaging_controls_block(_r.from_user_id, _r.to_user_id) IS NOT NULL
     -- SEC-7 final review (1): the recipient's guardian may have revoked, changed the controls, or the ages moved apart since it was sent
     OR (_ct <> 'adult' AND NOT private_sec.messaging_connection(_r.from_user_id, _r.to_user_id)
         AND NOT (_ct IN ('teen_13_15', 'teen_16_17') AND _ct = _cf AND private_sec.has_guardian_link(_r.to_user_id)
                  AND EXISTS (SELECT 1 FROM public.child_controls c WHERE c.child_user_id = _r.to_user_id AND c.messaging = 'peers'))) THEN
    UPDATE public.availability_contact_requests SET status = 'withdrawn' WHERE id = _request;
    PERFORM set_config('app.guardian_decide_request', '', true);
    RETURN 'blocked';
  END IF;
  UPDATE public.availability_contact_requests
     SET status = 'pending', guardian_approved_by = auth.uid(), guardian_approved_at = now() WHERE id = _request;
  INSERT INTO public.notifications (user_id, type, title, body, link)
  VALUES (_r.to_user_id, 'contact_request', 'You have a new request', 'A player sent you a request. Open your requests to answer it.', '/messages');
  PERFORM set_config('app.guardian_decide_request', '', true);
  RETURN 'approved';
END $function$;

-- ---------------------------------------------------------------------------- (6) no age-derived refusal reason for a caller who is not an adult
-- For a caller who is not a confirmed adult, the reason a refusal gives must not depend on the other person's age. What stays: the caller's own
-- guardian controls (messaging off, guardian only, teammates only) and whether the caller has a verified guardian. Everything else (a reason
-- about the other person, "needs a connection", "under 13 needs a guardian" which only an adult target produces) becomes one code.
CREATE OR REPLACE FUNCTION private_sec.minor_caller_block_code(_me uuid, _block text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT CASE
    WHEN _block IS NULL THEN NULL
    WHEN _block IN ('messaging_off:self', 'guardian_only:self', 'teammates_only:self', 'needs_guardian_link:self') THEN _block
    WHEN NOT private_sec.has_guardian_link(_me) THEN 'needs_guardian_link:self'
    ELSE 'needs_connection:self'
  END
$function$;
REVOKE ALL ON FUNCTION private_sec.minor_caller_block_code(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private_sec.minor_caller_block_code(uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.create_direct_conversation(_other_user uuid, _game_id text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _me uuid := auth.uid();
  _existing uuid;
  _new_id uuid;
  _mode text;
  _block text;
BEGIN
  IF _me IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;
  IF _me = _other_user THEN
    RAISE EXCEPTION 'Cannot message yourself';
  END IF;

  _block := public.minor_messaging_block(_me, _other_user);
  IF _block IS NOT NULL THEN
    IF COALESCE(public.age_cohort_of(_me), 'unknown') <> 'adult' THEN
      -- SEC-7 final review (6): a caller who is not a confirmed adult learns nothing about the other person's age
      _block := private_sec.minor_caller_block_code(_me, _block);
    ELSIF _block LIKE '%:other' THEN
      -- Final review N1: a reason about the OTHER person (their age band, guardian link or controls) is not told to the caller;
      -- the app shows its generic line for this code. A reason about the caller's own account (:self) is still explained.
      _block := 'not_permitted:other';
    END IF;
    RAISE EXCEPTION 'MINOR_MESSAGING_BLOCKED:%', _block;
  END IF;

  SELECT cp1.conversation_id INTO _existing
  FROM public.conversation_participants cp1
  JOIN public.conversation_participants cp2
    ON cp1.conversation_id = cp2.conversation_id
  WHERE cp1.user_id = _me AND cp2.user_id = _other_user
  LIMIT 1;

  IF _existing IS NOT NULL THEN
    RETURN _existing;
  END IF;

  _mode := COALESCE(public.privacy_text(_other_user, 'allow_messages'), 'everyone');
  IF _mode = 'nobody' THEN
    RAISE EXCEPTION 'This player is not accepting new messages.';
  ELSIF _mode = 'shared' AND NOT public.shares_game_or_chat(_me, _other_user) THEN
    RAISE EXCEPTION 'This player only accepts messages from people they share a game or chat with.';
  END IF;

  INSERT INTO public.conversations (created_by, game_id)
  VALUES (_me, _game_id)
  RETURNING id INTO _new_id;

  INSERT INTO public.conversation_participants (conversation_id, user_id)
  VALUES (_new_id, _me), (_new_id, _other_user);

  RETURN _new_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.guard_contact_request_minor_recipient()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _cf text; _ct text; _block text;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;   -- service-role maintenance
  _cf := COALESCE(public.age_cohort_of(NEW.from_user_id), 'unknown');
  _ct := COALESCE(public.age_cohort_of(NEW.to_user_id), 'unknown');
  _block := private_sec.messaging_controls_block(NEW.from_user_id, NEW.to_user_id);
  IF _block IS NULL AND (_cf <> 'adult' OR _ct <> 'adult') THEN
    IF _cf = 'adult' THEN
      -- an adult asking a minor: only inside an authorized context, never as a stranger
      IF NOT private_sec.messaging_connection(NEW.from_user_id, NEW.to_user_id) THEN
        _block := CASE WHEN _ct = 'child_under_13' THEN 'child_needs_guardian:other'
                       WHEN NOT private_sec.has_guardian_link(NEW.to_user_id) THEN 'needs_guardian_link:other'
                       ELSE 'needs_connection:other' END;
      END IF;
    ELSE
      -- a minor asking anyone: needs a linked guardian, who approves it (see the gate trigger); asking another minor also needs a context
      IF NOT private_sec.has_guardian_link(NEW.from_user_id) THEN
        _block := 'needs_guardian_link:self';
      ELSIF _ct <> 'adult' AND NOT private_sec.messaging_connection(NEW.from_user_id, NEW.to_user_id)
            -- teen to teen of the same age band, when the recipient's guardian allows peers: the request then waits for the sender's
            -- guardian and the recipient's acceptance (mutual consent); never an under-13, never across age bands
            AND NOT (_ct IN ('teen_13_15', 'teen_16_17') AND _ct = _cf AND private_sec.has_guardian_link(NEW.to_user_id)
                     AND EXISTS (SELECT 1 FROM public.child_controls c WHERE c.child_user_id = NEW.to_user_id AND c.messaging = 'peers')) THEN
        _block := 'needs_connection:other';
      END IF;
    END IF;
  END IF;
  IF _block IS NOT NULL THEN
    IF _cf <> 'adult' THEN
      _block := private_sec.minor_caller_block_code(NEW.from_user_id, _block);   -- SEC-7 final review (6): nothing about the other's age
    ELSIF _block LIKE '%:other' THEN
      _block := 'not_permitted:other';   -- final review N1: no reason about the other person
    END IF;
    RAISE EXCEPTION 'MINOR_MESSAGING_BLOCKED:%', _block USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $function$;

-- ------------------------------------------------------------------------- (4) revoke_parental_consent: authorization before any lookup
-- Unchanged from 20261028160000 except the order: a caller who is neither the child's guardian nor a moderator gets NOT_AUTHORIZED whether or
-- not the child has a consent record (or is a minor at all); CONSENT_NOT_FOUND is for an authorized caller only.
CREATE OR REPLACE FUNCTION public.revoke_parental_consent(_child uuid, _reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE me uuid := auth.uid(); r public.parental_consents;
BEGIN
  IF NOT (public.is_guardian_of(me, _child) OR public.is_moderator(me)) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;
  SELECT * INTO r FROM public.parental_consents WHERE child_user_id = _child;
  IF r.id IS NULL THEN RAISE EXCEPTION 'CONSENT_NOT_FOUND'; END IF;

  UPDATE public.parental_consents SET
    status = 'revoked', revoked_at = now(), revoked_reason = _reason,
    verification_token_hash = NULL, token_expires_at = NULL
  WHERE id = r.id;

  -- Immediately apply restrictions rather than only flipping a flag.
  UPDATE public.child_controls SET
    messaging = 'off', media_visibility = 'private', social_discovery = false,
    ai_analysis = false, game_participation = false, updated_by = me
  WHERE child_user_id = _child;

  UPDATE public.privacy_preferences SET
    profile_visibility = 'private', allow_messages = 'nobody', allow_invites = 'nobody',
    location_precision = 'city', ai_processing = false, ai_training_opt_in = false
  WHERE user_id = _child;

  UPDATE public.highlight_reels SET hidden_at = COALESCE(hidden_at, now()) WHERE user_id = _child;
  UPDATE public.player_availabilities SET hidden_at = COALESCE(hidden_at, now()), status = 'inactive'
  WHERE user_id = _child;

  INSERT INTO public.parental_consent_events (consent_id, child_user_id, actor_id, action, from_status, to_status, detail)
  VALUES (r.id, _child, me, 'consent_revoked', r.status, 'revoked', jsonb_build_object('reason', _reason));
END $function$;

-- ------------------------------------------------------------------------------------- (8) no privacy row is 'private', not an age default
-- An account with no privacy_preferences row (sign-up writes one; only legacy accounts lack it) used to fall back to the age-derived default,
-- which differs by age band and so told a visitor the band. It is now 'private' for everyone. No data is rewritten here: an operator who wants
-- such accounts to keep their age default can run, as a reviewed one-off batch,
--   INSERT INTO public.privacy_preferences (user_id, profile_visibility)
--   SELECT p.id, private_sec.default_profile_visibility_for(p.id) FROM public.profiles p
--    WHERE NOT EXISTS (SELECT 1 FROM public.privacy_preferences pp WHERE pp.user_id = p.id) ON CONFLICT (user_id) DO NOTHING;
-- (see docs/privacy/sec7-remaining-defects.md).
CREATE OR REPLACE FUNCTION private_sec.profile_visibility_of(_user uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN public.age_cohort_of(_user) IN ('child_under_13','teen_13_15','teen_16_17')
         AND private_sec.guardian_public_profile(_user) THEN 'public'
    ELSE COALESCE((SELECT pp.profile_visibility FROM public.privacy_preferences pp WHERE pp.user_id = _user), 'private')
  END;
$function$;

-- A person's age is shown for a confirmed adult whose profile is visible; a non-adult's only to them, their verified guardian or staff.
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
    AND private_sec.profile_visibility_of(b.user_id) IN ('public','members')
    AND (public.age_cohort_of(b.user_id) = 'adult'
         OR (auth.uid() IS NOT NULL
             AND (b.user_id = auth.uid() OR private_sec.is_guardian_of(auth.uid(), b.user_id)
                  OR private_sec.is_moderator(auth.uid()) OR private_sec.is_superadmin(auth.uid()))));
$function$;

-- --------------------------------------------------------------------------------------------- (5) team invitations tell a manager nothing
-- team_invite_player raised BLOCKED (telling a manager that the person blocked them, or that they blocked the person) and stored NULL as the
-- message for a non-adult, which the manager read back (telling them the invitee's age band). Now:
--   * a blocked pair gets an invitation row like any other, answered with its id, but no notification is sent and the row is recorded in
--     team_invite_suppressions (server only): it does not exist for the invitee or their guardians (team_invites_inbox, team_respond_invite,
--     guardian_approve_team_invite, sign_team_waiver), so it can never be accepted; it expires like an unanswered invitation;
--   * the manager's message is stored as written for every invitee, so the manager's view of the row is the same whoever was invited;
--   * invitees and their guardians read invitations only through team_invites_inbox(), which leaves out suppressed rows and shows the free text
--     only to a confirmed adult invitee. The base table is readable by the team's managers only.
CREATE TABLE IF NOT EXISTS public.team_invite_suppressions (
  invite_id uuid PRIMARY KEY REFERENCES public.team_invites(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.team_invite_suppressions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.team_invite_suppressions FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.team_invite_suppressions TO service_role;

CREATE OR REPLACE FUNCTION public.team_invite_player(_team text, _user uuid, _role team_role DEFAULT 'player'::team_role, _message text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _me uuid := auth.uid();
  _id uuid;
  _team_name text;
  _minor boolean := COALESCE(public.age_cohort_of(_user), 'unknown') <> 'adult';
  _blocked boolean;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF NOT public.is_team_manager(_team, _me) THEN RAISE EXCEPTION 'NOT_TEAM_MANAGER'; END IF;
  IF _role = 'owner' THEN RAISE EXCEPTION 'OWNER_NOT_INVITABLE'; END IF;
  IF _user = _me THEN RAISE EXCEPTION 'SELF_INVITE'; END IF;
  IF public.is_team_member(_team, _user) THEN RAISE EXCEPTION 'ALREADY_MEMBER'; END IF;
  _blocked := public.blocks_exist_between(_me, _user);

  SELECT name INTO _team_name FROM public.teams WHERE id = _team;

  UPDATE public.team_invites SET status = 'expired', updated_at = now()
  WHERE team_id = _team AND invitee_id = _user AND status = 'pending' AND expires_at <= now();

  -- the manager's text as written, whoever the invitee is; team_invites_inbox() never shows it to a non-adult
  INSERT INTO public.team_invites (team_id, invitee_id, invited_by, role, message)
  VALUES (_team, _user, _me, _role, nullif(btrim(coalesce(_message,'')), ''))
  RETURNING id INTO _id;

  IF _blocked THEN
    -- a block between the two: the same answer for the manager, nothing at all for the invitee or their guardians
    INSERT INTO public.team_invite_suppressions (invite_id) VALUES (_id);
    RETURN _id;
  END IF;

  IF NOT _minor THEN
    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (_user, 'team_invite', 'Team invitation',
            coalesce(_team_name,'A team') || ' invited you to join as ' || _role::text,
            '/teams/' || _team);
  ELSE
    PERFORM public.notify_guardians(_user, 'team_invite',
      'Team invitation for your player',
      coalesce(_team_name,'A team') || ' invited your player to join as ' || _role::text,
      '/parent');
  END IF;

  RETURN _id;
END $function$;

-- The invitations addressed to the caller or to a child they are the verified guardian of. Suppressed invitations are left out; the free-text
-- message is shown only when the invitee is a confirmed adult. Filters (eq, in, is, gt, order) apply to the result as to a table.
CREATE OR REPLACE FUNCTION public.team_invites_inbox()
 RETURNS TABLE(id uuid, team_id text, invitee_id uuid, invited_by uuid, role public.team_role, message text, status text, expires_at timestamptz,
               responded_at timestamptz, created_at timestamptz, updated_at timestamptz, guardian_approved_at timestamptz,
               guardian_approved_by uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT i.id, i.team_id, i.invitee_id, i.invited_by, i.role,
         CASE WHEN public.age_cohort_of(i.invitee_id) = 'adult' THEN i.message END,
         i.status, i.expires_at, i.responded_at, i.created_at, i.updated_at, i.guardian_approved_at, i.guardian_approved_by
    FROM public.team_invites i
   WHERE auth.uid() IS NOT NULL
     AND (i.invitee_id = auth.uid() OR private_sec.is_guardian_of(auth.uid(), i.invitee_id))
     AND NOT EXISTS (SELECT 1 FROM public.team_invite_suppressions s WHERE s.invite_id = i.id)
$function$;
REVOKE ALL ON FUNCTION public.team_invites_inbox() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.team_invites_inbox() TO authenticated, service_role;

DROP POLICY IF EXISTS "Guardians view their children's pending team invites" ON public.team_invites;
DROP POLICY IF EXISTS "team_invites_read" ON public.team_invites;
CREATE POLICY "team_invites_read" ON public.team_invites FOR SELECT TO authenticated
  USING (private_sec.is_team_manager(team_id, auth.uid()));

-- Unchanged except that a suppressed invitation does not make the invitee eligible to sign the team's waiver.
CREATE OR REPLACE FUNCTION public.sign_team_waiver(_team_id text, _waiver_id uuid, _on_behalf_of uuid DEFAULT NULL::uuid, _attested boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _me uuid := auth.uid();
  _signer uuid := COALESCE(_on_behalf_of, auth.uid());
  _id uuid;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;

  IF _on_behalf_of IS NOT NULL THEN
    IF NOT public.is_guardian_of(_me, _on_behalf_of) THEN RAISE EXCEPTION 'NOT_YOUR_GUARDIAN_LINK'; END IF;
    IF NOT _attested THEN
      RAISE EXCEPTION 'ATTESTATION_REQUIRED: confirm you are signing on this child''s behalf.';
    END IF;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.team_waivers
    WHERE id = _waiver_id AND team_id = _team_id AND published
  ) THEN
    RAISE EXCEPTION 'WAIVER_NOT_PUBLISHED';
  END IF;

  IF NOT (
    public.is_team_member(_team_id, _signer)
    OR EXISTS (
      SELECT 1 FROM public.team_invites i
      WHERE i.team_id = _team_id AND i.invitee_id = _signer AND i.status = 'pending'
        AND NOT EXISTS (SELECT 1 FROM public.team_invite_suppressions s WHERE s.invite_id = i.id)
    )
  ) THEN
    RAISE EXCEPTION 'NOT_TEAM_MEMBER_OR_INVITEE';
  END IF;

  -- signed_by is who actually performed the action (mirrors
  -- legal_consents.accepted_by) -- the guardian, never the child.
  INSERT INTO public.team_waiver_signatures (waiver_id, team_id, signer_user_id, signed_by, user_agent)
  VALUES (
    _waiver_id, _team_id, _signer,
    CASE WHEN _on_behalf_of IS NOT NULL THEN _me ELSE NULL END,
    CASE WHEN _on_behalf_of IS NOT NULL THEN 'guardian-on-behalf' ELSE NULL END
  )
  ON CONFLICT (waiver_id, signer_user_id) DO NOTHING
  RETURNING id INTO _id;

  RETURN _id;
END;
$function$;

-- SEC-2 interplay: re-wrap the helper functions if the containment migration is present (item 1 replaced a wrapped helper's private body).
DO $rewrap$ BEGIN
  IF to_regprocedure('private_sec.wrap_oracle_helpers()') IS NOT NULL THEN PERFORM private_sec.wrap_oracle_helpers(); END IF;
END $rewrap$;
