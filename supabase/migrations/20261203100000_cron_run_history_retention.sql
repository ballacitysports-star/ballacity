-- Scheduled jobs: pg_cron's run history is kept for 30 days instead of for ever.
--
-- WHY. pg_cron writes one row to cron.job_run_details for every run and never deletes any. Production has about 260,000
-- rows (348 MB), most of them from process-highlight-reels, which runs every minute; flush-held-notifications and
-- send-game-reminders add two rows every 5 minutes. That is about 2,000 rows a day, growing without end. Nothing reads
-- history that old: the Scheduled jobs card (20261201100000_scheduled_jobs_health) counts failures over 7 days and reads
-- the newest 100,000 runs. The owner approved a retention job (2026-11-25, "continue as you recommend").
--
-- WHAT.
-- 1. private_sec.purge_cron_run_details(_keep_days integer DEFAULT 30, _batch integer DEFAULT 20000) -> jsonb.
--    SECURITY DEFINER, empty search_path, lock_timeout 5s. EXECUTE for nobody but its owner (and the scheduler, which runs
--    the job as the owner): revoked from PUBLIC, anon, authenticated and service_role. It deletes the finished runs (status
--    'succeeded' or 'failed') whose time is strictly older than the cut-off, now() - _keep_days days. A run's time is its
--    end_time, or its start_time when it has no end_time (the same rule the health card uses, the other way round:
--    pg_cron leaves start_time empty for "connection failed" and "job startup timeout", and end_time empty while a run is
--    in progress). Never deleted: runs in any other status ('starting', 'connecting', 'sending', 'running'), and runs with
--    neither time (a "server restarted" while starting); those are rare and stay.
--    - Clamped, never refused: _keep_days NULL means 30 and is held to 14..365 (the card needs 7 days of failures; 14 keeps
--      a week of margin), _batch NULL means 20000 and is held to 1..100000.
--    - Bounded: one call deletes at most _batch rows, the oldest runids first (runid is the primary key, so the oldest rows
--      are found by walking its index, with no scan of the recent ones). A function with a SET clause is one transaction,
--      so the cap is what keeps it short. The answer is {"available": true, "deleted", "remaining_older", "cutoff",
--      "keep_days", "batch"}: remaining_older counts the deletable rows still older than the cut-off, so a backlog larger
--      than the batch drains over the following nights (production's: about 200,000 rows, so about 10 nights; or run the
--      function by hand a few times).
--    - Locks: a DELETE takes ROW EXCLUSIVE on the table, which does not block pg_cron's inserts or its updates of running
--      rows (those are never deleted, so no row lock is shared). lock_timeout 5s makes a run fail cleanly, and visibly on
--      the card, instead of queueing behind a schema change.
--    - Where pg_cron is not installed (no cron.job_run_details) it answers {"available": false, "reason":
--      "not_installed"} and changes nothing. Every reference to cron.* is dynamic SQL, so the function compiles without it.
--      Any other error is raised, so the job's run shows as failed on the card.
--    - Row level security: on Supabase, cron.job_run_details has a policy "username = current_user" and pg_cron grants
--      DELETE on it to PUBLIC. The function runs as its owner, the role that applies migrations (postgres), which is the
--      role that scheduled every job in supabase/migrations, so it deletes those jobs' runs. A run of a job scheduled by
--      hand as another role is not visible to it and stays.
-- 2. private_sec.schedule_cron_run_history_purge(): schedules job 'purge-cron-run-history' daily at 03:57 UTC, command
--    'SELECT private_sec.purge_cron_run_details()' (the defaults: 30 days, 20000 rows), where pg_cron is installed
--    (cron.schedule exists), and does nothing with a notice otherwise. cron.schedule with a job name replaces a job of
--    that name, so re-running is safe. 03:57 is free: the other daily jobs run at 03:17, 03:37, 04:17, 04:41, 04:47, 04:51
--    and 08:47, the hourly one at :23, the rest every 5 minutes or every minute. The migration calls it once.
--
-- This migration deletes nothing itself and changes no table, policy or grant on pg_cron's tables. Where pg_cron is
-- installed, the first deletion is the job's first run, the next 03:57 UTC after the migration is applied: applying it to
-- production is the owner's go-ahead for that first run. Deleted run history cannot be restored. The space it frees is
-- reused by autovacuum for new runs; the file does not shrink (only VACUUM FULL would return it, which locks the table).
--
-- Docs: docs/scheduled-jobs-health.md ("Run history retention").
--
-- Rollback: docs/rollbacks/20261203100000_cron_run_history_retention.down.sql.

