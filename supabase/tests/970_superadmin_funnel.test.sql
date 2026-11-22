-- WP 5.2 (20261127100000_superadmin_funnel): only a superadmin reads the funnel, and it counts what the tables say, totals only.
-- Adults only: minors, unknown-age and review-pending accounts are not computed unless the under-18 switch is on, and only
-- superadmin_set_funnel_minor_counts turns it on (a superadmin, a reason, an audit row). Test and staff accounts never count; the
-- host's own roster row never counts; an approved request without a roster row is joined; a deleted post does not break the
-- invite counts; invites before the table went live, hidden games and test or staff hosts' games are out (in every step);
-- a window of +/-infinity is refused; 1-4 leave as "<5".
BEGIN;
SELECT t.person('host', 35), t.person('hoster', 41), t.person('ana', 28), t.person('ben', 30), t.person('cal', 31),
       t.person('dee', 32), t.person('eli', 33), t.person('fay', 34), t.person('gus', 36), t.person('hal', 37), t.person('ivy', 38),
       t.person('jon', 39), t.person('kim', 40), t.person('lee', 42), t.person('rev', 43), t.person('tester', 29),
       t.person('modone', 44), t.person('adminone', 45), t.person('superone', 46), t.person('teen', 16);
-- An account with no date of birth: age unknown.
INSERT INTO auth.users (id, email, email_confirmed_at, raw_user_meta_data)
VALUES (t.id('unk'), 'unk@example.test', now(), jsonb_build_object('display_name', 'Unk', 'account_type', 'player'));
INSERT INTO public.user_roles (user_id, role)
VALUES (t.id('modone'), 'moderator'), (t.id('adminone'), 'admin'), (t.id('superone'), 'superadmin');
UPDATE auth.users SET email = 'e2e-tester@lovable.test' WHERE id = t.id('tester');

SET LOCAL session_replication_role = replica;
UPDATE public.profiles SET age_review_required = true WHERE id = t.id('rev');
-- Games start now (the same New York day as the posts and invites); the report is read "as of" two days from now.
INSERT INTO public.hosted_games (id, host_id, sport, title, date, max_players, series_id, cancelled_at, hidden_at) VALUES
  ('gameone',   t.id('host'),   'basketball', 'One-off run',    now(), 20, NULL, NULL, NULL),
  ('gameseries', t.id('host'),  'basketball', 'Weekly run',     now(), 20, md5('series')::uuid, NULL, NULL),
  ('gamecancel', t.id('host'),  'basketball', 'Called off',     now(), 20, NULL, now(), NULL),
  ('gameempty', t.id('host'),   'basketball', 'Empty copy',     now(), 20, md5('series')::uuid, NULL, NULL),
  ('gamehidden', t.id('host'),  'basketball', 'Hidden run',     now(), 20, NULL, NULL, now()),
  ('gametest',  t.id('tester'), 'basketball', 'Test host run',  now(), 20, NULL, NULL, NULL),
  ('gameother', t.id('hoster'), 'basketball', 'Another run',    now(), 20, NULL, NULL, NULL);
-- Posts, created now. ana posts twice (one poster); gus's post is hidden; jon's is deleted below.
INSERT INTO public.player_availabilities (id, user_id, sports, status, time_slots, timezone, hidden_at)
SELECT md5('post:' || h || n)::uuid, t.id(h), ARRAY['Basketball'], 'open', '[]'::jsonb, 'America/New_York',
       CASE WHEN h = 'gus' THEN now() END
  FROM unnest(ARRAY['ana', 'ana', 'ben', 'cal', 'dee', 'eli', 'fay', 'gus', 'hal', 'ivy', 'jon',
                    'teen', 'unk', 'rev', 'tester', 'modone']) WITH ORDINALITY AS x(h, n);

-- Invitations (as game_invite_player writes them), each with its notification.
CREATE FUNCTION pg_temp.invite(_game text, _who text, _status text, _read boolean, _post boolean DEFAULT false,
                               _at timestamptz DEFAULT now()) RETURNS void LANGUAGE plpgsql AS $$
DECLARE _id uuid := md5('inv:' || _game || ':' || _who)::uuid;
BEGIN
  INSERT INTO public.game_invites (id, game_id, host_id, invitee_id, availability_id, status, created_at, responded_at)
  SELECT _id, _game, g.host_id, t.id(_who), CASE WHEN _post THEN md5('post:' || _who || '11')::uuid END, _status, _at,
         CASE WHEN _status IN ('accepted', 'declined') THEN _at END
    FROM public.hosted_games g WHERE g.id = _game;
  INSERT INTO public.notifications (user_id, type, title, link, read_at, created_at)
  VALUES (t.id(_who), 'game_invite', 'You''re invited', '/games/' || _game || '?invite=1&from=x&inv=' || _id || '&exp=1',
          CASE WHEN _read THEN _at END, _at);
