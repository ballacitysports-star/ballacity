-- Scheduled jobs health: a superadmin sees a failing pg_cron sweep on the SuperAdmin Overview without querying the database.
--
-- WHY. Production runs pg_cron jobs scheduled by the migrations: flush-held-notifications, send-game-reminders and
-- release-expired-payment-holds every 5 minutes, sweep-availability-lifecycle hourly, and daily purge-app-error-events (03:17),
-- purge-diagnostics (03:37), extend-game-series (04:17), end-adult-guardian-links (04:41), age-adult-cohorts (04:47),
-- expire-managed-handovers (04:51) and snapshot-funnel-daily (08:47). When one fails, pg_cron writes it to
-- cron.job_run_details and tells nobody. The E2E sandbox and the CI replay database have no pg_cron.
--
-- WHAT. public.superadmin_scheduled_jobs(_runs integer DEFAULT 5) -> jsonb. SECURITY DEFINER, search_path ''. It checks
-- is_superadmin itself (as superadmin_funnel does), reads only pg_cron's and pg_net's own tables, and writes nothing.
-- - Where pg_cron is not installed (no cron.job or cron.job_run_details) it answers {"available": false, "reason":
--   "not_installed", "jobs": []}; where those tables cannot be read as expected (privilege or shape), reason "unreadable".
--   Every read of cron.* and net.* is dynamic SQL, so the function compiles without either schema.
-- - Per job: jobid, jobname, schedule, active; the last N runs, newest first (N = _runs clamped to 1..20, NULL means 5), each
--   with status, start_time and end_time, and for a failed run only a short message; the failures in the last 7 days; the last
--   successful run; flags: last_run_failed, not_run_25h (every job runs at least daily), never_run, inactive. "attention" is
--   true when any flag is set. A run's time is its start_time, or its end_time when it never started (pg_cron leaves
--   start_time empty for "connection failed" and "job startup timeout"). A failed run with neither ("server restarted"
--   while starting) counts in the 7 days when the newest time among the runs recorded before it (lower runids) is in them.
-- - A failed run's message keeps only the primary error. pg_cron saves libpq's whole error text, and its DETAIL ("Failing
--   row contains (...)", "Key (col)=(value) ..."), HINT, QUERY and CONTEXT ("SQL statement ...") lines carry row values, so
--   everything from the first such line is dropped: from any line that starts with an upper-case label and a colon, and
--   from DETAIL:, HINT:, QUERY:, CONTEXT: or LINE n: wherever it appears. Then whitespace is collapsed; URLs, UUIDs, email
--   addresses, everything after a "(column)=(" key detail, double-quoted literals (a quoted name right after column,
--   relation, table, constraint, index, schema, function, type, sequence, view, trigger, extension, policy, operator,
--   domain or role is kept), single-quoted literals, 32+ character tokens and numbers of 6+ digits (with single spaces,
--   dots, dashes, slashes, colons or plus signs between them, so phone numbers and dates) are replaced by [url], [id],
--   [email], ([value]), "[value]", '[value]', [token] and [number]; then it is cut to 200 characters. An unterminated quote
--   is redacted to the end. Free text that a job's own RAISE puts in its primary message is not recognised. A succeeded
--   run's message is never returned.
-- - NEVER returned: cron.job's command (it can carry an endpoint URL), username, database, nodename, nodeport, the run's
--   command, or anything from an app table.
-- - pg_net: where net._http_response exists, counts of the last 24 hours' responses by status class (2xx/3xx/4xx/5xx, no
--   response). Counts only: no URL, header or body. A worker_post job "succeeds" when pg_net accepts the request, even if
--   the endpoint then answers 500, so this is the only sign of that. pg_net keeps responses for 6 hours by default and
--   records no job id, so the counts are for every pg_net request, not per job.
-- - Cost: one pass over the newest 100000 rows of cron.job_run_details (a range on its primary key, runid). That is weeks
--   of history at the current job rate; a job whose last run is older than that reads as never_run, which is flagged anyway.
-- - On Supabase, cron.job and cron.job_run_details have row level security "username = current_user": the function runs as
--   its owner (the migration role), so it sees the jobs that role scheduled, which are all the jobs the migrations schedule.
--
-- Nothing here changes a row or what any other role can read. The UI: src/components/superadmin/ScheduledJobsCard.tsx;
-- docs/scheduled-jobs-health.md.
--
-- Rollback: docs/rollbacks/20261201100000_scheduled_jobs_health.down.sql.

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.superadmin_scheduled_jobs(_runs integer DEFAULT 5)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _n    CONSTANT integer := LEAST(GREATEST(COALESCE(_runs, 5), 1), 20);
  _jobs jsonb;
  _http jsonb := jsonb_build_object('available', false);
