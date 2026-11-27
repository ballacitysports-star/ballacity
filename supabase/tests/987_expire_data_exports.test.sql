-- 20261205110000_expire_data_exports: a data export expires 24 hours after it is ready, and then its file is deleted.
-- expire_stale_data_exports flips to 'expired' only exports whose window has ended (expires_at strictly in the past, or
-- ready_at strictly more than 24 hours ago), never a fresh one, one exactly at the boundary, a failed one or one with no
-- window. data_export_files_due lists, oldest first and at most a batch, the expired (or failed) exports whose window has
-- ended and that still point at their own file '<user_id>/<id>.json': never a ready export (lapsed or not), never a fresh
-- one marked expired, never a pointer at another export's file. clear_data_export_files clears only those pointers and
-- keeps every row. Only the service role runs the three; visitors and members cannot, and nobody but the owner runs the
-- window rule or the scheduler. The daily job 'expire-data-exports' (04:27 UTC, through private_sec.worker_post) is
-- scheduled only where pg_cron and pg_net are installed, is one job, and is replaced (not duplicated) when scheduled again.
-- This database has neither, so the test builds stand-ins shaped like them, inside the transaction.
BEGIN;
SELECT t.person('member', 30), t.person('otherone', 30), t.person('thirdone', 30), t.person('fourthone', 30);

-- ================= 1. the shape and the grants =================
SELECT t.ok((SELECT p.prosecdef AND 'search_path=""' = ANY (p.proconfig) AND 'lock_timeout=5s' = ANY (p.proconfig)
                    AND p.prorettype = 'integer'::regtype
               FROM pg_proc p WHERE p.oid = 'public.expire_stale_data_exports()'::regprocedure),
            'expire_stale_data_exports is SECURITY DEFINER with an empty search_path and a 5s lock_timeout, returns integer');
SELECT t.ok((SELECT p.prosecdef AND 'search_path=""' = ANY (p.proconfig) AND p.proretset AND p.provolatile = 's'
               FROM pg_proc p WHERE p.oid = 'public.data_export_files_due(integer)'::regprocedure),
            'data_export_files_due is a STABLE SECURITY DEFINER set-returning function with an empty search_path');
SELECT t.eq(pg_get_function_arguments('public.data_export_files_due(integer)'::regprocedure), '_limit integer DEFAULT 100',
            'it lists 100 by default');
SELECT t.ok((SELECT p.prosecdef AND 'search_path=""' = ANY (p.proconfig) AND 'lock_timeout=5s' = ANY (p.proconfig)
               FROM pg_proc p WHERE p.oid = 'public.clear_data_export_files(uuid[])'::regprocedure),
            'clear_data_export_files is SECURITY DEFINER with an empty search_path and a 5s lock_timeout');
SELECT t.ok((SELECT NOT p.prosecdef AND 'search_path=""' = ANY (p.proconfig)
               FROM pg_proc p WHERE p.oid = 'private_sec.schedule_data_export_expiry()'::regprocedure),
            'the scheduler is not SECURITY DEFINER and has an empty search_path');
SELECT t.eq((SELECT string_agg(p.oid::regprocedure::text || '=' || coalesce(r.rolname, 'PUBLIC') || ':' || x.privilege_type, ', '
                               ORDER BY p.oid::regprocedure::text, coalesce(r.rolname, 'PUBLIC'))
               FROM pg_proc p
              CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
               LEFT JOIN pg_roles r ON r.oid = x.grantee
              WHERE p.oid IN ('public.expire_stale_data_exports()'::regprocedure,
                              'public.data_export_files_due(integer)'::regprocedure,
                              'public.clear_data_export_files(uuid[])'::regprocedure,
                              'private_sec.data_export_lapsed(timestamptz,timestamptz)'::regprocedure,
                              'private_sec.schedule_data_export_expiry()'::regprocedure)
                AND x.grantee <> p.proowner),
            'clear_data_export_files(uuid[])=service_role:EXECUTE, data_export_files_due(integer)=service_role:EXECUTE, '
            'expire_stale_data_exports()=service_role:EXECUTE',
            'the three public functions are granted to the service role only (not PUBLIC, anon or authenticated); the window '
            'rule and the scheduler to nobody but their owner');
