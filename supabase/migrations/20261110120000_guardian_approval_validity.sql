-- Audit F03 (P0-5): a guardian's approval counts only while that guardian still has authority.
--
-- A 16-17-year-old with a guardian needs a guardian's approval before paying for a game, before taking a place on a
-- roster, and before accepting a team invite. Until now each gate accepted any non-null guardian_approved_at, so:
--   * an approval kept counting after the guardian who gave it lost the link (revoke_guardian_link), while another
--     guardian's link kept the child's gates switched on;
--   * guardian_approve_join_request kept the first approver with COALESCE, so a current guardian could not replace a
--     stale approval;
--   * the approval stamp itself was writable through the API: a child could insert a join request already marked
--     approved by their guardian, and a host could set the stamp on any request for their game (both have the column
--     grant, and no policy or trigger looked at these columns).
--
-- Changes (all tighten; nothing is loosened):
--   1. private_sec.guardian_approver_eligible(approver): an adult (or age unknown), not a managed child, not suspended,
--      not held for an age review.
--   2. private_sec.guardian_approval_valid(child, approver): the approver is the child's guardian now (is_guardian_of:
--      active, verified link) and is eligible.
--   3. The payment gate, the roster gate and team_respond_invite count an approval only if it is valid.
--   4. guardian_approve_join_request refuses to let an ineligible guardian approve (GUARDIAN_NOT_ELIGIBLE; declining
--      stays open to any linked guardian) and replaces a stale approval instead of keeping it.
--   5. revoke_guardian_link clears that guardian's approvals of requests still open (not of places already taken), so
--      the app shows them as waiting on a guardian again.
--   6. A trigger on join_requests: through the API (roles authenticated and anon) nobody can set or change who approved
--      a request. Only the approval function and revoke_guardian_link (SECURITY DEFINER) and the server (service role)
--      can.
--   7. Every other way a guardian loses authority clears their approvals of requests still open too: the guardian's
--      account is deleted (the foreign key empties guardian_approved_by), a link is changed or deleted outside
--      revoke_guardian_link, the guardian is suspended or held for an age review. Approvals that already stopped
--      counting are cleared once, when this migration runs. The app reads a set stamp as an approval and lists a
--      request with no stamp in the other guardian's queue, so a stamp that no longer counts must not stay behind.
-- team_invites needs no write guard: its direct insert and update policies are already false.
--
-- Families: a request approved by a guardian who was later removed, deleted their account or was suspended has to be
-- approved again by a current guardian. Lifting a suspension does not bring the approval back.
-- Rollback: docs/rollbacks/20261110120000_guardian_approval_validity.down.sql (guarded).