BEGIN
  -- Checked here, not only in the admin page: the page is not an authorization boundary.
  IF NOT COALESCE(private_sec.is_superadmin(auth.uid()), false) THEN
    RAISE EXCEPTION 'SUPERADMIN_ONLY' USING ERRCODE = '42501';
  END IF;

  IF to_regclass('cron.job') IS NULL OR to_regclass('cron.job_run_details') IS NULL THEN
    RETURN jsonb_build_object('available', false, 'reason', 'not_installed', 'jobs', '[]'::jsonb);
  END IF;

  BEGIN
    EXECUTE $q$
      WITH recent AS (
        SELECT d.jobid, d.runid, d.status, d.return_message, d.start_time, d.end_time,
               coalesce(d.start_time, d.end_time) AS run_at,
               coalesce(d.start_time, d.end_time,
                        max(coalesce(d.start_time, d.end_time)) OVER (ORDER BY d.runid)) AS not_before
          FROM cron.job_run_details d
         WHERE d.runid > (SELECT coalesce(max(m.runid), 0) - 100000 FROM cron.job_run_details m)
      ),
      ranked AS (
        SELECT r.*, row_number() OVER (PARTITION BY r.jobid ORDER BY r.runid DESC) AS rn FROM recent r
      ),
      per_job AS (
        SELECT j.jobid, j.jobname, j.schedule, j.active,
               l.status AS last_status,
               s.last_run_at, s.last_success_at, s.failures_7d,
               coalesce(k.runs, '[]'::jsonb) AS runs
          FROM (SELECT c.jobid, c.jobname, c.schedule, c.active FROM cron.job c
                 ORDER BY c.jobname NULLS LAST, c.jobid LIMIT 200) j
          LEFT JOIN ranked l ON l.jobid = j.jobid AND l.rn = 1
          LEFT JOIN LATERAL (
            SELECT max(r.run_at) AS last_run_at,
                   max(r.start_time) FILTER (WHERE r.status = 'succeeded') AS last_success_at,
                   count(*) FILTER (WHERE r.status = 'failed' AND r.not_before >= now() - interval '7 days')::int AS failures_7d
              FROM recent r WHERE r.jobid = j.jobid) s ON true
          LEFT JOIN LATERAL (
            SELECT jsonb_agg(jsonb_build_object(
                     'status', x.status,
                     'start_time', x.start_time,
                     'end_time', x.end_time,
                     'message', CASE WHEN x.status = 'failed' THEN
                       NULLIF(CASE WHEN length(x.msg) > 200 THEN left(x.msg, 199) || '…' ELSE x.msg END, '')
                     END) ORDER BY x.rn) AS runs
              FROM (SELECT q.rn, q.status, q.start_time, q.end_time,
                           btrim(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
                             regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
                             left(coalesce(q.return_message, ''), 2000),
                             '\n\s*[A-Z][A-Z ]*[0-9]*:.*$', ''),
                             '(^|\s)(DETAIL|HINT|QUERY|CONTEXT|LINE [0-9]+):.*$', ''),
                             '\s+', ' ', 'g'),
                             '[A-Za-z][A-Za-z0-9+.-]*://[^[:space:]''"]*', '[url]', 'g'),
                             '[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}', '[id]', 'g'),
                             '[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+', '[email]', 'g'),
                             '\)=\(.*$', ')=([value])'),
                             '(?<![[:alnum:]_])(?<!\m(column|relation|table|constraint|index|schema|function|type|sequence|view|trigger|extension|policy|operator|domain|role) )"[^"]*("|$)', '"[value]"', 'g'),
                             '(?<![[:alnum:]_])''[^'']*(''|$)', '''[value]''', 'g'),
                             '[A-Za-z0-9_+/=-]{32,}', '[token]', 'g'),
                             '[0-9]([ ./:+-]?[0-9]){5,}', '[number]', 'g')) AS msg
                      FROM ranked q WHERE q.jobid = j.jobid AND q.rn <= $1) x) k ON true
      )
      SELECT coalesce(jsonb_agg(jsonb_build_object(
               'jobid', p.jobid,
               'jobname', p.jobname,
               'schedule', p.schedule,
               'active', p.active,
               'last_status', p.last_status,
               'last_run_at', p.last_run_at,
               'last_success_at', p.last_success_at,
               'failures_7d', coalesce(p.failures_7d, 0),
               'runs', p.runs,
               'flags', f.flags,
               'attention', jsonb_array_length(f.flags) > 0)
             ORDER BY p.jobname NULLS LAST, p.jobid), '[]'::jsonb)
        FROM per_job p
       CROSS JOIN LATERAL (
         SELECT to_jsonb(array_remove(ARRAY[
                  CASE WHEN p.last_status = 'failed' THEN 'last_run_failed' END,
                  CASE WHEN p.last_run_at IS NULL AND p.last_status IS NULL THEN 'never_run' END,
                  CASE WHEN p.active AND (p.last_run_at < now() - interval '25 hours'
                                          OR (p.last_run_at IS NULL AND p.last_status IS NOT NULL)) THEN 'not_run_25h' END,
                  CASE WHEN p.active IS NOT TRUE THEN 'inactive' END], NULL)) AS flags) f
    $q$ INTO _jobs USING _n;
  EXCEPTION WHEN insufficient_privilege OR undefined_table OR undefined_column THEN
    RETURN jsonb_build_object('available', false, 'reason', 'unreadable', 'jobs', '[]'::jsonb);
  END;

  IF to_regclass('net._http_response') IS NOT NULL THEN
    BEGIN
      EXECUTE $q$
        SELECT jsonb_build_object(
                 'available', true,
                 'window_hours', 24,
                 'oldest_at', min(h.created),
                 'total', count(*),
                 's2xx', count(*) FILTER (WHERE h.status_code BETWEEN 200 AND 299),
                 's3xx', count(*) FILTER (WHERE h.status_code BETWEEN 300 AND 399),
                 's4xx', count(*) FILTER (WHERE h.status_code BETWEEN 400 AND 499),
                 's5xx', count(*) FILTER (WHERE h.status_code BETWEEN 500 AND 599),
                 'no_response', count(*) FILTER (WHERE h.status_code IS NULL),
                 'other', count(*) FILTER (WHERE h.status_code < 200 OR h.status_code > 599))
          FROM net._http_response h
         WHERE h.created >= now() - interval '24 hours'
      $q$ INTO _http;
    EXCEPTION WHEN insufficient_privilege OR undefined_table OR undefined_column THEN
      _http := jsonb_build_object('available', false);
    END;
  END IF;

  RETURN jsonb_build_object('available', true, 'generated_at', now(), 'runs_per_job', _n, 'jobs', _jobs, 'http', _http);
END $$;
REVOKE ALL ON FUNCTION public.superadmin_scheduled_jobs(integer) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.superadmin_scheduled_jobs(integer) TO authenticated;
COMMENT ON FUNCTION public.superadmin_scheduled_jobs(integer) IS
  'Scheduled jobs health: pg_cron jobs with their last runs (failed-run messages redacted and cut to 200 characters), failures in 7 days, flags, and pg_net response counts. Never the job command, user or database. Superadmin only; writes nothing.';

RESET lock_timeout;
