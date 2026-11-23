-- WP 5.9 (20261129120000_diagnostics_purge): the 90-day promise for sign-in and delivery diagnostics is kept.
-- public.purge_diagnostics() deletes rows of auth_signin_events, location_denial_events and notification_delivery_log whose
-- created_at is more than 90 days old, and nothing younger: a row exactly 90 days old stays. Only the service role (and the
-- scheduler) runs it; no member, admin or visitor can, so nobody can erase diagnostics early. A run is capped per table and
-- says when it hit the cap; the next run takes the rest. A second run deletes nothing. The daily job is scheduled only where
-- pg_cron is installed.
BEGIN;
SELECT t.person('ana', 30), t.person('boss', 40);
INSERT INTO public.user_roles (user_id, role) VALUES (t.id('boss'), 'admin');

-- ================= 1. the shape =================
SELECT t.ok((SELECT p.prosecdef
               AND 'search_path=""' = ANY (p.proconfig)
               AND 'lock_timeout=5s' = ANY (p.proconfig)
               AND p.prorettype = 'jsonb'::regtype
               FROM pg_proc p WHERE p.oid = 'public.purge_diagnostics(interval,integer)'::regprocedure),
            'the purge is SECURITY DEFINER with an empty search_path and a 5s lock_timeout, and returns jsonb');
SELECT t.eq((SELECT pg_get_function_arguments('public.purge_diagnostics(interval,integer)'::regprocedure)),
            '_older_than interval DEFAULT ''90 days''::interval, _max_rows integer DEFAULT 100000',
            'the window defaults to 90 days');
SELECT t.ok(NOT has_function_privilege('anon', 'public.purge_diagnostics(interval,integer)', 'EXECUTE')
            AND NOT has_function_privilege('authenticated', 'public.purge_diagnostics(interval,integer)', 'EXECUTE')
            AND has_function_privilege('service_role', 'public.purge_diagnostics(interval,integer)', 'EXECUTE'),
            'only the service role may execute the purge');
SELECT t.ok(NOT has_function_privilege('anon', 'private_sec.schedule_diagnostics_purge()', 'EXECUTE')
            AND NOT has_function_privilege('authenticated', 'private_sec.schedule_diagnostics_purge()', 'EXECUTE')
            AND NOT has_function_privilege('service_role', 'private_sec.schedule_diagnostics_purge()', 'EXECUTE'),
            'no API role runs the scheduler helper');
SELECT t.eq((SELECT count(*)::int FROM pg_trigger
              WHERE tgrelid IN ('public.auth_signin_events'::regclass, 'public.location_denial_events'::regclass,
                                'public.notification_delivery_log'::regclass)
                AND NOT tgisinternal AND (tgtype & 8) <> 0), 0,
            'no trigger on the three tables fires on DELETE');
SELECT t.eq((SELECT count(*)::int FROM pg_constraint
              WHERE contype = 'f' AND confrelid IN ('public.auth_signin_events'::regclass, 'public.location_denial_events'::regclass,
                                                    'public.notification_delivery_log'::regclass)), 0,
            'no foreign key points at the three tables');

-- ================= 2. rows either side of the 90-day line =================
-- now() is the transaction's start, the same inside the purge, so "exactly 90 days" is exact.
DELETE FROM public.auth_signin_events;
DELETE FROM public.location_denial_events;
DELETE FROM public.notification_delivery_log;
CREATE TEMP TABLE ages (tag text PRIMARY KEY, at timestamptz NOT NULL, goes boolean NOT NULL) ON COMMIT DROP;
INSERT INTO ages VALUES
  ('ancient',  now() - interval '400 days',           true),
  ('justover', now() - interval '90 days 1 second',   true),
  ('exactly',  now() - interval '90 days',            false),
  ('justunder', now() - interval '89 days 23:59:59',  false),
  ('fresh',    now(),                                 false);