SET lock_timeout = '5s';

-- 1. The purge ---------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private_sec.purge_cron_run_details(_keep_days integer DEFAULT 30, _batch integer DEFAULT 20000)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
AS $$
DECLARE
  _days    CONSTANT integer := LEAST(GREATEST(COALESCE(_keep_days, 30), 14), 365);
  _limit   CONSTANT integer := LEAST(GREATEST(COALESCE(_batch, 20000), 1), 100000);
  _cutoff  CONSTANT timestamptz := now() - make_interval(days => _days);
  _deleted integer;
  _left    bigint;
BEGIN
  IF to_regclass('cron.job_run_details') IS NULL THEN
    RETURN jsonb_build_object('available', false, 'reason', 'not_installed');
  END IF;

  -- The same test twice: in the subquery that picks the batch, and again on the row being deleted.
  EXECUTE $q$
    DELETE FROM cron.job_run_details d
     WHERE d.runid IN (SELECT s.runid FROM cron.job_run_details s
                        WHERE s.status IN ('succeeded', 'failed')
                          AND coalesce(s.end_time, s.start_time) < $1
                        ORDER BY s.runid
                        LIMIT $2)
       AND d.status IN ('succeeded', 'failed')
       AND coalesce(d.end_time, d.start_time) < $1
  $q$ USING _cutoff, _limit;
  GET DIAGNOSTICS _deleted = ROW_COUNT;

  EXECUTE $q$
    SELECT count(*) FROM cron.job_run_details d
     WHERE d.status IN ('succeeded', 'failed') AND coalesce(d.end_time, d.start_time) < $1
  $q$ INTO _left USING _cutoff;

  RETURN jsonb_build_object('available', true, 'deleted', _deleted, 'remaining_older', _left, 'cutoff', _cutoff,
                            'keep_days', _days, 'batch', _limit);
END $$;
REVOKE ALL ON FUNCTION private_sec.purge_cron_run_details(integer, integer) FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION private_sec.purge_cron_run_details(integer, integer) IS
  'Deletes finished pg_cron runs (succeeded or failed) older than _keep_days (default 30, held to 14..365), at most _batch (default 20000, held to 1..100000) per call, oldest runid first. Never a run in progress or one with no time. Owner and scheduler only.';

-- 2. The schedule ------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private_sec.schedule_cron_run_history_purge()
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SET search_path = ''
AS $$
BEGIN
  IF to_regprocedure('cron.schedule(text,text,text)') IS NULL THEN
    RAISE NOTICE 'pg_cron is not installed: purge-cron-run-history not scheduled';
    RETURN false;
  END IF;
  EXECUTE 'SELECT cron.schedule($1, $2, $3)'
    USING 'purge-cron-run-history', '57 3 * * *', 'SELECT private_sec.purge_cron_run_details()';
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION private_sec.schedule_cron_run_history_purge() FROM PUBLIC, anon, authenticated, service_role;

DO $cron$
BEGIN
  PERFORM private_sec.schedule_cron_run_history_purge();
EXCEPTION WHEN others THEN
  RAISE NOTICE 'purge-cron-run-history not scheduled: %', SQLERRM;
END
$cron$;

RESET lock_timeout;
