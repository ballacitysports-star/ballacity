-- WP 5.5 (narrowed, owner decision 2026-11-23): accepting an invitation to a free game puts the player on the roster.
--
-- WHY. game_respond_invite (20261119100000) approves the invitee's place request and stops there. On a free game the roster
-- row is written later by the browser (the game page's auto-join), so an invitee who accepts from My availability and never
-- opens the game page is "accepted" but not playing, and the host's roster does not show them. Separately, an invitation
-- outlives the host taking the place back: if the host declined the player's request after inviting them, accepting the
-- old invitation flips that declined request back to approved.
--
-- WHAT. public.game_respond_invite is replaced; same signature, grants, SECURITY DEFINER and empty search_path. Nothing else
-- changes: no table, trigger, policy or other function, and no stored row is rewritten.
-- 1. Free game, no guardian approval outstanding: the accept also writes the game_participants row (game_id, user_id), in
--    the same transaction, after the game-row lock the function already takes, as the invitee (auth.uid() is the invitee,
--    so every roster trigger sees a player joining for themselves: the join gate, the age requirement, the host's blocks,
--    the child-participation and per-game guardian rules). If any of them refuses, the error ends the whole accept: the
--    request is not approved and the invitation stays pending.
--      - "Free" is the join gate's own fee rule (enforce_game_join_gate): the newest game_payment_settings row written by
--        the game's payee, else the game's price; free when that fee is 0 or missing.
--      - "Guardian approval outstanding" is the roster trigger's own rule (enforce_child_game_participation): a minor with an
--        active guardian link whose request for this game carries no approval from a guardian who still has authority. The
--        request is unique per game and player and is 'approved' once accepted, so this is exactly the trigger's test.
--      - Capacity on this path: the other players' roster rows (the player's own row, if any, is not counted) against
--        max_players. A full game answers {status:'full'} and writes nothing; the invitation stays pending.
--      - A player already on the roster gets no second row (the row is written only when absent; ON CONFLICT DO NOTHING).
-- 2. Paid games and places a guardian still has to approve: exactly as before. The request is approved, no roster row is
--    written, and capacity is counted as before (every roster row).
-- 3. A taken-back invitation: when the player's request for this game was declined at or after the invitation was created
--    (its last_rejected_at, which the server stamps on every decline; reviewed_at, which the host's device writes, only on
--    a declined request with no last_rejected_at), whether it is still declined or the player has sent it again (pending),
--    the accept approves nothing and marks the invitation 'expired'. A request declined before the invitation is approved
--    by the accept, as before: the host invited the player knowing.
--      - Only the host takes an invitation back. Two declines the host never made are not counted while the request still
--        carries the note they write: the payment window running out (release_expired_payment_holds, 'Payment window
--        expired — your spot was released.') and a guardian's no (guardian_approve_join_request, 'Declined by guardian').
--        Those accept as before; a guardian's no also clears the guardian's approval, so the roster trigger's guardian rule
--        still holds the place (no roster row until a guardian says yes again). The host's re-invitation then works: it
--        returns the same pending invitation, created before the decline.
--      - Sending the request again clears its note (enforce_join_request_resubmit_rules), so such a decline followed by a
--        resend reads as the host's and the accept answers 'expired'. 980 records this by name.
--    KNOWN GAP, not closed here (it needs another object changed, outside this WP's scope): the rule can only read the
--    player's own request row, and the player can delete it ("Players withdraw own join requests"; the app's Cancel request
--    on a resent one) or, when sending a declined request again, write their own last_rejected_at (the resubmit trigger
--    does not pin it). Either way the decline leaves no trace here and the accept goes through. The app ends the
--    invitation when the host declines (game_cancel_invite, best-effort), which covers declines made from the new app when
--    that call succeeds; invitations already pending under a declined request rely on this rule alone. 980 records both
--    bypasses by name, so closing the gap is a deliberate change to that test.
-- 4. Every answer carries on_roster: whether the player has a roster row in that game when the function returns.
--
-- Release order: publish the app first (it reads on_roster and tolerates its own roster row already existing), then apply
-- this migration. The app copes with either version of the function.
--
-- Rollback: docs/rollbacks/20261127120000_invite_accept_roster.down.sql (restores 20261119100000's definition verbatim).

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
  -- The roster trigger's guardian rule, for the request as it stands once approved.
  _held := COALESCE(public.is_minor(_me), false)
           AND EXISTS (SELECT 1 FROM public.guardian_links WHERE child_user_id = _me AND status = 'active')
           AND NOT COALESCE(_jr.guardian_approved_at IS NOT NULL
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
   WHERE id = _jrid AND status <> 'approved';

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
REVOKE ALL ON FUNCTION public.game_respond_invite(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.game_respond_invite(uuid, boolean) TO authenticated;