END $$;
SELECT pg_temp.invite('gameone', 'ana', 'accepted', true), pg_temp.invite('gameone', 'ben', 'accepted', true),
       pg_temp.invite('gameone', 'cal', 'accepted', true), pg_temp.invite('gameone', 'dee', 'accepted', true),
       pg_temp.invite('gameone', 'eli', 'accepted', true), pg_temp.invite('gameone', 'fay', 'accepted', true),
       pg_temp.invite('gameone', 'hal', 'accepted', true), pg_temp.invite('gameone', 'lee', 'accepted', true),
       pg_temp.invite('gameone', 'ivy', 'declined', false),   -- answered from the game page: seen, notification unread
       pg_temp.invite('gameone', 'jon', 'pending', false, true),
       pg_temp.invite('gamecancel', 'kim', 'accepted', true),
       pg_temp.invite('gameseries', 'ben', 'pending', false),
       -- never in the adults' numbers
       pg_temp.invite('gameone', 'teen', 'accepted', true), pg_temp.invite('gameone', 'unk', 'pending', true),
       pg_temp.invite('gameone', 'rev', 'pending', true), pg_temp.invite('gameone', 'tester', 'pending', true),
       pg_temp.invite('gameone', 'modone', 'pending', true),
       pg_temp.invite('gamehidden', 'ana', 'accepted', true), pg_temp.invite('gametest', 'ben', 'accepted', true),
       -- before game_invites went live (2026-11-18 03:34 UTC)
       pg_temp.invite('gameother', 'cal', 'pending', true, false, timestamptz '2026-11-17 12:00+00');
-- Roster: six invitees, the host's own row (never counted), ivy's own join of another host's game, a player in the series game,
-- the teen. hal's request is approved but the browser has not written the roster row yet. lee left late: no row, a late leave.
INSERT INTO public.game_participants (game_id, user_id, attended)
VALUES ('gameone', t.id('ana'), true), ('gameone', t.id('ben'), true), ('gameone', t.id('cal'), true),
       ('gameone', t.id('dee'), true), ('gameone', t.id('eli'), true), ('gameone', t.id('fay'), false),
       ('gameone', t.id('host'), true), ('gameempty', t.id('host'), NULL), ('gameother', t.id('ivy'), NULL),
       ('gameseries', t.id('kim'), NULL), ('gameone', t.id('teen'), true);
INSERT INTO public.join_requests (game_id, player_id, host_id, status, idempotency_key)
VALUES ('gameone', t.id('hal'), t.id('host'), 'approved', 'invite:' || md5('inv:gameone:hal')),
       ('gamecancel', t.id('kim'), t.id('host'), 'approved', 'invite:' || md5('inv:gamecancel:kim'));
INSERT INTO public.late_cancellations (user_id, kind, ref_id, event_at, cutoff_min, minutes_before)
VALUES (t.id('lee'), 'game', 'gameone', now(), 120, 30);
SET LOCAL session_replication_role = origin;

-- The week holding today (America/New_York), read as of two days from now.
CREATE FUNCTION pg_temp.week(_minors boolean DEFAULT false, _now timestamptz DEFAULT now() + interval '2 days')
RETURNS jsonb LANGUAGE sql AS $$
  SELECT w FROM jsonb_array_elements(
           private_sec.funnel_report((now() AT TIME ZONE 'America/New_York')::date, NULL, _now, _minors) -> 'weeks') w
   WHERE (w ->> 'week_start')::date = date_trunc('week', (now() AT TIME ZONE 'America/New_York')::date::timestamp)::date
$$;
CREATE FUNCTION pg_temp.adults(_key text) RETURNS jsonb LANGUAGE sql AS $$ SELECT pg_temp.week() -> 'adults' -> _key $$;

