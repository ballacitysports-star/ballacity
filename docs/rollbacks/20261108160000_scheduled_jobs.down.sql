-- ROLLBACK for supabase/migrations/20261108160000_scheduled_jobs.sql (P2-7).
-- NOT a migration. It unschedules the three jobs and drops the worker helpers and the base URL setting.
-- Reminders then go out only while the app is open, held pushes wait for another scheduler, and old error
-- reports are no longer purged. No other data is changed. It refuses to run unless the session confirms:
--     PGOPTIONS="-c app.confirm_drop_scheduled_jobs=yes" psql ... -f <this file>
BEGIN;
DO $guard$
BEGIN
  IF current_setting('app.confirm_drop_scheduled_jobs', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'Refusing to run: reminders would stop arriving while the app is closed. Set app.confirm_drop_scheduled_jobs=yes for the session to proceed deliberately.';
  END IF;
END
$guard$;

DO $cron$
BEGIN
  IF to_regclass('cron.job') IS NOT NULL THEN
    PERFORM cron.unschedule(jobname) FROM cron.job
     WHERE jobname IN ('flush-held-notifications', 'send-game-reminders', 'purge-app-error-events');
  END IF;
END
$cron$;

DROP FUNCTION IF EXISTS private_sec.worker_post(text);
DROP FUNCTION IF EXISTS private_sec.worker_base_url();
DELETE FROM public.app_settings WHERE key = 'worker_base_url';

COMMIT;
