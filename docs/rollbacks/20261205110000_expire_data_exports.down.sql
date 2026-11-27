-- ROLLBACK for supabase/migrations/20261205110000_expire_data_exports.sql (expired data-export files are deleted).
-- NOT a migration. It unschedules the job 'expire-data-exports' (where pg_cron has it), restores
-- public.expire_stale_data_exports() exactly as 20260901232232 created it (search_path public, expires_at only, the same
-- grants: service_role only), and drops the functions the migration added: public.data_export_files_due(integer),
-- public.clear_data_export_files(uuid[]), private_sec.schedule_data_export_expiry() and
-- private_sec.data_export_lapsed(timestamptz, timestamptz).
-- DELETED FILES CANNOT BE RESTORED. Every export file the job already removed from the 'data-exports' bucket is gone for
-- good, and its row keeps storage_path NULL (those rows are expired; the app never offers them for download). After the
-- rollback, files of exports that expire stay in the bucket again, which breaks the "expires 24 hours after it is ready"
-- line in docs/data-retention.md as far as the file is concerned. Say so in the release record.
-- THE APP: src/routes/api/public/data-exports/expire.ts calls the dropped functions. Once the job is gone nothing calls the
-- route on a schedule; a call by hand would expire rows (the restored function) and then answer 500 (list_failed). Revert
-- the route with the rollback, or accept that. Nothing else in the app calls these functions.
-- It stops, changing nothing, unless all five functions still have the definitions 20261205110000 gave them (md5 below),
-- the three public ones are granted to service_role only and the two private_sec ones to nobody but their owner, no other
-- function names one of the four it drops, and, where pg_cron is installed, the job 'expire-data-exports' (if present)
-- still runs 'SELECT private_sec.worker_post(''/api/public/data-exports/expire'')' at '27 4 * * *' and no other job names
-- that route or a function this drops. A later change needs a person to look first. After restoring, it checks that
-- expire_stale_data_exports is byte for byte the 20260901232232 definition (md5 3a40aa32828fc0d68eb3003e5d4b5289) and
-- undoes everything if not.
-- It refuses to run unless the session sets the confirmation first:
--     SET app.confirm_expire_data_exports_rollback = 'yes';
--     (or PGOPTIONS="-c app.confirm_expire_data_exports_rollback=yes")
-- LEDGER: this file does not touch supabase_migrations.schema_migrations. After a successful rollback, delete the ledger row
-- for 20261205110000 by hand (as the earlier release records do), or the ledger says applied while the functions are gone.
-- PRODUCTION CHECK: the md5s below were computed on the local Postgres 16; production runs 17 and pg_get_functiondef text may
-- differ between versions. The guard fails closed (it refuses, changing nothing), but do not find that out in an emergency:
-- before applying the migration, record md5(pg_get_functiondef('public.expire_stale_data_exports()'::regprocedure)) in
-- production (the restore check below expects 3a40aa32828fc0d68eb3003e5d4b5289), and after applying it run this read-only
-- query and record the result in the release record. It must return the five values in _want below, in that order; if
-- not, the guard values here need a person to look first.
--     SELECT md5(pg_get_functiondef('public.expire_stale_data_exports()'::regprocedure)),
--            md5(pg_get_functiondef('public.data_export_files_due(integer)'::regprocedure)),
--            md5(pg_get_functiondef('public.clear_data_export_files(uuid[])'::regprocedure)),
--            md5(pg_get_functiondef('private_sec.data_export_lapsed(timestamptz,timestamptz)'::regprocedure)),
--            md5(pg_get_functiondef('private_sec.schedule_data_export_expiry()'::regprocedure));
-- Locks: a function replace and four drops, and one cron.job row; no app table is touched. The wait is limited to 5 s.
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $guard$
DECLARE
  -- signature, md5 of pg_get_functiondef, the grants it must have (beyond its owner)
  _want CONSTANT text[][] := ARRAY[
    ['public.expire_stale_data_exports()',                        '381f7d82ae83cbc7e27bd19635b9dab0', 'service_role:EXECUTE'],
    ['public.data_export_files_due(integer)',                     '318f94592489c6a3315203143ba756f8', 'service_role:EXECUTE'],
    ['public.clear_data_export_files(uuid[])',                    '0477238323fb1fb1f1256bf31f113157', 'service_role:EXECUTE'],
    ['private_sec.data_export_lapsed(timestamptz,timestamptz)',   '7e0b7c9e1a4a955c1bb48e83592c7bbd', ''],
    ['private_sec.schedule_data_export_expiry()',                 '6cc3fd0e390822e9dc589795791bcbeb', '']];
  _callee_re CONSTANT text := '\m(data_export_files_due|clear_data_export_files|data_export_lapsed|schedule_data_export_expiry)\M';
  _route_re  CONSTANT text := '/api/public/data-exports/expire';
  _guarded oid[] := '{}';
  _fn regprocedure;
  _got text;
  i int;
