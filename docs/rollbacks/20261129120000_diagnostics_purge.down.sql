-- ROLLBACK for supabase/migrations/20261129120000_diagnostics_purge.sql (WP 5.9: the 90-day diagnostics purge).
-- NOT a migration. It unschedules the job 'purge-diagnostics' (where pg_cron has it), then drops the functions
-- public.purge_diagnostics(interval, integer) and private_sec.schedule_diagnostics_purge().
-- DELETED ROWS CANNOT BE RESTORED. Every row of public.auth_signin_events, public.location_denial_events and
-- public.notification_delivery_log the purge has already deleted is gone for good; this only stops further deletion. Say so in
-- the release record. After it, the "kept up to 90 days" text in src/lib/retention.ts is a promise nothing keeps again: change
-- that text (and docs/data-retention.md) or re-apply the migration.
-- Nothing in the app calls the purge (only the job does), so no code needs reverting first.
-- It stops, changing nothing, unless both functions still have the definitions 20261129120000 gave them and the same API-role
-- grants (EXECUTE on the purge for service_role only, none on the scheduler helper), no other function names either of them,
-- and, where pg_cron is installed, the job 'purge-diagnostics' (if present) still runs 'SELECT public.purge_diagnostics()' at
-- '37 3 * * *' and no other job names a function this drops. A later change needs a person to look first.
-- It refuses to run unless the session sets the confirmation first:
--     SET app.confirm_diagnostics_purge_rollback = 'yes';
-- Locks: none on an app table. It drops two functions and removes one cron row.
BEGIN;
DO $guard$
DECLARE
  _want CONSTANT text[][] := ARRAY[
    ['public.purge_diagnostics(interval,integer)', '613440ac1c24d89d1784e8301bb76ae9', 'service_role:EXECUTE'],
    ['private_sec.schedule_diagnostics_purge()',  '035c6a89e731b8deb301facc24ae2d8e', '']];
  _callee_re CONSTANT text := '\m(purge_diagnostics|schedule_diagnostics_purge)\M';
  _guarded oid[] := '{}';
  _fn regprocedure;
  _got text;
  i int;
BEGIN
  IF current_setting('app.confirm_diagnostics_purge_rollback', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'Refusing to run: the 90-day diagnostics purge stops and the promise in retention.ts is no longer kept. Rows it already deleted cannot be restored. Set app.confirm_diagnostics_purge_rollback=yes for the session to proceed deliberately.';
  END IF;
  FOR i IN 1 .. array_length(_want, 1) LOOP
    _fn := to_regprocedure(_want[i][1]);
    SELECT md5(pg_get_functiondef(p.oid)) INTO _got FROM pg_proc p WHERE p.oid = _fn;
    IF _fn IS NULL OR _got IS DISTINCT FROM _want[i][2] THEN
      RAISE EXCEPTION 'Refusing to run: % is not the definition 20261129120000 created (md5 %). A later change needs a person to look first.', _want[i][1], _got;
    END IF;
    SELECT coalesce(string_agg(coalesce(r.rolname, 'PUBLIC') || ':' || x.privilege_type, ',' ORDER BY coalesce(r.rolname, 'PUBLIC')), '')
      INTO _got
      FROM pg_proc p
      CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
      LEFT JOIN pg_roles r ON r.oid = x.grantee
     WHERE p.oid = _fn AND coalesce(r.rolname, 'PUBLIC') IN ('PUBLIC', 'anon', 'authenticated', 'service_role');
    IF _got IS DISTINCT FROM _want[i][3] THEN
      RAISE EXCEPTION 'Refusing to run: the grants on % are not the ones 20261129120000 gave (%). A later change needs a person to look first.', _want[i][1], _got;
    END IF;
    _guarded := _guarded || _fn::oid;
  END LOOP;
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO _got
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'cron')
     AND p.oid <> ALL (_guarded)
     AND p.prosrc ~ _callee_re;
  IF _got IS NOT NULL THEN
    RAISE EXCEPTION 'Refusing to run: % names a function this rollback drops. A later change needs a person to look first.', _got;
  END IF;
  IF to_regclass('cron.job') IS NOT NULL THEN
    EXECUTE $q$SELECT string_agg(jobname || ' [' || schedule || '] ' || command, '; ' ORDER BY jobname) FROM cron.job
                WHERE (jobname = 'purge-diagnostics'
                       AND (schedule IS DISTINCT FROM '37 3 * * *' OR command IS DISTINCT FROM 'SELECT public.purge_diagnostics()'))
                   OR (jobname IS DISTINCT FROM 'purge-diagnostics' AND command ~ $1)$q$
      INTO _got USING _callee_re;
    IF _got IS NOT NULL THEN
      RAISE EXCEPTION 'Refusing to run: a scheduled job is not the one 20261129120000 created, or names a function this drops (%). A later change needs a person to look first.', _got;
    END IF;
  END IF;
END
$guard$;

-- The job first, so it never runs against a dropped function.
DO $cron$
DECLARE
  _scheduled boolean := false;
BEGIN
  IF to_regclass('cron.job') IS NOT NULL THEN
    EXECUTE $q$SELECT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-diagnostics')$q$ INTO _scheduled;
  END IF;
  IF _scheduled THEN
    EXECUTE $q$SELECT cron.unschedule('purge-diagnostics')$q$;
  END IF;
END
$cron$;

DROP FUNCTION private_sec.schedule_diagnostics_purge();
DROP FUNCTION public.purge_diagnostics(interval, integer);

COMMIT;
