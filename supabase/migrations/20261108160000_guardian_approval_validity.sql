-- Audit F03 (with A-F3, A-F4): a guardian approval counts only while the guardian who gave it still has authority.
--
-- payment_guardian_missing (20261108140000), enforce_child_game_participation (20261108130000:99) and team_respond_invite
-- accepted any non-null guardian_approved_at. When guardian A approved and A's link was later suspended, revoked or
-- replaced through account recovery, A's old timestamp still satisfied the payment and participation checks without the
-- current guardian (B) approving. Also:
--   - guardian_approve_join_request kept the first approver (COALESCE), so B's fresh approval still named A;
--   - child_game_participation_allowed and the approval checks applied only while a link was 'active', so a staff
--     suspension or revocation switched the guardian's protections off (A-F3);
--   - provision_managed_child ignored an open guardian authority hold (A-F4), and a hold lifted as "revoke" only
--     revoked the links suspended when it was placed.
--
-- Rules now:
--   guardian_approval_required(child): the child has an active OR SUSPENDED guardian link. A suspension (a security
--     review) therefore keeps the gate closed instead of opening it (A-F3). Once every link is revoked the child is
--     treated like any child without a guardian (the existing product rule, tests 3xx), and no old approval matters.
--   guardian_approval_valid(child, approver): the approver currently has an active, verified link to the child, no open
--     authority hold, and is still eligible to act as a guardian (private_sec.guardian_eligible: an adult account that is
--     not suspended, not under age review and not a managed child). An approval given before a ban or an age review
--     stops counting (independent pre-review, 2026-11-05), and such an account cannot give a new one.

DO $$ BEGIN
  IF to_regclass('public.guardian_authority_holds') IS NULL OR to_regprocedure('private_sec.is_guardian_of(uuid,uuid)') IS NULL
     OR to_regprocedure('private_sec.payment_guardian_missing(text,uuid)') IS NULL
     OR to_regprocedure('private_sec.guardian_eligible(uuid)') IS NULL THEN
    RAISE EXCEPTION 'guardian approval validity: needs SEC-4 (20261108100000), SEC-7 (20261108130000) and SEC-8 (20261108140000)';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION private_sec.guardian_approval_required(_child uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.guardian_links gl WHERE gl.child_user_id = _child AND gl.status IN ('active', 'suspended'))
