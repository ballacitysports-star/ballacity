-- WP 5.3 (20261127110000_funnel_daily_history): the funnel keeps its history. private_sec.funnel_daily holds adult daily totals
-- and nothing that identifies anyone; no API role reads it or runs the snapshot. Once a day is frozen (before the Monday of the
-- week holding today - 21 days) a deleted post or a leave does not change it; rerunning the snapshot changes nothing; a day
-- inside the window is recomputed; superadmin_funnel reads frozen days from here; an adult found later to be a minor is taken
-- out of the frozen weeks (not a test or staff account). The nightly job is scheduled only where pg_cron is installed.
BEGIN;
SELECT t.person('ana', 28), t.person('ben', 30), t.person('cal', 31), t.person('dee', 32), t.person('eli', 33),
       t.person('fay', 34), t.person('teen', 16);
-- Whatever the replay's own first snapshot wrote is not this test's.
DELETE FROM private_sec.funnel_daily;

SET LOCAL session_replication_role = replica;
INSERT INTO public.player_availabilities (id, user_id, sports, status, time_slots, timezone)
SELECT md5('post:' || h)::uuid, t.id(h), ARRAY['Basketball'], 'open', '[]'::jsonb, 'America/New_York'
  FROM unnest(ARRAY['ana', 'ben', 'cal', 'dee', 'eli', 'fay', 'teen']) h;
SET LOCAL session_replication_role = origin;

CREATE FUNCTION pg_temp.today() RETURNS date LANGUAGE sql AS $$ SELECT (now() AT TIME ZONE 'America/New_York')::date $$;
CREATE FUNCTION pg_temp.stored(_key text) RETURNS int LANGUAGE sql AS $$
  SELECT (metrics ->> _key)::int FROM private_sec.funnel_daily WHERE day = pg_temp.today() $$;
-- The week holding today as the report shows it, read as of `_now`.
CREATE FUNCTION pg_temp.week(_now timestamptz, _minors boolean DEFAULT false) RETURNS jsonb LANGUAGE sql AS $$
  SELECT w FROM jsonb_array_elements(private_sec.funnel_report(pg_temp.today(), pg_temp.today(), _now, _minors) -> 'weeks') w $$;
CREATE FUNCTION pg_temp.table_text() RETURNS text LANGUAGE sql AS $$
  SELECT string_agg(day || '=' || metrics::text || '@' || computed_at, ';' ORDER BY day) FROM private_sec.funnel_daily $$;

-- ---- shape: totals only, out of the API's reach ---------------------------------------------------------------------------------
SELECT t.eq((SELECT string_agg(attname || ':' || format_type(atttypid, atttypmod), ',' ORDER BY attnum) FROM pg_attribute
              WHERE attrelid = 'private_sec.funnel_daily'::regclass AND attnum > 0 AND NOT attisdropped),
  'day:date,metrics:jsonb,computed_at:timestamp with time zone', 'funnel_daily has a day, the counts and when: no identifier column');
SELECT t.ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'private_sec.funnel_daily'::regclass), 'RLS is on');
SELECT t.eq((SELECT count(*)::int FROM pg_policies WHERE schemaname = 'private_sec' AND tablename = 'funnel_daily'), 0, 'with no policies');
SELECT t.ok(NOT has_table_privilege('anon', 'private_sec.funnel_daily', 'SELECT')
        AND NOT has_table_privilege('authenticated', 'private_sec.funnel_daily', 'SELECT')
        AND NOT has_table_privilege('service_role', 'private_sec.funnel_daily', 'SELECT')
        AND NOT has_table_privilege('authenticated', 'private_sec.funnel_daily', 'INSERT'),
  'no API role reads or writes it');
SELECT t.throws($q$INSERT INTO private_sec.funnel_daily (day, metrics) VALUES ('2026-11-01', '{"poster": "1b4e28ba-2fa1-11d2-883f-0016d3cca427"}')$q$,
  'funnel_daily_counts_only', 'an identifier cannot be stored, not even by the server');
SELECT t.throws($q$INSERT INTO private_sec.funnel_daily (day, metrics) VALUES ('2026-11-01', '{"posters": {"ana": 1}}')$q$,
  'funnel_daily_counts_only', 'nor a breakdown');
SELECT t.throws($q$INSERT INTO private_sec.funnel_daily (day, metrics) VALUES ('2026-11-01', '{"posters": -1}')$q$,
  'funnel_daily_counts_only', 'only whole counts');
SELECT t.throws($q$INSERT INTO private_sec.funnel_daily (day, metrics) VALUES ('2026-11-01', '[1, 2]')$q$,
  'funnel_daily_counts_only', 'only an object of counts');

