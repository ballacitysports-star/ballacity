-- 20261203100000_cron_run_history_retention: pg_cron's run history is kept for 30 days. private_sec.purge_cron_run_details
-- deletes finished runs (succeeded or failed) whose end_time, or start_time when there is no end_time, is strictly older
-- than the cut-off, and nothing else: not a younger run, not a run in progress (running, starting, connecting, sending),
-- not a run in any other status (unknown or NULL: the test is an allow list), not a run with neither time. The window is held to 14..365 days, so the Scheduled jobs card keeps its 7 days of failures whatever is
-- passed; a call deletes at most a batch (held to 1..100000), oldest runid first, and says how many older runs remain.
-- Nobody but the owner (and the scheduler, as the owner) runs either function: not visitors, members or the service role.
-- Without pg_cron it says so and changes nothing. The daily job is one job, replaced (not duplicated) when scheduled again.
-- This database has no pg_cron, so the test builds stand-ins shaped like its tables, inside the transaction.
BEGIN;
SELECT t.person('member', 30), t.person('superone', 33);
INSERT INTO public.user_roles (user_id, role) VALUES (t.id('superone'), 'superadmin');

-- ================= 1. the shape and the grants =================
SELECT t.ok((SELECT p.prosecdef
               AND 'search_path=""' = ANY (p.proconfig)
               AND 'lock_timeout=5s' = ANY (p.proconfig)
               AND p.prorettype = 'jsonb'::regtype
               FROM pg_proc p WHERE p.oid = 'private_sec.purge_cron_run_details(integer,integer)'::regprocedure),
            'the purge is SECURITY DEFINER with an empty search_path and a 5s lock_timeout, and returns jsonb');
SELECT t.eq(pg_get_function_arguments('private_sec.purge_cron_run_details(integer,integer)'::regprocedure),
            '_keep_days integer DEFAULT 30, _batch integer DEFAULT 20000', 'it keeps 30 days and deletes 20000 rows by default');
SELECT t.ok(NOT has_function_privilege('anon', 'private_sec.purge_cron_run_details(integer,integer)', 'EXECUTE')
            AND NOT has_function_privilege('authenticated', 'private_sec.purge_cron_run_details(integer,integer)', 'EXECUTE')
            AND NOT has_function_privilege('service_role', 'private_sec.purge_cron_run_details(integer,integer)', 'EXECUTE'),
            'no API role (visitors, members, the service role) may execute the purge');
SELECT t.ok(NOT has_function_privilege('anon', 'private_sec.schedule_cron_run_history_purge()', 'EXECUTE')
            AND NOT has_function_privilege('authenticated', 'private_sec.schedule_cron_run_history_purge()', 'EXECUTE')
            AND NOT has_function_privilege('service_role', 'private_sec.schedule_cron_run_history_purge()', 'EXECUTE'),
            'no API role may execute the scheduler helper');
SELECT t.eq((SELECT count(*)::int FROM pg_proc p
               CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
              WHERE p.oid IN ('private_sec.purge_cron_run_details(integer,integer)'::regprocedure,
                              'private_sec.schedule_cron_run_history_purge()'::regprocedure)
                AND x.grantee <> p.proowner), 0,
            'neither function has a grant to anyone but its owner (not PUBLIC either)');
SELECT t.ok((SELECT NOT p.prosecdef
               AND 'search_path=""' = ANY (p.proconfig)
               AND p.prorettype = 'boolean'::regtype
               FROM pg_proc p WHERE p.oid = 'private_sec.schedule_cron_run_history_purge()'::regprocedure),
            'the scheduler is not SECURITY DEFINER and has an empty search_path');
SELECT t.ok((SELECT p.prosrc FROM pg_proc p WHERE p.oid = 'private_sec.purge_cron_run_details(integer,integer)'::regprocedure)
            !~* '\mpublic\.', 'the purge touches no app table');

