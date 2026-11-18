-- ROLLBACK for supabase/migrations/20261119120000_can_notify_without_contact_requests.sql.
-- NOT a migration. It puts the availability_contact_requests clause back into private_sec.can_notify, so one contact request
-- (in either direction) again counts as a relationship. Every other clause, the public wrapper, the OID, owner and grants
-- stay as they are (CREATE OR REPLACE, as 20261112150000 asks).
--
-- What it does NOT bring back: the free-text createNotificationForUser and sendPushToUser that made that clause a phishing
-- channel. The app no longer asks can_notify, so this rollback only matters for an old app build (one from before this
-- change), whose invite and "availability updated" notifications needed the clause. Roll the app back first only if you
-- must, and know that doing so reopens the hole this change closed.
--
-- It stops, changing nothing, if private_sec.can_notify no longer has the definition 20261119120000 gave it (a later change
-- needs a person to look first), and refuses to run unless the session sets the confirmation first:
--     SET app.confirm_can_notify_contact_request_rollback = 'yes';
BEGIN;
DO $guard$
DECLARE
  _got text;
BEGIN
  IF current_setting('app.confirm_can_notify_contact_request_rollback', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'Refusing to run: this lets an availability contact request count as a relationship for can_notify again. Set app.confirm_can_notify_contact_request_rollback=yes for the session to proceed deliberately.';
  END IF;
  SELECT md5(pg_get_functiondef(p.oid)) INTO _got
    FROM pg_proc p WHERE p.oid = to_regprocedure('private_sec.can_notify(uuid,uuid)');
  IF _got IS DISTINCT FROM 'b91a31b96b924565a8fdabb49d3145f9' THEN
    RAISE EXCEPTION 'Refusing to run: private_sec.can_notify is not the definition 20261119120000 created (md5 %). A later change needs a person to look first.', _got;
  END IF;
END
$guard$;

SET LOCAL lock_timeout = '5s';

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
      OR EXISTS (
        SELECT 1 FROM public.availability_contact_requests acr
        WHERE (acr.from_user_id = _caller AND acr.to_user_id = _target)
           OR (acr.from_user_id = _target AND acr.to_user_id = _caller)
      )
    );
$$;

COMMENT ON FUNCTION private_sec.can_notify(uuid, uuid) IS NULL;

COMMIT;