SELECT t.ok(NOT has_function_privilege('anon', 'public.expire_stale_data_exports()', 'EXECUTE')
            AND NOT has_function_privilege('authenticated', 'public.expire_stale_data_exports()', 'EXECUTE')
            AND NOT has_function_privilege('anon', 'public.data_export_files_due(integer)', 'EXECUTE')
            AND NOT has_function_privilege('authenticated', 'public.data_export_files_due(integer)', 'EXECUTE')
            AND NOT has_function_privilege('anon', 'public.clear_data_export_files(uuid[])', 'EXECUTE')
            AND NOT has_function_privilege('authenticated', 'public.clear_data_export_files(uuid[])', 'EXECUTE')
            AND has_function_privilege('service_role', 'public.expire_stale_data_exports()', 'EXECUTE')
            AND has_function_privilege('service_role', 'public.data_export_files_due(integer)', 'EXECUTE')
            AND has_function_privilege('service_role', 'public.clear_data_export_files(uuid[])', 'EXECUTE'),
            'visitors and members have no EXECUTE on any of them (not through PUBLIC either); the service role has');

-- ================= 2. exports in every state =================
-- now() is the transaction's start, the same inside the functions, so "exactly 24 hours" is exact. requested_at is set so
-- that no member has more than 3 requests in the last 24 hours (the rate-limit trigger).
CREATE TEMP TABLE tags987 (tag text PRIMARY KEY, id uuid NOT NULL, who text NOT NULL, path text);
GRANT SELECT ON tags987 TO PUBLIC;
CREATE FUNCTION pg_temp.row987(_tag text, _who text, _status text, _ready interval, _expires interval, _requested interval,
                               _path text DEFAULT 'own') RETURNS void LANGUAGE plpgsql AS $f$
DECLARE
  _id uuid := t.id('export-' || _tag);
  _p text := CASE WHEN _path = 'own' THEN t.id(_who)::text || '/' || _id::text || '.json' ELSE _path END;
BEGIN
  INSERT INTO public.data_export_requests (id, user_id, status, categories, storage_path, file_bytes, requested_at,
                                           ready_at, expires_at)
  VALUES (_id, t.id(_who), _status, '{profile}', _p, CASE WHEN _p IS NOT NULL THEN 1234 END, now() - _requested,
          now() - _ready, now() + _expires);
  INSERT INTO tags987 VALUES (_tag, _id, _who, _p);
END $f$;
SELECT pg_temp.row987('fresh',        'member',    'ready',      '1 hour',               '23 hours',   '1 hour 1 minute');
SELECT pg_temp.row987('soon',         'otherone',  'ready',      '23 hours 30 minutes',  '30 minutes', '23 hours 31 minutes');
SELECT pg_temp.row987('exactly',      'thirdone',  'ready',      '24 hours',             '0 seconds',  '24 hours 1 minute');
SELECT pg_temp.row987('justover',     'member',    'ready',      '24 hours 1 second',    '-1 second',  '24 hours 2 minutes');
SELECT pg_temp.row987('lapsed',       'member',    'ready',      '25 hours',             '-1 hour',    '25 hours 1 minute');
SELECT pg_temp.row987('noexp',        'otherone',  'ready',      '25 hours 30 minutes',  NULL,         '25 hours 31 minutes');
SELECT pg_temp.row987('noexpfresh',   'otherone',  'ready',      '23 hours',             NULL,         '23 hours 1 minute');
SELECT pg_temp.row987('late',         'thirdone',  'ready',      '30 hours',             '48 hours',   '30 hours 1 minute');
SELECT pg_temp.row987('oldexpired',   'member',    'expired',    '3 days',               '-2 days',    '3 days 1 minute');
SELECT pg_temp.row987('cleared',      'member',    'expired',    '3 days',               '-2 days',    '3 days 1 minute', NULL);
SELECT pg_temp.row987('failedold',    'thirdone',  'failed',     '26 hours',             '-2 hours',   '26 hours 1 minute');
SELECT pg_temp.row987('failedfresh',  'fourthone', 'failed',     '1 hour',               '23 hours',   '1 hour 1 minute');
SELECT pg_temp.row987('processing',   'fourthone', 'processing', NULL,                   NULL,         '2 minutes', NULL);
SELECT pg_temp.row987('requested',    'fourthone', 'requested',  NULL,                   NULL,         '1 minute', NULL);
SELECT pg_temp.row987('stuck',        'thirdone',  'processing', NULL,                   NULL,         '3 days', NULL);
SELECT pg_temp.row987('wrongpath',    'thirdone',  'expired',    '3 days',               '-2 days',    '3 days 1 minute',
                      (SELECT path FROM tags987 WHERE tag = 'fresh'));
