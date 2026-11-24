-- A declined join request keeps the host's decision and loses the guardian's approval. Owner decisions 2026-11-24: a
-- guardian's cancel leaves a declined request in place; and a declined request a minor's accepted invitation reopens
-- holds them for their guardian again ("Fix it in this PR").
--
-- WHY. Two ways a guarded minor's earlier guardian approval outlived a host's or guardian's decision.
-- 1. guardian_cancel_child_game (20261008160000) deletes the child's join request for the game whatever its status. A
--    request the host declined (Decline, the roster's Remove, host_remove_player's 'Removed by host', 20261129130000)
--    went with it, and with it its last_rejected_at and attempt_count: the child could send a brand-new request at once,
--    with no 15-minute cooldown and a fresh 3-attempt cap (enforce_join_request_resubmit_rules reads both from the old
--    row), and the host's decision no longer showed on the child's side. It happened whenever the guardian's cancel came
--    after the decline: a Parent Center list loaded before the host decided, or the app's retry after a deadlock with
--    the host's removal (the removal won, so the retry found the request declined).
-- 2. A host's decline or removal, and the payment window running out (release_expired_payment_holds), leave the
--    guardian's approval (guardian_approved_at/by) on the declined request. An invitation the minor then accepts
--    (game_respond_invite, 20261127120000) moves that request rejected -> approved and, on a free game, seats them on
--    the old approval; on a paid game it approves the request with the approval still on it, so the roster row written
--    after the payment needs no guardian. The rule since 20261110120000 (trg_join_request_reopen_needs_guardian) is that
--    a reopened request does not ride on an approval given for an earlier attempt that a host, a lapsed payment hold or
--    a guardian has since turned down, but that trigger fired only on rejected -> pending (the child's resend).
--
-- WHAT. Two functions are replaced and one trigger's condition is widened. No table, policy, grant or other trigger or
-- function changes, and no stored row is rewritten.
-- a) CREATE OR REPLACE public.guardian_cancel_child_game(uuid, text): the body 20261008160000 created character for
--    character (no later migration redefines it; the replayed body equals that file's) apart from two things:
--      - the request delete gains AND status <> 'rejected' (status is NOT NULL). So a request with status 'rejected',
--        whatever its note ('Removed by host', any host decline, the payment window's release, a guardian's 'Declined by
--        guardian'), stays as it was: status, notes, reviewed_at, last_rejected_at and attempt_count;
--      - right after that delete, one UPDATE clears guardian_approved_at and guardian_approved_by on that kept declined
--        request when either is set. The old body's delete took the approval away with the row; kept, it must not
--        outlive the guardian's own cancel (as guardian_approve_join_request's no also takes back any approval). The
--        UPDATE sets only the two guardian fields, so the cooldown, attempt count, notes and the decline trigger are
--        untouched; it runs as the function's owner, which trg_guard_join_request_guardian_stamp allows. A 'Declined by
--        guardian' request already has no approval (the guardian's no clears it), so it is not written.
--    Everything else is unchanged:
--      - the guardian check and its refusal (42501), the game checks (not found, no longer on, already started);
--      - which children it acts on and what it answers: 'nothing' when the child has no roster row and no request;
--        'cancelled' when the child had a place (a roster row or an approved request); 'withdrawn' otherwise. A child
--        whose only row is a declined request still answers 'withdrawn' (the request is kept, any unreviewed payment
--        claim is deleted as before). The app ignores the value (cancelChildGame answers ok), and the Parent Center lists
--        only pending and approved requests, so only a list loaded before the host declined reaches that case;
--      - unreviewed payment claims (status 'pending') are deleted, verified ones kept and settled by the roster trigger;
--      - pending and approved requests and the roster row are deleted, with their delete triggers (late cancellation,
--        refund settlement, joined count) as before. Those triggers act only on approved requests and roster rows, so the
--        declined rows that are now kept never fired them;
--      - the host's 'participant_left' notice when the child had a place, unless a late-cancel notice went first.
--    Signature, owner, SECURITY DEFINER, search_path (public) and grants are those of the live function.
-- b) Trigger trg_join_request_reopen_needs_guardian (20261110120000) now also fires when a declined request is moved to
--    'approved': WHEN (OLD.status = 'rejected' AND NEW.status IN ('pending', 'approved') AND an approval is set). Its
--    name, timing (BEFORE UPDATE OF status, FOR EACH ROW) and function (private_sec.join_request_reopen_needs_guardian,
--    which sets both guardian fields to NULL; unchanged) stay as they were, so it still runs after the stamp guard. So
--    whoever reopens a declined request to 'approved', the guardian approval on it is taken back. Who can do that today:
--      - game_respond_invite, the invitee accepting an invitation (in practice the only path);
--      - the service role or other table-owner code writing the row directly (nothing in the app does).
--    A client cannot: the host's own reopening is refused by lock_closed_relationship ('DECISION_FINAL', 20261125100000,
--    for anyone but the player), and the player's only update rule ("Players resubmit rejected requests") allows
--    rejected -> pending only. No SECURITY DEFINER function other than game_respond_invite moves a request out of
--    'rejected' (guardian_approve_join_request acts on pending and approved requests only).
--    The rejected -> pending case (the child's resend) is unchanged.
-- c) CREATE OR REPLACE public.game_respond_invite(uuid, boolean): the body 20261127120000 created, character for
--    character (no later migration redefines it; 20261129100000 and 20261129130000 name it only in comments), apart from
--    two tests, two variables and their comment:
--      - when it works out whether the place is held for a guardian (_held), a request it is about to move from
--        'rejected' to 'approved' counts as carrying no guardian approval, because b) takes the approval back in that
--        same update. Without this the function would read the approval from the row as it was before its update,
--        decide the minor is not held, and on a free game try to seat them, which the roster's guardian rule
--        (enforce_child_game_participation) refuses with an error that ends the whole accept;
--      - a guarded minor (a minor with an active guardian link: _held's own test, now worked out once in _guarded)
--        already on the roster under a declined request (_on, read once with private_sec.is_game_participant, and
--        only for a guarded minor) is the exception: the accept leaves that request declined (its update gains AND NOT
--        (status = 'rejected' AND _on)), so b) does not fire and the approval stays, and _held is worked out as before.
--        Reopening it would take the approval back from a child who keeps the place; the request would then sit in the
--        guardian's Parent Center list with nothing she could do (guardian_approve_join_request refuses a child on the
--        roster, ALREADY_ON_ROSTER, for Approve and Decline alike), and with _held true the capacity check would count
--        the child's own roster row and answer 'full' on a full game. With the exception the accept ends as before for
--        this child ({status:'accepted', on_roster:true}, the invitation accepted), except that the request stays
--        'rejected' instead of turning 'approved' with the old approval: the place is the one the child already had, and
--        a later rejoin, after leaving or being removed, needs a fresh guardian approval (a resend or another accept
--        reopens the request, and b) clears the approval). Because the request stays declined, a later
--        host_remove_player finds it already declined and leaves it as it is (no 'Removed by host', no fresh
--        last_rejected_at, as for any request already declined), so the child's resend gets no new cooldown; it still
--        waits for the guardian. For everyone else (adults, minors with no active guardian link) _on is false and the
--        accept does exactly what 20261127120000's did: it reopens the declined request to 'approved' ('Invited by the
--        host'), so a later host_remove_player declines it again ('Removed by host', a fresh last_rejected_at) and the
--        15-minute resend cooldown applies.
--        How a player gets there: game_invite_player refuses a player on the roster (ALREADY_IN_GAME), and a host's
--        decline cancels the pending invitations (20261129130000), but a player with a declined request can be seated
--        after an invitation was sent if the host opens the game (turns approval off): the player takes a place
--        directly (the join gate allows it on an open game; the game page's UI for this was not checked) with the
--        invitation still pending, then accepts it. An adult or a minor with no active guardian link can do that; a
--        guarded minor cannot, because the roster's guardian rule refuses their own join on a declined request. So for
--        a guarded minor the exception is reached only if the guardian link is made after such a join (run on a
--        scratch replay with a 17-year-old), or through older data or a direct invitation write.
--    So when a minor with an active guardian link accepts an invitation that reopens their declined request, free game
--    or paid, the answer is {status:'accepted', on_roster:false}, the request is approved with no guardian approval and no
--    roster row is written: exactly 20261127120000's guardian-held path (its point 2; 980 section 5). The guardian sees it
--    in the Parent Center (useGuardianApprovals lists pending and approved requests with no guardian approval) and
--    approves it there (guardian_approve_join_request accepts an approved request not yet on the roster); the child then
--    takes the place from the game page (free game) or after paying (paid game), through the roster's guardian rule.
--    Adults, and minors with no active guardian link, are not held (the roster's rule does not apply to them) and are
--    seated on a free game as before; clearing a stale approval on their request changes nothing for them. The take-back
--    rule (a decline at or after the invitation answers 'expired'), the capacity rules, the payment rules, the host's
--    'game_invite_accepted' notice and every answer's shape are unchanged (a guarded minor's answer changes only from
--    on_roster true to false where they are now held). Its owner, SECURITY DEFINER, empty search_path
--    and grants (EXECUTE for authenticated and service_role; none for PUBLIC or anon) are those of the live function.
-- Together: after a guardian's cancel, and after a host's decline or removal or a lapsed payment hold, a minor comes back
-- through a resend or by accepting a new invitation, and either way is seated only once the guardian approves again
-- (except on a request a live 20261127120000 accept already reopened with the old approval on it: WHAT IT DOES NOT DO).
-- A guardian's own 'Declined by guardian' is kept too, on purpose.
-- supabase/tests/989_guardian_cancel_keeps_declined_request.test.sql covers all three and pins the definitions.
--
-- LOCKS. CREATE OR REPLACE FUNCTION takes a brief lock on the function only. CREATE OR REPLACE TRIGGER takes SHARE ROW
-- EXCLUSIVE on public.join_requests (writers wait for it, readers do not), as 20261129130000's CREATE TRIGGER did; if
-- another transaction holds the table, the apply fails after 5 seconds instead of queueing every writer behind it; run it
-- again. It replaces the trigger in one statement, so there is no moment without it (a DROP TRIGGER would also take
-- ACCESS EXCLUSIVE, which makes readers wait). The functions come first: while only they are applied, a reopened minor is
-- held by game_respond_invite but keeps the approval (the old gap, no error); with the trigger alone, the old
-- game_respond_invite would try to seat a minor whose approval the trigger had just cleared, and the accept would fail.
-- When they run, the functions lock the same rows or fewer, in the same order as before. guardian_cancel_child_game:
-- the child's request at the point the old body deleted it (deleted; a declined one only when it carries an approval,
-- which is cleared), then the roster row and, through the joined count, the game. game_respond_invite: the invitation,
-- the game, the request, as before; the trigger runs inside its request update and locks nothing else. So the
-- lock-order deadlocks with host_remove_player and game_respond_invite for the same child are unchanged; the app retries
-- an ended cancel or accept once (cancelChildGame, respondToGameInvite, on 40P01), and a retry that finds the request
-- declined now keeps it (the race in scripts/db-test.mjs). Two interleavings end differently, both with the child's
-- declined request being moved out of 'rejected' while the guardian's cancel runs. The cancel's delete no longer matches
-- a declined row, so it does not wait for the other transaction, and its clearing update, which does, re-checks the row,
-- finds it no longer declined and skips it. The cancel still answers 'withdrawn' (the app reports success).
--   - An accept reopening the request: it is left approved with no guardian approval (b) cleared it) and the child is
--     not seated: it is back in the guardian's list, as after any accept held for her (the old body's delete waited for
--     the accept and then deleted the approved request). For a guarded child on the roster the accept leaves the request
--     declined, so the cancel's update clears its approval and the roster row goes, as with no accept.
--   - The child's resend (rejected -> pending, after the cooldown): the pending request survives with no guardian
--     approval (the resend's trigger cleared it), the child is not seated, and the request shows in the guardian's
--     Parent Center list for her to approve or decline. That is what the child gets by resending right after the
--     cancel; the old body's delete waited for the resend and then deleted the pending request.
-- In neither case does the child get a place without a fresh guardian approval. All three were run by hand on scratch
-- replays.
--
-- WHAT IT DOES NOT DO (no one-off is part of this change):
--   - declined requests already deleted by a guardian's cancel are not put back; those children may already have sent a
--     new request, which stays as it is;
--   - minors already seated by an accept on an old approval stay seated, and approvals left on declined requests stay
--     stored until the request is reopened (they seat nobody while it is declined: the roster's guardian rule reads only
--     pending and approved requests);
--   - requests a live 20261127120000 accept already reopened, with the old approval still on them and no roster row yet
--     (a paid game's accept writes none), stay as they are: b) fires only on the move out of 'rejected', so the roster
--     write after a payment still passes the guardian rule on that old approval. They are the approved requests not on
--     the roster whose guardian_approved_at is older than their last_rejected_at; the rollback file's PRODUCTION CHECK
--     has the read-only count to record (expected 0). Clearing them would be a one-off for the owner to decide;
--   - a paid game with a payment hold: the hold's window starts at the accept (reviewed_at), but a held minor cannot pay
--     until the guardian approves (enforce_guardian_before_payment), and guardian_approve_join_request does not restart
--     the window, so release_expired_payment_holds can release the place before the child could pay. This was already
--     so for 980 section 5's held accept; this change sends more minors down that path;
--   - nothing changes for the child's own Leave or withdraw. The app's withdraw deletes only a pending or an approved
--     request, but the player's own delete rule ("Players withdraw own join requests") still lets a player delete their
--     declined request through the API and send a new one, as before (20261129130000's decline trigger keeps a host's
--     decision on the invitation side; the request side is not closed here). A new request starts with no approval;
--   - it writes no notification for the guardian when an accept is held for them. The app does that, as for a pending
--     request (owner decision 2026-11-24, "Fix both in the PR"; no database change): after an accept answered with
--     on_roster false, respondToGameInvite asks the server (notifyGuardiansOfPending, kind invite_accept), which checks
--     with the service role that the invitation is the caller's and accepted, that its request is approved with no
--     guardian approval and the child has no roster row, and then tells each guardian in force, unless the child's
--     notifications are off, with the pending request's in-app notice and push (guardian_approval_needed, linking to
--     the Parent Center named by the request, /parent?request=<id>): "<child> accepted an invitation to <game>. Review it
--     in the Parent Center." A guardian already told about the same request since it was last sent or declined (its
--     pending notice, or this one) is not told again, and a notice about an earlier attempt does not stop this one
--     (guardian-push.server). So the game page's "waiting for your parent ... we've let them know" is true here too,
--     unless the child's notifications are off (as for a pending request) or the app's best-effort ping does not land;
--   - the child's pending invitation to the game is left as it was (as before);
--   - the app's accept words: GameInviteBanner ("You're in. The host has been told.") and GameInvitationsSection (on the
--     roster "You're in.", otherwise "Open the game to finish joining") keep them, except when the place waits for the
--     guardian (a guardian link in force and a request with no guardian approval, the game page's own rule): both then
--     say "Invitation accepted. Your parent has to approve before you're in." (not that the guardian was told: the
--     ping is best effort and tells nobody with the child's notifications off, so the toast cannot know). The game page
--     shows the place as waiting for the parent and its auto-join waits for the guardian's approval; the accept
--     reminders (WP 5.4) are saved as on any accept and go out in the app only until the place is final.
--
-- Release order: either order. The app does not read guardian_cancel_child_game's value, the retries are safe with either
-- body, and game_respond_invite's answers keep their shape.
--
-- Rollback: docs/rollbacks/20261130110000_guardian_cancel_keeps_declined_request.down.sql (puts the 20261008160000 body of
-- guardian_cancel_child_game, the 20261127120000 body of game_respond_invite and the 20261110120000 trigger condition back
-- verbatim; guarded). Roll this back before docs/rollbacks/20261127120000_invite_accept_roster.down.sql, whose guard
-- expects game_respond_invite as 20261127120000 left it.

-- a) The cancellation. Anything the child holds for this game goes: an unreviewed payment claim, the request (pending or
-- approved; a declined one stays, with its cooldown, and loses any guardian approval left on it), the roster spot. A
-- verified payment is kept and settled by the roster/request delete triggers.
CREATE OR REPLACE FUNCTION public.guardian_cancel_child_game(_child uuid, _game text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  g record;
  _had_spot boolean;
  _had_request boolean;
  _was_late boolean;
  _who text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_guardian_of(auth.uid(), _child) THEN
    RAISE EXCEPTION 'You can only cancel for a child linked to your account.' USING ERRCODE = '42501';
  END IF;

  SELECT id, title, date, host_id, cancelled_at, completed_at INTO g
    FROM public.hosted_games WHERE id = _game;
  IF g.id IS NULL THEN RAISE EXCEPTION 'Game not found.' USING ERRCODE = 'P0001'; END IF;
  IF g.cancelled_at IS NOT NULL OR g.completed_at IS NOT NULL THEN
    RAISE EXCEPTION 'This game is no longer on.' USING ERRCODE = 'P0001';
  END IF;
  IF now() >= g.date THEN
    RAISE EXCEPTION 'This game has already started.' USING ERRCODE = 'P0001';
  END IF;

  _had_spot := EXISTS (SELECT 1 FROM public.game_participants WHERE game_id = _game AND user_id = _child)
            OR EXISTS (SELECT 1 FROM public.join_requests WHERE game_id = _game AND player_id = _child AND status = 'approved');
  _had_request := EXISTS (SELECT 1 FROM public.join_requests WHERE game_id = _game AND player_id = _child);
  IF NOT _had_spot AND NOT _had_request THEN RETURN 'nothing'; END IF;

  DELETE FROM public.payment_submissions
   WHERE game_id = _game AND player_id = _child AND status = 'pending';
  DELETE FROM public.join_requests WHERE game_id = _game AND player_id = _child AND status <> 'rejected';
  UPDATE public.join_requests SET guardian_approved_at = NULL, guardian_approved_by = NULL
   WHERE game_id = _game AND player_id = _child AND status = 'rejected'
     AND (guardian_approved_at IS NOT NULL OR guardian_approved_by IS NOT NULL);
  DELETE FROM public.game_participants WHERE game_id = _game AND user_id = _child;

  IF _had_spot AND g.host_id IS NOT NULL AND g.host_id <> _child THEN
    _was_late := EXISTS (
      SELECT 1 FROM public.late_cancellations
       WHERE user_id = _child AND kind = 'game' AND ref_id = _game AND created_at >= now() - interval '1 minute');
    -- A late cancel already sent the host its own notice.
    IF NOT _was_late THEN
      SELECT display_name INTO _who FROM public.profiles WHERE id = _child;
      INSERT INTO public.notifications (user_id, type, title, body, link)
      VALUES (
        g.host_id, 'participant_left',
        left(COALESCE(_who, 'A player') || ' left ' || g.title, 200),
        'Their parent or guardian cancelled for them. Their spot is open again.',
        '/games/' || g.id
      );
    END IF;
  END IF;
  RETURN CASE WHEN _had_spot THEN 'cancelled' ELSE 'withdrawn' END;
END;
$$;

-- c) Accepting an invitation: a declined request it reopens counts as having no guardian approval when the function
-- decides whether the place is held for a guardian (b, below, clears the approval in the same update).
CREATE OR REPLACE FUNCTION public.game_respond_invite(_invite uuid, _accept boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  _me   uuid := auth.uid();
  _i    record;
  _g    record;
  _jr   record;
  _jrid uuid;
  _name text;
  _fee  numeric;
  _held boolean;
  _seat boolean;
  _guarded boolean;
  _on   boolean;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '28000'; END IF;
  SELECT * INTO _i FROM public.game_invites WHERE id = _invite AND invitee_id = _me FOR UPDATE;
  IF _i.id IS NULL THEN RAISE EXCEPTION 'INVITE_NOT_FOUND'; END IF;
  IF _i.status <> 'pending' THEN
    RETURN jsonb_build_object('status', _i.status, 'join_request_id', _i.join_request_id,
                              'on_roster', private_sec.is_game_participant(_i.game_id, _me));
  END IF;

  IF NOT _accept THEN
    UPDATE public.game_invites SET status = 'declined', responded_at = now(), updated_at = now() WHERE id = _invite;
    RETURN jsonb_build_object('status', 'declined', 'on_roster', private_sec.is_game_participant(_i.game_id, _me));
  END IF;

  SELECT id, host_id, title, max_players, price INTO _g FROM public.hosted_games WHERE id = _i.game_id FOR NO KEY UPDATE;
  IF NOT private_sec.game_open_for_invites(_i.game_id) OR _g.host_id IS DISTINCT FROM _i.host_id THEN
    UPDATE public.game_invites SET status = 'expired', responded_at = now(), updated_at = now() WHERE id = _invite;
    RETURN jsonb_build_object('status', 'expired', 'on_roster', private_sec.is_game_participant(_i.game_id, _me));
  END IF;

  -- The player's place request for this game (one per game and player), held until the end.
  SELECT id, status, reviewed_at, last_rejected_at, reviewer_notes, guardian_approved_at, guardian_approved_by INTO _jr
    FROM public.join_requests WHERE game_id = _i.game_id AND player_id = _me FOR UPDATE;

  -- Taken back: declined at or after the invitation, whether still declined or sent again since. The decline's time is
  -- last_rejected_at (server clock); reviewed_at (the host's device clock) only on a declined row that has none. A
  -- decline the host did not make (the payment window ran out, a guardian said no) is not a take-back.
  IF _jr.id IS NOT NULL AND _jr.status IN ('rejected', 'pending')
     AND COALESCE(_jr.last_rejected_at, CASE WHEN _jr.status = 'rejected' THEN _jr.reviewed_at END) >= _i.created_at
     AND NOT (_jr.status = 'rejected'
              AND COALESCE(_jr.reviewer_notes, '') IN ('Payment window expired — your spot was released.',
                                                       'Declined by guardian')) THEN
    UPDATE public.game_invites SET status = 'expired', responded_at = now(), updated_at = now() WHERE id = _invite;
    RETURN jsonb_build_object('status', 'expired', 'on_roster', private_sec.is_game_participant(_i.game_id, _me));
  END IF;

  -- The join gate's fee rule: the payee's newest settings row, else the game's price.
  SELECT s.entry_fee INTO _fee
    FROM public.game_payment_settings s
   WHERE s.game_id = _i.game_id AND s.host_id = private_sec.game_payee(s.game_id)
   ORDER BY s.created_at DESC
   LIMIT 1;
  IF NOT FOUND THEN _fee := _g.price; END IF;
  -- The roster trigger's guardian rule, for the request as it stands once approved. A declined request carries no
  -- guardian approval once approved: the update below reopens it, and trg_join_request_reopen_needs_guardian clears it.
  -- A guarded minor already on the roster under a declined request (a host's decline that did not remove them) keeps
  -- both as they are: the update below leaves that request declined, with its approval. Anyone else's is reopened.
  _guarded := COALESCE(public.is_minor(_me), false)
              AND EXISTS (SELECT 1 FROM public.guardian_links WHERE child_user_id = _me AND status = 'active');
  _on := _guarded AND private_sec.is_game_participant(_i.game_id, _me);
  _held := _guarded
           AND NOT COALESCE((_jr.status IS DISTINCT FROM 'rejected' OR _on)
                            AND _jr.guardian_approved_at IS NOT NULL
                            AND private_sec.guardian_approval_valid(_me, _jr.guardian_approved_by), false);
  _seat := COALESCE(_fee, 0) <= 0 AND NOT _held;

  -- Free with no guardian step: the other players' rows. Otherwise, as before: every row.
  IF (SELECT count(*) FROM public.game_participants p
       WHERE p.game_id = _i.game_id AND (NOT _seat OR p.user_id <> _me)) >= _g.max_players THEN
    RETURN jsonb_build_object('status', 'full', 'on_roster', private_sec.is_game_participant(_i.game_id, _me));
  END IF;
  IF NOT COALESCE(private_sec.game_age_fits(_i.game_id, _me), false) THEN
    RAISE EXCEPTION 'INVITE_NOT_AVAILABLE: this invitation can''t be accepted.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- The place request: created as the player (every insert check applies), then approved, as the host would.
  IF _jr.id IS NULL THEN
    INSERT INTO public.join_requests (game_id, host_id, player_id, message, idempotency_key)
    VALUES (_i.game_id, _g.host_id, _me, 'Accepted the host''s invitation', 'invite:' || _invite)
    RETURNING id INTO _jrid;
  ELSE
    _jrid := _jr.id;
  END IF;
  UPDATE public.join_requests
     SET status = 'approved', reviewed_at = now(), reviewer_notes = 'Invited by the host'
   WHERE id = _jrid AND status <> 'approved' AND NOT (status = 'rejected' AND _on);

  -- The place itself, as the player, through every roster trigger; a refusal ends the whole accept.
  IF _seat AND NOT private_sec.is_game_participant(_i.game_id, _me) THEN
    INSERT INTO public.game_participants (game_id, user_id) VALUES (_i.game_id, _me)
    ON CONFLICT (game_id, user_id) DO NOTHING;
  END IF;

  UPDATE public.game_invites
     SET status = 'accepted', responded_at = now(), updated_at = now(), join_request_id = _jrid
   WHERE id = _invite;

  SELECT COALESCE(NULLIF(btrim(p.display_name), ''), 'A player') INTO _name FROM public.profiles p WHERE p.id = _me;
  INSERT INTO public.notifications (user_id, type, title, body, link)
  VALUES (_g.host_id, 'game_invite_accepted', left(COALESCE(_name, 'A player') || ' accepted your invitation', 200),
          left(_g.title, 300), '/games/' || _i.game_id);
  RETURN jsonb_build_object('status', 'accepted', 'join_request_id', _jrid,
                            'on_roster', private_sec.is_game_participant(_i.game_id, _me));
END $$;

-- b) A declined request reopened to 'approved' (an accepted invitation) loses its guardian approval, as one reopened to
-- 'pending' (the child's resend) already did. Same name, timing and function; only the condition is widened.
SET lock_timeout = '5s';
CREATE OR REPLACE TRIGGER trg_join_request_reopen_needs_guardian
BEFORE UPDATE OF status ON public.join_requests
FOR EACH ROW
WHEN (OLD.status = 'rejected' AND NEW.status IN ('pending', 'approved')
      AND (NEW.guardian_approved_at IS NOT NULL OR NEW.guardian_approved_by IS NOT NULL))
EXECUTE FUNCTION private_sec.join_request_reopen_needs_guardian();
RESET lock_timeout;
