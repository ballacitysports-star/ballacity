-- WP 5.9 (Phase 5, docs/product/phase-5-validation-plan.md; owner decision 12, default "enforce"): the 90-day promise for
-- sign-in and delivery diagnostics becomes true. src/lib/retention.ts ("logs") tells members that sign-in events, notification
-- delivery attempts and location permission denials are "kept up to 90 days"; until now nothing deleted them.
--
-- 1. public.purge_diagnostics(_older_than, _max_rows): deletes the rows of public.auth_signin_events,
--    public.location_denial_events and public.notification_delivery_log whose created_at is older than the window (default
--    90 days; strictly older, so a row exactly 90 days old stays until the next run). The purge_app_error_events pattern
--    (20261108150000): SECURITY DEFINER, empty search_path, EXECUTE for service_role only (and the scheduler, which runs as
--    the owner). It returns the count per table as jsonb.
--    - What a DELETE fires: nothing. The only triggers on these tables (aa_anonymise_minor_signin_event,
--      aa_anonymise_minor_location_denial) run BEFORE INSERT OR UPDATE. In the replayed schema no foreign key points at any
--      of the three tables and no view or function reads them. Their own foreign keys (user_id -> auth.users,
--      notification_delivery_log.notification_id -> notifications) are on the deleted side, so deleting checks nothing. The
--      app's realtime listener on notification_delivery_log (NotificationsPanel) asks for INSERT events only, so deletes
--      reach no open page.
--    - Bounded: at most _max_rows rows per table per call (default 100000, far above a day's inflow). A function with a SET
--      clause cannot commit part-way, so a call is one transaction; the cap keeps that transaction short, and a backlog
--      larger than the cap drains over the following nights. The result says whether a table hit the cap ("capped").
--    - Locks: a DELETE takes ROW EXCLUSIVE, which does not block the app's inserts and reads. The function sets
--      lock_timeout = 5s, so a schema change holding the table (or a row lock held elsewhere) makes the run fail cleanly
--      instead of queueing behind it; the next night tries again.
--    - No index added: notification_delivery_log has no index on created_at alone, so the daily run scans it. At its size
--      (90 days of push attempts) that is cheap, and an index would cost every insert.
-- 2. private_sec.schedule_diagnostics_purge(): schedules job 'purge-diagnostics' daily at 03:37 UTC where pg_cron is installed
--    (cron.schedule exists), and does nothing with a notice otherwise. 03:37 is free: the other daily jobs run at 03:17,
--    04:17, 04:41, 04:47, 04:51 and 08:47, the hourly one at :23, the rest every 5 minutes or every minute.
--
-- This migration does NOT purge anything itself. Where pg_cron is installed, the first deletion is the job's first run, the
-- next 03:37 UTC after the migration is applied: applying it to production is the owner's go-ahead for that first run.
-- Deleted rows cannot be restored.
--
-- Rollback: docs/rollbacks/20261129120000_diagnostics_purge.down.sql.

-- 1. The purge ---------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.purge_diagnostics(_older_than interval DEFAULT interval '90 days',
                                                    _max_rows integer DEFAULT 100000)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
AS $$
DECLARE
  _cutoff timestamptz;
  _signin integer;
  _denial integer;
  _delivery integer;
BEGIN
  IF _older_than IS NULL OR _older_than < interval '1 day' THEN
    RAISE EXCEPTION 'INVALID_WINDOW' USING ERRCODE = '22023';
  END IF;
  IF _max_rows IS NULL OR _max_rows < 1 OR _max_rows > 1000000 THEN
    RAISE EXCEPTION 'INVALID_LIMIT' USING ERRCODE = '22023';
  END IF;
  _cutoff := now() - _older_than;

  DELETE FROM public.auth_signin_events e
   WHERE e.id IN (SELECT s.id FROM public.auth_signin_events s WHERE s.created_at < _cutoff LIMIT _max_rows)
     AND e.created_at < _cutoff;
  GET DIAGNOSTICS _signin = ROW_COUNT;

  DELETE FROM public.location_denial_events e
   WHERE e.id IN (SELECT s.id FROM public.location_denial_events s WHERE s.created_at < _cutoff LIMIT _max_rows)
     AND e.created_at < _cutoff;
  GET DIAGNOSTICS _denial = ROW_COUNT;

  DELETE FROM public.notification_delivery_log e
   WHERE e.id IN (SELECT s.id FROM public.notification_delivery_log s WHERE s.created_at < _cutoff LIMIT _max_rows)
     AND e.created_at < _cutoff;
  GET DIAGNOSTICS _delivery = ROW_COUNT;

  RETURN jsonb_build_object(
    'auth_signin_events', _signin,
    'location_denial_events', _denial,
    'notification_delivery_log', _delivery,
    'capped', _signin >= _max_rows OR _denial >= _max_rows OR _delivery >= _max_rows);
END;
$$;
REVOKE ALL ON FUNCTION public.purge_diagnostics(interval, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_diagnostics(interval, integer) TO service_role;
COMMENT ON FUNCTION public.purge_diagnostics(interval, integer) IS
  'WP 5.9: deletes sign-in, location-denial and delivery diagnostics older than the window (default 90 days), at most _max_rows per table per call. Service role and scheduler only.';

-- 2. The schedule ------------------------------------------------------------------------------------------------------------------
-- cron.schedule exists exactly when pg_cron is installed (the extension creates the cron schema). Called by name, so this
-- function also exists where it is not. cron.schedule with a job name replaces a job of that name, so re-running is safe.
CREATE OR REPLACE FUNCTION private_sec.schedule_diagnostics_purge()
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SET search_path = ''
AS $$
BEGIN
  IF to_regprocedure('cron.schedule(text,text,text)') IS NULL THEN
    RAISE NOTICE 'pg_cron is not installed: purge-diagnostics not scheduled';
    RETURN false;
  END IF;
  EXECUTE 'SELECT cron.schedule($1, $2, $3)'
    USING 'purge-diagnostics', '37 3 * * *', 'SELECT public.purge_diagnostics()';
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION private_sec.schedule_diagnostics_purge() FROM PUBLIC, anon, authenticated, service_role;

DO $cron$
BEGIN
  PERFORM private_sec.schedule_diagnostics_purge();
EXCEPTION WHEN others THEN
  RAISE NOTICE 'purge-diagnostics not scheduled: %', SQLERRM;
END
$cron$;