$function$;
REVOKE ALL ON FUNCTION private_sec.guardian_approval_required(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private_sec.guardian_approval_valid(_child uuid, _approver uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT _approver IS NOT NULL
     AND private_sec.is_guardian_of(_approver, _child)
     AND NOT EXISTS (SELECT 1 FROM public.guardian_authority_holds h WHERE h.guardian_user_id = _approver AND h.lifted_at IS NULL)
     AND private_sec.guardian_eligible(_approver)
$function$;
REVOKE ALL ON FUNCTION private_sec.guardian_approval_valid(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------- payment
CREATE OR REPLACE FUNCTION private_sec.payment_guardian_missing(_game_id text, _player uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT private_sec.guardian_approval_required(_player)
     AND NOT EXISTS (SELECT 1 FROM public.join_requests jr
                      WHERE jr.game_id = _game_id AND jr.player_id = _player
                        AND jr.guardian_approved_at IS NOT NULL AND jr.status IN ('pending', 'approved')
                        AND private_sec.guardian_approval_valid(_player, jr.guardian_approved_by))
$function$;
REVOKE ALL ON FUNCTION private_sec.payment_guardian_missing(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private_sec.payment_guardian_missing(text, uuid) TO service_role;

-- ---------------------------------------------------------------------------------------------------- participation controls (A-F3)
CREATE OR REPLACE FUNCTION private_sec.child_game_participation_allowed(_user uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN public.child_features_locked(_user) THEN false
    WHEN NOT private_sec.age_verified(_user) THEN false
    WHEN public.age_cohort_of(_user) = 'child_under_13' THEN
      COALESCE((SELECT game_participation FROM public.child_controls WHERE child_user_id = _user), false)
    -- a guardian's controls keep applying while that guardian is suspended or after a revocation
    WHEN public.is_minor(_user) AND private_sec.guardian_approval_required(_user) THEN
      COALESCE((SELECT game_participation FROM public.child_controls WHERE child_user_id = _user), true)
    ELSE true
  END;
$function$;

-- ---------------------------------------------------------------------------------------------------- game participation
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
     AND private_sec.guardian_approval_required(subject)
     AND EXISTS (SELECT 1 FROM public.join_requests jr WHERE jr.game_id = NEW.game_id AND jr.player_id = subject)
     AND NOT EXISTS (
       SELECT 1 FROM public.join_requests jr
       WHERE jr.game_id = NEW.game_id AND jr.player_id = subject AND jr.guardian_approved_at IS NOT NULL
         AND private_sec.guardian_approval_valid(subject, jr.guardian_approved_by)
     )
  THEN
    RAISE EXCEPTION 'GUARDIAN_APPROVAL_REQUIRED: a parent or guardian must approve this join request first.';
  END IF;

  RETURN NEW;
END $function$;

-- ---------------------------------------------------------------------------------------------------- team invite acceptance
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
     AND private_sec.guardian_approval_required(_me)
     AND (_row.guardian_approved_at IS NULL OR NOT private_sec.guardian_approval_valid(_me, _row.guardian_approved_by)) THEN
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

-- ---------------------------------------------------------------------------------------------------- re-approval by the current guardian
CREATE OR REPLACE FUNCTION public.guardian_approve_join_request(_request uuid, _approve boolean DEFAULT true)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _me uuid := auth.uid();
  _row public.join_requests;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  SELECT * INTO _row FROM public.join_requests WHERE id = _request FOR UPDATE;
  IF _row.id IS NULL THEN RAISE EXCEPTION 'REQUEST_NOT_FOUND'; END IF;
  IF NOT public.is_guardian_of(_me, _row.player_id) THEN RAISE EXCEPTION 'NOT_GUARDIAN'; END IF;
  IF _approve AND NOT private_sec.guardian_approval_valid(_row.player_id, _me) THEN
    RAISE EXCEPTION 'GUARDIAN_NOT_ELIGIBLE: this account cannot approve for a child right now.' USING ERRCODE = '42501';
  END IF;
  IF _row.status NOT IN ('pending', 'approved') THEN RAISE EXCEPTION 'REQUEST_NOT_PENDING'; END IF;
  IF EXISTS (SELECT 1 FROM public.game_participants gp
              WHERE gp.game_id = _row.game_id AND gp.user_id = _row.player_id) THEN
    RAISE EXCEPTION 'ALREADY_ON_ROSTER: this child is already in the game; cancel their spot from the game page.';
  END IF;

  IF _approve THEN
    PERFORM set_config('app.guardian_approve_join_request', 'on', true);
    UPDATE public.join_requests
       -- keep an earlier approval only while the guardian who gave it still has authority; otherwise this guardian's counts
       SET guardian_approved_at = CASE WHEN private_sec.guardian_approval_valid(player_id, guardian_approved_by)
                                       THEN guardian_approved_at ELSE now() END,
           guardian_approved_by = CASE WHEN private_sec.guardian_approval_valid(player_id, guardian_approved_by)
                                       THEN guardian_approved_by ELSE _me END
     WHERE id = _request AND status IN ('pending', 'approved');
    PERFORM set_config('app.guardian_approve_join_request', '', true);

    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (_row.player_id, 'join_request_guardian_approved', 'Your guardian approved this request',
            CASE WHEN _row.status = 'approved'
                 THEN 'Your guardian and the host both said yes. You can take your place now.'
                 ELSE 'Your guardian approved your request to join this game.' END,
            '/games/' || _row.game_id);
  ELSE
    -- join_requests has no 'withdrawn-by-guardian' concept distinct from the
    -- player's own withdrawal; reuse the existing 'rejected' status rather
    -- than widening join_requests_status_chk for a guardian-specific value.
    UPDATE public.join_requests
       SET status = 'rejected', reviewed_at = now(), reviewer_notes = 'Declined by guardian'
     WHERE id = _request AND status IN ('pending', 'approved');
  END IF;
END;
$function$;

-- ---------------------------------------------------------------------------------------------------- managed children (A-F4)
CREATE OR REPLACE FUNCTION public.provision_managed_child(_child uuid, _dob date, _display_name text, _relationship text DEFAULT 'parent'::text, _sport text DEFAULT NULL::text, _versions jsonb DEFAULT '{}'::jsonb, _attested boolean DEFAULT false)
 RETURNS TABLE(cohort text, consent_recorded boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _parent uuid := auth.uid();
  _parent_cohort text; _parent_review boolean; _parent_suspended timestamptz;
  _parent_name text; _parent_email text; _parent_confirmed timestamptz;
  _child_meta jsonb; _child_created timestamptz;
  _cohort text; _age int; _name text; _rel text; _sport_clean text;
  _terms text; _privacy text; _published text;
  _consent boolean := false; _cid uuid; _prev text;
BEGIN
  IF _parent IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED: sign in to add your child.';
  END IF;
  IF NOT COALESCE(_attested, false) THEN
    RAISE EXCEPTION 'ATTESTATION_REQUIRED: confirm you are this child''s parent or legal guardian.';
  END IF;

  SELECT p.age_cohort, p.age_review_required, p.suspended_at, p.display_name
    INTO _parent_cohort, _parent_review, _parent_suspended, _parent_name
    FROM public.profiles p WHERE p.id = _parent;
  SELECT u.email, u.email_confirmed_at
    INTO _parent_email, _parent_confirmed
    FROM auth.users u WHERE u.id = _parent;
  IF COALESCE(_parent_cohort, 'unknown') <> 'adult'
     OR COALESCE(_parent_review, false)
     OR _parent_suspended IS NOT NULL
     OR _parent_confirmed IS NULL
     OR EXISTS (SELECT 1 FROM public.managed_accounts m WHERE m.child_user_id = _parent) THEN
    RAISE EXCEPTION 'ADULT_REQUIRED: only a verified adult account can add a child.';
  END IF;
  -- A-F4: a guardian under an open authority hold (or otherwise ineligible) gains no new guardian authority
  IF NOT private_sec.guardian_eligible(_parent) THEN
    RAISE EXCEPTION 'GUARDIAN_NOT_ELIGIBLE: this account cannot add a child right now. Contact support.';
  END IF;

  SELECT u.raw_app_meta_data, u.created_at
    INTO _child_meta, _child_created
    FROM auth.users u WHERE u.id = _child;
  IF _child_meta IS NULL
     OR COALESCE(_child_meta ->> 'managed', '') <> 'true'
     OR (_child_meta ->> 'managed_by') IS DISTINCT FROM _parent::text
     OR _child_created < now() - interval '15 minutes' THEN
    RAISE EXCEPTION 'NOT_YOUR_MANAGED_CHILD: that profile was not created for your account.';
  END IF;

  IF EXISTS (SELECT 1 FROM public.managed_accounts m WHERE m.child_user_id = _child)
     OR EXISTS (SELECT 1 FROM public.profile_birthdays b WHERE b.user_id = _child)
     OR EXISTS (SELECT 1 FROM public.guardian_links g WHERE g.child_user_id = _child) THEN
    RAISE EXCEPTION 'ALREADY_PROVISIONED: that profile is already set up.';
  END IF;

  IF (SELECT count(*) FROM public.managed_accounts m WHERE m.managed_by = _parent) >= 10
     OR (SELECT count(*) FROM public.managed_accounts m
          WHERE m.managed_by = _parent AND m.created_at > now() - interval '24 hours') >= 5 THEN
    RAISE EXCEPTION 'MANAGED_LIMIT: too many child profiles for one account.';
  END IF;

  IF _dob IS NULL THEN
    RAISE EXCEPTION 'DOB_REQUIRED: enter your child''s date of birth.';
  END IF;
  IF _dob > current_date THEN
    RAISE EXCEPTION 'DOB_IN_FUTURE: enter a date of birth in the past.';
  END IF;
  _age := public.calculate_age(_dob);
  IF _age IS NULL OR _age > 120 THEN
    RAISE EXCEPTION 'DOB_INVALID: enter a valid date of birth.';
  END IF;
  _cohort := public.age_cohort_from_birthday(_dob);
  IF _cohort NOT IN ('child_under_13', 'teen_13_15', 'teen_16_17') THEN
    RAISE EXCEPTION 'CHILD_IS_ADULT: an adult signs up with their own account.';
  END IF;

  _name := btrim(COALESCE(_display_name, ''));
  IF _name = '' THEN
    RAISE EXCEPTION 'NAME_REQUIRED: enter your child''s first name.';
  END IF;
  IF length(_name) > 60 OR _name ~ '[0-9@]' THEN
    RAISE EXCEPTION 'NAME_INVALID: use letters only in your child''s name.';
  END IF;

  _rel := CASE WHEN _relationship IN ('parent', 'guardian', 'grandparent', 'other adult')
               THEN _relationship ELSE 'parent' END;
  _sport_clean := NULLIF(left(btrim(COALESCE(_sport, '')), 40), '');

  _terms := NULLIF(btrim(COALESCE(_versions ->> 'terms', '')), '');
  _privacy := NULLIF(btrim(COALESCE(_versions ->> 'privacy', '')), '');
  IF _terms IS NULL OR _privacy IS NULL OR length(_terms) > 64 OR length(_privacy) > 64 THEN
    RAISE EXCEPTION 'LEGAL_VERSION_INVALID: accept the current Terms and Privacy Policy.';
  END IF;
  SELECT d.version INTO _published FROM public.legal_documents d
   WHERE d.document_type = 'terms' AND d.published
   ORDER BY d.effective_date DESC, d.published_at DESC NULLS LAST LIMIT 1;
  IF _published IS NOT NULL AND _published <> _terms THEN
    RAISE EXCEPTION 'LEGAL_VERSION_STALE: the Terms were just updated.';
  END IF;
  _published := NULL;
  SELECT d.version INTO _published FROM public.legal_documents d
   WHERE d.document_type = 'privacy' AND d.published
   ORDER BY d.effective_date DESC, d.published_at DESC NULLS LAST LIMIT 1;
  IF _published IS NOT NULL AND _published <> _privacy THEN
    RAISE EXCEPTION 'LEGAL_VERSION_STALE: the Privacy Policy was just updated.';
  END IF;

  BEGIN
    INSERT INTO public.managed_accounts (child_user_id, managed_by, relationship)
    VALUES (_child, _parent, _rel);
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'ALREADY_PROVISIONED: that profile is already set up.';
  END;

  INSERT INTO public.account_profiles (user_id, kind, ref_id)
  VALUES (_parent, 'parent', NULL)
  ON CONFLICT DO NOTHING;

  INSERT INTO public.profile_birthdays (user_id, birthday) VALUES (_child, _dob);

  UPDATE public.profiles
     SET display_name = _name,
         avatar_initials = upper(left(regexp_replace(_name, '[^[:alpha:] ]', '', 'g'), 1)
                                 || COALESCE(left(split_part(_name, ' ', 2), 1), '')),
         sport = COALESCE(_sport_clean, sport),
         account_type = 'player',
         updated_at = now()
   WHERE id = _child;

  INSERT INTO public.guardian_links (parent_user_id, child_user_id, relationship, status, verified_at)
  VALUES (_parent, _child, _rel, 'active', now());

  IF public.parental_consent_required(_cohort) THEN
    SELECT c.id, c.status INTO _cid, _prev FROM public.parental_consents c WHERE c.child_user_id = _child;
    IF _cid IS NULL THEN
      INSERT INTO public.parental_consents (
        child_user_id, parent_email, parent_name, parent_user_id, relationship,
        status, method, jurisdiction, approved_at, requested_at,
        terms_version, privacy_version, scope)
      VALUES (_child, COALESCE(_parent_email, ''), _parent_name, _parent, _rel,
              'approved', 'email_confirmation', 'US_FEDERAL', now(), now(),
              _terms, _privacy,
              jsonb_build_object('guardian_attested', true, 'source', 'managed_child'))
      RETURNING id INTO _cid;
      _prev := 'required';
    ELSE
      UPDATE public.parental_consents
         SET status = 'approved', method = 'email_confirmation',
             parent_email = COALESCE(_parent_email, ''), parent_name = _parent_name,
             parent_user_id = _parent, relationship = _rel,
             approved_at = now(), revoked_at = NULL, revoked_reason = NULL,
             verification_token_hash = NULL, token_expires_at = NULL,
             terms_version = _terms, privacy_version = _privacy,
             scope = jsonb_build_object('guardian_attested', true, 'source', 'managed_child'),
             updated_at = now()
       WHERE id = _cid;
    END IF;

    INSERT INTO public.parental_consent_events
      (consent_id, child_user_id, actor_id, action, from_status, to_status, method, detail)
    VALUES (_cid, _child, _parent, 'consent_approved', COALESCE(_prev, 'required'), 'approved',
            'email_confirmation',
            jsonb_build_object('method', 'email_confirmation', 'source', 'managed_child',
                               'guardian_attested', true));
    _consent := true;
  END IF;

  INSERT INTO public.child_controls (child_user_id, updated_by)
  VALUES (_child, _parent)
  ON CONFLICT (child_user_id) DO NOTHING;

  INSERT INTO public.legal_consents (user_id, document_type, document_version, accepted_by, user_agent)
  VALUES (_child, 'terms', _terms, _parent, 'guardian-on-behalf'),
         (_child, 'privacy', _privacy, _parent, 'guardian-on-behalf')
  ON CONFLICT (user_id, document_type, document_version) DO NOTHING;

  INSERT INTO public.family_audit_log (actor_user_id, child_user_id, action, context)
  VALUES (_parent, _child, 'managed.created',
          jsonb_build_object('relationship', _rel, 'cohort', _cohort));

  IF NOT _consent THEN
    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (_parent, 'guardian_link', 'Child profile added',
            _name || '''s profile is ready. You manage it from your account.', '/parent');
  END IF;

  RETURN QUERY SELECT _cohort, _consent;
END $function$;

-- ---------------------------------------------------------------------------------------------------- lifting a hold as "revoke"
CREATE OR REPLACE FUNCTION public.staff_lift_guardian_suspension(_guardian uuid, _reinstate boolean, _reason text, _evidence_ref text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _me uuid := auth.uid(); _why text := btrim(COALESCE(_reason, '')); _ref text := private_sec.guardian_case_ref(_evidence_ref);
        _h public.guardian_authority_holds; _l public.guardian_links; _n integer := 0;
BEGIN
  IF _me IS NULL OR NOT public.is_moderator(_me) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: only BallaCity staff lift a guardian suspension.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _reinstate IS NULL THEN RAISE EXCEPTION 'DECISION_REQUIRED: reinstate or revoke.'; END IF;
  IF length(_why) < 4 OR length(_why) > 500 THEN RAISE EXCEPTION 'REASON_REQUIRED: give a reason (4 to 500 characters).'; END IF;
  IF _reinstate AND _ref IS NULL THEN
    RAISE EXCEPTION 'EVIDENCE_REQUIRED: record the case reference (8 to 64 characters, like GV-20261104 or ZD-48213-B), never the document.';
  END IF;
  SELECT * INTO _h FROM public.guardian_authority_holds WHERE guardian_user_id = _guardian AND lifted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'HOLD_NOT_FOUND: this guardian is not suspended.' USING ERRCODE = 'no_data_found'; END IF;
  IF _me = _guardian OR EXISTS (SELECT 1 FROM public.guardian_links g WHERE g.parent_user_id = _guardian AND g.child_user_id = _me) THEN
    RAISE EXCEPTION 'CONFLICT_OF_INTEREST: a party cannot act on this guardian.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _me = _h.placed_by THEN
    RAISE EXCEPTION 'SECOND_REVIEWER_REQUIRED: a different staff member than the one who suspended must lift it.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM private_sec.guardian_write_begin(jsonb_build_object('actor_role', 'staff', 'reason', _why));
  UPDATE public.guardian_authority_holds
     SET lifted_by = _me, lifted_at = now(), lift_reason = _why, lift_evidence_ref = _ref,
         outcome = CASE WHEN _reinstate THEN 'reinstated' ELSE 'revoked' END
   WHERE id = _h.id;
  IF _reinstate AND NOT private_sec.guardian_eligible(_guardian) THEN
    RAISE EXCEPTION 'GUARDIAN_NOT_ELIGIBLE: the guardian must be a verified adult in good standing.';
  END IF;
  -- a "revoke" outcome also revokes any link this guardian gained while held (A-F4/A-F5), not only the suspended ones
  FOR _l IN SELECT * FROM public.guardian_links
             WHERE (id = ANY (_h.suspended_links) AND status = 'suspended')
                OR (NOT _reinstate AND parent_user_id = _guardian AND status = 'active')
             FOR UPDATE LOOP
    IF _reinstate AND COALESCE(public.age_cohort_of(_l.child_user_id), 'unknown') <> 'adult'
       AND NOT public.blocks_exist_between(_l.parent_user_id, _l.child_user_id) THEN
      PERFORM set_config('app.guardian_audit', jsonb_build_object('actor_role', 'staff', 'reason', _why, 'evidence_ref', _ref,
                                                                  'method', 'staff_reinstatement',
                                                                  'detail', jsonb_build_object('hold_id', _h.id, 'suspended_by', _h.placed_by))::text, true);
      UPDATE public.guardian_links SET status = 'active', verified_at = now(), verified_by = _me, verification_method = 'staff_reinstatement'
       WHERE id = _l.id;
      _n := _n + 1;
    ELSE
      PERFORM set_config('app.guardian_audit', jsonb_build_object('actor_role', 'staff', 'reason', _why, 'method', 'staff_revocation',
                                                                  'detail', jsonb_build_object('hold_id', _h.id, 'suspected_fraud', NOT _reinstate))::text, true);
      UPDATE public.guardian_links SET status = 'revoked' WHERE id = _l.id;
      UPDATE public.parental_consents
         SET status = 'revoked', revoked_at = now(), revoked_reason = 'Guardian link revoked by BallaCity staff', updated_at = now()
       WHERE child_user_id = _l.child_user_id AND parent_user_id = _l.parent_user_id AND status <> 'revoked';
    END IF;
  END LOOP;
  PERFORM private_sec.guardian_write_end();
  INSERT INTO public.notifications (user_id, type, title, body, link)
  VALUES (_guardian, 'guardian_link', CASE WHEN _reinstate THEN 'Guardian access restored' ELSE 'Guardian connection removed' END,
          CASE WHEN _reinstate THEN 'BallaCity finished its security review and restored your guardian access.'
               ELSE 'BallaCity finished its security review and removed your guardian connection. Contact support with questions.' END, '/parent');
  RETURN _n;
END $function$;