-- ============================================================ 1-2. who may approve
CREATE OR REPLACE FUNCTION private_sec.guardian_approver_eligible(_approver uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _approver IS NOT NULL
     AND NOT public.is_minor(_approver)
     AND NOT EXISTS (SELECT 1 FROM public.managed_accounts m WHERE m.child_user_id = _approver)
     AND NOT EXISTS (
       SELECT 1 FROM public.profiles p
        WHERE p.id = _approver AND (p.suspended_at IS NOT NULL OR p.age_review_required)
     );
$$;
REVOKE ALL ON FUNCTION private_sec.guardian_approver_eligible(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private_sec.guardian_approval_valid(_child uuid, _approver uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _approver IS NOT NULL
     AND public.is_guardian_of(_approver, _child)
     AND private_sec.guardian_approver_eligible(_approver);
$$;
REVOKE ALL ON FUNCTION private_sec.guardian_approval_valid(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- ============================================================ 3. the gates count only a valid approval
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
       AND private_sec.guardian_approval_valid(NEW.player_id, jr.guardian_approved_by)
       AND jr.status IN ('pending', 'approved')
  ) THEN
    RAISE EXCEPTION 'GUARDIAN_APPROVAL_REQUIRED: a parent or guardian has to approve this game before a payment can be sent.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
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

-- ============================================================ 4. approving: eligible guardians only; a stale approval is replaced
CREATE OR REPLACE FUNCTION public.guardian_approve_join_request(_request uuid, _approve boolean DEFAULT true)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _me uuid := auth.uid();
  _row public.join_requests;
  _keep boolean;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  SELECT * INTO _row FROM public.join_requests WHERE id = _request FOR UPDATE;
  IF _row.id IS NULL THEN RAISE EXCEPTION 'REQUEST_NOT_FOUND'; END IF;
  IF NOT public.is_guardian_of(_me, _row.player_id) THEN RAISE EXCEPTION 'NOT_GUARDIAN'; END IF;
  -- Approving needs an eligible guardian. Declining, the protective answer, needs only the link.
  IF _approve AND NOT private_sec.guardian_approver_eligible(_me) THEN RAISE EXCEPTION 'GUARDIAN_NOT_ELIGIBLE'; END IF;
  IF _row.status NOT IN ('pending', 'approved') THEN RAISE EXCEPTION 'REQUEST_NOT_PENDING'; END IF;
  IF EXISTS (SELECT 1 FROM public.game_participants gp
              WHERE gp.game_id = _row.game_id AND gp.user_id = _row.player_id) THEN
    RAISE EXCEPTION 'ALREADY_ON_ROSTER: this child is already in the game; cancel their spot from the game page.';
  END IF;

  IF _approve THEN
    -- Keep an existing approval only while the guardian who gave it still has
    -- authority; a stale one (link ended, guardian no longer eligible) is replaced.
    _keep := _row.guardian_approved_at IS NOT NULL
             AND private_sec.guardian_approval_valid(_row.player_id, _row.guardian_approved_by);
    UPDATE public.join_requests
       SET guardian_approved_at = CASE WHEN _keep THEN guardian_approved_at ELSE now() END,
           guardian_approved_by = CASE WHEN _keep THEN guardian_approved_by ELSE _me END
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
$function$;

-- ============================================================ 5. ending a link clears that guardian's open approvals
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

  -- This guardian's approvals of requests still open stop counting (audit F03):
  -- clear them, so the child and the host see the request waiting on a guardian
  -- again. A place already taken on a roster is left as it is.
  UPDATE public.join_requests jr
     SET guardian_approved_at = NULL, guardian_approved_by = NULL
   WHERE jr.player_id = _child_user_id
     AND jr.guardian_approved_by = v_parent
     AND jr.status IN ('pending', 'approved')
     AND NOT EXISTS (SELECT 1 FROM public.game_participants gp
                      WHERE gp.game_id = jr.game_id AND gp.user_id = jr.player_id);

  UPDATE public.parental_consents
  SET status = 'revoked',
      revoked_at = now(),
      revoked_reason = coalesce(_reason, 'Guardian ended the family link'),
      updated_at = now()
  WHERE child_user_id = _child_user_id
    AND parent_user_id = v_parent
    AND status <> 'revoked';
END;
$function$;

-- ============================================================ 6. the approval stamp is not writable through the API
CREATE OR REPLACE FUNCTION public.guard_join_request_guardian_stamp()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Deliberately not SECURITY DEFINER: current_user is the caller. A write made inside the approval function or
  -- revoke_guardian_link runs as their owner, and the server runs as service_role; both pass.
  IF current_user IN ('authenticated', 'anon') THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.guardian_approved_at IS NOT NULL OR NEW.guardian_approved_by IS NOT NULL THEN
        RAISE EXCEPTION 'GUARDIAN_APPROVAL_FORBIDDEN: a request starts without a guardian''s approval; the guardian approves it from their account.'
          USING ERRCODE = '42501';
      END IF;
    ELSIF NEW.guardian_approved_at IS DISTINCT FROM OLD.guardian_approved_at
       OR NEW.guardian_approved_by IS DISTINCT FROM OLD.guardian_approved_by THEN
      RAISE EXCEPTION 'GUARDIAN_APPROVAL_FORBIDDEN: only the child''s guardian can approve, from their account.'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_join_request_guardian_stamp() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_join_request_guardian_stamp ON public.join_requests;
CREATE TRIGGER trg_guard_join_request_guardian_stamp
BEFORE INSERT OR UPDATE ON public.join_requests
FOR EACH ROW EXECUTE FUNCTION public.guard_join_request_guardian_stamp();

-- ============================================================ 7. wherever authority ends, the open approvals it gave are cleared
-- Clears the stamp on requests still open (pending or host-approved, child not yet on the roster) whose approval no
-- longer counts, for one child, one approver, or everyone. A place already taken keeps its record.
CREATE OR REPLACE FUNCTION private_sec.clear_stale_guardian_approvals(_child uuid DEFAULT NULL, _approver uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _n integer;
BEGIN
  UPDATE public.join_requests jr
     SET guardian_approved_at = NULL, guardian_approved_by = NULL
   WHERE (jr.guardian_approved_at IS NOT NULL OR jr.guardian_approved_by IS NOT NULL)
     AND (_child IS NULL OR jr.player_id = _child)
     AND (_approver IS NULL OR jr.guardian_approved_by = _approver)
     AND jr.status IN ('pending', 'approved')
     AND NOT private_sec.guardian_approval_valid(jr.player_id, jr.guardian_approved_by)
     AND NOT EXISTS (SELECT 1 FROM public.game_participants gp
                      WHERE gp.game_id = jr.game_id AND gp.user_id = jr.player_id);
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END $$;
REVOKE ALL ON FUNCTION private_sec.clear_stale_guardian_approvals(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- A link that changes (revoked, unverified) or is deleted, by any path, including with an account.
CREATE OR REPLACE FUNCTION private_sec.guardian_link_change_clears_approvals()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM private_sec.clear_stale_guardian_approvals(_child => OLD.child_user_id);
  IF TG_OP = 'UPDATE' AND NEW.child_user_id IS DISTINCT FROM OLD.child_user_id THEN
    PERFORM private_sec.clear_stale_guardian_approvals(_child => NEW.child_user_id);
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION private_sec.guardian_link_change_clears_approvals() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guardian_link_clears_approvals ON public.guardian_links;
CREATE TRIGGER trg_guardian_link_clears_approvals
AFTER UPDATE OR DELETE ON public.guardian_links
FOR EACH ROW EXECUTE FUNCTION private_sec.guardian_link_change_clears_approvals();

-- A guardian who is suspended or held for an age review.
CREATE OR REPLACE FUNCTION private_sec.ineligible_guardian_clears_approvals()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM private_sec.clear_stale_guardian_approvals(_approver => NEW.id);
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION private_sec.ineligible_guardian_clears_approvals() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_ineligible_guardian_clears_approvals ON public.profiles;
CREATE TRIGGER trg_ineligible_guardian_clears_approvals
AFTER UPDATE OF suspended_at, age_review_required ON public.profiles
FOR EACH ROW
WHEN ((NEW.suspended_at IS NOT NULL AND OLD.suspended_at IS NULL)
   OR (NEW.age_review_required IS TRUE AND OLD.age_review_required IS NOT TRUE))
EXECUTE FUNCTION private_sec.ineligible_guardian_clears_approvals();

-- The approver's account is deleted: the foreign key sets guardian_approved_by to NULL (as the table owner, so the
-- stamp guard above lets it through) and would leave guardian_approved_at behind on a request still open.
CREATE OR REPLACE FUNCTION private_sec.join_request_approver_gone()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.guardian_approved_at IS NOT NULL
     AND NEW.status IN ('pending', 'approved')
     AND NOT EXISTS (SELECT 1 FROM public.game_participants gp
                      WHERE gp.game_id = NEW.game_id AND gp.user_id = NEW.player_id) THEN
    NEW.guardian_approved_at := NULL;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private_sec.join_request_approver_gone() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_join_request_approver_gone ON public.join_requests;
CREATE TRIGGER trg_join_request_approver_gone
BEFORE UPDATE OF guardian_approved_by ON public.join_requests
FOR EACH ROW
WHEN (NEW.guardian_approved_by IS NULL AND OLD.guardian_approved_by IS NOT NULL)
EXECUTE FUNCTION private_sec.join_request_approver_gone();

-- Approvals that had already stopped counting before this migration (none on production on 2026-11-10).
SELECT private_sec.clear_stale_guardian_approvals();