SELECT pg_temp.row987('expiredearly', 'member',    'expired',    '1 hour',               '23 hours',   '1 hour 2 minutes');

-- tag:status, then + while the row points at a file and - once it does not
CREATE FUNCTION pg_temp.state987() RETURNS text LANGUAGE sql AS $f$
  SELECT string_agg(g.tag || ':' || r.status || CASE WHEN r.storage_path IS NULL THEN '-' ELSE '+' END, ','
                    ORDER BY g.tag COLLATE "C")
    FROM tags987 g JOIN public.data_export_requests r ON r.id = g.id $f$;
-- the tags data_export_files_due returns, in its order; NULL when it returns nothing
CREATE FUNCTION pg_temp.due987(_limit integer DEFAULT 100) RETURNS text LANGUAGE sql AS $f$
  SELECT string_agg(g.tag, ',' ORDER BY d.n)
    FROM public.data_export_files_due(_limit) WITH ORDINALITY d(id, storage_path, n)
    JOIN tags987 g ON g.id = d.id $f$;
CREATE FUNCTION pg_temp.ids987(VARIADIC _tags text[]) RETURNS uuid[] LANGUAGE sql AS $f$
  SELECT array_agg(t.id('export-' || x)) FROM unnest(_tags) x $f$;

SELECT t.eq(pg_temp.state987(),
            'cleared:expired-,exactly:ready+,expiredearly:expired+,failedfresh:failed+,failedold:failed+,fresh:ready+,'
            'justover:ready+,lapsed:ready+,late:ready+,noexp:ready+,noexpfresh:ready+,oldexpired:expired+,'
            'processing:processing-,requested:requested-,soon:ready+,stuck:processing-,wrongpath:expired+',
            'setup: seventeen exports');

-- ================= 3. nobody but the service role runs them =================
SELECT t.as_anon();
SELECT t.throws($$SELECT public.expire_stale_data_exports()$$, 'permission denied', 'a visitor cannot expire exports');
SELECT t.throws($$SELECT * FROM public.data_export_files_due()$$, 'permission denied', 'nor list their files');
SELECT t.throws(format('SELECT public.clear_data_export_files(%L)', pg_temp.ids987('oldexpired')), 'permission denied',
                'nor clear a pointer');
SELECT t.reset();
SELECT t.as_user(t.id('member'));
SELECT t.throws($$SELECT public.expire_stale_data_exports()$$, 'permission denied', 'a member cannot expire exports');
SELECT t.throws($$SELECT * FROM public.data_export_files_due(1000)$$, 'permission denied', 'nor list the files');
SELECT t.throws(format('SELECT public.clear_data_export_files(%L)', pg_temp.ids987('fresh', 'oldexpired')),
                'permission denied', 'nor clear a pointer, not even their own');
SELECT t.throws($$SELECT private_sec.data_export_lapsed(now() - interval '2 days', NULL)$$, 'permission denied',
                'nor call the window rule');
SELECT t.throws($$SELECT private_sec.schedule_data_export_expiry()$$, 'permission denied', 'nor schedule the job');
SELECT t.reset();
SELECT t.as_service();
SELECT t.throws($$SELECT private_sec.schedule_data_export_expiry()$$, 'permission denied',
                'the service role cannot schedule the job either');