BEGIN
  IF current_setting('app.confirm_expire_data_exports_rollback', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'Refusing to run: expired data-export files would stay in the bucket again. Files already deleted cannot be restored. Set app.confirm_expire_data_exports_rollback=yes for the session to proceed deliberately.';
  END IF;
  FOR i IN 1 .. array_length(_want, 1) LOOP
    _fn := to_regprocedure(_want[i][1]);
    SELECT md5(pg_get_functiondef(p.oid)) INTO _got FROM pg_proc p WHERE p.oid = _fn;
    IF _fn IS NULL OR _got IS DISTINCT FROM _want[i][2] THEN
      RAISE EXCEPTION 'Refusing to run: % is not the definition 20261205110000 created (md5 %, expected %). A later change needs a person to look first.', _want[i][1], _got, _want[i][2];
    END IF;
    SELECT coalesce(string_agg(coalesce(r.rolname, 'PUBLIC') || ':' || x.privilege_type, ','
                               ORDER BY coalesce(r.rolname, 'PUBLIC'), x.privilege_type), '')
      INTO _got
      FROM pg_proc p
      CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
      LEFT JOIN pg_roles r ON r.oid = x.grantee
     WHERE p.oid = _fn AND x.grantee <> p.proowner;
    IF _got IS DISTINCT FROM _want[i][3] THEN
      RAISE EXCEPTION 'Refusing to run: % has grants 20261205110000 did not give (%, expected "%"). A later change needs a person to look first.', _want[i][1], _got, _want[i][3];
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
    EXECUTE $q$SELECT string_agg(coalesce(jobname, '(unnamed)') || ' [' || schedule || ']', '; ' ORDER BY jobname)
                 FROM cron.job
                WHERE (jobname = 'expire-data-exports'
                       AND (schedule IS DISTINCT FROM '27 4 * * *'
                            OR command IS DISTINCT FROM 'SELECT private_sec.worker_post(''/api/public/data-exports/expire'')'))
                   OR (jobname IS DISTINCT FROM 'expire-data-exports'
                       AND (command ~ $1 OR strpos(command, $2) > 0))$q$
      INTO _got USING _callee_re, _route_re;
    IF _got IS NOT NULL THEN
      RAISE EXCEPTION 'Refusing to run: a scheduled job is not the one 20261205110000 created, or calls the route or a function this drops (%). A later change needs a person to look first.', _got;
    END IF;
  END IF;
END
$guard$;

-- The job first, so it never calls the route against dropped functions.
DO $cron$
DECLARE
  _scheduled boolean := false;
BEGIN
  IF to_regclass('cron.job') IS NOT NULL THEN
    EXECUTE $q$SELECT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'expire-data-exports')$q$ INTO _scheduled;
  END IF;
  IF _scheduled THEN
    EXECUTE $q$SELECT cron.unschedule('expire-data-exports')$q$;
  END IF;
END
$cron$;

-- public.expire_stale_data_exports() exactly as 20260901232232_97a7936b-94be-4675-bf83-acfc3e925a1b.sql created it.
-- Marks ready exports whose signed download window has lapsed.
CREATE OR REPLACE FUNCTION public.expire_stale_data_exports()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  touched integer;
BEGIN
  UPDATE public.data_export_requests
  SET status = 'expired'
  WHERE status IN ('ready','processing','requested')
    AND expires_at IS NOT NULL
    AND expires_at < now();
  GET DIAGNOSTICS touched = ROW_COUNT;
  RETURN touched;
END;
$$;

REVOKE ALL ON FUNCTION public.expire_stale_data_exports() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_stale_data_exports() TO service_role;

DO $restored$
DECLARE
  _got text;
BEGIN
  SELECT md5(pg_get_functiondef(p.oid)) INTO _got FROM pg_proc p WHERE p.oid = 'public.expire_stale_data_exports()'::regprocedure;
  IF _got IS DISTINCT FROM '3a40aa32828fc0d68eb3003e5d4b5289' THEN
    RAISE EXCEPTION 'Rollback undone: the restored expire_stale_data_exports is not the 20260901232232 definition (md5 %, expected 3a40aa32828fc0d68eb3003e5d4b5289). Nothing was changed.', _got;
  END IF;
END
$restored$;

DROP FUNCTION private_sec.schedule_data_export_expiry();
DROP FUNCTION public.clear_data_export_files(uuid[]);
DROP FUNCTION public.data_export_files_due(integer);
DROP FUNCTION private_sec.data_export_lapsed(timestamptz, timestamptz);

COMMIT;
