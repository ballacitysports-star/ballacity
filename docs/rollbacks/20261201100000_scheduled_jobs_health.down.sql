-- ROLLBACK for supabase/migrations/20261201100000_scheduled_jobs_health.sql (the superadmin Scheduled jobs card).
-- NOT a migration. It drops public.superadmin_scheduled_jobs(integer), the only object the migration created. No row
-- changes: the function only read pg_cron's and pg_net's tables. pg_cron, its jobs and their run history are untouched.
-- The app keeps working after it: the Scheduled jobs card shows "Not available yet" when the function is missing (PGRST202).
-- It stops, changing nothing, unless the function still has the definition 20261201100000 gave it (md5 below) and the same
-- API-role grants (EXECUTE for authenticated only), and no other function names it. A later change needs a person to look
-- first. It refuses to run unless the session sets the confirmation first:
--     SET app.confirm_scheduled_jobs_health_rollback = 'yes';
--     (or PGOPTIONS="-c app.confirm_scheduled_jobs_health_rollback=yes")
-- LEDGER: this file does not touch supabase_migrations.schema_migrations. After a successful rollback, delete the ledger row
-- for 20261201100000 by hand (as the earlier release records do), or the ledger says applied while the function is gone.
-- PRODUCTION CHECK: the md5 below was computed on the local Postgres 16; production runs 17 and pg_get_functiondef text may
-- differ between versions. The guard fails closed (it refuses, changing nothing), but do not find that out in an emergency:
-- after applying the migration, run this read-only query in production and record the result in the release record. It must
-- equal 373c82595845f90c62020f70c9f9427c; if not, the guard value here needs a person to look first.
--     SELECT md5(pg_get_functiondef('public.superadmin_scheduled_jobs(integer)'::regprocedure));
-- Locks: DROP FUNCTION takes a lock on the function only; the wait is limited to 5 s.
BEGIN;
DO $guard$
DECLARE
  _fn CONSTANT regprocedure := to_regprocedure('public.superadmin_scheduled_jobs(integer)');
  _got text;
BEGIN
  IF current_setting('app.confirm_scheduled_jobs_health_rollback', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'Refusing to run: superadmins lose the Scheduled jobs card. Set app.confirm_scheduled_jobs_health_rollback=yes for the session to proceed deliberately.';
  END IF;
  SELECT md5(pg_get_functiondef(p.oid)) INTO _got FROM pg_proc p WHERE p.oid = _fn;
  IF _fn IS NULL OR _got IS DISTINCT FROM '373c82595845f90c62020f70c9f9427c' THEN
    RAISE EXCEPTION 'Refusing to run: public.superadmin_scheduled_jobs(integer) is not the definition 20261201100000 created (md5 %, expected 373c82595845f90c62020f70c9f9427c). A later change needs a person to look first.', _got;
  END IF;
  SELECT coalesce(string_agg(coalesce(r.rolname, 'PUBLIC') || ':' || x.privilege_type || CASE WHEN x.is_grantable THEN '*' ELSE '' END,
                             ',' ORDER BY coalesce(r.rolname, 'PUBLIC'), x.privilege_type), '')
    INTO _got
    FROM pg_proc p
    CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
    LEFT JOIN pg_roles r ON r.oid = x.grantee
   WHERE p.oid = _fn AND coalesce(r.rolname, 'PUBLIC') IN ('PUBLIC', 'anon', 'authenticated', 'service_role');
  IF _got IS DISTINCT FROM 'authenticated:EXECUTE' THEN
    RAISE EXCEPTION 'Refusing to run: the grants on public.superadmin_scheduled_jobs(integer) are not the ones 20261201100000 gave (%). A later change needs a person to look first.', _got;
  END IF;
  -- a SQL or plpgsql body names its callees only as text, which pg_depend does not record
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO _got
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
     AND p.oid <> _fn
     AND p.prosrc ~ '\msuperadmin_scheduled_jobs\M';
  IF _got IS NOT NULL THEN
    RAISE EXCEPTION 'Refusing to run: % names the function this rollback drops. A later change needs a person to look first.', _got;
  END IF;
END
$guard$;

SET LOCAL lock_timeout = '5s';
DROP FUNCTION public.superadmin_scheduled_jobs(integer);

COMMIT;