SELECT t.reset();
SELECT t.eq(pg_temp.state987(),
            'cleared:expired-,exactly:ready+,expiredearly:expired+,failedfresh:failed+,failedold:failed+,fresh:ready+,'
            'justover:ready+,lapsed:ready+,late:ready+,noexp:ready+,noexpfresh:ready+,oldexpired:expired+,'
            'processing:processing-,requested:requested-,soon:ready+,stuck:processing-,wrongpath:expired+',
            'the refused calls changed nothing');

-- ================= 4. a ready export is expired before its file is touched =================
SELECT t.eq(pg_temp.due987(), 'oldexpired,failedold',
            'before the expiry only exports already expired (or failed) with an ended window are listed: not a lapsed one '
            'still marked ready, not one marked expired early, not a pointer at another export''s file');
SELECT t.eq(public.clear_data_export_files(pg_temp.ids987('lapsed', 'justover', 'noexp', 'late')), 0,
            'a lapsed export still marked ready keeps its pointer');

-- ================= 5. only lapsed exports expire =================
SELECT t.as_service();
SELECT t.eq(public.expire_stale_data_exports(), 4, 'the service role expires the four ready exports whose window ended');
SELECT t.reset();
SELECT t.eq(pg_temp.state987(),
            'cleared:expired-,exactly:ready+,expiredearly:expired+,failedfresh:failed+,failedold:failed+,fresh:ready+,'
            'justover:expired+,lapsed:expired+,late:expired+,noexp:expired+,noexpfresh:ready+,oldexpired:expired+,'
            'processing:processing-,requested:requested-,soon:ready+,stuck:processing-,wrongpath:expired+',
            'expired: one second past its expiry, an hour past, 25 hours ready with no expiry, 30 hours ready with an '
            'expiry later than the promise; kept: fresh, 30 minutes left, exactly 24 hours, 23 hours ready with no expiry, '
            'failed, in progress; no file pointer changed');
SELECT t.eq((SELECT status FROM public.data_export_requests WHERE id = t.id('export-fresh')), 'ready',
            'a fresh export is untouched');
SELECT t.eq(public.expire_stale_data_exports(), 0, 'a second run expires nothing');

-- ================= 6. the files to delete =================
SELECT t.eq(pg_temp.due987(), 'oldexpired,late,failedold,noexp,lapsed,justover',
            'every expired or failed export with an ended window and its own file, oldest ready first');
SELECT t.ok((SELECT bool_and(d.storage_path = g.path AND g.path = t.id(g.who)::text || '/' || g.id::text || '.json')
               FROM public.data_export_files_due() d JOIN tags987 g ON g.id = d.id),
            'each is listed with its own file name, <user_id>/<id>.json');
SELECT t.ok(NOT EXISTS (SELECT 1 FROM public.data_export_files_due(1000) d
                         WHERE d.storage_path = (SELECT path FROM tags987 WHERE tag = 'fresh')),
            'the fresh export''s file is never listed, not even through another row''s pointer');
SELECT t.eq(pg_temp.due987(2), 'oldexpired,late', 'a batch of 2 lists the 2 oldest');
SELECT t.eq(pg_temp.due987(0), 'oldexpired', 'a batch of 0 is held to 1');
SELECT t.eq(pg_temp.due987(NULL), 'oldexpired,late,failedold,noexp,lapsed,justover', 'NULL means the default batch');
SELECT t.as_service();
SELECT t.eq((SELECT count(*)::int FROM public.data_export_files_due()), 6, 'the service role lists them');
SELECT t.reset();

-- ================= 7. clearing the pointers =================
SELECT t.eq(public.clear_data_export_files(pg_temp.ids987('oldexpired', 'late', 'fresh', 'soon', 'exactly', 'noexpfresh',
                                                          'expiredearly', 'failedfresh', 'wrongpath', 'cleared',
                                                          'processing')), 2,
            'of a mixed list only the two listed exports are cleared');