INSERT INTO public.auth_signin_events (id, created_at, event)
SELECT md5('signin:' || tag)::uuid, at, 'attempt' FROM ages;
INSERT INTO public.location_denial_events (id, created_at, reason)
SELECT md5('denial:' || tag)::uuid, at, 'denied' FROM ages;
INSERT INTO public.notification_delivery_log (id, created_at, user_id, channel, status)
SELECT md5('delivery:' || tag)::uuid, at, t.id('ana'), 'push', 'sent' FROM ages;
SELECT t.eq((SELECT count(*)::int FROM public.auth_signin_events WHERE created_at IS NOT DISTINCT FROM
              (SELECT at FROM ages WHERE tag = 'ancient')), 1, 'setup: the insert trigger keeps created_at as written');

CREATE FUNCTION pg_temp.left_in(_table text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE _got text;
BEGIN
  EXECUTE format($q$SELECT string_agg(a.tag, ',' ORDER BY a.at) FROM ages a
                     JOIN public.%I r ON r.id = md5(%L || a.tag)::uuid$q$,
                 _table, CASE _table WHEN 'auth_signin_events' THEN 'signin:'
                                     WHEN 'location_denial_events' THEN 'denial:' ELSE 'delivery:' END)
    INTO _got;
  RETURN _got;
END $$;
CREATE FUNCTION pg_temp.all_left() RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.left_in('auth_signin_events') || ' | ' || pg_temp.left_in('location_denial_events') || ' | '
         || pg_temp.left_in('notification_delivery_log') $$;
SELECT t.eq(pg_temp.all_left(),
            'ancient,justover,exactly,justunder,fresh | ancient,justover,exactly,justunder,fresh | ancient,justover,exactly,justunder,fresh',
            'setup: five rows per table');

-- ================= 3. nobody but the service role purges =================
SELECT t.as_user(t.id('ana'));
SELECT t.throws($$SELECT public.purge_diagnostics()$$, 'permission denied', 'a member cannot run the purge');
SELECT t.throws($$SELECT public.purge_diagnostics(interval '1 day')$$, 'permission denied', 'nor with a shorter window');
SELECT t.reset();
SELECT t.as_user(t.id('boss'));
SELECT t.throws($$SELECT public.purge_diagnostics()$$, 'permission denied', 'an admin cannot run the purge');
SELECT t.reset();
SELECT t.as_anon();
SELECT t.throws($$SELECT public.purge_diagnostics()$$, 'permission denied', 'a visitor cannot run the purge');
SELECT t.reset();
SELECT t.as_user(t.id('ana'));
SELECT t.throws($$SELECT private_sec.schedule_diagnostics_purge()$$, 'permission denied', 'a member cannot reschedule the job');
SELECT t.reset();
SELECT t.as_service();
SELECT t.throws($$SELECT private_sec.schedule_diagnostics_purge()$$, 'permission denied', 'nor can the service role');
SELECT t.reset();
SELECT t.eq(pg_temp.left_in('auth_signin_events'), 'ancient,justover,exactly,justunder,fresh', 'the refused calls deleted nothing');

-- ================= 4. the purge: only rows older than 90 days, in each table =================
SELECT t.as_service();
SELECT t.throws($$SELECT public.purge_diagnostics(NULL)$$, 'INVALID_WINDOW', 'a NULL window is refused');
SELECT t.throws($$SELECT public.purge_diagnostics(interval '23 hours')$$, 'INVALID_WINDOW', 'a window under a day is refused');
SELECT t.throws($$SELECT public.purge_diagnostics(interval '90 days', 0)$$, 'INVALID_LIMIT', 'a cap of 0 is refused');
SELECT t.throws($$SELECT public.purge_diagnostics(interval '90 days', NULL)$$, 'INVALID_LIMIT', 'a NULL cap is refused');
SELECT t.eq(public.purge_diagnostics(),
            '{"auth_signin_events": 2, "location_denial_events": 2, "notification_delivery_log": 2, "capped": false}'::jsonb,
            'the service role purges two rows per table');
SELECT t.reset();
SELECT t.eq(pg_temp.left_in('auth_signin_events'), 'exactly,justunder,fresh',
            'auth_signin_events: older than 90 days gone; exactly 90 days and younger kept');
SELECT t.eq(pg_temp.left_in('location_denial_events'), 'exactly,justunder,fresh',
            'location_denial_events: older than 90 days gone; exactly 90 days and younger kept');
SELECT t.eq(pg_temp.left_in('notification_delivery_log'), 'exactly,justunder,fresh',
            'notification_delivery_log: older than 90 days gone; exactly 90 days and younger kept');

-- ================= 5. idempotent =================
SELECT t.as_service();
SELECT t.eq(public.purge_diagnostics(),
            '{"auth_signin_events": 0, "location_denial_events": 0, "notification_delivery_log": 0, "capped": false}'::jsonb,
            'a second run deletes nothing');
SELECT t.reset();
SELECT t.eq(pg_temp.all_left(),
            'exactly,justunder,fresh | exactly,justunder,fresh | exactly,justunder,fresh', 'and leaves the same rows');

-- ================= 6. the cap: a backlog drains over several runs =================
INSERT INTO public.auth_signin_events (created_at, event)
SELECT now() - interval '120 days' - g * interval '1 hour', 'attempt' FROM generate_series(1, 5) g;
INSERT INTO public.notification_delivery_log (created_at, user_id, channel, status)
VALUES (now() - interval '100 days', t.id('ana'), 'inapp', 'skipped');
SELECT t.as_service();
SELECT t.eq(public.purge_diagnostics(interval '90 days', 2),
            '{"auth_signin_events": 2, "location_denial_events": 0, "notification_delivery_log": 1, "capped": true}'::jsonb,
            'a capped run deletes at most the cap per table and says it was capped');
SELECT t.eq(public.purge_diagnostics(interval '90 days', 2),
            '{"auth_signin_events": 2, "location_denial_events": 0, "notification_delivery_log": 0, "capped": true}'::jsonb,
            'the next run takes the next batch');
SELECT t.eq(public.purge_diagnostics(interval '90 days', 2),
            '{"auth_signin_events": 1, "location_denial_events": 0, "notification_delivery_log": 0, "capped": false}'::jsonb,
            'and the last one is not capped');
SELECT t.reset();
SELECT t.eq((SELECT count(*)::int FROM public.auth_signin_events WHERE created_at < now() - interval '90 days'), 0,
            'the backlog is gone');
SELECT t.eq(pg_temp.all_left(),
            'exactly,justunder,fresh | exactly,justunder,fresh | exactly,justunder,fresh', 'and the young rows are untouched');

-- ================= 7. the schedule: only where pg_cron is installed =================
SELECT t.ok(to_regprocedure('cron.schedule(text,text,text)') IS NULL, 'setup: this database has no pg_cron');
SELECT t.eq(private_sec.schedule_diagnostics_purge(), false, 'without pg_cron nothing is scheduled (and the migration applied)');
-- A stand-in for pg_cron's schedule(), with its upsert-by-name behaviour.
CREATE SCHEMA cron;
CREATE TABLE cron.job (jobname text PRIMARY KEY, schedule text, command text);
CREATE FUNCTION cron.schedule(text, text, text) RETURNS bigint LANGUAGE sql AS $f$
  INSERT INTO cron.job VALUES ($1, $2, $3) ON CONFLICT (jobname) DO UPDATE SET schedule = EXCLUDED.schedule, command = EXCLUDED.command
  RETURNING 1::bigint $f$;
SELECT t.eq(private_sec.schedule_diagnostics_purge(), true, 'with pg_cron the job is scheduled');
SELECT t.eq((SELECT schedule || ' ' || command FROM cron.job WHERE jobname = 'purge-diagnostics'),
            '37 3 * * * SELECT public.purge_diagnostics()', 'daily at 03:37 UTC, the default 90-day window');
SELECT t.eq(private_sec.schedule_diagnostics_purge(), true, 'scheduling again works');
SELECT t.eq((SELECT count(*)::int FROM cron.job), 1, 'scheduling again keeps one job');

ROLLBACK;
