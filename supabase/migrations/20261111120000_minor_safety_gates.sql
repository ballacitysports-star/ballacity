-- Minor-safety gates (stale-PR triage step 18): live guardian/minor defects on main, ported from SEC-7 item 1 and final
-- review (4)/(5) (PR #280), SEC-1 item 1b (PR #276), R7 F4 (PR #270) and SEC-8's payee gate (PR #283), adapted to main's
-- tables and built on the definitions of 20261110120000_guardian_approval_validity (PR #389, audit F03), which it keeps.
--
--  1. A declared age (profiles.age_cohort is not 'unknown', i.e. a birthday was stored: public.age_verified) is required,
--     failing closed on an unknown age, before an account:
--     a. takes or asks for a place in a game, whoever writes the row. enforce_child_game_participation checked the age
--        only when the player wrote the row themselves, and child_game_participation_allowed treats an unknown age as
--        "not a minor". RLS lets a player write only their own rows, hosts and moderators cannot write anyone else's,
--        no definer function inserts them, and a join request needs a signed-in player (validate_join_request). The
--        one other writer is the server (service role) inserting game_participants in addPaidPlayerToRoster, after the
--        host verified a payment or a PayPal capture: it acts for the player and is not meant to skip the player's
--        rules, so an account with no birthday that paid for an open game was put on the roster with no age check.
--     b. accepts a team invite (team_respond_invite) or is joined to a team by a guardian's approval
--        (guardian_approve_team_invite). Declining stays open.
--     c. is added to an organization (org_members) or a team roster (team_members) directly by an administrator or a
--        manager: only a declared adult (SEC-1 1b, R7 F4). Unknown age used to pass "NOT is_minor". A person's own
--        request to join an organization, approved by approve_org_member_request, is unchanged, as in SEC-1 and SEC-7.
--  2. get_game_host_payment_methods answered any signed-in caller who named a game and its payee, so a 16-17-year-old
--     host's payment handles (often a real name) were readable by anyone. It now answers only for an adult payee (the
--     payee may still read their own) and only to a caller who can see the game (the hosted_games read policies for a
--     signed-in account) or is involved in it (private_sec.can_read_game_payment_settings: the payee, an approved
--     requester, a payer, a participant).
--  3. revoke_parental_consent looked the child's consent up before checking the caller, so anyone could learn whether
--     an account has a parental-consent record (CONSENT_NOT_FOUND versus NOT_AUTHORIZED). It now authorizes first.
--  4. team_invite_player answered BLOCKED when the manager and the invitee had a block between them, telling the
--     manager that the person blocked them. It now gives the same answer as for anyone else: the invitation is written
--     and its id returned, but it is recorded in team_invite_suppressions (server only), nobody is notified, and it
--     does not exist for the invitee or their guardians (read policies, team_respond_invite,
--     guardian_approve_team_invite, sign_team_waiver), so it can never be accepted; it expires like an unanswered one.
--     A target who does not exist, a minor and an adult already got the same answer.
--
-- Everything here tightens; every existing rule is kept. Rows already written are not changed.
-- Rollback: docs/rollbacks/20261111120000_minor_safety_gates.down.sql (guarded).

-- ============================================================ 4. (table first: the functions below read it)
CREATE TABLE IF NOT EXISTS public.team_invite_suppressions (
  invite_id uuid PRIMARY KEY REFERENCES public.team_invites(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.team_invite_suppressions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.team_invite_suppressions FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.team_invite_suppressions TO service_role;

-- Whether an invitation reaches the caller as its invitee or the invitee's guardian. Always false for anyone else, so
-- a manager learns nothing from it.
CREATE OR REPLACE FUNCTION private_sec.team_invite_reaches_invitee(_invite uuid, _invitee uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL
     AND (auth.uid() = _invitee OR public.is_guardian_of(auth.uid(), _invitee))
     AND NOT EXISTS (SELECT 1 FROM public.team_invite_suppressions s WHERE s.invite_id = _invite);
$$;
REVOKE ALL ON FUNCTION private_sec.team_invite_reaches_invitee(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private_sec.team_invite_reaches_invitee(uuid, uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS "team_invites_read" ON public.team_invites;
CREATE POLICY "team_invites_read" ON public.team_invites FOR SELECT TO authenticated
  USING (((invitee_id = auth.uid()) AND private_sec.team_invite_reaches_invitee(id, invitee_id))
         OR public.is_team_manager(team_id, auth.uid()));

DROP POLICY IF EXISTS "Guardians view their children's pending team invites" ON public.team_invites;
CREATE POLICY "Guardians view their children's pending team invites" ON public.team_invites FOR SELECT TO authenticated
  USING (public.is_guardian_of(auth.uid(), invitee_id) AND private_sec.team_invite_reaches_invitee(id, invitee_id));

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
  _blocked boolean;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF NOT public.is_team_manager(_team, _me) THEN RAISE EXCEPTION 'NOT_TEAM_MANAGER'; END IF;
  IF _role = 'owner' THEN RAISE EXCEPTION 'OWNER_NOT_INVITABLE'; END IF;
  IF _user = _me THEN RAISE EXCEPTION 'SELF_INVITE'; END IF;
  IF public.is_team_member(_team, _user) THEN RAISE EXCEPTION 'ALREADY_MEMBER'; END IF;
  -- A block between the two no longer answers BLOCKED: the manager gets the same answer as for anyone else.
  _blocked := public.blocks_exist_between(_me, _user);

  SELECT name INTO _team_name FROM public.teams WHERE id = _team;

  UPDATE public.team_invites SET status = 'expired', updated_at = now()
  WHERE team_id = _team AND invitee_id = _user AND status = 'pending' AND expires_at <= now();

  INSERT INTO public.team_invites (team_id, invitee_id, invited_by, role, message)
  VALUES (_team, _user, _me, _role, nullif(btrim(coalesce(_message,'')), ''))
  RETURNING id INTO _id;

  IF _blocked THEN
    -- Written like any other, but it never reaches the invitee or their guardians, and nobody is told.
    INSERT INTO public.team_invite_suppressions (invite_id) VALUES (_id);
    RETURN _id;
  END IF;

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

-- Unchanged except that a suppressed invitation does not make its invitee eligible to sign the team's waiver.
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

-- ============================================================ 1a. a place in a game needs a declared age, whoever writes it
-- #389's definition; only the age check changes (it applied when the player wrote the row themselves).
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

  -- A declared age is required whoever writes the row: the player, or the server placing them after a payment. An
  -- unknown age is not "not a minor".
  IF subject IS NOT NULL AND NOT public.age_verified(subject) THEN
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

-- ============================================================ 1b. joining a team by invite needs a declared age (4: and an invite that reaches you)
-- #389's definitions; added: a suppressed invitation does not exist for the invitee (INVITE_NOT_FOUND, as for no
-- invitation at all), and accepting needs a declared age.
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
  -- An invitation written while a block stood between the manager and the invitee does not exist for the invitee.
  IF EXISTS (SELECT 1 FROM public.team_invite_suppressions s WHERE s.invite_id = _invite) THEN
    RAISE EXCEPTION 'INVITE_NOT_FOUND';
  END IF;
  IF _row.status <> 'pending' THEN RAISE EXCEPTION 'INVITE_NOT_PENDING'; END IF;
  IF _row.expires_at <= now() THEN
    UPDATE public.team_invites SET status = 'expired', updated_at = now() WHERE id = _invite;
    RAISE EXCEPTION 'INVITE_EXPIRED';
  END IF;

  IF _accept AND public.child_features_locked(_me) THEN
    RAISE EXCEPTION 'CHILD_ACTIVITY_LOCKED';
  END IF;

  -- An unknown age is not "not a minor": joining needs a declared age (declining stays open).
  IF _accept AND NOT public.age_verified(_me) THEN
    RAISE EXCEPTION 'AGE_VERIFICATION_REQUIRED: add your date of birth before joining a team.';
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
  -- Nor for the invitee's guardians.
  IF EXISTS (SELECT 1 FROM public.team_invite_suppressions s WHERE s.invite_id = _invite) THEN
    RAISE EXCEPTION 'INVITE_NOT_FOUND';
  END IF;
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
  -- A team membership needs a declared age, the same as accepting the invite yourself.
  IF NOT public.age_verified(_row.invitee_id) THEN
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

-- ============================================================ 1c. direct adds: a declared adult only
DROP POLICY IF EXISTS "Admins can insert org members" ON public.org_members;
CREATE POLICY "Admins can insert org members" ON public.org_members FOR INSERT TO authenticated
  WITH CHECK (public.is_trainer_org_admin(org_id, auth.uid()) AND public.age_verified(user_id) AND NOT public.is_minor(user_id));

DROP POLICY IF EXISTS "team_members_manager_write" ON public.team_members;
CREATE POLICY "team_members_manager_write" ON public.team_members FOR INSERT TO authenticated
  WITH CHECK (public.is_team_manager(team_id, auth.uid()) AND (role <> 'owner'::public.team_role)
              AND public.age_verified(user_id) AND (NOT public.is_minor(user_id)));

-- ============================================================ 2. payment handles: an adult payee, a caller who can see or is in the game
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
  IF _me IS NULL THEN
    RETURN;
  END IF;
  -- Only the game's payee has payment methods to show for it.
  IF _host_id IS DISTINCT FROM private_sec.game_payee(_game_id) THEN
    RETURN;
  END IF;
  -- Only a confirmed adult's handles are shown: not a 16-17-year-old's, not an unknown age's (the payee sees their own).
  IF _me IS DISTINCT FROM _host_id AND public.age_cohort_of(_host_id) IS DISTINCT FROM 'adult' THEN
    RETURN;
  END IF;
  -- Only to someone involved in the game (the payee, an approved requester, a payer, a participant: the rule of the
  -- payment settings row), or who can see it (the hosted_games read policies for a signed-in account).
  IF NOT private_sec.can_read_game_payment_settings(_game_id, _host_id)
     AND NOT EXISTS (
       SELECT 1 FROM public.hosted_games g
        WHERE g.id = _game_id
          AND ((g.is_private = false AND g.hidden_at IS NULL)
               OR g.host_id = _me
               OR ((g.is_private = true OR g.moderator_hidden_at IS NULL)
                   AND (public.is_game_participant(g.id, _me)
                        OR EXISTS (SELECT 1 FROM public.join_requests jr
                                    WHERE jr.game_id = g.id AND jr.player_id = _me))))) THEN
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

-- ============================================================ 3. revoke_parental_consent: authorize before looking anything up
-- Unchanged from 20261028160000 except the order: a caller who is neither the child's guardian nor a moderator gets
-- NOT_AUTHORIZED whether or not the child has a consent record; CONSENT_NOT_FOUND is for an authorized caller only.
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