-- ================= 2. nobody but the owner runs it =================
SELECT t.as_anon();
SELECT t.throws($$SELECT private_sec.purge_cron_run_details()$$, 'permission denied', 'a visitor cannot run the purge');
SELECT t.reset();
SELECT t.as_user(t.id('member'));
SELECT t.throws($$SELECT private_sec.purge_cron_run_details(14, 1)$$, 'permission denied', 'a member cannot run the purge');
SELECT t.reset();
SELECT t.as_user(t.id('superone'));
SELECT t.throws($$SELECT private_sec.purge_cron_run_details()$$, 'permission denied', 'nor can a superadmin through the API');
SELECT t.throws($$SELECT private_sec.schedule_cron_run_history_purge()$$, 'permission denied',
                'a superadmin cannot reschedule the job through the API');
SELECT t.reset();
SELECT t.as_service();
SELECT t.throws($$SELECT private_sec.purge_cron_run_details()$$, 'permission denied', 'the service role cannot run the purge');
SELECT t.throws($$SELECT private_sec.schedule_cron_run_history_purge()$$, 'permission denied', 'nor reschedule the job');
SELECT t.reset();

-- ================= 3. no pg_cron =================
SELECT t.ok(to_regclass('cron.job_run_details') IS NULL AND to_regnamespace('cron') IS NULL, 'setup: this database has no pg_cron');
SELECT t.eq(private_sec.purge_cron_run_details(), '{"available": false, "reason": "not_installed"}'::jsonb,
            'without pg_cron the purge says not available');
SELECT t.eq(private_sec.schedule_cron_run_history_purge(), false,
            'without pg_cron nothing is scheduled (and the migration applied)');

-- ================= 4. stand-ins shaped like pg_cron's tables =================
-- cron.schedule(name, schedule, command) replaces a job of that name, as pg_cron's does; the unnamed two-argument form adds
-- a new job each time, as pg_cron's does.
CREATE SCHEMA cron;
CREATE TABLE cron.job (
  jobid bigserial PRIMARY KEY, schedule text NOT NULL, command text NOT NULL, nodename text NOT NULL DEFAULT 'localhost',
  nodeport integer NOT NULL DEFAULT 5432, database text NOT NULL DEFAULT current_database(),
  username text NOT NULL DEFAULT CURRENT_USER, active boolean NOT NULL DEFAULT true, jobname text,
  UNIQUE (username, jobname));
CREATE TABLE cron.job_run_details (
  jobid bigint, runid bigserial PRIMARY KEY, job_pid integer, database text, username text, command text, status text,
  return_message text, start_time timestamptz, end_time timestamptz);
CREATE FUNCTION cron.schedule(job_name text, schedule text, command text) RETURNS bigint LANGUAGE sql AS $f$
  INSERT INTO cron.job (jobname, schedule, command) VALUES ($1, $2, $3)
  ON CONFLICT (username, jobname) DO UPDATE SET schedule = EXCLUDED.schedule, command = EXCLUDED.command
  RETURNING jobid $f$;
CREATE FUNCTION cron.schedule(schedule text, command text) RETURNS bigint LANGUAGE sql AS $f$
  INSERT INTO cron.job (schedule, command) VALUES ($1, $2) RETURNING jobid $f$;
CREATE FUNCTION cron.unschedule(job_name text) RETURNS boolean LANGUAGE sql AS $f$
  WITH d AS (DELETE FROM cron.job WHERE jobname = $1 RETURNING 1) SELECT EXISTS (SELECT 1 FROM d) $f$;

INSERT INTO cron.job (jobid, jobname, schedule, command) VALUES
  (1, 'process-highlight-reels', '* * * * *', 'SELECT 1'),
  (2, 'purge-diagnostics', '37 3 * * *', 'SELECT public.purge_diagnostics()'),
  (3, 'end-adult-guardian-links', '41 4 * * *', 'SELECT private_sec.end_adult_guardian_links()');
SELECT setval('cron.job_jobid_seq', 3);