SELECT t.as_user(t.id('ana'));
SELECT t.throws('SELECT private_sec.snapshot_funnel_daily()', 'permission denied', 'a member cannot run the snapshot');
SELECT t.throws('SELECT private_sec.schedule_funnel_snapshot()', 'permission denied', 'nor schedule it');
SELECT t.reset();
SELECT t.as_anon();
SELECT t.throws('SELECT private_sec.snapshot_funnel_daily()', 'permission denied', 'nor can a visitor');
SELECT t.reset();
SELECT t.as_service();
SELECT t.throws('SELECT private_sec.snapshot_funnel_daily()', 'permission denied', 'nor server code: the scheduler runs it');
SELECT t.reset();

-- ---- a frozen day keeps what it saw -----------------------------------------------------------------------------------------------
-- As of 40 days from now, today is long frozen (the line is the Monday of the week holding today + 19 days).
SELECT t.ok(private_sec.funnel_frozen_before(now() + interval '40 days') > pg_temp.today(), 'setup: today is frozen 40 days on');
SELECT t.ok((private_sec.snapshot_funnel_daily(now() + interval '40 days') ->> 'written')::int >= 40,
  'the first snapshot writes every day from 2026-11-16 to the day before');
SELECT t.eq(pg_temp.stored('posters'), 6, 'today holds six adult posters (the teen is not stored)');
SELECT t.ok((SELECT bool_and(private_sec.funnel_metrics_are_counts(metrics)) AND bool_and(metrics::text !~* '[0-9a-f]{8}-[0-9a-f]{4}-')
               FROM private_sec.funnel_daily), 'the snapshot holds counts only, no identifiers');
SELECT t.ok((SELECT bool_and(NOT (metrics ? 'not_confirmed_adult')) FROM private_sec.funnel_daily), 'and no under-18 numbers');

DELETE FROM public.player_availabilities WHERE user_id = t.id('fay');
SELECT t.eq((SELECT (m.metrics ->> 'posters')::int FROM private_sec.funnel_day_metrics(pg_temp.today(), pg_temp.today(),
                                                                                      now() + interval '40 days', true) m), 5,
  'setup: fay deleted her post, so a live count now finds five');
SELECT t.eq(pg_temp.week(now() + interval '40 days') -> 'adults' -> 'posters', '6'::jsonb,
  'a post deleted after the snapshot is still counted: the report reads the frozen day');
SELECT t.eq(pg_temp.week(now() + interval '40 days') ->> 'source', 'history', 'and says the week came from the history');

CREATE TEMP TABLE before_rerun AS SELECT pg_temp.table_text() AS txt;
SELECT t.eq((private_sec.snapshot_funnel_daily(now() + interval '40 days') ->> 'written')::int,
            (SELECT count(*)::int FROM private_sec.funnel_daily WHERE day >= private_sec.funnel_frozen_before(now() + interval '40 days')),
  'rerunning the snapshot as of the same moment rewrites only the days after the line');
SELECT t.eq(pg_temp.table_text(), (SELECT txt FROM before_rerun), 'and leaves the table exactly as it was (idempotent)');
-- A gap in a later frozen week (nights the job missed) makes the next run recompute that week from its Monday; the complete
-- frozen week holding today is not rewritten.
DELETE FROM private_sec.funnel_daily WHERE day = pg_temp.today() + 7;
SELECT t.eq((private_sec.snapshot_funnel_daily(now() + interval '41 days') ->> 'from')::date,
            date_trunc('week', (pg_temp.today() + 7)::timestamp)::date,
  'setup: a later night recomputes the week with the gap, from its Monday');
SELECT t.ok(EXISTS (SELECT 1 FROM private_sec.funnel_daily WHERE day = pg_temp.today() + 7), 'and fills the gap');
SELECT t.eq(pg_temp.stored('posters'), 6, 'and still does not rewrite a complete frozen week');

-- ---- inside the window a day is recomputed -------------------------------------------------------------------------------------------
SELECT t.ok(private_sec.funnel_frozen_before(now() + interval '1 day') <= pg_temp.today(), 'setup: tomorrow, today is not frozen');
SELECT private_sec.snapshot_funnel_daily(now() + interval '1 day');
SELECT t.eq(pg_temp.stored('posters'), 5, 'an unfrozen day is recomputed from what exists now');
SELECT t.eq(pg_temp.week(now() + interval '1 day') ->> 'source', 'live', 'and the report computes that week live');

