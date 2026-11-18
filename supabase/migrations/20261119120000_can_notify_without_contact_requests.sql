-- can_notify: an availability contact request is no longer a relationship that lets one member notify another.
--
-- WHY. can_notify(caller, target) (20260715040319) was the only check on createNotificationForUser and sendPushToUser, which
-- took any type, title, body and link from the caller's app. Its last clause made it true as soon as ANY row in
-- availability_contact_requests linked the two people, in either direction. One contact request, which anyone may send to
-- anyone whose availability post they can read, therefore let the sender's app put any text and any link (another site, or
-- a misleading in-app path) in the other person's notifications and on their lock screen: a phishing and spoofing channel.
--
-- WHAT THE APP DOES NOW (same commit). createNotificationForUser takes only an allow-listed type and the row it is about
-- (a game, a message, an availability post); the server checks the caller's part in that row and writes the title, body
-- and in-app link itself (src/lib/notification-requests.ts, src/lib/notification-plan.server.ts). sendPushToUser is gone:
-- a push to someone else goes out only with the notification it mirrors. Neither asks can_notify any more. The two things
-- that relied on this clause are checked against their own rows instead: "availability updated" reaches only the people
-- who sent a request about that post, from its author; the legacy invite reaches only the player a pending invite request
-- names, from the host of the game it names (WP 2.0, 20261119100000, writes invitations in the database instead).
--
-- WHAT THIS DOES. Replaces the body of private_sec.can_notify (where 20261112150000 moved the original; every caller,
-- including any policy, reaches it) with 20260715040319's definition minus the availability_contact_requests clause.
-- Nothing else changes: same signature, return type, SECURITY DEFINER and search_path; CREATE OR REPLACE keeps the OID,
-- the owner and the grants, and the public wrapper (fixed answer for a signed-in client asking about others) is untouched,
-- as 20261112150000 asks of later redefinitions. The remaining clauses (a shared conversation, a join request, a game the
-- one hosts and the other plays in, a game both play in, or the same person) are unchanged.
--
-- APP FIRST. Apply this after the app carrying this commit is published. The old app's invite and "availability updated"
-- notifications asked can_notify and would be refused here; the new app does not ask it, so it works before and after.
--
-- ROLLBACK: docs/rollbacks/20261119120000_can_notify_without_contact_requests.down.sql (guarded; puts the clause back).
-- TEST: supabase/tests/890_can_notify_without_contact_requests.test.sql.

SET lock_timeout = '5s';

DO $guard$
BEGIN
  IF to_regprocedure('private_sec.can_notify(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'private_sec.can_notify(uuid,uuid) is missing: apply 20261112150000_helper_oracle_containment first.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.oid = 'public.can_notify(uuid,uuid)'::regprocedure
      AND NOT p.prosecdef AND p.prosrc LIKE '%private_sec.rpc_probe_denied%'
  ) THEN
    RAISE EXCEPTION 'public.can_notify is not the 20261112150000 wrapper; a person needs to look before its body is replaced.';
  END IF;
END
$guard$;

CREATE OR REPLACE FUNCTION private_sec.can_notify(_caller uuid, _target uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
  SELECT
    _caller IS NOT NULL AND _target IS NOT NULL AND (
      _caller = _target
      OR EXISTS (
        SELECT 1
        FROM public.conversation_participants a
        JOIN public.conversation_participants b ON b.conversation_id = a.conversation_id
        WHERE a.user_id = _caller AND b.user_id = _target
      )
      OR EXISTS (
        SELECT 1 FROM public.join_requests jr
        WHERE (jr.host_id = _caller AND jr.player_id = _target)
           OR (jr.host_id = _target AND jr.player_id = _caller)
      )
      OR EXISTS (
        SELECT 1 FROM public.game_participants gp
        JOIN public.hosted_games hg ON hg.id = gp.game_id
        WHERE (hg.host_id = _caller AND gp.user_id = _target)
           OR (hg.host_id = _target AND gp.user_id = _caller)
      )
      OR EXISTS (
        SELECT 1 FROM public.game_participants a
        JOIN public.game_participants b ON b.game_id = a.game_id
        WHERE a.user_id = _caller AND b.user_id = _target
      )
    );
$$;

COMMENT ON FUNCTION private_sec.can_notify(uuid, uuid) IS
  'Whether two people share a conversation, a join request or a game. An availability contact request does not count (20261119120000). The app no longer asks it before notifying; createNotificationForUser checks the named row instead.';
