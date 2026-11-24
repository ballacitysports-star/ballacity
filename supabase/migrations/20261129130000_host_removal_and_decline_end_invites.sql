-- Host-control gaps left by WP 5.5 (owner decision 2026-11-23): a host's removal declines the player's request, and a
-- host's decline ends the player's pending invitation to that game.
--
-- WHY. Two host decisions did not hold.
-- 1. Removal. The game page's Remove (hostRemoveParticipant) deletes the roster row and then tries to delete the player's
--    join request, which no host rule allows (hosts may only update requests), so it deletes nothing. The request stays
--    'approved', and the player's next visit to the game page (its auto-join for an approved player) puts them back.
-- 2. Decline. game_respond_invite's taken-back rule (20261127120000) reads only the player's own request row. The player
--    can delete a declined request ("Players withdraw own join requests") or send it again and write their own
--    last_rejected_at, and the old pending invitation then approves them. Only the app's best-effort game_cancel_invite on
--    decline protected this ("KNOWN GAP" in 20261127120000).
--
-- WHAT. Two functions and one trigger are added. No table, policy, existing trigger or existing function changes, and no
-- stored row is rewritten.
-- a) public.host_remove_player(_game text, _player uuid) RETURNS jsonb. SECURITY DEFINER, empty search_path, EXECUTE for
--    authenticated (not PUBLIC or anon; service_role keeps the Supabase default grant, and without a signed-in user it is
--    refused AUTH_REQUIRED). The caller must be the game's host (hosted_games.host_id), exactly the roster DELETE rule
--    "Hosts can remove participants from their games"; no one else, not a moderator (that rule has no moderator clause).
--    Anyone else: NOT_GAME_HOST (42501), a missing game included; signed out: AUTH_REQUIRED (28000). In one transaction:
--      - deletes the player's roster row (if any; every roster delete trigger runs, with auth.uid() the host, as before);
--      - sets the player's pending invitation to that game to 'cancelled' (what game_cancel_invite writes: status and
--        updated_at; responded_at stays NULL, the player did not answer it);
--      - declines the player's request for that game if it is not declined already: status 'rejected', reviewed_at now(),
--        reviewer_notes 'Removed by host' (the roster row's Remove writes the same note). The resubmit trigger stamps
--        last_rejected_at, as on every decline, so the player may send the request again after the cooldown and the host
--        decides again. Guardian approval fields are left as they are, as a host's decline leaves them.
--    Answers {removed, request_declined, invites_cancelled}.
-- b) Trigger trg_join_request_host_decline_ends_invites, AFTER UPDATE OF status ON public.join_requests, FOR EACH ROW,
--    when a request moves to 'rejected' (from anything else). It sets the player's pending invitation to that game to
--    'cancelled', but only for a host's decision: the actor (auth.uid()) is the request's or the game's host, or a
--    moderator, and the request does not carry either note game_respond_invite's taken-back rule excludes: the payment
--    window ('Payment window expired — your spot was released.', release_expired_payment_holds) and a guardian's no
--    ('Declined by guardian', guardian_approve_join_request). Those two are checked together with the actor: a host who
--    is also the child's guardian declining as guardian, or a host who runs release_expired_payment_holds for their game,
--    is not a host decision. The service role (no auth.uid()) ends nothing.
--    The decision now survives the player deleting or rewriting the request: the invitation is already 'cancelled', so
--    game_respond_invite answers 'cancelled' and approves nothing.
--
-- LOCKS. game_respond_invite takes the invitation (FOR UPDATE), then the game (FOR NO KEY UPDATE), then the request (FOR
-- UPDATE). host_remove_player takes them in that same order (after an unlocked host check, repeated under the game lock),
-- so a removal and an accept for the same player queue at the invitation instead of deadlocking: whichever comes second
-- sees the first's outcome (an accept after a removal answers 'cancelled'; a removal after an accept removes the place
-- the accept gave and declines the request it approved).
-- The decline trigger runs while the declining UPDATE already holds the request, and then waits for the pending
-- invitation like any UPDATE, whoever holds it. Holders include game_respond_invite (accept or no), game_cancel_invite,
-- host_remove_player, the foreign-key action of a player deleting the availability post the invitation came from (ON
-- DELETE SET NULL updates it and holds it until that delete commits) and cascades that delete it (a game, an account);
-- the trigger does not rely on that list being complete. It waits for the holder to commit or roll back, then cancels
-- the invitation if it is still pending; a holder that gives up (a timeout, a dropped connection) leaves it to the
-- decline. A holder that is itself waiting for this request (an accept or a removal under way, for example) makes the
-- wait a deadlock, and Postgres ends one side after deadlock_timeout. If it ends the holder, nothing of it is kept and
-- the decline cancels the invitation (a player who was accepting sees an error and, trying again, 'cancelled'). If it
-- ends the trigger's wait, the trigger gives the wait up (that error only) and the decline commits: the holder then
-- reads the request declined after the invitation (an accept answers 'expired', a removal cancels it).
-- Residual: in that last case, a holder that fails after the decline commits, or one that does not end the invitation,
-- leaves it pending, guarded only by the taken-back rule, as before this migration.
-- Residual, as for the accept: the removal holds the game before the request, while release_expired_payment_holds and
-- guardian_cancel_child_game hold the request and then update the game (the roster delete's joined count). A removal at
-- the same moment as one of them, for the same player, can deadlock; Postgres ends one of the two and nothing half-done
-- is kept. The app tries an ended removal once more (hostRemoveParticipant, on 40P01); an ended sweep runs again on its
-- next schedule.
--
-- WHAT IT DOES NOT DO (no one-off is part of this change):
--   - requests left 'approved' by removals made before this migration stay approved;
--   - invitations already pending under a request declined before this migration are still guarded only by the taken-back
--     rule (980's KNOWN GAP fixtures, written straight into the table, still behave as recorded there);
--   - on an open game (requires_approval false) the join gate never reads the request, so a removed player can still
--     join again directly, as before.
--
-- Release order: apply this migration, then publish the app (hostRemoveParticipant calls host_remove_player and falls
-- back to its old statements while the function is missing, so either order works).
--
-- Rollback: docs/rollbacks/20261129130000_host_removal_and_decline_end_invites.down.sql.

CREATE FUNCTION public.host_remove_player(_game text, _player uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  _me        uuid := auth.uid();
  _host      uuid;
  _jr        record;
  _removed   integer := 0;
  _cancelled integer := 0;
  _declined  integer := 0;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '28000'; END IF;
  -- The roster DELETE rule's test, before anything is locked.
  SELECT g.host_id INTO _host FROM public.hosted_games g WHERE g.id = _game;
  IF _host IS NULL OR _host IS DISTINCT FROM _me OR _player IS NULL THEN
    RAISE EXCEPTION 'NOT_GAME_HOST: only the game''s host can remove players from it.' USING ERRCODE = '42501';
  END IF;

  -- game_respond_invite's order: the invitation, the game, the request.
  PERFORM 1 FROM public.game_invites i
   WHERE i.game_id = _game AND i.invitee_id = _player AND i.status = 'pending'
     FOR UPDATE;
  SELECT g.host_id INTO _host FROM public.hosted_games g WHERE g.id = _game FOR NO KEY UPDATE;
  IF _host IS DISTINCT FROM _me THEN
    RAISE EXCEPTION 'NOT_GAME_HOST: only the game''s host can remove players from it.' USING ERRCODE = '42501';
  END IF;
  SELECT jr.id, jr.status INTO _jr
    FROM public.join_requests jr
   WHERE jr.game_id = _game AND jr.player_id = _player
     FOR UPDATE;

  DELETE FROM public.game_participants p WHERE p.game_id = _game AND p.user_id = _player;
  GET DIAGNOSTICS _removed = ROW_COUNT;

  -- What game_cancel_invite writes.
  UPDATE public.game_invites i
     SET status = 'cancelled', updated_at = now()
   WHERE i.game_id = _game AND i.invitee_id = _player AND i.status = 'pending';
  GET DIAGNOSTICS _cancelled = ROW_COUNT;

  -- What a host's decline writes; the resubmit trigger stamps last_rejected_at.
  IF _jr.id IS NOT NULL AND _jr.status IS DISTINCT FROM 'rejected' THEN
    UPDATE public.join_requests
       SET status = 'rejected', reviewed_at = now(), reviewer_notes = 'Removed by host'
     WHERE id = _jr.id AND status <> 'rejected';
    GET DIAGNOSTICS _declined = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object('removed', _removed > 0, 'request_declined', _declined > 0,
                            'invites_cancelled', _cancelled);
END $$;
REVOKE ALL ON FUNCTION public.host_remove_player(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.host_remove_player(text, uuid) TO authenticated;

-- A host's (or moderator's) decline ends the player's pending invitation to that game. Runs as the table owner: the host
-- has no write rule on invitations.
CREATE FUNCTION private_sec.join_request_host_decline_ends_invites()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  _me uuid := auth.uid();
BEGIN
  -- The two declines game_respond_invite's taken-back rule does not count as the host's.
  IF COALESCE(NEW.reviewer_notes, '') IN ('Payment window expired — your spot was released.', 'Declined by guardian') THEN
    RETURN NULL;
  END IF;
  IF _me IS NULL
     OR NOT (_me = NEW.host_id
             OR _me = (SELECT g.host_id FROM public.hosted_games g WHERE g.id = NEW.game_id)
             OR COALESCE(public.is_moderator(_me), false)) THEN
    RETURN NULL;
  END IF;
  -- Waits for whoever holds the invitation (see LOCKS in the header). Only when that holder is itself waiting for this
  -- request (an accept or a removal under way) is the wait a deadlock; if this side is the one Postgres stops, the wait
  -- is given up and the decline goes on: the holder reads the declined request once this commits.
  BEGIN
    UPDATE public.game_invites i
       SET status = 'cancelled', updated_at = now()
     WHERE i.game_id = NEW.game_id AND i.invitee_id = NEW.player_id AND i.status = 'pending';
  EXCEPTION WHEN deadlock_detected THEN
    NULL;
  END;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION private_sec.join_request_host_decline_ends_invites() FROM PUBLIC, anon, authenticated, service_role;

-- CREATE TRIGGER takes SHARE ROW EXCLUSIVE on join_requests (writers wait for it, readers do not). If another transaction
-- holds the table, the apply fails after 5 seconds instead of queueing every writer behind it; run it again.
SET lock_timeout = '5s';
CREATE TRIGGER trg_join_request_host_decline_ends_invites
AFTER UPDATE OF status ON public.join_requests
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM 'rejected' AND NEW.status = 'rejected')
EXECUTE FUNCTION private_sec.join_request_host_decline_ends_invites();
RESET lock_timeout;