-- Each run is tagged in return_message; inserted in this order, so runid follows it. "now" is the transaction's start,
-- the same inside the purge, so "exactly 30 days" is exact.
INSERT INTO cron.job_run_details (jobid, status, return_message, start_time, end_time) VALUES
  (3, 'failed',    'notime',       NULL,                                         NULL),
  (1, 'succeeded', 'ancient',      now() - interval '400 days',                  now() - interval '400 days'),
  (1, 'succeeded', 'old200',       now() - interval '200 days',                  now() - interval '200 days'),
  (2, 'failed',    'fail40d',      now() - interval '40 days',                   now() - interval '40 days' + interval '1 second'),
  (1, 'failed',    'connfail40d',  NULL,                                         now() - interval '40 days'),
  (1, 'failed',    'noend40d',     now() - interval '40 days',                   NULL),
  (1, 'running',   'running40d',   now() - interval '40 days',                   NULL),
  (1, 'starting',  'starting40d',  now() - interval '40 days',                   NULL),
  (1, 'connecting', 'connecting40d', NULL,                                       now() - interval '40 days'),
  (1, 'sending',   'sending40d',   now() - interval '40 days',                   NULL),
  (1, 'unknown',   'unknown40d',   now() - interval '40 days',                   now() - interval '40 days'),
  (1, NULL,        'nostatus40d',  now() - interval '40 days',                   now() - interval '40 days'),
  (1, 'succeeded', 'longrun',      now() - interval '40 days',                   now() - interval '29 days'),
  (1, 'succeeded', 'justover',     now() - interval '30 days 1 minute',          now() - interval '30 days 1 second'),
  (1, 'succeeded', 'exactly',      now() - interval '30 days 1 minute',          now() - interval '30 days'),
  (1, 'succeeded', 'day20',        now() - interval '20 days',                   now() - interval '20 days'),
  (2, 'failed',    'fail10d',      now() - interval '10 days',                   now() - interval '10 days'),
  (1, 'succeeded', 'day13',        now() - interval '13 days',                   now() - interval '13 days'),
  (2, 'failed',    'fail3d',       now() - interval '3 days',                    now() - interval '3 days'),
  (2, 'succeeded', 'ok1h',         now() - interval '1 hour',                    now() - interval '1 hour'),
  (1, 'running',   'running',      now() - interval '1 minute',                  NULL);

CREATE FUNCTION pg_temp.left997() RETURNS text LANGUAGE sql AS $f$
  SELECT string_agg(return_message, ',' ORDER BY runid) FROM cron.job_run_details $f$;
-- The superadmin's Scheduled jobs card, read as the superadmin.
CREATE TEMP TABLE out997 (call text PRIMARY KEY, v jsonb);
GRANT ALL ON out997 TO authenticated;
CREATE FUNCTION pg_temp.card997(_k text) RETURNS jsonb LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM t.as_user(t.id('superone'));
  EXECUTE format('INSERT INTO pg_temp.out997 VALUES (%L, public.superadmin_scheduled_jobs())', _k);
  PERFORM t.reset();
  RETURN (SELECT j FROM out997 o CROSS JOIN LATERAL jsonb_array_elements(o.v -> 'jobs') j
           WHERE o.call = _k AND j ->> 'jobname' = 'purge-diagnostics');
END $f$;

SELECT t.eq(pg_temp.left997(),
            'notime,ancient,old200,fail40d,connfail40d,noend40d,running40d,starting40d,connecting40d,sending40d,'
            'unknown40d,nostatus40d,longrun,justover,exactly,day20,fail10d,day13,fail3d,ok1h,running',
            'setup: twenty-one runs');
SELECT t.eq((SELECT jsonb_build_object('failures_7d', j -> 'failures_7d', 'last_status', j -> 'last_status')
               FROM (SELECT pg_temp.card997('before') j) s),
            '{"failures_7d": 1, "last_status": "succeeded"}'::jsonb, 'setup: the card counts one failure in 7 days');