SELECT t.eq(pg_temp.due987(), 'failedold,noexp,lapsed,justover', 'the next batch is the rest');
SELECT t.as_service();
SELECT t.eq(public.clear_data_export_files((SELECT array_agg(id) FROM tags987)), 4,
            'the service role clears the rest, given every id');
SELECT t.eq((SELECT count(*)::int FROM public.data_export_files_due()), 0, 'nothing is left to delete');
SELECT t.eq(public.clear_data_export_files((SELECT array_agg(id) FROM tags987)), 0, 'clearing again changes nothing');
SELECT t.eq(public.clear_data_export_files(NULL), 0, 'no ids, nothing cleared');
SELECT t.throws(format('SELECT public.clear_data_export_files(%L)',
                       (SELECT array_agg(gen_random_uuid()) FROM generate_series(1, 1001))), 'INVALID_LIMIT',
                'more than 1000 ids at once is refused');
SELECT t.reset();
SELECT t.eq(pg_temp.state987(),
            'cleared:expired-,exactly:ready+,expiredearly:expired+,failedfresh:failed+,failedold:failed-,fresh:ready+,'
            'justover:expired-,lapsed:expired-,late:expired-,noexp:expired-,noexpfresh:ready+,oldexpired:expired-,'
            'processing:processing-,requested:requested-,soon:ready+,stuck:processing-,wrongpath:expired+',
            'only the six lapsed exports lost their pointer; statuses unchanged; the fresh, early, failed-fresh and '
            'wrong-pointer rows keep theirs');
SELECT t.eq((SELECT count(*)::int FROM public.data_export_requests WHERE id IN (SELECT id FROM tags987)), 17,
            'every row is kept');
SELECT t.eq((SELECT string_agg(g.tag || '=' || r.file_bytes, ',' ORDER BY g.tag COLLATE "C")
               FROM tags987 g JOIN public.data_export_requests r ON r.id = g.id
              WHERE g.tag IN ('oldexpired', 'late', 'justover')),
            'justover=1234,late=1234,oldexpired=1234', 'a cleared row keeps its size and times');
SELECT t.as_user(t.id('member'));
SELECT t.eq(t.count('SELECT 1 FROM public.data_export_requests'), 6, 'the member still sees their whole export history');
SELECT t.reset();

-- ================= 8. no pg_cron, no pg_net =================
SELECT t.ok(to_regnamespace('cron') IS NULL AND to_regnamespace('net') IS NULL, 'setup: this database has no pg_cron or pg_net');
SELECT t.eq(private_sec.schedule_data_export_expiry(), false, 'without pg_cron nothing is scheduled (and the migration applied)');

-- pg_net's http_post, recording each call
CREATE SCHEMA net;
CREATE TABLE net.calls987 (id bigserial PRIMARY KEY, url text, headers jsonb, body jsonb);
CREATE FUNCTION net.http_post(url text, body jsonb DEFAULT '{}'::jsonb, params jsonb DEFAULT '{}'::jsonb,
                              headers jsonb DEFAULT '{}'::jsonb, timeout_milliseconds integer DEFAULT 5000)
RETURNS bigint LANGUAGE sql AS $f$
  INSERT INTO net.calls987 (url, headers, body) VALUES ($1, $4, $2) RETURNING id $f$;
SELECT t.eq(private_sec.schedule_data_export_expiry(), false, 'pg_net without pg_cron: nothing is scheduled, and no error');
ALTER SCHEMA net RENAME TO net_hidden987;

-- cron.schedule(name, schedule, command) replaces a job of that name, as pg_cron's does; the unnamed two-argument form adds
-- a new job each time, as pg_cron's does.
CREATE SCHEMA cron;
CREATE TABLE cron.job (
  jobid bigserial PRIMARY KEY, schedule text NOT NULL, command text NOT NULL, nodename text NOT NULL DEFAULT 'localhost',
  nodeport integer NOT NULL DEFAULT 5432, database text NOT NULL DEFAULT current_database(),
  username text NOT NULL DEFAULT CURRENT_USER, active boolean NOT NULL DEFAULT true, jobname text,
  UNIQUE (username, jobname));
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
  (2, 'purge-cron-run-history', '57 3 * * *', 'SELECT private_sec.purge_cron_run_details()'),
  (3, 'send-game-reminders', '*/5 * * * *', 'SELECT private_sec.worker_post(''/api/public/reminders/run'')');
