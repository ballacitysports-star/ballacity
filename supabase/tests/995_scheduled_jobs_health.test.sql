-- 20261201100000_scheduled_jobs_health: only a superadmin reads the scheduled jobs' health, and it never carries a job's
-- command (which can hold an endpoint URL), user, database or node, a succeeded run's message, or a raw key value: a failed
-- run's message keeps only the primary error (no DETAIL such as "Failing row contains", no HINT, QUERY or CONTEXT), has
-- URLs, UUIDs, emails, key details, quoted literals, tokens and long numbers (phone numbers and dates too) redacted and is
-- cut to 200 characters. The last N runs are clamped to 1..20. Flags: last run failed, not run in 25 hours (active jobs
-- only), never run, inactive. A run that never started is timed by its end. pg_net responses are counts by status class
-- only. Where pg_cron is not installed (or its tables cannot be read) it says so, with no jobs.
-- This database has no pg_cron or pg_net, so the test builds stand-ins shaped like their tables, inside the transaction.
BEGIN;
SELECT t.person('member', 30), t.person('modone', 31), t.person('adminone', 32), t.person('superone', 33);
INSERT INTO public.user_roles (user_id, role)
VALUES (t.id('modone'), 'moderator'), (t.id('adminone'), 'admin'), (t.id('superone'), 'superadmin');