-- ================= 5. the upper clamp: at most 365 days are kept =================
SELECT t.eq(private_sec.purge_cron_run_details(1000) - 'cutoff',
            '{"available": true, "deleted": 1, "remaining_older": 0, "keep_days": 365, "batch": 20000}'::jsonb,
            '1000 days is held to 365: only the 400-day-old run goes');
SELECT t.eq(private_sec.purge_cron_run_details(1000) -> 'cutoff', to_jsonb(now() - interval '365 days'),
            'the cut-off is now minus 365 days');

-- ================= 6. the default: 30 days, in batches =================
SELECT t.eq(private_sec.purge_cron_run_details(NULL, 2) - 'cutoff',
            '{"available": true, "deleted": 2, "remaining_older": 3, "keep_days": 30, "batch": 2}'::jsonb,
            'a batch of 2 deletes 2 and says 3 older runs remain');
SELECT t.eq(pg_temp.left997(),
            'notime,connfail40d,noend40d,running40d,starting40d,connecting40d,sending40d,unknown40d,nostatus40d,longrun,'
            'justover,exactly,day20,fail10d,day13,fail3d,ok1h,running', 'the batch took the oldest runids first');
SELECT t.eq(private_sec.purge_cron_run_details(30, 2) - 'cutoff',
            '{"available": true, "deleted": 2, "remaining_older": 1, "keep_days": 30, "batch": 2}'::jsonb,
            'the next call takes the next batch');
SELECT t.eq(private_sec.purge_cron_run_details() - 'cutoff',
            '{"available": true, "deleted": 1, "remaining_older": 0, "keep_days": 30, "batch": 20000}'::jsonb,
            'and the last call finishes the backlog');
SELECT t.eq(private_sec.purge_cron_run_details() -> 'cutoff', to_jsonb(now() - interval '30 days'),
            'the default cut-off is now minus 30 days');
SELECT t.eq(private_sec.purge_cron_run_details() ->> 'deleted', '0', 'a second run deletes nothing');
SELECT t.eq(pg_temp.left997(),
            'notime,running40d,starting40d,connecting40d,sending40d,unknown40d,nostatus40d,longrun,exactly,day20,'
            'fail10d,day13,fail3d,ok1h,running',
            'finished runs older than 30 days are gone; exactly 30 days and younger, runs in progress, runs in any other '
            'status and runs with no time are kept');
SELECT t.ok((SELECT NOT EXISTS (SELECT 1 FROM cron.job_run_details WHERE return_message IN ('connfail40d', 'noend40d'))),
            'an old run with only an end_time, or only a start_time, is deleted');
SELECT t.ok((SELECT EXISTS (SELECT 1 FROM cron.job_run_details WHERE return_message = 'longrun')),
            'a run that started 40 days ago and ended 29 days ago is timed by its end, and kept');
SELECT t.ok((SELECT count(*) = 4 FROM cron.job_run_details
              WHERE return_message IN ('running40d', 'starting40d', 'connecting40d', 'sending40d')),
            'a run still running, starting, connecting or sending is kept however old');
SELECT t.ok((SELECT count(*) = 2 FROM cron.job_run_details WHERE return_message IN ('unknown40d', 'nostatus40d')),
            'a run in any other status (unknown, or none) is kept however old: only succeeded and failed go');
SELECT t.ok((SELECT EXISTS (SELECT 1 FROM cron.job_run_details WHERE return_message = 'notime')),
            'a run with neither time is kept');
SELECT t.eq((SELECT jsonb_build_object('failures_7d', j -> 'failures_7d', 'last_status', j -> 'last_status',
                                       'last_success_at', j -> 'last_success_at')
               FROM (SELECT pg_temp.card997('after30') j) s),
            jsonb_build_object('failures_7d', 1, 'last_status', 'succeeded', 'last_success_at', now() - interval '1 hour'),
            'after the purge the card still counts the failure in 7 days');

