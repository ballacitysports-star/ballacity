-- ROLLBACK for supabase/migrations/20261129130000_host_removal_and_decline_end_invites.sql (host removal declines the
-- request; a host's decline ends the player's pending invitation).
-- NOT a migration. It drops the trigger trg_join_request_host_decline_ends_invites on public.join_requests, then the
-- functions private_sec.join_request_host_decline_ends_invites() and public.host_remove_player(text, uuid).
-- ROWS ARE NOT PUT BACK. Requests the function or a host's decline set to 'rejected' stay declined, roster rows it deleted
-- stay deleted, and invitations it or the trigger set to 'cancelled' stay cancelled. This only stops further changes.
-- After it, a host's decline no longer ends the invitation on the server (only the app's best-effort game_cancel_invite
-- does, as before), so the WP 5.5 known gap is open again. The app copes: hostRemoveParticipant falls back to its old
-- statements when host_remove_player is missing (PGRST202/42883), and with them the removal leaves the request approved
-- again (the gap this migration closed). Say both in the release record.
-- It stops, changing nothing, unless both functions still have the definitions 20261129130000 gave them and the same
-- API-role grants (EXECUTE on host_remove_player for authenticated and service_role, none on the trigger function), the
-- trigger is the one it created (same definition, enabled), no other trigger runs the trigger function, and no other
-- function names either function. A later change needs a person to look first.
-- It refuses to run unless the session sets the confirmation first:
--     SET app.confirm_host_removal_rollback = 'yes';
-- Locks: DROP TRIGGER takes ACCESS EXCLUSIVE on public.join_requests for a moment; it gives up after 5 seconds rather than
-- queue readers and writers behind a long transaction (run it again).
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $guard$
DECLARE
  _want CONSTANT text[][] := ARRAY[
    ['public.host_remove_player(text,uuid)',                   'ebdc548c85bd4abf4545f48ced07fddd', 'authenticated:EXECUTE,service_role:EXECUTE'],
    ['private_sec.join_request_host_decline_ends_invites()',   '0c6d5541cd4160631348b26d220b41a7', '']];
  _trigger_md5 CONSTANT text := '6acada385bf14e2035ae127d5c2b65ff';
  _callee_re CONSTANT text := '\m(host_remove_player|join_request_host_decline_ends_invites)\M';
  _guarded oid[] := '{}';
  _fn regprocedure;
  _got text;
  i int;
BEGIN
  IF current_setting('app.confirm_host_removal_rollback', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'Refusing to run: a host''s removal stops declining the request (the removed player can rejoin again) and a host''s decline stops ending the invitation on the server. Requests already declined and invitations already cancelled stay as they are. Set app.confirm_host_removal_rollback=yes for the session to proceed deliberately.';
  END IF;
  FOR i IN 1 .. array_length(_want, 1) LOOP
    _fn := to_regprocedure(_want[i][1]);
    SELECT md5(pg_get_functiondef(p.oid)) INTO _got FROM pg_proc p WHERE p.oid = _fn;
    IF _fn IS NULL OR _got IS DISTINCT FROM _want[i][2] THEN
      RAISE EXCEPTION 'Refusing to run: % is not the definition 20261129130000 created (md5 %). A later change needs a person to look first.', _want[i][1], _got;
    END IF;
    SELECT coalesce(string_agg(coalesce(r.rolname, 'PUBLIC') || ':' || x.privilege_type, ',' ORDER BY coalesce(r.rolname, 'PUBLIC')), '')
      INTO _got
      FROM pg_proc p
      CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
      LEFT JOIN pg_roles r ON r.oid = x.grantee
     WHERE p.oid = _fn AND coalesce(r.rolname, 'PUBLIC') IN ('PUBLIC', 'anon', 'authenticated', 'service_role');
    IF _got IS DISTINCT FROM _want[i][3] THEN
      RAISE EXCEPTION 'Refusing to run: the grants on % are not the ones 20261129130000 gave (%). A later change needs a person to look first.', _want[i][1], _got;
    END IF;
    _guarded := _guarded || _fn::oid;
  END LOOP;
  SELECT md5(pg_get_triggerdef(t.oid)) || '/' || t.tgenabled::text INTO _got
    FROM pg_trigger t
   WHERE t.tgrelid = 'public.join_requests'::regclass AND t.tgname = 'trg_join_request_host_decline_ends_invites';
  IF _got IS DISTINCT FROM _trigger_md5 || '/O' THEN
    RAISE EXCEPTION 'Refusing to run: trg_join_request_host_decline_ends_invites is missing, changed or disabled (%). A later change needs a person to look first.', _got;
  END IF;
  SELECT string_agg(t.tgrelid::regclass::text || '.' || t.tgname, ', ') INTO _got
    FROM pg_trigger t
   WHERE t.tgfoid = 'private_sec.join_request_host_decline_ends_invites()'::regprocedure
     AND NOT (t.tgrelid = 'public.join_requests'::regclass AND t.tgname = 'trg_join_request_host_decline_ends_invites');
  IF _got IS NOT NULL THEN
    RAISE EXCEPTION 'Refusing to run: % also runs the trigger function this rollback drops. A later change needs a person to look first.', _got;
  END IF;
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO _got
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
     AND p.oid <> ALL (_guarded)
     AND p.prosrc ~ _callee_re;
  IF _got IS NOT NULL THEN
    RAISE EXCEPTION 'Refusing to run: % names a function this rollback drops. A later change needs a person to look first.', _got;
  END IF;
END
$guard$;

-- The trigger first, so no decline runs against a dropped function.
DROP TRIGGER trg_join_request_host_decline_ends_invites ON public.join_requests;
DROP FUNCTION private_sec.join_request_host_decline_ends_invites();
DROP FUNCTION public.host_remove_player(text, uuid);

COMMIT;
