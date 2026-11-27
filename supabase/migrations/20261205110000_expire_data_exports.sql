-- P3-6a: an expired data export's file is deleted. docs/data-retention.md says a member's export "expires 24 hours after it
-- is ready"; until now the JSON file stayed in the private 'data-exports' bucket for ever. public.expire_stale_data_exports()
-- (20260901232232) only flipped the status, and nothing ran it; getDataExportDownloadUrl (src/lib/data-export.functions.ts)
-- refuses to sign a lapsed export and flips it to 'expired', but leaves the file.
--
-- WHAT. The window is the one the app already sets and the docs already state; nothing here changes it.
-- 1. private_sec.data_export_lapsed(_expires_at, _ready_at) -> boolean: the one rule for "the download window has ended".
--    True when expires_at is set and strictly in the past (the app sets it to ready_at + 24 hours, EXPORT_TTL_HOURS), or
--    when ready_at is set and strictly more than 24 hours in the past (so a ready row whose expires_at is missing, or
--    later than the promise, still ends 24 hours after it was ready). Exactly 24 hours old is not yet lapsed; the next run
--    takes it. EXECUTE for nobody but its owner; the functions below run as the owner.
-- 2. public.expire_stale_data_exports() -> integer, replaced: the same rows as before (status 'ready', 'processing' or
--    'requested') flip to 'expired' when data_export_lapsed says so. Tightened: search_path '' (was public), lock_timeout
--    5s. Same signature, same grants (service_role only). It writes nothing else; the row and its file pointer stay.
-- 3. public.data_export_files_due(_limit integer DEFAULT 100) -> TABLE (id, storage_path): a batch of exports whose file
--    may be deleted, oldest first. Only rows that are already 'expired' (or 'failed') AND whose window has lapsed AND that
--    still hold a storage_path AND whose storage_path is that export's own file name, '<user_id>/<id>.json' (the only name
--    requestDataExport writes). So a row can only ever cause its own file to be deleted, never a fresh export's, even if a
--    pointer were wrong. A 'ready' row is never returned, lapsed or not: it is expired first. Oldest ready_at first.
--    _limit NULL means 100 and is held to 1..1000 (the storage API deletes at most 1000 names per call). Read-only.
-- 4. public.clear_data_export_files(_ids uuid[]) -> integer: sets storage_path to NULL on those rows, after their files
--    are deleted, so a row is not tried again. The same test as (3) on each row, so it cannot clear a fresh export's
--    pointer. At most 1000 ids per call (more raises INVALID_LIMIT). The row is kept: its status, sizes, times and the
--    rate-limit count are unchanged. lock_timeout 5s.
--    (3) and (4) are SECURITY DEFINER with an empty search_path, EXECUTE for service_role only (not PUBLIC, anon or
--    authenticated), like expire_stale_data_exports.
-- 5. private_sec.schedule_data_export_expiry(): schedules job 'expire-data-exports' daily at 04:27 UTC, command
--    'SELECT private_sec.worker_post(''/api/public/data-exports/expire'')' (20261108160000's worker pattern), where pg_cron
--    (cron.schedule) and pg_net (net.http_post) are installed, and does nothing with a notice otherwise. cron.schedule with
--    a job name replaces a job of that name, so re-running is safe. 04:27 is free: the other daily jobs run at 03:17, 03:37,
--    03:57, 04:17, 04:41, 04:47, 04:51 and 08:47, the hourly one at :23, the rest every 5 minutes or every minute. Not
--    SECURITY DEFINER; EXECUTE for nobody but its owner. The migration calls it once.
--
-- The worker route, src/routes/api/public/data-exports/expire.ts (worker secret, service role), runs (2), then deletes the
-- files (3) returns from the bucket in batches and clears their pointers (4). A batch whose delete fails keeps its
-- pointers, so the next run tries it again. It answers counts only.
--
-- This migration deletes no file and changes no row itself. Where pg_cron is installed, the first deletion is the job's
-- first run, the next 04:27 UTC after the migration is applied and the app with the route is published: applying it to
-- production is the owner's go-ahead for that first run. Deleted files cannot be restored. A file is deleted at the first
-- run after its window ends, so up to a day after.
--
-- Rollback: docs/rollbacks/20261205110000_expire_data_exports.down.sql.

SET lock_timeout = '5s';

-- 1. The window ------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private_sec.data_export_lapsed(_expires_at timestamptz, _ready_at timestamptz)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT (_expires_at IS NOT NULL AND _expires_at < pg_catalog.now())
      OR (_ready_at IS NOT NULL AND _ready_at < pg_catalog.now() - interval '24 hours')
$$;
REVOKE ALL ON FUNCTION private_sec.data_export_lapsed(timestamptz, timestamptz) FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION private_sec.data_export_lapsed(timestamptz, timestamptz) IS
  'P3-6a: whether a data export''s download window has ended: expires_at in the past, or ready_at more than 24 hours ago. Owner only.';

-- 2. The status ------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.expire_stale_data_exports()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
AS $$
DECLARE
  touched integer;
BEGIN
  UPDATE public.data_export_requests r
     SET status = 'expired'
   WHERE r.status IN ('ready', 'processing', 'requested')
     AND private_sec.data_export_lapsed(r.expires_at, r.ready_at);
  GET DIAGNOSTICS touched = ROW_COUNT;
  RETURN touched;
END;
$$;
REVOKE ALL ON FUNCTION public.expire_stale_data_exports() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_stale_data_exports() TO service_role;

-- 3. The files to delete ---------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.data_export_files_due(_limit integer DEFAULT 100)
RETURNS TABLE (id uuid, storage_path text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT r.id, r.storage_path
    FROM public.data_export_requests r
   WHERE r.storage_path IS NOT NULL
     AND r.status IN ('expired', 'failed')
     AND private_sec.data_export_lapsed(r.expires_at, r.ready_at)
     AND r.storage_path = r.user_id::text || '/' || r.id::text || '.json'
   ORDER BY r.ready_at, r.id
   LIMIT LEAST(GREATEST(COALESCE(_limit, 100), 1), 1000)
$$;
REVOKE ALL ON FUNCTION public.data_export_files_due(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.data_export_files_due(integer) TO service_role;
COMMENT ON FUNCTION public.data_export_files_due(integer) IS
  'P3-6a: expired data exports whose file may be deleted (lapsed, still pointing at their own <user_id>/<id>.json), oldest first, at most _limit (1..1000). Service role only.';

-- 4. The pointers ----------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.clear_data_export_files(_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
AS $$
DECLARE
  _cleared integer;
BEGIN
  IF coalesce(cardinality(_ids), 0) > 1000 THEN
    RAISE EXCEPTION 'INVALID_LIMIT' USING ERRCODE = '22023';
  END IF;
  UPDATE public.data_export_requests r
     SET storage_path = NULL
   WHERE r.id = ANY (_ids)
     AND r.storage_path IS NOT NULL
     AND r.status IN ('expired', 'failed')
     AND private_sec.data_export_lapsed(r.expires_at, r.ready_at)
     AND r.storage_path = r.user_id::text || '/' || r.id::text || '.json';
  GET DIAGNOSTICS _cleared = ROW_COUNT;
  RETURN _cleared;
END;
$$;
REVOKE ALL ON FUNCTION public.clear_data_export_files(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clear_data_export_files(uuid[]) TO service_role;
COMMENT ON FUNCTION public.clear_data_export_files(uuid[]) IS
  'P3-6a: clears the file pointer of expired data exports whose file was deleted (the same test as data_export_files_due). The row is kept. Service role only.';

-- 5. The schedule ----------------------------------------------------------------------------------------------------------------
-- cron.schedule exists exactly when pg_cron is installed, net.http_post exactly when pg_net is (worker_post calls it). Both
-- are looked up by name, so this function also exists where they are not.
CREATE OR REPLACE FUNCTION private_sec.schedule_data_export_expiry()
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SET search_path = ''
AS $$
BEGIN
  IF to_regprocedure('cron.schedule(text,text,text)') IS NULL THEN
    RAISE NOTICE 'pg_cron is not installed: expire-data-exports not scheduled';
    RETURN false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'net' AND p.proname = 'http_post') THEN
    RAISE NOTICE 'pg_net is not installed: expire-data-exports not scheduled';
    RETURN false;
  END IF;
  EXECUTE 'SELECT cron.schedule($1, $2, $3)'
    USING 'expire-data-exports', '27 4 * * *', 'SELECT private_sec.worker_post(''/api/public/data-exports/expire'')';
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION private_sec.schedule_data_export_expiry() FROM PUBLIC, anon, authenticated, service_role;

DO $cron$
BEGIN
  PERFORM private_sec.schedule_data_export_expiry();
EXCEPTION WHEN others THEN
  RAISE NOTICE 'expire-data-exports not scheduled: %', SQLERRM;
END
$cron$;

RESET lock_timeout;
