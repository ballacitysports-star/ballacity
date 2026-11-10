-- ROLLBACK for supabase/migrations/20261110120000_guardian_approval_validity.sql (audit F03, P0-5).
-- NOT a migration. It puts back the gates that accept any guardian approval stamp, the approval function that keeps
-- the first approver, revoke_guardian_link without clearing approvals, and the API's ability to write the stamp: the
-- holes the migration closed. It also drops the triggers that clear approvals when a guardian's account is deleted,
-- a link changes or is deleted, or a guardian is suspended. Approvals the migration cleared are not restored.
-- It refuses to run unless:
--     PGOPTIONS="-c app.confirm_guardian_approval_rollback=yes" psql ... -f <this file>
BEGIN;
DO $guard$
BEGIN
  IF current_setting('app.confirm_guardian_approval_rollback', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'Refusing to run: this reopens forged and stale guardian approvals for minors. Set app.confirm_guardian_approval_rollback=yes for the session to proceed deliberately.';
  END IF;
END
$guard$;

DROP TRIGGER IF EXISTS trg_guard_join_request_guardian_stamp ON public.join_requests;
DROP FUNCTION IF EXISTS public.guard_join_request_guardian_stamp();

DROP TRIGGER IF EXISTS trg_join_request_approver_gone ON public.join_requests;
DROP TRIGGER IF EXISTS trg_ineligible_guardian_clears_approvals ON public.profiles;
DROP TRIGGER IF EXISTS trg_guardian_link_clears_approvals ON public.guardian_links;
DROP FUNCTION IF EXISTS private_sec.join_request_approver_gone();
DROP FUNCTION IF EXISTS private_sec.ineligible_guardian_clears_approvals();
DROP FUNCTION IF EXISTS private_sec.guardian_link_change_clears_approvals();
DROP FUNCTION IF EXISTS private_sec.clear_stale_guardian_approvals(uuid, uuid);

-- The definitions in force before the migration (main at 57a398a7), unchanged.
CREATE OR REPLACE FUNCTION public.enforce_guardian_before_payment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NEW.player_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.guardian_links gl
     WHERE gl.child_user_id = NEW.player_id AND gl.status = 'active'
  ) AND NOT EXISTS (
    SELECT 1 FROM public.join_requests jr
     WHERE jr.game_id = NEW.game_id
       AND jr.player_id = NEW.player_id
       AND jr.guardian_approved_at IS NOT NULL
       AND jr.status IN ('pending', 'approved')
  ) THEN
    RAISE EXCEPTION 'GUARDIAN_APPROVAL_REQUIRED: a parent or guardian has to approve this game before a payment can be sent.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$function$
;

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
     AND EXISTS (SELECT 1 FROM public.join_requests jr WHERE jr.game_id = NEW.game_id AND jr.player_id = subject)
     AND NOT EXISTS (
       SELECT 1 FROM public.join_requests jr
       WHERE jr.game_id = NEW.game_id AND jr.player_id = subject AND jr.guardian_approved_at IS NOT NULL
     )
  THEN
    RAISE EXCEPTION 'GUARDIAN_APPROVAL_REQUIRED: a parent or guardian must approve this join request first.';
  END IF;

  RETURN NEW;
END $function$
;

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
END $function$
;

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
  IF _row.status NOT IN ('pending', 'approved') THEN RAISE EXCEPTION 'REQUEST_NOT_PENDING'; END IF;
  IF EXISTS (SELECT 1 FROM public.game_participants gp
              WHERE gp.game_id = _row.game_id AND gp.user_id = _row.player_id) THEN
    RAISE EXCEPTION 'ALREADY_ON_ROSTER: this child is already in the game; cancel their spot from the game page.';
  END IF;

  IF _approve THEN
    UPDATE public.join_requests
       SET guardian_approved_at = COALESCE(guardian_approved_at, now()),
           guardian_approved_by = COALESCE(guardian_approved_by, _me)
     WHERE id = _request AND status IN ('pending', 'approved');

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
$function$
;

CREATE OR REPLACE FUNCTION public.revoke_guardian_link(_child_user_id uuid, _reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_parent uuid := auth.uid();
BEGIN
  IF v_parent IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.guardian_links
    WHERE parent_user_id = v_parent AND child_user_id = _child_user_id AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'NOT_FOUND';
  END IF;

  -- Unlinking would drop the child from guardian_children_overview for the
  -- only adult who can reach a credential-less account. Deleting the child's
  -- profile is the supported way out.
  IF EXISTS (
    SELECT 1 FROM public.managed_accounts
    WHERE child_user_id = _child_user_id AND managed_by = v_parent
  ) THEN
    RAISE EXCEPTION 'MANAGED_CHILD_DELETE_INSTEAD';
  END IF;

  UPDATE public.guardian_links
  SET status = 'revoked'
  WHERE parent_user_id = v_parent AND child_user_id = _child_user_id AND status = 'active';

  UPDATE public.parental_consents
  SET status = 'revoked',
      revoked_at = now(),
      revoked_reason = coalesce(_reason, 'Guardian ended the family link'),
      updated_at = now()
  WHERE child_user_id = _child_user_id
    AND parent_user_id = v_parent
    AND status <> 'revoked';
END;
$function$
;

DROP FUNCTION IF EXISTS private_sec.guardian_approval_valid(uuid, uuid);
DROP FUNCTION IF EXISTS private_sec.guardian_approver_eligible(uuid);

COMMIT;