-- ================= 7. the lower clamp: at least 14 days are kept =================
SELECT t.eq(private_sec.purge_cron_run_details(1) - 'cutoff',
            '{"available": true, "deleted": 3, "remaining_older": 0, "keep_days": 14, "batch": 20000}'::jsonb,
            '1 day is held to 14: runs older than 14 days go');
SELECT t.eq(private_sec.purge_cron_run_details(-5) ->> 'keep_days', '14', 'a negative window is held to 14');
SELECT t.eq(private_sec.purge_cron_run_details(NULL, 0) - 'cutoff',
            '{"available": true, "deleted": 0, "remaining_older": 0, "keep_days": 30, "batch": 1}'::jsonb,
            'NULL means 30 days; a batch of 0 is held to 1');
SELECT t.eq(private_sec.purge_cron_run_details(30, 2000000000) ->> 'batch', '100000', 'a batch is held to 100000');
SELECT t.eq(pg_temp.left997(),
            'notime,running40d,starting40d,connecting40d,sending40d,unknown40d,nostatus40d,fail10d,day13,fail3d,ok1h,'
            'running', 'the 13-day-old run and the 10-day-old failure are kept');
SELECT t.eq((SELECT j -> 'failures_7d' FROM (SELECT pg_temp.card997('after14') j) s), '1'::jsonb,
            'the shortest window still leaves the card its 7 days of failures');

-- ================= 8. the schedule =================
SELECT t.eq(private_sec.schedule_cron_run_history_purge(), true, 'with pg_cron the job is scheduled');
SELECT t.eq((SELECT jsonb_agg(jsonb_build_array(jobname, schedule, command)) FROM cron.job WHERE jobid > 3),
            '[["purge-cron-run-history", "57 3 * * *", "SELECT private_sec.purge_cron_run_details()"]]'::jsonb,
            'exactly one new job: purge-cron-run-history, daily at 03:57 UTC, calling the purge with its defaults');
UPDATE cron.job SET schedule = '0 0 * * *', command = 'SELECT 1' WHERE jobname = 'purge-cron-run-history';
SELECT t.eq(private_sec.schedule_cron_run_history_purge(), true, 'scheduling again works');
SELECT t.eq((SELECT jsonb_agg(jsonb_build_array(jobname, schedule, command)) FROM cron.job WHERE jobid > 3),
            '[["purge-cron-run-history", "57 3 * * *", "SELECT private_sec.purge_cron_run_details()"]]'::jsonb,
            'scheduling again replaces the job, it does not add one');
SELECT t.eq((SELECT jsonb_agg(jsonb_build_array(jobid, jobname, schedule) ORDER BY jobid) FROM cron.job WHERE jobid <= 3),
            '[[1, "process-highlight-reels", "* * * * *"], [2, "purge-diagnostics", "37 3 * * *"], [3, "end-adult-guardian-links", "41 4 * * *"]]'::jsonb,
            'the other jobs are untouched');
INSERT INTO cron.job_run_details (jobid, status, return_message, start_time, end_time)
VALUES (1, 'succeeded', 'old15d', now() - interval '15 days', now() - interval '15 days');
DO $run$
DECLARE _cmd text;
BEGIN
  SELECT command INTO _cmd FROM cron.job WHERE jobname = 'purge-cron-run-history';
  EXECUTE _cmd;
END
$run$;
SELECT t.eq(pg_temp.left997(),
            'notime,running40d,starting40d,connecting40d,sending40d,unknown40d,nostatus40d,fail10d,day13,fail3d,ok1h,'
            'running,old15d', 'the job''s command runs and keeps 30 days');

-- ================= 9. pg_cron gone again =================
ALTER SCHEMA cron RENAME TO cron_hidden997;
SELECT t.eq(private_sec.purge_cron_run_details(), '{"available": false, "reason": "not_installed"}'::jsonb,
            'no cron schema: not available, nothing deleted');
ALTER SCHEMA cron_hidden997 RENAME TO cron;
SELECT t.eq((SELECT count(*)::int FROM cron.job_run_details), 13, 'and every run is still there');

ROLLBACK;