-- ---- the under-18 column is never stored, and only live -------------------------------------------------------------------------------
-- (the switch row is changed directly here, as the test superuser with the function's flag: 970 covers the switch itself)
SELECT set_config('app.funnel_minor_counts_rpc', 'on', true);
UPDATE public.app_settings SET value = '{"enabled": true}' WHERE key = 'funnel_minor_counts';
SELECT set_config('app.funnel_minor_counts_rpc', 'off', true);
SELECT private_sec.snapshot_funnel_daily(now() + interval '40 days');
SELECT t.ok((SELECT bool_and(NOT (metrics::text LIKE '%not_confirmed%')) FROM private_sec.funnel_daily),
  'with the switch on, the snapshot still stores adults only');
SELECT t.eq(pg_temp.week(now() + interval '40 days', true) -> 'not_confirmed_adult' -> 'posters', '"<5"'::jsonb,
  'the report computes the under-18 column live (the teen)');

-- ---- a day the job missed is written once, then frozen ---------------------------------------------------------------------------------
DELETE FROM private_sec.funnel_daily WHERE day = pg_temp.today();
SELECT private_sec.snapshot_funnel_daily(now() + interval '40 days');
SELECT t.eq(pg_temp.stored('posters'), 5, 'a frozen day with no row is filled from what exists then');

-- ---- a week is frozen whole, never part from one run and part from another ---------------------------------------------------------
-- Week M (two weeks after this one): five adults post on Monday and again on Thursday. A run on Wednesday writes Monday and
-- Tuesday; the Monday posts are then deleted and the job misses every night until week M is frozen. Each of the five is one
-- poster of week M, whether the week is read from the history or computed live.
DELETE FROM private_sec.funnel_daily;
CREATE TEMP TABLE wk AS SELECT (date_trunc('week', pg_temp.today()::timestamp) + interval '14 days')::date AS m;
CREATE FUNCTION pg_temp.at(_days int) RETURNS timestamptz LANGUAGE sql AS $$
  SELECT ((SELECT m FROM wk) + _days)::timestamp AT TIME ZONE 'UTC' + interval '8 hours 47 minutes' $$;
CREATE FUNCTION pg_temp.week_m(_now timestamptz) RETURNS jsonb LANGUAGE sql AS $$
  SELECT w FROM jsonb_array_elements(private_sec.funnel_report((SELECT m FROM wk), (SELECT m FROM wk) + 6, _now, false) -> 'weeks') w $$;
CREATE FUNCTION pg_temp.stored_m(_key text) RETURNS int LANGUAGE sql AS $$
  SELECT sum((metrics ->> _key)::int)::int FROM private_sec.funnel_daily, wk WHERE day >= wk.m AND day < wk.m + 7 $$;
SET LOCAL session_replication_role = replica;
INSERT INTO public.player_availabilities (id, user_id, sports, status, time_slots, timezone, created_at)
SELECT md5('wk:' || h || d)::uuid, t.id(h), ARRAY['Basketball'], 'open', '[]'::jsonb, 'America/New_York',
       (((SELECT m FROM wk) + d)::timestamp + interval '12 hours') AT TIME ZONE 'America/New_York'
  FROM unnest(ARRAY['ana', 'ben', 'cal', 'dee', 'eli']) h CROSS JOIN unnest(ARRAY[0, 3]) d;
SET LOCAL session_replication_role = origin;
SELECT private_sec.snapshot_funnel_daily(pg_temp.at(2));
SELECT t.eq((SELECT count(*)::int FROM private_sec.funnel_daily, wk WHERE day >= wk.m AND day < wk.m + 7), 2,
  'setup: the Wednesday run wrote Monday and Tuesday of week M');
SELECT t.eq(pg_temp.stored_m('posters'), 5, 'setup: five posters on Monday');
DELETE FROM public.player_availabilities WHERE id IN (SELECT md5('wk:' || h || '0')::uuid FROM unnest(ARRAY['ana', 'ben', 'cal', 'dee', 'eli']) h);
SELECT t.ok(private_sec.funnel_frozen_before(pg_temp.at(35)) > (SELECT m FROM wk) + 6, 'setup: five weeks on, week M is frozen');
SELECT t.eq(pg_temp.week_m(pg_temp.at(35)) -> 'adults' -> 'posters', '5'::jsonb,
  'the report computes a frozen week with missing days whole and live: five posters, not Monday''s five again on Thursday');
SELECT t.eq(pg_temp.week_m(pg_temp.at(35)) ->> 'source', 'live', 'and says so');
SELECT t.eq((private_sec.snapshot_funnel_daily(pg_temp.at(35)) ->> 'from')::date, (SELECT m FROM wk),
  'the next run starts at the Monday of the incomplete frozen week, not at its first missing day');
SELECT t.eq(pg_temp.stored_m('posters'), 5, 'and rewrites that week whole: each poster counted once');
SELECT t.eq((SELECT count(*)::int FROM private_sec.funnel_daily, wk WHERE day >= wk.m AND day < wk.m + 7), 7, 'all seven days written');
SELECT t.eq(pg_temp.week_m(pg_temp.at(35)) ->> 'source', 'history', 'from then on the week is read from the history');

-- ---- an adult found later to be a minor leaves the frozen weeks too ---------------------------------------------------------------
-- Week M is frozen with ana among its five adult posters. Her birthday is corrected: she is 16, and the cohort drops at once.
-- With the switch off, the report (superadmin_funnel is funnel_report as of now(); week M is frozen only as of pg_temp.at(35))
-- must not count her in the adults' column of that week, from the history or live.
-- (birthdays change as review_birthday_correction writes them, under openrun.birthday_review)
SELECT set_config('openrun.birthday_review', 'on', true);
CREATE TEMP TABLE before_lower AS SELECT pg_temp.table_text() AS txt;
UPDATE public.profiles SET display_name = 'Ana B' WHERE id = t.id('ana');
UPDATE public.profile_birthdays SET birthday = current_date - interval '16 years 6 months' WHERE user_id = t.id('teen');
SELECT t.eq(pg_temp.table_text(), (SELECT txt FROM before_lower),
  'setup: another profile change, or a minor''s birthday change, leaves the history alone');
UPDATE public.profile_birthdays SET birthday = current_date - interval '16 years 6 months' WHERE user_id = t.id('ana');
SELECT t.eq((SELECT age_cohort FROM public.profiles WHERE id = t.id('ana')), 'teen_16_17', 'setup: ana is now a minor');
SELECT t.eq(pg_temp.week_m(pg_temp.at(35)) -> 'adults' -> 'posters', '"<5"'::jsonb,
  'a frozen week no longer counts an adult later found to be a minor: four adult posters, masked');
SELECT t.eq(pg_temp.week_m(pg_temp.at(35)) ->> 'source', 'live', 'the week is computed live, without her');
SELECT t.eq(pg_temp.week_m(pg_temp.at(35)) ? 'not_confirmed_adult', false, 'and with the switch off no under-18 number is returned');
SELECT private_sec.snapshot_funnel_daily(pg_temp.at(35));
SELECT t.eq(pg_temp.stored_m('posters'), 4, 'the next night writes the week whole again, without her');
SELECT t.eq(pg_temp.week_m(pg_temp.at(35)) ->> 'source', 'history', 'and it is read from the history again');
-- Test and staff accounts were never counted: their age changing deletes nothing.
SELECT t.person('staffer', 50);
INSERT INTO public.user_roles (user_id, role) VALUES (t.id('staffer'), 'moderator');
DROP TABLE before_lower;
CREATE TEMP TABLE before_lower AS SELECT pg_temp.table_text() AS txt;
UPDATE public.profile_birthdays SET birthday = current_date - interval '16 years 6 months' WHERE user_id = t.id('staffer');
SELECT t.eq((SELECT age_cohort FROM public.profiles WHERE id = t.id('staffer')), 'teen_16_17', 'setup: a staff account''s age is lowered');
SELECT t.eq(pg_temp.table_text(), (SELECT txt FROM before_lower), 'and the history is left alone');
SELECT set_config('openrun.birthday_review', 'off', true);

-- ---- the schedule: only where pg_cron is installed -----------------------------------------------------------------------------------
SELECT t.ok(to_regprocedure('cron.schedule(text,text,text)') IS NULL, 'setup: this database has no pg_cron');
SELECT t.eq(private_sec.schedule_funnel_snapshot(), false, 'without pg_cron nothing is scheduled (and the migration applied)');
-- A stand-in for pg_cron's schedule(), with its upsert-by-name behaviour.
CREATE SCHEMA cron;
CREATE TABLE cron.job (jobname text PRIMARY KEY, schedule text, command text);
CREATE FUNCTION cron.schedule(text, text, text) RETURNS bigint LANGUAGE sql AS $f$
  INSERT INTO cron.job VALUES ($1, $2, $3) ON CONFLICT (jobname) DO UPDATE SET schedule = EXCLUDED.schedule, command = EXCLUDED.command
  RETURNING 1::bigint $f$;
SELECT t.eq(private_sec.schedule_funnel_snapshot(), true, 'with pg_cron the job is scheduled');
SELECT t.eq((SELECT schedule || ' ' || command FROM cron.job WHERE jobname = 'snapshot-funnel-daily'),
  '47 8 * * * SELECT private_sec.snapshot_funnel_daily()', 'nightly at 08:47 UTC, after the New York day has ended');
SELECT private_sec.schedule_funnel_snapshot();
SELECT t.eq((SELECT count(*)::int FROM cron.job), 1, 'scheduling again keeps one job');

ROLLBACK;