-- Each answer the superadmin gets is kept here, then checked as the superuser.
CREATE TEMP TABLE out995 (call text PRIMARY KEY, v jsonb);
GRANT ALL ON out995 TO authenticated;
CREATE FUNCTION pg_temp.job995(_k text, _name text) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT j FROM out995 o CROSS JOIN LATERAL jsonb_array_elements(o.v -> 'jobs') j WHERE o.call = _k AND j ->> 'jobname' = _name
$f$;
CREATE FUNCTION pg_temp.read995(_k text, _runs text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM t.as_user(t.id('superone'));
  EXECUTE format('INSERT INTO pg_temp.out995 VALUES (%L, public.superadmin_scheduled_jobs(%s))', _k, _runs);
  PERFORM t.reset();
END $f$;

-- ================= 1. the shape and the grants =================
SELECT t.ok((SELECT p.prosecdef AND 'search_path=""' = ANY (p.proconfig) AND p.prorettype = 'jsonb'::regtype
               FROM pg_proc p WHERE p.oid = 'public.superadmin_scheduled_jobs(integer)'::regprocedure),
            'SECURITY DEFINER with an empty search_path, returns jsonb');
SELECT t.eq(pg_get_function_arguments('public.superadmin_scheduled_jobs(integer)'::regprocedure),
            '_runs integer DEFAULT 5', 'five runs per job by default');
SELECT t.ok(NOT has_function_privilege('anon', 'public.superadmin_scheduled_jobs(integer)', 'EXECUTE'),
            'visitors (and PUBLIC) have no EXECUTE');
SELECT t.ok(NOT has_function_privilege('service_role', 'public.superadmin_scheduled_jobs(integer)', 'EXECUTE'),
            'the service role has no EXECUTE');
SELECT t.ok(has_function_privilege('authenticated', 'public.superadmin_scheduled_jobs(integer)', 'EXECUTE'),
            'signed-in users may call it (the function checks the role)');
SELECT t.ok((SELECT p.prosrc FROM pg_proc p WHERE p.oid = 'public.superadmin_scheduled_jobs(integer)'::regprocedure)
            !~* '\m(command|username|database|nodename|nodeport)\M',
            'the body never names a job''s command, user, database or node');
SELECT t.ok((SELECT p.prosrc FROM pg_proc p WHERE p.oid = 'public.superadmin_scheduled_jobs(integer)'::regprocedure)
            !~* '\mpublic\.',
            'the body reads no app table');

-- ================= 2. who may read it =================
SELECT t.as_anon();
SELECT t.throws('SELECT public.superadmin_scheduled_jobs()', 'permission denied', 'a visitor is refused');
SELECT t.reset();
SELECT t.as_user(t.id('member'));
SELECT t.throws('SELECT public.superadmin_scheduled_jobs()', 'SUPERADMIN_ONLY', 'a member is refused');
SELECT t.reset();
SELECT t.as_user(t.id('modone'));
SELECT t.throws('SELECT public.superadmin_scheduled_jobs()', 'SUPERADMIN_ONLY', 'a moderator is refused');
SELECT t.reset();
SELECT t.as_user(t.id('adminone'));
SELECT t.throws('SELECT public.superadmin_scheduled_jobs()', 'SUPERADMIN_ONLY', 'an admin is refused');
SELECT t.reset();
SELECT t.as_service();
SELECT t.throws('SELECT public.superadmin_scheduled_jobs()', 'permission denied', 'server code with no signed-in superadmin is refused');
SELECT t.reset();

-- ================= 3. no pg_cron =================
SELECT t.ok(to_regclass('cron.job') IS NULL AND to_regnamespace('cron') IS NULL, 'setup: this database has no pg_cron');
SELECT t.ok(to_regclass('net._http_response') IS NULL, 'setup: this database has no pg_net');
SELECT pg_temp.read995('absent', '');
SELECT t.eq((SELECT v FROM out995 WHERE call = 'absent'),
            '{"available": false, "reason": "not_installed", "jobs": []}'::jsonb,
            'without pg_cron: not available, no jobs');

-- ================= 4. stand-ins shaped like pg_cron's and pg_net's tables =================
CREATE SCHEMA cron;
CREATE TABLE cron.job (
  jobid bigserial PRIMARY KEY, schedule text NOT NULL, command text NOT NULL, nodename text NOT NULL DEFAULT 'localhost',
  nodeport integer NOT NULL DEFAULT 5432, database text NOT NULL DEFAULT current_database(),
  username text NOT NULL DEFAULT CURRENT_USER, active boolean NOT NULL DEFAULT true, jobname text);
CREATE TABLE cron.job_run_details (
  jobid bigint, runid bigserial PRIMARY KEY, job_pid integer, database text, username text, command text, status text,
  return_message text, start_time timestamptz, end_time timestamptz);

INSERT INTO cron.job (jobid, jobname, schedule, command, nodename, nodeport, database, username, active) VALUES
  (1, 'flush-held-notifications', '*/5 * * * *', $c$SELECT private_sec.worker_post('/api/public/notifications/flush')$c$,
   'nodehost995', 5432, 'dbname995', 'cronowner995', true),
  (2, 'purge-diagnostics', '37 3 * * *', 'SELECT public.purge_diagnostics()', 'nodehost995', 5432, 'dbname995', 'cronowner995', true),
  (3, 'age-adult-cohorts', '47 4 * * *', 'SELECT private_sec.age_adult_cohorts()', 'nodehost995', 5432, 'dbname995', 'cronowner995', true),
  (4, 'expire-managed-handovers', '51 4 * * *', 'SELECT private_sec.expire_managed_handovers()', 'nodehost995', 5432,
   'dbname995', 'cronowner995', true),
  (5, 'process-highlight-reels', '* * * * *',
   $c$SELECT net.http_post(url := 'https://reels-secret995.example.test/api/public/reels/process', headers := '{"x-worker-secret": "hdrsecret995"}'::jsonb)$c$,
   'nodehost995', 5432, 'dbname995', 'cronowner995', false),
  (6, 'send-game-reminders', '*/5 * * * *', $c$SELECT private_sec.worker_post('/api/public/reminders/run')$c$,
   'nodehost995', 5432, 'dbname995', 'cronowner995', true),
  (7, 'end-adult-guardian-links', '41 4 * * *', 'SELECT private_sec.end_adult_guardian_links()', 'nodehost995', 5432,
   'dbname995', 'cronowner995', true),
  (8, 'extend-game-series', '17 4 * * *', 'SELECT private_sec.extend_game_series()', 'nodehost995', 5432,
   'dbname995', 'cronowner995', true);

-- end-adult-guardian-links: the oldest run recorded is a failed run that never started and has no time ("server restarted"
-- while starting): nothing recorded before it, so it is not counted in the 7 days.
INSERT INTO cron.job_run_details (jobid, database, username, command, status, return_message, start_time, end_time)
VALUES (7, 'dbname995', 'cronowner995', 'c', 'failed', 'server restarted', NULL, NULL);
-- flush-held-notifications: 25 succeeded runs, every 5 minutes, newest 5 minutes ago.
INSERT INTO cron.job_run_details (jobid, database, username, command, status, return_message, start_time, end_time)
SELECT 1, 'dbname995', 'cronowner995', 'worker_post command', 'succeeded', '1 row okmarker995 https://ok995.example.test',
       now() - make_interval(mins => 5 * i), now() - make_interval(mins => 5 * i) + interval '2 seconds'
  FROM generate_series(25, 1, -1) i;
-- purge-diagnostics: failed 10 days ago (outside 7 days), failed 3 days ago, succeeded 25 hours ago, failed 1 hour ago.
INSERT INTO cron.job_run_details (jobid, database, username, command, status, return_message, start_time, end_time) VALUES
  (2, 'dbname995', 'cronowner995', 'c', 'failed', 'ERROR: old failure', now() - interval '10 days', now() - interval '10 days'),
  (2, 'dbname995', 'cronowner995', 'c', 'failed', 'ERROR: canceling statement due to lock timeout',
   now() - interval '3 days', now() - interval '3 days' + interval '5 seconds'),
  (2, 'dbname995', 'cronowner995', 'c', 'succeeded', 'DELETE 12', now() - interval '25 hours', now() - interval '25 hours'),
  (2, 'dbname995', 'cronowner995', 'c', 'failed',
   E'ERROR:\n  game 5f0c1e2d-3b4a-4c5d-8e6f-708192a3b4c5: insert on table "delivery_log" violates foreign key for jane.doe@example.com ' ||
   E'order 123456789 phone +44 7700 900123 value "Jane Q Public" or \'Jane\' at https://hook995.example.test/api/public/x?token=abc '
   'secret ' || repeat('A1', 20) || ' ' || repeat('padding ', 30) || 'tail 7d1c2b3a-aaaa-4bbb-8ccc-ddddeeeeffff',
   now() - interval '1 hour', now() - interval '1 hour' + interval '1 second');
-- age-adult-cohorts: its last run was 30 hours ago (stale). expire-managed-handovers: never ran.
INSERT INTO cron.job_run_details (jobid, database, username, command, status, return_message, start_time, end_time) VALUES
  (3, 'dbname995', 'cronowner995', 'c', 'succeeded', '1 row', now() - interval '30 hours', now() - interval '30 hours'),
-- process-highlight-reels: inactive, last ran 30 hours ago (an inactive job is not "not run in 25 hours").
  (5, 'dbname995', 'cronowner995', 'c', 'succeeded', '1 row', now() - interval '30 hours', now() - interval '30 hours'),
-- send-game-reminders: succeeded 6 minutes ago, running now.
  (6, 'dbname995', 'cronowner995', 'c', 'succeeded', '1 row', now() - interval '6 minutes', now() - interval '6 minutes'),
  (6, 'dbname995', 'cronowner995', 'c', 'running', NULL, now() - interval '1 minute', NULL),
-- a run of a job that no longer exists.
  (99, 'dbname995', 'cronowner995', 'c', 'failed', 'ERROR: orphan995', now() - interval '1 minute', now());
-- end-adult-guardian-links: succeeded 26 hours ago; then failed while starting with no time ("server restarted"), after runs
-- inside the 7 days; then failed to connect 10 minutes ago, which pg_cron records with an end_time and no start_time.
INSERT INTO cron.job_run_details (jobid, database, username, command, status, return_message, start_time, end_time) VALUES
  (7, 'dbname995', 'cronowner995', 'c', 'succeeded', '1 row', now() - interval '26 hours', now() - interval '26 hours'),
  (7, 'dbname995', 'cronowner995', 'c', 'failed', 'server restarted', NULL, NULL),
  (7, 'dbname995', 'cronowner995', 'c', 'failed', 'connection failed', NULL, now() - interval '10 minutes');
-- extend-game-series: failed runs whose messages are libpq's whole error text, as pg_cron saves it (oldest first).
INSERT INTO cron.job_run_details (jobid, database, username, command, status, return_message, start_time, end_time) VALUES
  (8, 'dbname995', 'cronowner995', 'c', 'failed',
   E'ERROR:  null value in column "birth_date" of relation "profiles" violates not-null constraint\n' ||
   E'DETAIL:  Failing row contains (3f2a, Jane Public, jane, null, +44 7700 900123, f).',
   now() - interval '7 hours', now() - interval '7 hours'),
  (8, 'dbname995', 'cronowner995', 'c', 'failed', E'ERROR:  invalid input syntax for type date: "Jane Q Public"',
   now() - interval '6 hours', now() - interval '6 hours'),
  (8, 'dbname995', 'cronowner995', 'c', 'failed',
   E'ERROR:  duplicate key value violates unique constraint "profiles_display_name_key"\n' ||
   E'DETAIL:  Key (display_name)=(Jane (JJ) Public) already exists.',
   now() - interval '5 hours', now() - interval '5 hours'),
  (8, 'dbname995', 'cronowner995', 'c', 'failed',
   E'ERROR:  boom995\n' ||
   E'CONTEXT:  SQL statement "UPDATE profiles SET display_name = \'Jane Public\' WHERE phone = \'07700 900123\'"\n' ||
   E'PL/pgSQL function private_sec.extend_game_series() line 4 at SQL statement',
   now() - interval '4 hours', now() - interval '4 hours'),
  (8, 'dbname995', 'cronowner995', 'c', 'failed',
   E'ERROR:  value too long for type character varying(20)\nSCHEMA NAME:  Jane Public\nTABLE NAME:  profiles',
   now() - interval '3 hours', now() - interval '3 hours'),
  (8, 'dbname995', 'cronowner995', 'c', 'failed',
   E'ERROR:  duplicate key value violates unique constraint "k" DETAIL:  Failing row contains (Jane Public, 2010-04-02).',
   now() - interval '2 hours', now() - interval '2 hours'),
  (8, 'dbname995', 'cronowner995', 'c', 'failed',
   E'ERROR:  guardian check: \'Jane\' born 2010-04-02, call (415) 555-0134, key (display_name)=(Jane (JJ) Public) more',
   now() - interval '1 hour', now() - interval '1 hour');

SELECT pg_temp.read995('default', '');
SELECT pg_temp.read995('null', 'NULL');
SELECT pg_temp.read995('many', '100');
SELECT pg_temp.read995('zero', '0');
SELECT pg_temp.read995('negative', '-3');

-- ================= 5. what it carries, and what it never does =================
SELECT t.eq((SELECT v -> 'available' FROM out995 WHERE call = 'default'), 'true'::jsonb, 'with pg_cron: available');
SELECT t.eq((SELECT array_agg(j ->> 'jobname' ORDER BY j ->> 'jobname') FROM out995 o, jsonb_array_elements(o.v -> 'jobs') j
              WHERE o.call = 'default'),
            ARRAY['age-adult-cohorts', 'end-adult-guardian-links', 'expire-managed-handovers', 'extend-game-series',
                  'flush-held-notifications', 'process-highlight-reels', 'purge-diagnostics', 'send-game-reminders'],
            'every job, once, and no run of a job that no longer exists');
SELECT t.eq((SELECT array_agg(k ORDER BY k) FROM out995 o, jsonb_object_keys(o.v) k WHERE o.call = 'default'),
            ARRAY['available', 'generated_at', 'http', 'jobs', 'runs_per_job'], 'top level: only the expected keys');
SELECT t.eq((SELECT count(*)::int FROM out995 o, jsonb_array_elements(o.v -> 'jobs') j
              WHERE o.call = 'default'
                AND (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(j) k)
                    IS DISTINCT FROM ARRAY['active', 'attention', 'failures_7d', 'flags', 'jobid', 'jobname', 'last_run_at',
                                           'last_status', 'last_success_at', 'runs', 'schedule']),
            0, 'each job: only jobid, jobname, schedule, active, runs, counts and flags');
SELECT t.eq((SELECT count(*)::int FROM out995 o, jsonb_array_elements(o.v -> 'jobs') j, jsonb_array_elements(j -> 'runs') r
              WHERE (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(r) k)
                    IS DISTINCT FROM ARRAY['end_time', 'message', 'start_time', 'status']),
            0, 'each run: only status, start_time, end_time and message');
SELECT t.eq((SELECT count(*)::int FROM out995 o
              WHERE o.v::text ~* '(worker_post|http_post|purge_diagnostics\(|reels-secret995|hdrsecret995|https?://|cronowner995|dbname995|nodehost995|localhost)'),
            0, 'no answer carries a command, URL, user, database or node');
SELECT t.eq((SELECT count(*)::int FROM out995 o WHERE o.v::text ~ '(okmarker995|DELETE 12|orphan995)'), 0,
            'no answer carries a succeeded run''s message, or a deleted job''s run');
SELECT t.eq((SELECT count(*)::int FROM out995 o, jsonb_array_elements(o.v -> 'jobs') j, jsonb_array_elements(j -> 'runs') r
              WHERE r ->> 'status' <> 'failed' AND r -> 'message' <> 'null'::jsonb),
            0, 'succeeded and running runs carry no message');

-- ================= 6. the failed run's message =================
SELECT t.eq((SELECT jsonb_build_array(j -> 'last_status', j -> 'runs' -> 0 -> 'status')
               FROM (SELECT pg_temp.job995('default', 'purge-diagnostics') j) s),
            '["failed", "failed"]'::jsonb, 'purge-diagnostics: the latest run failed, newest run first');
SELECT t.eq((SELECT (j -> 'runs' -> 1 ->> 'message') FROM (SELECT pg_temp.job995('default', 'purge-diagnostics') j) s),
            NULL, 'the run that succeeded carries no message');
SELECT t.eq((SELECT (j -> 'runs' -> 2 ->> 'message') FROM (SELECT pg_temp.job995('default', 'purge-diagnostics') j) s),
            'ERROR: canceling statement due to lock timeout', 'a message with nothing to redact is kept as it is');
SELECT t.ok((SELECT m !~* '(5f0c1e2d|7d1c2b3a|jane|Q Public|example\.com|123456789|7700|hook995|token=|A1A1A1)'
               FROM (SELECT pg_temp.job995('default', 'purge-diagnostics') -> 'runs' -> 0 ->> 'message' AS m) s),
            'redacted: no UUID, name, email, long number, phone number, URL or token is left');
SELECT t.ok((SELECT m LIKE 'ERROR: game [id]: insert on table "delivery_log" violates foreign key for [email] order [number] phone +[number] value "[value]" or ''[value]'' at [url] secret [token] padding%'
               FROM (SELECT pg_temp.job995('default', 'purge-diagnostics') -> 'runs' -> 0 ->> 'message' AS m) s),
            'redacted in place: [id], [email], [number], "[value]", ''[value]'', [url], [token]; a table name is kept');
SELECT t.ok((SELECT m LIKE 'ERROR: game%' AND m NOT LIKE E'%\n%'
               FROM (SELECT pg_temp.job995('default', 'purge-diagnostics') -> 'runs' -> 0 ->> 'message' AS m) s),
            'whitespace is collapsed to single spaces');
SELECT t.ok((SELECT length(m) = 200 AND m LIKE '%…'
               FROM (SELECT pg_temp.job995('default', 'purge-diagnostics') -> 'runs' -> 0 ->> 'message' AS m) s),
            'a long message is cut to 200 characters');
SELECT t.eq((SELECT jsonb_path_query_array(pg_temp.job995('many', 'extend-game-series') -> 'runs', '$[*].message')),
            jsonb_build_array(
              'ERROR: guardian check: ''[value]'' born [number], call (415) [number], key (display_name)=([value])',
              'ERROR: duplicate key value violates unique constraint "k"',
              'ERROR: value too long for type character varying(20)',
              'ERROR: boom995',
              'ERROR: duplicate key value violates unique constraint "profiles_display_name_key"',
              'ERROR: invalid input syntax for type date: "[value]"',
              'ERROR: null value in column "birth_date" of relation "profiles" violates not-null constraint'),
            'libpq error text: only the primary error is kept (no DETAIL, CONTEXT or other labelled line, inline or not); '
            'quoted literals, a key detail with parentheses, dates and phone numbers redacted; column, relation and '
            'constraint names kept');
SELECT t.eq((SELECT count(*)::int FROM out995 o, jsonb_array_elements(o.v -> 'jobs') j, jsonb_array_elements(j -> 'runs') r
              WHERE r ->> 'message' ~* '(jane|JJ|7700|900123|555-0134|2010-04|3f2a|profiles SET|Failing row|SCHEMA NAME|SQL statement)'),
            0, 'no message carries a name, phone number, date, row or SQL statement');

-- ================= 7. counts and flags =================
SELECT t.eq((SELECT jsonb_build_object('failures_7d', j -> 'failures_7d', 'last_success_at', j -> 'last_success_at',
                                       'flags', j -> 'flags', 'attention', j -> 'attention')
               FROM (SELECT pg_temp.job995('default', 'purge-diagnostics') j) s),
            jsonb_build_object('failures_7d', 2, 'last_success_at', now() - interval '25 hours',
                               'flags', '["last_run_failed"]'::jsonb, 'attention', true),
            'purge-diagnostics: 2 failures in 7 days, last success 25 hours ago, flagged as failed');
SELECT t.eq((SELECT jsonb_build_array(j -> 'flags', j -> 'attention', j -> 'last_run_at')
               FROM (SELECT pg_temp.job995('default', 'age-adult-cohorts') j) s),
            jsonb_build_array('["not_run_25h"]'::jsonb, true, now() - interval '30 hours'),
            'age-adult-cohorts: not run in 25 hours, flagged');
SELECT t.eq((SELECT jsonb_build_array(j -> 'flags', j -> 'attention', j -> 'runs', j -> 'last_run_at', j -> 'last_status',
                                      j -> 'failures_7d')
               FROM (SELECT pg_temp.job995('default', 'expire-managed-handovers') j) s),
            '[["never_run"], true, [], null, null, 0]'::jsonb, 'expire-managed-handovers: never ran, flagged');
SELECT t.eq((SELECT jsonb_build_array(j -> 'flags', j -> 'active', j -> 'last_run_at')
               FROM (SELECT pg_temp.job995('default', 'process-highlight-reels') j) s),
            jsonb_build_array('["inactive"]'::jsonb, false, now() - interval '30 hours'),
            'an inactive job is flagged as inactive only, not as not run in 25 hours');
SELECT t.eq((SELECT jsonb_build_array(j -> 'flags', j -> 'attention', j -> 'last_status', j -> 'runs' -> 0 -> 'end_time',
                                      j -> 'last_success_at')
               FROM (SELECT pg_temp.job995('default', 'send-game-reminders') j) s),
            jsonb_build_array('[]'::jsonb, false, 'running', NULL, now() - interval '6 minutes'),
            'a running job is not flagged, and a running run is not its last success');
SELECT t.eq((SELECT jsonb_build_object('last_status', j -> 'last_status', 'last_run_at', j -> 'last_run_at',
                                       'last_success_at', j -> 'last_success_at', 'failures_7d', j -> 'failures_7d',
                                       'flags', j -> 'flags',
                                       'runs', jsonb_path_query_array(j -> 'runs', '$[*].message'),
                                       'first', j -> 'runs' -> 0)
               FROM (SELECT pg_temp.job995('default', 'end-adult-guardian-links') j) s),
            jsonb_build_object('last_status', 'failed', 'last_run_at', now() - interval '10 minutes',
                               'last_success_at', now() - interval '26 hours', 'failures_7d', 2,
                               'flags', '["last_run_failed"]'::jsonb,
                               'runs', '["connection failed", "server restarted", null, "server restarted"]'::jsonb,
                               'first', jsonb_build_object('status', 'failed', 'start_time', NULL,
                                                           'end_time', now() - interval '10 minutes',
                                                           'message', 'connection failed')),
            'runs that never started: timed by their end, counted in the 7 days (one with no time only after runs in them)');
SELECT t.eq((SELECT jsonb_build_array(j -> 'flags', j -> 'attention', j -> 'failures_7d', j -> 'schedule')
               FROM (SELECT pg_temp.job995('default', 'flush-held-notifications') j) s),
            '[[], false, 0, "*/5 * * * *"]'::jsonb, 'a healthy job is not flagged');
SELECT t.eq((SELECT (j -> 'runs' -> 0 -> 'start_time') FROM (SELECT pg_temp.job995('default', 'flush-held-notifications') j) s),
            to_jsonb(now() - interval '5 minutes'), 'runs are newest first');

-- ================= 8. how many runs =================
SELECT t.eq((SELECT jsonb_build_array(jsonb_array_length(pg_temp.job995('default', 'flush-held-notifications') -> 'runs'),
                                      (SELECT v -> 'runs_per_job' FROM out995 WHERE call = 'default'))),
            '[5, 5]'::jsonb, 'five runs by default');
SELECT t.eq(jsonb_array_length(pg_temp.job995('null', 'flush-held-notifications') -> 'runs'), 5, 'NULL means five');
SELECT t.eq((SELECT jsonb_build_array(jsonb_array_length(pg_temp.job995('many', 'flush-held-notifications') -> 'runs'),
                                      (SELECT v -> 'runs_per_job' FROM out995 WHERE call = 'many'))),
            '[20, 20]'::jsonb, 'at most 20 runs, whatever is asked');
SELECT t.eq(jsonb_array_length(pg_temp.job995('zero', 'flush-held-notifications') -> 'runs'), 1, 'zero asks for at least one');
SELECT t.eq(jsonb_array_length(pg_temp.job995('negative', 'flush-held-notifications') -> 'runs'), 1, 'a negative number asks for one');
SELECT t.eq(jsonb_array_length(pg_temp.job995('many', 'purge-diagnostics') -> 'runs'), 4, 'a job with fewer runs shows them all');

-- ================= 9. pg_net: counts only =================
SELECT t.eq((SELECT v -> 'http' FROM out995 WHERE call = 'default'), '{"available": false}'::jsonb,
            'without pg_net: no response counts');
CREATE SCHEMA net;
CREATE TABLE net._http_response (
  id bigserial PRIMARY KEY, status_code integer, content_type text, headers jsonb, content text, timed_out boolean,
  error_msg text, created timestamptz NOT NULL DEFAULT now());
INSERT INTO net._http_response (status_code, content_type, headers, content, timed_out, error_msg, created)
SELECT s, 'application/json', '{"x-marker": "headermarker995"}'::jsonb, 'bodymarker995', false, NULL, now() - interval '1 hour'
  FROM unnest(ARRAY[200, 200, 200, 201, 302, 404, 500, 500]) s;
INSERT INTO net._http_response (status_code, headers, content, timed_out, error_msg, created) VALUES
  (NULL, NULL, NULL, true, 'Timeout of 5000 ms reached errmarker995 https://hook995.example.test', now() - interval '2 hours'),
  (500, '{"x-marker": "headermarker995"}', 'bodymarker995', false, NULL, now() - interval '30 hours');
SELECT pg_temp.read995('net', '');
SELECT t.eq((SELECT (v -> 'http') - 'oldest_at' FROM out995 WHERE call = 'net'),
            '{"available": true, "window_hours": 24, "total": 9, "s2xx": 4, "s3xx": 1, "s4xx": 1, "s5xx": 2, "no_response": 1, "other": 0}'::jsonb,
            'pg_net responses of the last 24 hours, by status class');
SELECT t.eq((SELECT v -> 'http' -> 'oldest_at' FROM out995 WHERE call = 'net'), to_jsonb(now() - interval '2 hours'),
            'the oldest response counted');
SELECT t.eq((SELECT count(*)::int FROM out995 o WHERE o.v::text ~* '(headermarker995|bodymarker995|errmarker995|hook995|application/json)'),
            0, 'no response header, body, error or URL');

-- ================= 10. not available =================
ALTER TABLE cron.job_run_details RENAME COLUMN status TO status_moved;
SELECT pg_temp.read995('shape', '');
SELECT t.eq((SELECT v FROM out995 WHERE call = 'shape'), '{"available": false, "reason": "unreadable", "jobs": []}'::jsonb,
            'a run table it cannot read: not available, no jobs');
ALTER TABLE cron.job_run_details RENAME COLUMN status_moved TO status;
ALTER TABLE cron.job_run_details RENAME TO job_run_details_moved;
SELECT pg_temp.read995('norun', '');
SELECT t.eq((SELECT v FROM out995 WHERE call = 'norun'), '{"available": false, "reason": "not_installed", "jobs": []}'::jsonb,
            'no run table: not available, no jobs');
ALTER TABLE cron.job_run_details_moved RENAME TO job_run_details;
ALTER SCHEMA cron RENAME TO cron_hidden995;
SELECT pg_temp.read995('hidden', '');
SELECT t.eq((SELECT v FROM out995 WHERE call = 'hidden'), '{"available": false, "reason": "not_installed", "jobs": []}'::jsonb,
            'no cron schema: not available, no jobs');
ALTER SCHEMA cron_hidden995 RENAME TO cron;
SELECT pg_temp.read995('back', '');
SELECT t.eq((SELECT jsonb_array_length(v -> 'jobs') FROM out995 WHERE call = 'back'), 8, 'available again once it is back');

ROLLBACK;