SELECT setval('cron.job_jobid_seq', 3);

SELECT t.eq(private_sec.schedule_data_export_expiry(), false, 'pg_cron without pg_net: nothing is scheduled');
SELECT t.eq((SELECT count(*)::int FROM cron.job), 3, 'and no job was added');
ALTER SCHEMA net_hidden987 RENAME TO net;

-- ================= 9. the schedule =================
SELECT t.eq(private_sec.schedule_data_export_expiry(), true, 'with pg_cron and pg_net the job is scheduled');
SELECT t.eq((SELECT jsonb_agg(jsonb_build_array(jobname, schedule, command)) FROM cron.job WHERE jobid > 3),
            '[["expire-data-exports", "27 4 * * *", "SELECT private_sec.worker_post(''/api/public/data-exports/expire'')"]]'::jsonb,
            'exactly one new job: expire-data-exports, daily at 04:27 UTC, posting to the data-export worker route');
UPDATE cron.job SET schedule = '0 0 * * *', command = 'SELECT 1' WHERE jobname = 'expire-data-exports';
SELECT t.eq(private_sec.schedule_data_export_expiry(), true, 'scheduling again works');
SELECT t.eq((SELECT jsonb_agg(jsonb_build_array(jobname, schedule, command)) FROM cron.job WHERE jobid > 3),
            '[["expire-data-exports", "27 4 * * *", "SELECT private_sec.worker_post(''/api/public/data-exports/expire'')"]]'::jsonb,
            'scheduling again replaces the job, it does not add one');
SELECT t.eq((SELECT count(*)::int FROM cron.job WHERE command ~ 'data-exports'), 1, 'one job in all calls the route');
SELECT t.eq((SELECT jsonb_agg(jsonb_build_array(jobid, jobname, schedule, command) ORDER BY jobid) FROM cron.job WHERE jobid <= 3),
            '[[1, "process-highlight-reels", "* * * * *", "SELECT 1"], [2, "purge-cron-run-history", "57 3 * * *", "SELECT private_sec.purge_cron_run_details()"], [3, "send-game-reminders", "*/5 * * * *", "SELECT private_sec.worker_post(''/api/public/reminders/run'')"]]'::jsonb,
            'the other jobs are untouched');

-- The job's command, run as pg_cron would, posts to the route with the worker secret.
UPDATE public.app_settings SET value = '{"url": "https://app.example"}' WHERE key = 'worker_base_url';
SELECT vault.create_secret('sekretninetwoseven', 'reels_worker_secret');
DO $run$
DECLARE _cmd text;
BEGIN
  SELECT command INTO _cmd FROM cron.job WHERE jobname = 'expire-data-exports';
  EXECUTE _cmd;
END
$run$;
SELECT t.eq((SELECT jsonb_agg(jsonb_build_array(url, headers ->> 'x-worker-secret')) FROM net.calls987),
            '[["https://app.example/api/public/data-exports/expire", "sekretninetwoseven"]]'::jsonb,
            'the job''s command posts once to /api/public/data-exports/expire with the worker secret');
SELECT t.eq(pg_temp.state987(),
            'cleared:expired-,exactly:ready+,expiredearly:expired+,failedfresh:failed+,failedold:failed-,fresh:ready+,'
            'justover:expired-,lapsed:expired-,late:expired-,noexp:expired-,noexpfresh:ready+,oldexpired:expired-,'
            'processing:processing-,requested:requested-,soon:ready+,stuck:processing-,wrongpath:expired+',
            'scheduling and running the job''s command change no export in the database (the route does the work)');

ROLLBACK;
