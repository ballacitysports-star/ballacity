-- ROLLBACK for supabase/migrations/20261118100000_availability_expiry_job.sql (WP 1.2).
-- NOT a migration. It stops the hourly sweep: unschedules 'sweep-availability-lifecycle' and drops
-- private_sec.sweep_availability_lifecycle and private_sec.availability_reminders (the log of reminders sent).
-- It changes no post and no notification: posts the sweep marked 'expired' stay expired (they were already unlisted by
-- WP 1.1's read policy, and their authors can reopen them), and reminders already sent stay in the authors' notifications.
-- It stops, changing nothing, if the function no longer has the definition 20261118100000 gave it (a later change needs a
-- person to look first), and refuses to run unless the session sets the confirmation first:
--     SET app.confirm_availability_expiry_job_rollback = 'yes';
BEGIN;
DO $guard$
DECLARE
  _got text;
BEGIN
  IF current_setting('app.confirm_availability_expiry_job_rollback', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'Refusing to run: this stops availability reminders and expiry. Set app.confirm_availability_expiry_job_rollback=yes for the session to proceed deliberately.';
  END IF;
  SELECT md5(pg_get_functiondef(p.oid)) INTO _got
    FROM pg_proc p WHERE p.oid = to_regprocedure('private_sec.sweep_availability_lifecycle(timestamptz,integer)');
  IF _got IS DISTINCT FROM 'e583792c9e2a31ad5a7664607c08f8ea' THEN
    RAISE EXCEPTION 'Refusing to run: private_sec.sweep_availability_lifecycle is not the definition 20261118100000 created (md5 %). A later change needs a person to look first.', _got;
  END IF;
END
$guard$;

SET LOCAL lock_timeout = '5s';

DO $cron$
DECLARE
  _scheduled boolean := false;
BEGIN
  IF to_regclass('cron.job') IS NOT NULL THEN
    EXECUTE $q$SELECT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sweep-availability-lifecycle')$q$ INTO _scheduled;
  END IF;
  IF _scheduled THEN
    EXECUTE $q$SELECT cron.unschedule('sweep-availability-lifecycle')$q$;
  END IF;
END
$cron$;

DROP FUNCTION private_sec.sweep_availability_lifecycle(timestamptz, integer);
DROP TABLE private_sec.availability_reminders;

COMMIT;
