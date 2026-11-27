-- ROLLBACK for supabase/migrations/20261204100000_removal_ask_limits.sql (a removed player's asks are limited on the
-- removal record, and a player the host blocked cannot send a declined request again).
-- NOT a migration. The migration replaced no definition, so nothing is put back: it drops what the migration added, the
-- three triggers on public.join_requests (trg_join_request_removed_ask_insert, trg_join_request_removed_ask_resend and
-- enforce_host_block_resend), the function private_sec.removed_player_ask_limits() and the columns asks and last_ask_at
-- of public.game_removals. public.enforce_host_block() stays: 20261028150000's, still run by the insert triggers.
--
-- WHAT IT CANNOT UNDO: the ask counts and times are dropped with the columns and are not kept anywhere. After the
-- rollback a removed player can again delete their own request and ask again at once, without limit (the gap 996 used to
-- pin as NOT CLOSED, and 996's CLOSED lines fail again), and a player the host blocked can again move their declined
-- request back to pending. The removal records themselves stay. Say so in the release record. The app copes with either
-- version: it shows the same sentences, and it names the columns it reads from game_removals.
--
-- It stops, changing nothing, unless the function is exactly what 20261204100000 created (md5 below), owned by
-- postgres, SECURITY DEFINER, with no API-role grant; the three triggers are the ones it created, on public.join_requests,
-- enabled (tgenabled 'O', which pg_get_triggerdef does not show); the two columns have the type, default and nullability
-- it gave them; no other function's source names asks or last_ask_at next to game_removals, and no other trigger runs the
-- function (a later change that reads them would break when they go); public.enforce_host_block() is still
-- 20261028150000's; and the table's API grants are the ones 20261202100000 left. A later change to any of them needs a
-- person to look first. After dropping, it checks that the triggers, the function and the columns are gone and that
-- enforce_host_block and the table's grants are unchanged, and if not, undoes itself.
-- It refuses to run unless the session sets the confirmation first:
--     SET app.confirm_removal_ask_limits_rollback = 'yes';
--     (or PGOPTIONS="-c app.confirm_removal_ask_limits_rollback=yes")
-- ORDER: run this before docs/rollbacks/20261202100000_removal_sticks.down.sql. That rollback drops public.game_removals
-- and refuses while another function's source names the table, which this migration's function does, so the order is
-- enforced there too.
-- LEDGER: this file does not touch supabase_migrations.schema_migrations. After a successful rollback, delete the ledger
-- row for 20261204100000 by hand (as the earlier release records do), or the ledger says applied while the objects are
-- gone, and a later re-apply hits a primary-key conflict.
-- PRODUCTION CHECK: the md5 values here were computed on the local Postgres 16; production runs 17 and
-- pg_get_functiondef and pg_get_triggerdef text may differ between versions. The guard fails closed (it refuses,
-- changing nothing), but do not find that out in an emergency: after applying the migration, run this read-only query
-- in production and record the result in the release record. It must list exactly the values in the guard below; if
-- not, the guard values here need a person to look first.
--     SELECT md5(pg_get_functiondef('private_sec.removed_player_ask_limits()'::regprocedure));
--   (expected 546985774379162ec78158745a071138)
--     SELECT t.tgname, md5(pg_get_triggerdef(t.oid)) || '/' || t.tgenabled::text FROM pg_trigger t
--      WHERE t.tgrelid = 'public.join_requests'::regclass
--        AND t.tgname IN ('enforce_host_block_resend', 'trg_join_request_removed_ask_insert',
--                         'trg_join_request_removed_ask_resend') ORDER BY 1;
--   (expected enforce_host_block_resend 22d086340dff97a68b3088586f94e9a8/O,
--    trg_join_request_removed_ask_insert 3b73758ffddeef6665b199a830beea11/O,
--    trg_join_request_removed_ask_resend ee897bf53cb82b01fdb49c464ff47088/O)
-- Locks: DROP TRIGGER takes ACCESS EXCLUSIVE on public.join_requests and ALTER TABLE DROP COLUMN takes it on
-- public.game_removals, both until the commit, in that order (the app's order: the request, then the removal row).
-- Readers and writers of both wait, briefly: a request sent or decided, and the join gate on every roster insert. The
-- wait for each is limited to 5 s. Dropping a column does not rewrite the table.
BEGIN;
DO $guard$
DECLARE
  _fn CONSTANT text := 'private_sec.removed_player_ask_limits()';
  _got text;
BEGIN
  IF current_setting('app.confirm_removal_ask_limits_rollback', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'Refusing to run: every removed player''s ask count would be dropped, a removed player could again delete their request and ask again at once without limit, and a player the host blocked could again send a declined request back to the host. Set app.confirm_removal_ask_limits_rollback=yes for the session to proceed deliberately.';
  END IF;
  SELECT md5(pg_get_functiondef(p.oid)) || '/' || p.proowner::regrole::text || '/' || p.prosecdef::text INTO _got
    FROM pg_proc p WHERE p.oid = to_regprocedure(_fn);
  IF _got IS DISTINCT FROM '546985774379162ec78158745a071138/postgres/true' THEN
    RAISE EXCEPTION 'Refusing to run: % is not the definition 20261204100000 created, owned by postgres and SECURITY DEFINER (%, expected 546985774379162ec78158745a071138/postgres/true). A later change needs a person to look first.',
      _fn, coalesce(_got, 'missing');
  END IF;
  SELECT string_agg(coalesce(r.rolname, 'PUBLIC') || ':' || x.privilege_type, ',' ORDER BY coalesce(r.rolname, 'PUBLIC'))
    INTO _got
    FROM pg_proc p
    CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
    LEFT JOIN pg_roles r ON r.oid = x.grantee
   WHERE p.oid = to_regprocedure(_fn) AND coalesce(r.rolname, 'PUBLIC') IN ('PUBLIC', 'anon', 'authenticated', 'service_role');
  IF _got IS NOT NULL THEN
    RAISE EXCEPTION 'Refusing to run: % has API-role grants 20261204100000 did not give (%). A later change needs a person to look first.', _fn, _got;
  END IF;
  -- The three triggers it created, on public.join_requests, enabled; and nothing else runs the function.
  SELECT string_agg(n.nspname || '.' || c.relname || '.' || t.tgname || '=' || md5(pg_get_triggerdef(t.oid)) || '/' || t.tgenabled::text,
                    ', ' ORDER BY t.tgname)
    INTO _got FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE (t.tgname IN ('enforce_host_block_resend', 'trg_join_request_removed_ask_insert', 'trg_join_request_removed_ask_resend')
          OR t.tgfoid = to_regprocedure(_fn))
     AND NOT t.tgisinternal;
  IF _got IS DISTINCT FROM 'public.join_requests.enforce_host_block_resend=22d086340dff97a68b3088586f94e9a8/O, '
                           'public.join_requests.trg_join_request_removed_ask_insert=3b73758ffddeef6665b199a830beea11/O, '
                           'public.join_requests.trg_join_request_removed_ask_resend=ee897bf53cb82b01fdb49c464ff47088/O' THEN
    RAISE EXCEPTION 'Refusing to run: the triggers 20261204100000 created are not as it left them, enabled, or another trigger runs its function (%). A later change needs a person to look first.', coalesce(_got, 'none');
  END IF;
  -- The two columns, as it added them.
  SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text || ':'
                    || coalesce(pg_get_expr(d.adbin, d.adrelid), ''), ',' ORDER BY a.attname)
    INTO _got
    FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
   WHERE a.attrelid = to_regclass('public.game_removals') AND a.attname IN ('asks', 'last_ask_at') AND NOT a.attisdropped;
  IF _got IS DISTINCT FROM 'asks:integer:true:0,last_ask_at:timestamp with time zone:false:' THEN
    RAISE EXCEPTION 'Refusing to run: the columns asks and last_ask_at of public.game_removals are not as 20261204100000 added them (%). A later change needs a person to look first.', coalesce(_got, 'missing');
  END IF;
  -- The function the resend trigger runs stays (20261028150000's); it must still be the one the migration checked.
  SELECT md5(pg_get_functiondef(p.oid)) INTO _got FROM pg_proc p WHERE p.oid = to_regprocedure('public.enforce_host_block()');
  IF _got IS DISTINCT FROM '6b1d17279ccbb3238ceecd2bde49ba2d' THEN
    RAISE EXCEPTION 'Refusing to run: public.enforce_host_block() has md5 %, not 20261028150000''s 6b1d17279ccbb3238ceecd2bde49ba2d. A later change needs a person to look first.', coalesce(_got, 'missing');
  END IF;
  -- The table's API grants, as 20261202100000 left them (this migration added none).
  SELECT coalesce(string_agg(coalesce(r.rolname, 'PUBLIC') || ':' || x.privilege_type, ',' ORDER BY coalesce(r.rolname, 'PUBLIC'), x.privilege_type), '')
    INTO _got
    FROM pg_class c
    CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) x
    LEFT JOIN pg_roles r ON r.oid = x.grantee
   WHERE c.oid = 'public.game_removals'::regclass AND coalesce(r.rolname, 'PUBLIC') IN ('PUBLIC', 'anon', 'authenticated', 'service_role');
  IF _got IS DISTINCT FROM 'authenticated:SELECT,service_role:SELECT' THEN
    RAISE EXCEPTION 'Refusing to run: the API grants on public.game_removals are not the ones 20261202100000 left (%, expected authenticated:SELECT,service_role:SELECT). A later change needs a person to look first.', _got;
  END IF;
  -- No other function reads the columns this drops.
  SELECT string_agg(p.oid::regprocedure::text, ', ' ORDER BY 1) INTO _got FROM pg_proc p
   WHERE p.prosrc LIKE '%game_removals%' AND (p.prosrc LIKE '%last_ask_at%' OR p.prosrc ~ '\masks\M')
     AND p.oid IS DISTINCT FROM to_regprocedure(_fn);
  IF _got IS NOT NULL THEN
    RAISE EXCEPTION 'Refusing to run: other functions read the ask columns of public.game_removals (%), which this rollback drops. A later change needs a person to look first.', _got;
  END IF;
END
$guard$;

SET LOCAL lock_timeout = '5s';

DROP TRIGGER enforce_host_block_resend ON public.join_requests;
DROP TRIGGER trg_join_request_removed_ask_resend ON public.join_requests;
DROP TRIGGER trg_join_request_removed_ask_insert ON public.join_requests;
DROP FUNCTION private_sec.removed_player_ask_limits();
ALTER TABLE public.game_removals DROP COLUMN last_ask_at, DROP COLUMN asks;

DO $check$
DECLARE
  _got text;
BEGIN
  IF to_regprocedure('private_sec.removed_player_ask_limits()') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_trigger t
                 WHERE t.tgname IN ('enforce_host_block_resend', 'trg_join_request_removed_ask_insert',
                                    'trg_join_request_removed_ask_resend'))
     OR EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.game_removals'::regclass
                   AND a.attname IN ('asks', 'last_ask_at') AND NOT a.attisdropped) THEN
    RAISE EXCEPTION 'Rolled back nothing: a trigger, the function or a column 20261204100000 added is still there.';
  END IF;
  SELECT md5(pg_get_functiondef(p.oid)) INTO _got FROM pg_proc p WHERE p.oid = to_regprocedure('public.enforce_host_block()');
  IF _got IS DISTINCT FROM '6b1d17279ccbb3238ceecd2bde49ba2d' THEN
    RAISE EXCEPTION 'Rolled back nothing: public.enforce_host_block() (20261028150000''s, kept) has md5 %, not 6b1d17279ccbb3238ceecd2bde49ba2d.', coalesce(_got, 'missing');
  END IF;
  SELECT string_agg(t.tgname, ',' ORDER BY t.tgname) INTO _got FROM pg_trigger t
   WHERE t.tgfoid = 'public.enforce_host_block()'::regprocedure AND NOT t.tgisinternal;
  IF _got IS DISTINCT FROM 'enforce_host_block_participants,enforce_host_block_requests' THEN
    RAISE EXCEPTION 'Rolled back nothing: public.enforce_host_block() should run on its two insert triggers only, found %.', coalesce(_got, 'none');
  END IF;
  SELECT coalesce(string_agg(coalesce(r.rolname, 'PUBLIC') || ':' || x.privilege_type, ',' ORDER BY coalesce(r.rolname, 'PUBLIC'), x.privilege_type), '')
    INTO _got
    FROM pg_class c
    CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) x
    LEFT JOIN pg_roles r ON r.oid = x.grantee
   WHERE c.oid = 'public.game_removals'::regclass AND coalesce(r.rolname, 'PUBLIC') IN ('PUBLIC', 'anon', 'authenticated', 'service_role');
  IF _got IS DISTINCT FROM 'authenticated:SELECT,service_role:SELECT' THEN
    RAISE EXCEPTION 'Rolled back nothing: the API grants on public.game_removals changed (%).', _got;
  END IF;
END
$check$;
COMMIT;