-- ---- shape and access ------------------------------------------------------------------------------------------------------------
SELECT t.ok((SELECT p.prosecdef AND p.provolatile = 's' AND p.proconfig = ARRAY['search_path=""']
               FROM pg_proc p WHERE p.oid = 'public.superadmin_funnel(date,date)'::regprocedure),
  'superadmin_funnel is SECURITY DEFINER, STABLE (it cannot write) and has search_path ''''');
SELECT t.ok((SELECT bool_and(p.provolatile IN ('s', 'i')) FROM pg_proc p
               WHERE p.oid IN ('private_sec.funnel_report(date,date,timestamptz,boolean)'::regprocedure,
                               'private_sec.funnel_day_metrics(date,date,timestamptz,boolean)'::regprocedure)),
  'and so is everything it calls');
SELECT t.eq(has_function_privilege('anon', 'public.superadmin_funnel(date,date)', 'EXECUTE'), false, 'visitors cannot call it');
SELECT t.eq(has_function_privilege('authenticated', 'public.superadmin_funnel(date,date)', 'EXECUTE'), true,
  'signed-in callers can, and the function decides');
SELECT t.eq(has_function_privilege('anon', 'public.superadmin_set_funnel_minor_counts(boolean,text)', 'EXECUTE'), false,
  'visitors cannot call the switch');
SELECT t.ok(NOT has_function_privilege('authenticated', 'private_sec.funnel_report(date,date,timestamptz,boolean)', 'EXECUTE')
        AND NOT has_function_privilege('service_role', 'private_sec.funnel_report(date,date,timestamptz,boolean)', 'EXECUTE')
        AND NOT has_function_privilege('authenticated', 'private_sec.funnel_day_metrics(date,date,timestamptz,boolean)', 'EXECUTE'),
  'the private helpers (which can return the under-18 numbers) are not callable by any API role');

SELECT t.as_anon();
SELECT t.throws('SELECT public.superadmin_funnel()', 'permission denied', 'a visitor is refused');
SELECT t.reset();
SELECT t.as_user(t.id('ana'));
SELECT t.throws('SELECT public.superadmin_funnel()', 'SUPERADMIN_ONLY', 'a member is refused');
SELECT t.reset();
SELECT t.as_user(t.id('modone'));
SELECT t.throws('SELECT public.superadmin_funnel()', 'SUPERADMIN_ONLY', 'a moderator is refused');
SELECT t.reset();
SELECT t.as_user(t.id('adminone'));
SELECT t.throws('SELECT public.superadmin_funnel()', 'SUPERADMIN_ONLY', 'an admin is refused');
SELECT t.reset();
SELECT t.as_service();
SELECT t.throws('SELECT public.superadmin_funnel()', 'SUPERADMIN_ONLY', 'server code with no signed-in superadmin is refused');
SELECT t.reset();
SELECT t.as_user(t.id('superone'));
SELECT t.lives('SELECT public.superadmin_funnel()', 'a superadmin reads it');
SELECT t.eq(jsonb_array_length(public.superadmin_funnel() -> 'weeks'), 8, 'eight weeks by default');
SELECT t.eq(public.superadmin_funnel() ->> 'timezone', 'America/New_York', 'weeks are New York weeks');
SELECT t.eq((SELECT count(*)::int FROM jsonb_array_elements(public.superadmin_funnel('2026-01-01', '2026-11-20') -> 'weeks')), 26,
  'at most 26 weeks');
SELECT t.throws($q$SELECT public.superadmin_funnel('2026-11-20', '2026-11-01')$q$, 'INVALID_WINDOW', 'a start after the end is refused');
SELECT t.eq((public.superadmin_funnel(NULL, (now() AT TIME ZONE 'America/New_York')::date + 30) ->> 'to')::date,
            (now() AT TIME ZONE 'America/New_York')::date, 'never past today');
SELECT t.reset();

-- ---- the steps (adults) ------------------------------------------------------------------------------------------------------------
SELECT t.eq(pg_temp.adults('posters'), '9'::jsonb,
  'posters: nine adults (two posts are one poster; hidden, minor, unknown-age, review-pending, test and staff posts are out)');
SELECT t.eq(pg_temp.adults('posters_invited'), '9'::jsonb, 'posters invited: matched on the person');
SELECT t.eq(pg_temp.adults('invites_sent'), '12'::jsonb,
  'invites sent: twelve (not to minors, unknown age, review pending, test or staff accounts; not in a hidden or test-hosted game)');
SELECT t.eq(pg_temp.adults('invites_seen'), '10'::jsonb, 'seen: notification read (link inv=<id>), or answered');
SELECT t.eq(pg_temp.adults('invites_answered'), '10'::jsonb, 'answered');
SELECT t.eq(pg_temp.adults('invites_accepted'), '9'::jsonb, 'accepted');
SELECT t.eq(pg_temp.adults('invites_joined'), '8'::jsonb,
  'joined: a roster row or an approved request (hal has no roster row yet; lee left)');
SELECT t.eq(pg_temp.adults('invites_game_started'), '7'::jsonb, 'game started and not cancelled');
SELECT t.eq(pg_temp.adults('invites_attendance_marked'), '6'::jsonb, 'attendance marked');
SELECT t.eq(pg_temp.adults('invites_showed_up'), '5'::jsonb, 'showed up');
SELECT t.eq(pg_temp.adults('marked_coverage_pct'), '86'::jsonb, '"marked" coverage: 6 of 7');
SELECT t.eq(pg_temp.adults('show_up_rate_pct'), '83'::jsonb, 'show-up rate: 5 of 6 marked');

-- ---- masking: 1 to 4 leave as "<5", 0 stays 0 -------------------------------------------------------------------------------------
SELECT t.eq(pg_temp.adults('invites_late_leaves'), '"<5"'::jsonb, 'one late leave shows as <5');
SELECT t.eq(pg_temp.adults('invites_game_cancelled'), '"<5"'::jsonb, 'one invitee whose game was cancelled shows as <5');
SELECT t.eq(pg_temp.adults('invites_to_series_games'), '"<5"'::jsonb, 'one invite to a series game shows as <5');
SELECT t.eq(pg_temp.adults('posters_self_joined'), '"<5"'::jsonb, 'one poster who joined a game on their own shows as <5');
SELECT t.eq(pg_temp.adults('games_held'), '"<5"'::jsonb, 'three games held show as <5');
SELECT t.eq((SELECT w -> 'adults' -> 'posters' FROM jsonb_array_elements(
               private_sec.funnel_report((now() AT TIME ZONE 'America/New_York')::date - 14, (now() AT TIME ZONE 'America/New_York')::date - 8,
                                         now() + interval '2 days', false) -> 'weeks') w LIMIT 1), '0'::jsonb,
  'a week with nobody shows 0, not <5');
SELECT t.eq(private_sec.funnel_mask(4), '"<5"'::jsonb, 'mask: 4 is <5');
SELECT t.eq(private_sec.funnel_mask(5), '5'::jsonb, 'mask: 5 is 5');
SELECT t.eq(private_sec.funnel_rate(4, 10), NULL::integer, 'a rate over a masked count is not returned');
SELECT t.eq(private_sec.funnel_rate(5, 4), NULL::integer, 'nor a rate over a masked total');
SELECT t.eq(private_sec.funnel_rate(0, 9), 0, 'none of nine is 0%');
-- the host's own roster row is not a player: the series copy with only the host on it is left out of the game totals
SELECT t.eq(pg_temp.adults('series_games_left_out'), '"<5"'::jsonb, 'the empty series copy is left out');
SELECT t.eq((SELECT count(*)::int FROM public.game_participants WHERE game_id = 'gameempty' AND user_id = t.id('host')), 1,
  'even though its host has a roster row');
SELECT t.eq((SELECT (m.metrics ->> 'series_games_left_out')::int + (m.metrics ->> 'games_held')::int * 10
                    + (m.metrics ->> 'games_held_series')::int * 100 + (m.metrics ->> 'games_cancelled')::int * 1000
               FROM private_sec.funnel_day_metrics((now() AT TIME ZONE 'America/New_York')::date,
                                                   (now() AT TIME ZONE 'America/New_York')::date, now() + interval '2 days', true) m),
            1131, 'raw game totals: 3 held (1 from a series), 1 cancelled, 1 empty series copy left out; hidden and test-hosted out');

-- ---- nothing that names anyone leaves --------------------------------------------------------------------------------------------
SELECT t.ok(NOT (private_sec.funnel_report(NULL, NULL, now() + interval '2 days', true)::text
                 ~* '[0-9a-f]{8}-[0-9a-f]{4}-|gameone|gamecancel|@|ana|host'),
  'no user id, invite id, game id, email or name in the report');

-- ---- a deleted post does not break the counts ---------------------------------------------------------------------------------------
DELETE FROM public.player_availabilities WHERE user_id = t.id('jon');
SELECT t.eq((SELECT availability_id FROM public.game_invites WHERE id = md5('inv:gameone:jon')::uuid), NULL::uuid,
  'deleting the post empties the invite''s availability_id');
SELECT t.eq(pg_temp.adults('invites_sent'), '12'::jsonb, 'the invite still counts');
SELECT t.eq(pg_temp.adults('posters'), '8'::jsonb, 'computed live, jon is no longer a poster (WP 5.3 keeps him in the history)');

-- ---- out of scope: before the invites went live; before the pilot start --------------------------------------------------------------
SELECT t.eq((SELECT sum((m.metrics ->> 'invites_sent')::int)::int
               FROM private_sec.funnel_day_metrics('2026-11-16', '2026-11-17', timestamptz '2026-11-25 12:00+00', true) m), 0,
  'an invite from before 2026-11-18 03:34 UTC is not counted');
UPDATE public.app_settings SET value = jsonb_build_object('date', ((now() AT TIME ZONE 'America/New_York')::date + 1)::text)
 WHERE key = 'funnel_pilot_start';
SELECT t.eq(COALESCE(pg_temp.adults('posters'), '0'::jsonb), '0'::jsonb,
  'days before the pilot start are left out (the week holding them is not reported: the first counted week starts after)');
SELECT t.eq((private_sec.funnel_report(NULL, NULL, now() + interval '2 days', false) ->> 'pilot_start')::date,
            (now() AT TIME ZONE 'America/New_York')::date + 1, 'and the report says from when it counts');
UPDATE public.app_settings SET value = '{"date": "not a date"}' WHERE key = 'funnel_pilot_start';
SELECT t.eq(pg_temp.adults('posters'), '8'::jsonb, 'a pilot start that is not a date is ignored');
UPDATE public.app_settings SET value = '{"date": null}' WHERE key = 'funnel_pilot_start';

-- ---- the under-18 column: off by default, not computed -------------------------------------------------------------------------------
SELECT t.eq(private_sec.funnel_minor_counts_enabled(), false, 'the switch is off');
SELECT t.as_user(t.id('superone'));
SELECT t.eq(public.superadmin_funnel() -> 'minors_column', 'false'::jsonb, 'the report says the column is off');
SELECT t.ok(NOT public.superadmin_funnel()::text LIKE '%not_confirmed_adult%', 'and has no under-18 numbers');
SELECT t.reset();
SET LOCAL track_functions = 'all';
CREATE FUNCTION pg_temp.metric_calls() RETURNS bigint LANGUAGE sql AS $$
  SELECT COALESCE(pg_stat_get_xact_function_calls('private_sec.funnel_day_metrics(date,date,timestamptz,boolean)'::regprocedure), 0)
$$;
CREATE TEMP TABLE calls AS SELECT pg_temp.metric_calls() AS before;
SELECT t.as_user(t.id('superone'));
SELECT public.superadmin_funnel();
SELECT t.reset();
SELECT t.eq((SELECT pg_temp.metric_calls() - before FROM calls)::int, 1,
  'off, the report computes one group only (the adults): the under-18 numbers are never computed');
SELECT t.eq(pg_temp.week(false) ? 'not_confirmed_adult', false, 'nor returned');

-- ---- only the recorded act turns it on ---------------------------------------------------------------------------------------------
SELECT t.throws($q$UPDATE public.app_settings SET value = '{"enabled": true}' WHERE key = 'funnel_minor_counts'$q$,
  'FUNNEL_MINOR_COUNTS_LOCKED', 'a direct write cannot turn it on, not even from the SQL editor');
SELECT t.as_service();
SELECT t.throws($q$UPDATE public.app_settings SET value = '{"enabled": true, "x": 1}' WHERE key = 'funnel_minor_counts'$q$,
  'FUNNEL_MINOR_COUNTS_LOCKED', 'nor from server code (the Ops raw editor)');
SELECT t.throws($q$INSERT INTO public.app_settings (key, value) VALUES ('funnel_minor_counts', '{"enabled": true}')
                  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value$q$,
  'FUNNEL_MINOR_COUNTS_LOCKED', 'nor an upsert');
SELECT t.reset();
SELECT t.as_user(t.id('superone'));
SELECT t.eq(t.changed($q$UPDATE public.app_settings SET value = '{"enabled": true}' WHERE key = 'funnel_minor_counts'$q$), 0,
  'a superadmin cannot write settings rows through the API');
SELECT t.reset();
SELECT t.as_user(t.id('ana'));
SELECT t.throws($q$SELECT public.superadmin_set_funnel_minor_counts(true, 'Counsel signed off on 2026-12-01, checklist B1')$q$,
  'SUPERADMIN_ONLY', 'a member cannot turn it on');
SELECT t.reset();
SELECT t.as_user(t.id('adminone'));
SELECT t.throws($q$SELECT public.superadmin_set_funnel_minor_counts(true, 'Counsel signed off on 2026-12-01, checklist B1')$q$,
  'SUPERADMIN_ONLY', 'nor an admin');
SELECT t.reset();
SELECT t.as_user(t.id('superone'));
SELECT t.throws($q$SELECT public.superadmin_set_funnel_minor_counts(true, 'ok')$q$, 'FUNNEL_MINOR_COUNTS_REASON_REQUIRED',
  'a superadmin must say why (naming the sign-off)');
SELECT t.reset();
SELECT t.eq(private_sec.funnel_minor_counts_enabled(), false, 'still off');
SELECT t.eq((SELECT count(*)::int FROM public.admin_audit_log WHERE target_id = 'funnel_minor_counts'), 0, 'nothing recorded yet');

SELECT t.as_user(t.id('superone'));
SELECT t.eq(public.superadmin_set_funnel_minor_counts(true, 'Counsel signed off on 2026-12-01, checklist B1'),
            '{"enabled": true}'::jsonb, 'a superadmin turns it on with a reason');
SELECT t.reset();
SELECT t.eq(private_sec.funnel_minor_counts_enabled(), true, 'it is on');
SELECT t.eq(current_setting('app.funnel_minor_counts_rpc', true), 'off', 'the write flag does not outlive the write');
SELECT t.ok((SELECT a.actor_id = t.id('superone') AND a.action = 'feature_flag.update' AND a.target_type = 'app_setting'
                    AND a.reason = 'Counsel signed off on 2026-12-01, checklist B1'
                    AND a.before = '{"enabled": false}'::jsonb AND a.after -> 'enabled' = 'true'::jsonb
               FROM public.admin_audit_log a WHERE a.target_id = 'funnel_minor_counts'),
  'the audit log records who, why, before and after');
SELECT t.eq((SELECT is_public FROM public.app_settings WHERE key = 'funnel_minor_counts'), false, 'the row stays private');

-- ---- on: one combined column for accounts that are not confirmed adults ----------------------------------------------------------------
SELECT t.as_user(t.id('superone'));
SELECT t.eq(public.superadmin_funnel() -> 'minors_column', 'true'::jsonb, 'the report says the column is on');
SELECT t.reset();
SELECT t.eq(pg_temp.week(true) -> 'not_confirmed_adult' -> 'posters', '"<5"'::jsonb,
  'posters: the teen, the unknown-age and the review-pending account (3), masked');
SELECT t.eq(pg_temp.week(true) -> 'not_confirmed_adult' -> 'invites_sent', '"<5"'::jsonb, 'their invites, masked');
SELECT t.eq(pg_temp.week(true) -> 'adults', pg_temp.week(false) -> 'adults', 'the adults'' numbers do not change');
SELECT t.eq((SELECT (m.metrics ->> 'posters')::int * 10 + (m.metrics ->> 'invites_sent')::int
               FROM private_sec.funnel_day_metrics((now() AT TIME ZONE 'America/New_York')::date,
                                                   (now() AT TIME ZONE 'America/New_York')::date, now() + interval '2 days', false) m),
            33, 'raw: 3 posters and 3 invites (teen, unknown age, review pending); test and staff accounts are in neither group');

-- ---- off again: recorded, and allowed from anywhere --------------------------------------------------------------------------------
SELECT t.as_user(t.id('superone'));
SELECT t.eq(public.superadmin_set_funnel_minor_counts(false, 'Pause until the next review'), '{"enabled": false}'::jsonb,
  'a superadmin turns it off with a reason');
SELECT t.reset();
SELECT t.eq((SELECT count(*)::int FROM public.admin_audit_log WHERE target_id = 'funnel_minor_counts'), 2, 'both changes recorded');
SELECT t.eq(pg_temp.week(false) ? 'not_confirmed_adult', false, 'and the column is gone');
SELECT t.lives($q$UPDATE public.app_settings SET value = '{"enabled": false}', is_public = true WHERE key = 'funnel_minor_counts'$q$,
  'turning it off directly is allowed (off is the safe side)');
SELECT t.eq((SELECT is_public FROM public.app_settings WHERE key = 'funnel_minor_counts'), false, 'but the row never becomes public');
SELECT t.lives($q$UPDATE public.app_settings SET value = '{"enabled": "true"}' WHERE key = 'funnel_minor_counts'$q$,
  'a value the reader does not take for "on" passes the guard');
SELECT t.eq(private_sec.funnel_minor_counts_enabled(), false, 'and is off');

-- ---- whole weeks only: two answers never differ by a single day -----------------------------------------------------------------
-- Five adults post on Monday 2026-11-02, one on Wednesday 2026-11-04 (New York). If a window could end mid-week, the answers for
-- windows ending Tuesday and Wednesday would differ by exactly Wednesday's count, a 1 the masking exists to hide.
SET LOCAL session_replication_role = replica;
INSERT INTO public.player_availabilities (id, user_id, sports, status, time_slots, timezone, created_at)
SELECT md5('wk:' || h)::uuid, t.id(h), ARRAY['Basketball'], 'open', '[]'::jsonb, 'America/New_York',
       CASE WHEN h = 'fay' THEN timestamptz '2026-11-04 12:00-05' ELSE timestamptz '2026-11-02 12:00-05' END
  FROM unnest(ARRAY['ana', 'ben', 'cal', 'dee', 'eli', 'fay']) h;
SET LOCAL session_replication_role = origin;
CREATE FUNCTION pg_temp.report(_from date, _to date) RETURNS jsonb LANGUAGE sql AS $$
  SELECT private_sec.funnel_report(_from, _to, timestamptz '2026-12-03 12:00+00', false) $$;
SELECT t.eq(pg_temp.report('2026-11-02', '2026-11-03') -> 'weeks', pg_temp.report('2026-11-02', '2026-11-04') -> 'weeks',
  'two windows ending on different days of the same past week return the same weeks');
SELECT t.eq(pg_temp.report('2026-11-02', '2026-11-02') -> 'weeks', pg_temp.report('2026-11-02', '2026-11-08') -> 'weeks',
  'whichever day of the week the window ends on');
SELECT t.eq(pg_temp.report('2026-11-02', '2026-11-03') -> 'weeks' -> 0 -> 'adults' -> 'posters', '6'::jsonb,
  'the last week is counted whole: all six posters');
SELECT t.eq(pg_temp.report('2026-11-02', '2026-11-03') -> 'weeks' -> 0 ->> 'last_day', '2026-11-08', 'a past week ends on its Sunday');
SELECT t.eq(pg_temp.report('2026-11-02', '2026-11-03') ->> 'to', '2026-11-08', 'and so does the window');
SELECT t.eq(pg_temp.report('2026-11-30', NULL) ->> 'to', '2026-12-03', 'only the current week stops at today');
SELECT t.as_user(t.id('superone'));
SELECT t.eq(public.superadmin_funnel('2026-11-02', '2026-11-03') -> 'weeks', public.superadmin_funnel('2026-11-02', '2026-11-04') -> 'weeks',
  'the same through superadmin_funnel');
SELECT t.reset();
-- A pilot start that is not a Monday: the first counted week is the next whole one, whichever day of the week it names.
UPDATE public.app_settings SET value = '{"date": "2026-11-04"}' WHERE key = 'funnel_pilot_start';
CREATE TEMP TABLE wed_start AS SELECT pg_temp.report('2026-11-02', '2026-11-15') AS r;
UPDATE public.app_settings SET value = '{"date": "2026-11-05"}' WHERE key = 'funnel_pilot_start';
SELECT t.eq((SELECT r -> 'weeks' FROM wed_start), pg_temp.report('2026-11-02', '2026-11-15') -> 'weeks',
  'a pilot start on Wednesday or Thursday gives the same weeks (no day can be subtracted at the start of a week)');
SELECT t.eq((SELECT r -> 'weeks' -> 0 ->> 'week_start' FROM wed_start), '2026-11-09',
  'a mid-week pilot start counts from the next Monday: no day before it is counted');
SELECT t.eq((SELECT r ->> 'pilot_start' FROM wed_start), '2026-11-04', 'and the report still says what was set');
UPDATE public.app_settings SET value = '{"date": "2026-11-09"}' WHERE key = 'funnel_pilot_start';
SELECT t.eq(pg_temp.report('2026-11-02', '2026-11-15') -> 'weeks' -> 0 ->> 'week_start', '2026-11-09', 'a Monday start is its own week');
UPDATE public.app_settings SET value = '{"date": null}' WHERE key = 'funnel_pilot_start';

-- ---- a minor's actions never move an adult number --------------------------------------------------------------------------------
-- 2026-11-19: an adult's series copy whose only player is the teen; a game the teen hosts (allowed under a team since
-- 20261121100000), with an accepted invitation to an adult.
SELECT t.person('aaa', 27), t.person('bbb', 26), t.person('ccc', 25);
SET LOCAL session_replication_role = replica;
INSERT INTO public.hosted_games (id, host_id, sport, title, date, max_players, series_id) VALUES
  ('gameseriesteen', t.id('hoster'), 'basketball', 'Series copy',  timestamptz '2026-11-19 20:00+00', 20, md5('series2')::uuid),
  ('gameteenhost',   t.id('teen'),   'basketball', 'Teen run',     timestamptz '2026-11-19 22:00+00', 20, NULL),
  ('gamereinvite',   t.id('hoster'), 'basketball', 'Re-invite',    timestamptz '2026-11-20 23:00+00', 20, NULL),
  ('gamereqonly',    t.id('hoster'), 'basketball', 'Series, request only', timestamptz '2026-11-18 20:00+00', 20, md5('series3')::uuid);
INSERT INTO public.game_participants (game_id, user_id) VALUES ('gameseriesteen', t.id('teen'));
SELECT pg_temp.invite('gameteenhost', 'gus', 'accepted', true, false, timestamptz '2026-11-19 15:00+00');
INSERT INTO public.join_requests (game_id, player_id, host_id, status, idempotency_key)
VALUES ('gameteenhost', t.id('gus'), t.id('teen'), 'approved', 'invite:' || md5('inv:gameteenhost:gus'));
SET LOCAL session_replication_role = origin;
CREATE FUNCTION pg_temp.day(_d date, _adults boolean DEFAULT true) RETURNS jsonb LANGUAGE sql AS $$
  SELECT m.metrics FROM private_sec.funnel_day_metrics(_d, _d, timestamptz '2026-12-03 12:00+00', _adults) m $$;
CREATE TEMP TABLE with_minor AS SELECT pg_temp.day('2026-11-19') AS m;
DELETE FROM public.game_participants WHERE game_id = 'gameseriesteen';
DELETE FROM public.join_requests WHERE game_id = 'gameteenhost';
DELETE FROM public.game_invites WHERE game_id = 'gameteenhost';
SELECT t.eq((SELECT m FROM with_minor), pg_temp.day('2026-11-19'),
  'adding or removing a minor''s roster row, or a minor''s invitation, changes no adult number');
SELECT t.eq((SELECT (m ->> 'series_games_left_out')::int * 10 + (m ->> 'games_held')::int FROM with_minor), 10,
  'a series copy whose only player is a minor is left out of the adults'' games');
SELECT t.eq((SELECT (m ->> 'invites_sent')::int FROM with_minor), 0, 'and an invitation a minor sent is not an adult invite');

-- ---- one invitation per player and game is credited with what followed -------------------------------------------------------------
-- 2026-11-20: aaa's first invitation was cancelled and a second accepted (one place, attended); ccc declined and then joined on
-- their own. 2026-11-18: a series game whose only player accepted an invitation (approved request, no roster row yet).
SET LOCAL session_replication_role = replica;
INSERT INTO public.game_invites (id, game_id, host_id, invitee_id, status, created_at, responded_at) VALUES
  (md5('x1')::uuid, 'gamereinvite', t.id('hoster'), t.id('aaa'), 'cancelled', timestamptz '2026-11-20 14:00+00', NULL),
  (md5('x2')::uuid, 'gamereinvite', t.id('hoster'), t.id('aaa'), 'accepted',  timestamptz '2026-11-20 15:00+00', timestamptz '2026-11-20 15:05+00'),
  (md5('x3')::uuid, 'gamereinvite', t.id('hoster'), t.id('ccc'), 'declined',  timestamptz '2026-11-20 15:00+00', timestamptz '2026-11-20 15:10+00'),
  (md5('x4')::uuid, 'gamereqonly',  t.id('hoster'), t.id('bbb'), 'accepted',  timestamptz '2026-11-18 10:00+00', timestamptz '2026-11-18 10:05+00');
INSERT INTO public.join_requests (game_id, player_id, host_id, status, idempotency_key) VALUES
  ('gamereinvite', t.id('aaa'), t.id('hoster'), 'approved', 'invite:' || md5('x2')::uuid),
  ('gamereinvite', t.id('ccc'), t.id('hoster'), 'approved', 'own-request'),
  ('gamereqonly',  t.id('bbb'), t.id('hoster'), 'approved', 'invite:' || md5('x4')::uuid);
INSERT INTO public.game_participants (game_id, user_id, attended)
VALUES ('gamereinvite', t.id('aaa'), true), ('gamereinvite', t.id('ccc'), true);
SET LOCAL session_replication_role = origin;
SELECT t.eq((SELECT jsonb_build_object('sent', m -> 'invites_sent', 'answered', m -> 'invites_answered',
                                       'accepted', m -> 'invites_accepted', 'joined', m -> 'invites_joined',
                                       'started', m -> 'invites_game_started', 'marked', m -> 'invites_attendance_marked',
                                       'showed', m -> 'invites_showed_up')
               FROM (SELECT pg_temp.day('2026-11-20') AS m) x),
            '{"sent": 3, "answered": 2, "accepted": 1, "joined": 1, "started": 1, "marked": 1, "showed": 1}'::jsonb,
  'a cancelled invitation and its accepted re-invite are two invites but one place: joined, started, marked and showed up once; '
  'a declined invitation is not joined when the player later joins on their own');
SELECT t.eq((SELECT jsonb_build_object('held', m -> 'games_held', 'series', m -> 'games_held_series', 'left_out', m -> 'series_games_left_out',
                                       'joined', m -> 'invites_joined', 'started', m -> 'invites_game_started')
               FROM (SELECT pg_temp.day('2026-11-18') AS m) x),
            '{"held": 1, "series": 1, "left_out": 0, "joined": 1, "started": 1}'::jsonb,
  'a series game whose only player has an approved request (no roster row yet) is held, as its invite is joined');


-- ---- one host rule for every step: a staff or test account's game moves no adult number ------------------------------------------
-- Week of 2026-11-30: the superadmin hosts a game and invites an adult poster, who accepts, is on the roster and shows up; a
-- test account hosts a game an adult poster joins on their own. Neither game is held for the funnel (its host is not a pilot
-- user), so neither may add an invite, a join or a self-join either.
SELECT t.person('ppa', 33), t.person('ppb', 34);
CREATE FUNCTION pg_temp.span(_from date, _to date) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_object_agg(e.key, e.total) FROM (
    SELECT e.key, sum((e.value #>> '{}')::int) AS total
      FROM private_sec.funnel_day_metrics(_from, _to, timestamptz '2026-12-10 12:00+00', true) m
     CROSS JOIN LATERAL jsonb_each(m.metrics) e GROUP BY e.key) e $$;
CREATE TEMP TABLE no_staff_games AS SELECT pg_temp.span('2026-11-30', '2026-12-06') AS m;
SET LOCAL session_replication_role = replica;
INSERT INTO public.player_availabilities (id, user_id, sports, status, time_slots, timezone, created_at)
SELECT md5('staffweek:' || h)::uuid, t.id(h), ARRAY['Basketball'], 'open', '[]'::jsonb, 'America/New_York', timestamptz '2026-12-01 12:00-05'
  FROM unnest(ARRAY['ppa', 'ppb']) h;
INSERT INTO public.hosted_games (id, host_id, sport, title, date, max_players) VALUES
  ('gamestaff',     t.id('superone'), 'basketball', 'Staff run', timestamptz '2026-12-02 23:00+00', 20),
  ('gametestjoin',  t.id('tester'),   'basketball', 'Test run',  timestamptz '2026-12-02 23:00+00', 20);
SELECT pg_temp.invite('gamestaff', 'ppa', 'accepted', true, false, timestamptz '2026-12-01 18:00+00');
INSERT INTO public.join_requests (game_id, player_id, host_id, status, idempotency_key, created_at) VALUES
  ('gamestaff',    t.id('ppa'), t.id('superone'), 'approved', 'invite:' || md5('inv:gamestaff:ppa'), timestamptz '2026-12-01 18:05+00'),
  ('gametestjoin', t.id('ppb'), t.id('tester'),   'approved', 'own',                                 timestamptz '2026-12-01 18:00+00');
INSERT INTO public.game_participants (game_id, user_id, attended, created_at) VALUES
  ('gamestaff', t.id('ppa'), true, timestamptz '2026-12-01 18:05+00'),
  ('gametestjoin', t.id('ppb'), true, timestamptz '2026-12-01 18:00+00');
SET LOCAL session_replication_role = origin;
SELECT t.eq(pg_temp.span('2026-11-30', '2026-12-06') - 'posters' - 'posters_invited', (SELECT m FROM no_staff_games) - 'posters' - 'posters_invited',
  'a staff-hosted game adds no invite, join, start, mark or show-up, and a self-join into a test account''s game no self-join');
SELECT t.eq((pg_temp.span('2026-11-30', '2026-12-06') ->> 'posters')::int - ((SELECT m FROM no_staff_games) ->> 'posters')::int, 2,
  'setup: the two players are adult posters of that week');
SELECT t.eq(pg_temp.span('2026-11-30', '2026-12-06') -> 'posters_invited', (SELECT m FROM no_staff_games) -> 'posters_invited',
  'and an invitation from staff does not make a poster "invited"');
SELECT t.eq((pg_temp.span('2026-11-30', '2026-12-06') ->> 'games_held')::int, ((SELECT m FROM no_staff_games) ->> 'games_held')::int,
  'as neither game is held');

-- ---- a window must be real dates --------------------------------------------------------------------------------------------------
-- '-infinity' survived the clamping, and generate_series over it never ends: the call ran until a statement timeout stopped it.
SET LOCAL statement_timeout = '5s';
SELECT t.throws($q$SELECT private_sec.funnel_report('-infinity', '-infinity', now(), false)$q$, 'INVALID_WINDOW',
  'a window ending at -infinity is refused at once');
SELECT t.throws($q$SELECT private_sec.funnel_report(NULL, '-infinity', now(), false)$q$, 'INVALID_WINDOW', 'with no start too');
SELECT t.throws($q$SELECT private_sec.funnel_report('-infinity', NULL, now(), false)$q$, 'INVALID_WINDOW', 'a start at -infinity too');
SELECT t.throws($q$SELECT private_sec.funnel_report('infinity', NULL, now(), false)$q$, 'INVALID_WINDOW', 'and one at infinity');
SELECT t.as_user(t.id('superone'));
SELECT t.throws($q$SELECT public.superadmin_funnel(_to => '-infinity')$q$, 'INVALID_WINDOW', 'through superadmin_funnel too');
SELECT t.reset();
SET LOCAL statement_timeout = 0;

ROLLBACK;
