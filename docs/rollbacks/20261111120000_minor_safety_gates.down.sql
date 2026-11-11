-- ROLLBACK for supabase/migrations/20261111120000_minor_safety_gates.sql (stale-PR triage step 18).
-- NOT a migration. It puts back what the migration closed: an account with no birthday can again be placed in a game
-- by the server, accept a team invite (or be joined by a guardian's approval) and be added to an organization or a
-- team roster directly; get_game_host_payment_methods again returns any payee's handles, a 16-17-year-old's included,
-- to any signed-in caller; revoke_parental_consent again tells anyone whether an account has a consent record; and
-- team_invite_player again answers BLOCKED. Every replaced function and policy goes back to its definition before the
-- migration (this branch, PR #389's head e87948fc), byte for byte, and the table and helper it added are dropped.
-- Invitations the migration wrote while a block stood between the manager and the invitee (team_invite_suppressions)
-- are deleted first: before the migration they would never have been written, and once the table is gone nothing
-- would keep them from reaching the person who blocked (or was blocked by) the manager.
-- It refuses to run unless the session sets the confirmation first:
--     SET app.confirm_minor_safety_gates_rollback = 'yes';   (or PGOPTIONS="-c app.confirm_minor_safety_gates_rollback=yes")
BEGIN;
DO $guard$
BEGIN
  IF current_setting('app.confirm_minor_safety_gates_rollback', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'Refusing to run: this reopens unknown-age joins, minors'' payment handles and two oracles. Set app.confirm_minor_safety_gates_rollback=yes for the session to proceed deliberately.';
  END IF;
END
$guard$;

-- Policies, as they were.
DROP POLICY IF EXISTS "team_invites_read" ON public.team_invites;
CREATE POLICY "team_invites_read" ON public.team_invites FOR SELECT TO authenticated
  USING (((invitee_id = auth.uid()) OR is_team_manager(team_id, auth.uid())));

DROP POLICY IF EXISTS "Guardians view their children's pending team invites" ON public.team_invites;
CREATE POLICY "Guardians view their children's pending team invites" ON public.team_invites FOR SELECT TO authenticated
  USING (is_guardian_of(auth.uid(), invitee_id));

DROP POLICY IF EXISTS "Admins can insert org members" ON public.org_members;
CREATE POLICY "Admins can insert org members" ON public.org_members FOR INSERT TO authenticated
  WITH CHECK (is_trainer_org_admin(org_id, auth.uid()));

DROP POLICY IF EXISTS "team_members_manager_write" ON public.team_members;
CREATE POLICY "team_members_manager_write" ON public.team_members FOR INSERT TO authenticated
  WITH CHECK ((is_team_manager(team_id, auth.uid()) AND (role <> 'owner'::team_role) AND (NOT is_minor(user_id))));

-- The definitions in force before the migration (PR #389's head e87948fc), unchanged.
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

  IF subject IS NOT NULL AND subject = auth.uid() AND NOT public.age_verified(subject) THEN
    RAISE EXCEPTION 'AGE_VERIFICATION_REQUIRED: add your date of birth before joining games.';
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
     -- A request for this game, or a payment for it (a paid place cannot dodge the gate by deleting the request).
     AND (EXISTS (SELECT 1 FROM public.join_requests jr WHERE jr.game_id = NEW.game_id AND jr.player_id = subject)
          OR EXISTS (SELECT 1 FROM public.payment_submissions ps
                      WHERE ps.game_id = NEW.game_id AND ps.player_id = subject))
     AND NOT EXISTS (
       SELECT 1 FROM public.join_requests jr
       WHERE jr.game_id = NEW.game_id AND jr.player_id = subject AND jr.guardian_approved_at IS NOT NULL
         AND jr.status IN ('pending', 'approved')
         AND private_sec.guardian_approval_valid(subject, jr.guardian_approved_by)
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
  IF _row.status <> 'pending' THEN RAISE EXCEPTION 'INVITE_NOT_PENDING'; END IF;
  IF _row.expires_at <= now() THEN
    UPDATE public.team_invites SET status = 'expired', updated_at = now() WHERE id = _invite;
    RAISE EXCEPTION 'INVITE_EXPIRED';
  END IF;

  IF _accept AND public.child_features_locked(_me) THEN
    RAISE EXCEPTION 'CHILD_ACTIVITY_LOCKED';
  END IF;

  -- NEW: guardian approval, for any minor with an active guardian link
  -- (managed or self-operating alike — see verification doc for why this
  -- is a same-actor double-confirmation for a managed child, not a gap).
  IF _accept
     AND public.is_minor(_me)
     AND EXISTS (SELECT 1 FROM public.guardian_links WHERE child_user_id = _me AND status = 'active')
     AND (_row.guardian_approved_at IS NULL
          OR NOT private_sec.guardian_approval_valid(_me, _row.guardian_approved_by)) THEN
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
  -- Approving (which joins the child to the team) needs an eligible guardian; declining needs only the link.
  IF _approve AND NOT private_sec.guardian_approver_eligible(_me) THEN RAISE EXCEPTION 'GUARDIAN_NOT_ELIGIBLE'; END IF;
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

CREATE OR REPLACE FUNCTION public.get_game_host_payment_methods(_host_id uuid, _game_id text)
 RETURNS TABLE(id uuid, host_id uuid, payment_type text, label text, username text, payment_url text, contact_info text, instructions text, is_enabled boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _settings public.game_payment_settings%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;
  -- Only the game's payee has payment methods to show for it.
  IF _host_id IS DISTINCT FROM private_sec.game_payee(_game_id) THEN
    RETURN;
  END IF;

  SELECT *
  INTO _settings
  FROM public.game_payment_settings gps
  WHERE gps.game_id = _game_id
    AND gps.host_id = _host_id
  ORDER BY gps.created_at DESC
  LIMIT 1;

  IF _settings.id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
    SELECT hpm.id, hpm.host_id, hpm.payment_type, hpm.label, hpm.username, hpm.payment_url, hpm.contact_info, hpm.instructions, hpm.is_enabled
    FROM public.host_payment_methods hpm
    WHERE hpm.host_id = _host_id
      AND hpm.is_enabled = true
      AND (
        COALESCE(array_length(_settings.accepted_method_ids, 1), 0) = 0
        OR hpm.id = ANY(_settings.accepted_method_ids)
      );
END;
$function$;

CREATE OR REPLACE FUNCTION public.revoke_parental_consent(_child uuid, _reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE me uuid := auth.uid(); r public.parental_consents;
BEGIN
  SELECT * INTO r FROM public.parental_consents WHERE child_user_id = _child;
  IF r.id IS NULL THEN RAISE EXCEPTION 'CONSENT_NOT_FOUND'; END IF;
  IF NOT (public.is_guardian_of(me, _child) OR public.is_moderator(me)) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

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
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF NOT public.is_team_manager(_team, _me) THEN RAISE EXCEPTION 'NOT_TEAM_MANAGER'; END IF;
  IF _role = 'owner' THEN RAISE EXCEPTION 'OWNER_NOT_INVITABLE'; END IF;
  IF _user = _me THEN RAISE EXCEPTION 'SELF_INVITE'; END IF;
  IF public.is_team_member(_team, _user) THEN RAISE EXCEPTION 'ALREADY_MEMBER'; END IF;
  IF public.blocks_exist_between(_me, _user) THEN RAISE EXCEPTION 'BLOCKED'; END IF;

  SELECT name INTO _team_name FROM public.teams WHERE id = _team;

  UPDATE public.team_invites SET status = 'expired', updated_at = now()
  WHERE team_id = _team AND invitee_id = _user AND status = 'pending' AND expires_at <= now();

  INSERT INTO public.team_invites (team_id, invitee_id, invited_by, role, message)
  VALUES (_team, _user, _me, _role, nullif(btrim(coalesce(_message,'')), ''))
  RETURNING id INTO _id;

  INSERT INTO public.notifications (user_id, type, title, body, link)
  VALUES (_user, 'team_invite', 'Team invitation',
          coalesce(_team_name,'A team') || ' invited you to join as ' || _role::text,
          '/teams/' || _team);

  IF public.is_minor(_user) THEN
    PERFORM public.notify_guardians(_user, 'team_invite',
      'Team invitation for your player',
      coalesce(_team_name,'A team') || ' invited your player to join as ' || _role::text,
      '/parent');
  END IF;

  RETURN _id;
END $function$;

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
      SELECT 1 FROM public.team_invites
      WHERE team_id = _team_id AND invitee_id = _signer AND status = 'pending'
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

-- What the migration added.
DROP FUNCTION IF EXISTS private_sec.team_invite_reaches_invitee(uuid, uuid);
DELETE FROM public.team_invites i WHERE EXISTS (SELECT 1 FROM public.team_invite_suppressions s WHERE s.invite_id = i.id);
DROP TABLE IF EXISTS public.team_invite_suppressions;

COMMIT;
