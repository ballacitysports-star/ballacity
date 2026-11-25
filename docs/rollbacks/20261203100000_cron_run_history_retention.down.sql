-- ROLLBACK for supabase/migrations/20261203100000_cron_run_history_retention.sql (pg_cron run history kept for 30 days).
-- NOT a migration. It unschedules the job 'purge-cron-run-history' (where pg_cron has it), then drops the functions
-- private_sec.purge_cron_run_details(integer, integer) and private_sec.schedule_cron_run_history_purge(), the only objects
-- the migration created.
-- DELETED RUN HISTORY CANNOT BE RESTORED. Every row of cron.job_run_details the purge has already deleted is gone for good;
-- this only stops further deletion, and the table grows again by about 2,000 rows a day. Say so in the release record.
-- Nothing in the app calls the purge (only the job does), and the Scheduled jobs card does not depend on it, so no code needs
-- reverting first.
-- It stops, changing nothing, unless both functions still have the definitions 20261203100000 gave them (md5 below) and no
-- API-role grant (none for PUBLIC, anon, authenticated or service_role), no other function names either of them, and,
-- where pg_cron is installed, the job 'purge-cron-run-history' (if present) still runs
-- 'SELECT private_sec.purge_cron_run_details()' at '57 3 * * *' and no other job names a function this drops. A later
-- change needs a person to look first.
-- It refuses to run unless the session sets the confirmation first:
--     SET app.confirm_cron_run_history_retention_rollback = 'yes';
--     (or PGOPTIONS="-c app.confirm_cron_run_history_retention_rollback=yes")
-- LEDGER: this file does not touch supabase_migrations.schema_migrations. After a successful rollback, delete the ledger row
-- for 20261203100000 by hand (as the earlier release records do), or the ledger says applied while the functions are gone.
-- PRODUCTION CHECK: the md5s below were computed on the local Postgres 16; production runs 17 and pg_get_functiondef text may
-- differ between versions. The guard fails closed (it refuses, changing nothing), but do not find that out in an emergency:
-- after applying the migration, run this read-only query in production and record the result in the release record. It must
-- return e067f387979e2d09d34d7820224c0098 and beb7e03e3874ed8337297d7875b8440a; if not, the guard values here need a person
-- to look first.
--     SELECT md5(pg_get_functiondef('private_sec.purge_cron_run_details(integer,integer)'::regprocedure)),
--            md5(pg_get_functiondef('private_sec.schedule_cron_run_history_purge()'::regprocedure));
-- Locks: none on an app table. It drops two functions and removes one cron.job row; the wait is limited to 5 s.
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $guard$
DECLARE
  _want CONSTANT text[][] := ARRAY[
    ['private_sec.purge_cron_run_details(integer,integer)', 'e067f387979e2d09d34d7820224c0098'],
    ['private_sec.schedule_cron_run_history_purge()',      'beb7e03e3874ed8337297d7875b8440a']];
  _callee_re CONSTANT text := '\m(purge_cron_run_details|schedule_cron_run_history_purge)\M';
  _guarded oid[] := '{}';
  _fn regprocedure;
  _got text;
  i int;
BEGIN
  IF current_setting('app.confirm_cron_run_history_retention_rollback', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'Refusing to run: pg_cron''s run history is no longer purged and grows again. Runs already deleted cannot be restored. Set app.confirm_cron_run_history_retention_rollback=yes for the session to proceed deliberately.';
  END IF;
  FOR i IN 1 .. array_length(_want, 1) LOOP
    _fn := to_regprocedure(_want[i][1]);
    SELECT md5(pg_get_functiondef(p.oid)) INTO _got FROM pg_proc p WHERE p.oid = _fn;
    IF _fn IS NULL OR _got IS DISTINCT FROM _want[i][2] THEN
      RAISE EXCEPTION 'Refusing to run: % is not the definition 20261203100000 created (md5 %, expected %). A later change needs a person to look first.', _want[i][1], _got, _want[i][2];
    END IF;
    SELECT string_agg(coalesce(r.rolname, 'PUBLIC') || ':' || x.privilege_type, ',' ORDER BY coalesce(r.rolname, 'PUBLIC'))
      INTO _got
      FROM pg_proc p
      CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
      LEFT JOIN pg_roles r ON r.oid = x.grantee
     WHERE p.oid = _fn AND coalesce(r.rolname, 'PUBLIC') IN ('PUBLIC', 'anon', 'authenticated', 'service_role');
    IF _got IS NOT NULL THEN
      RAISE EXCEPTION 'Refusing to run: % has API-role grants 20261203100000 did not give (%). A later change needs a person to look first.', _want[i][1], _got;
    END IF;
    _guarded := _guarded || _fn::oid;
  END LOOP;
  -- a SQL or plpgsql body names its callees only as text, which pg_depend does not record
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
    EXECUTE $q$SELECT string_agg(coalesce(jobname, '(unnamed)') || ' [' || schedule || '] ' || command, '; ' ORDER BY jobname)
                 FROM cron.job
                WHERE (jobname = 'purge-cron-run-history'
                       AND (schedule IS DISTINCT FROM '57 3 * * *'
                            OR command IS DISTINCT FROM 'SELECT private_sec.purge_cron_run_details()'))
                   OR (jobname IS DISTINCT FROM 'purge-cron-run-history' AND command ~ $1)$q$
      INTO _got USING _callee_re;
    IF _got IS NOT NULL THEN
      RAISE EXCEPTION 'Refusing to run: a scheduled job is not the one 20261203100000 created, or names a function this drops (%). A later change needs a person to look first.', _got;
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
    EXECUTE $q$SELECT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-cron-run-history')$q$ INTO _scheduled;
  END IF;
  IF _scheduled THEN
    EXECUTE $q$SELECT cron.unschedule('purge-cron-run-history')$q$;
  END IF;
END
$cron$;

DROP FUNCTION private_sec.schedule_cron_run_history_purge();
DROP FUNCTION private_sec.purge_cron_run_details(integer, integer);

COMMIT;
