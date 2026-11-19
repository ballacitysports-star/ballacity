-- ROLLBACK for supabase/migrations/20261121100000_game_host_affiliation.sql (WP 3.0).
-- NOT a migration. It drops the trigger enforce_game_host_affiliation_trg and its function. Afterwards the server again accepts
-- any team id on a member's game, and a game without a team from anyone allowed to host (16-17 included). It changes no game:
-- games hosted without a team stay as they are.
-- It stops, changing nothing, if the function no longer has the definition 20261121100000 gave it (a later change needs a
-- person to look first), and refuses to run unless the session sets the confirmation first:
--     SET app.confirm_game_host_affiliation_rollback = 'yes';
BEGIN;
DO $guard$
DECLARE
  _got text;
BEGIN
  IF current_setting('app.confirm_game_host_affiliation_rollback', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'Refusing to run: this lets members publish games under teams they do not manage. Set app.confirm_game_host_affiliation_rollback=yes for the session to proceed deliberately.';
  END IF;
  SELECT md5(pg_get_functiondef(p.oid)) INTO _got
    FROM pg_proc p WHERE p.oid = to_regprocedure('private_sec.enforce_game_host_affiliation()');
  IF _got IS DISTINCT FROM '0e5d61fb8d43d75b5d6ed438362fee6d' THEN
    RAISE EXCEPTION 'Refusing to run: private_sec.enforce_game_host_affiliation is not the definition 20261121100000 created (md5 %). A later change needs a person to look first.', _got;
  END IF;
END
$guard$;

SET LOCAL lock_timeout = '5s';

DROP TRIGGER enforce_game_host_affiliation_trg ON public.hosted_games;
DROP FUNCTION private_sec.enforce_game_host_affiliation();

COMMIT;
