-- ROLLBACK for supabase/migrations/20261108150000_app_error_events.sql (P0-8).
-- NOT a migration. It drops the error-report table and its purge function; the app then fails to save reports
-- (it ignores that failure: reporting never breaks a page). The stored reports are deleted with the table.
-- It refuses to run unless the session confirms:
--     PGOPTIONS="-c app.confirm_drop_app_error_events=yes" psql ... -f <this file>
BEGIN;
DO $guard$
BEGIN
  IF current_setting('app.confirm_drop_app_error_events', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'Refusing to run: this deletes every stored error report. Set app.confirm_drop_app_error_events=yes for the session to proceed deliberately.';
  END IF;
END
$guard$;

DROP FUNCTION IF EXISTS public.purge_app_error_events(interval);
DROP TABLE IF EXISTS public.app_error_events;

COMMIT;
