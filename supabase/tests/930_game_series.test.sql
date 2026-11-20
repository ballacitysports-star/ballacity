-- WP 3.1 (20261122100000_game_series): the host makes an upcoming game repeat every week or every 2 weeks; the server creates
-- the dates up to 4 weeks ahead as copies of the latest date (same local time, payment settings, no players), once each; it
-- re-checks the host and ends the series when they may no longer host it, at its last date, or when no live date is left.
BEGIN;
SELECT t.person('host', 36), t.person('other', 33), t.person('teen', 17), t.person('mgr', 40), t.person('owner', 44);

SET LOCAL session_replication_role = replica;
INSERT INTO public.teams (id, owner_id, kind, name, handle) VALUES
  ('t930', t.id('owner'), 'team', 'Thursday Crew', 't930'),
  ('t930teen', t.id('teen'), 'team', 'Teen Crew', 't930teen');
INSERT INTO public.team_members (team_id, user_id, role) VALUES ('t930', t.id('mgr'), 'manager');
SET LOCAL session_replication_role = origin;

CREATE FUNCTION t.mk(_id text, _host text, _team text, _at timestamptz) RETURNS text LANGUAGE sql AS $f$
  SELECT format($q$INSERT INTO public.hosted_games (id, host_id, sport, title, date, ends_at, max_players, team_id, timezone, price)
                   VALUES (%L, %L, 'basketball', 'Thursday run', %L, %L, 10, %L, 'America/New_York', 5)$q$,
                _id, t.id(_host), _at, _at + interval '2 hours', _team)
$f$;
CREATE FUNCTION t.series_of(_game text) RETURNS uuid LANGUAGE sql AS $f$ SELECT series_id FROM public.hosted_games WHERE id = _game $f$;
CREATE FUNCTION t.dates(_series uuid) RETURNS int LANGUAGE sql AS $f$
  SELECT count(*)::int FROM public.hosted_games WHERE series_id = _series AND cancelled_at IS NULL
$f$;

-- ---- privileges ------------------------------------------------------------------------------------------------------------
SELECT t.eq(has_function_privilege('anon', 'public.game_series_start(text,text,date)', 'EXECUTE'), false, 'visitors cannot start a series');
SELECT t.eq(has_function_privilege('authenticated', 'public.game_series_start(text,text,date)', 'EXECUTE'), true, 'members can');
SELECT t.eq(has_function_privilege('authenticated', 'private_sec.extend_game_series(uuid,timestamptz)', 'EXECUTE'), false,
  'members cannot run the generator');
SELECT t.eq(has_table_privilege('authenticated', 'public.game_series', 'INSERT'), false, 'nobody writes series rows directly');

-- ---- starting a weekly series ------------------------------------------------------------------------------------------------
SELECT t.as_user(t.id('host'));
SELECT t.lives(t.mk('g1', 'host', NULL, now() + interval '3 days'), 'fixture: an adult hosts a game as themselves');
INSERT INTO public.game_payment_settings (game_id, host_id, entry_fee, requires_approval, refund_rule)
  VALUES ('g1', t.id('host'), 5, true, 'until_cutoff');
SELECT t.eq((public.game_series_start('g1', 'weekly') ->> 'created')::int, 3, 'weekly: the next 3 dates within 4 weeks are created');
SELECT t.eq(t.dates(t.series_of('g1')), 4, 'the series has 4 dates');
SELECT t.eq((SELECT count(DISTINCT ((date AT TIME ZONE 'America/New_York')::time))::int FROM public.hosted_games WHERE series_id = t.series_of('g1')), 1,
  'every date is at the same local time');
SELECT t.eq((SELECT count(*)::int FROM public.hosted_games WHERE series_id = t.series_of('g1') AND ends_at - date = interval '2 hours'), 4,
  'and keeps its length');
SELECT t.eq((SELECT count(*)::int FROM public.game_payment_settings ps JOIN public.hosted_games g ON g.id = ps.game_id
             WHERE g.series_id = t.series_of('g1') AND ps.entry_fee = 5 AND ps.requires_approval), 4, 'payment settings are copied');
SELECT t.eq((SELECT count(*)::int FROM public.hosted_games WHERE series_id = t.series_of('g1') AND rrule ->> 'freq' = 'weekly'), 4,
  'each date says it repeats weekly');
SELECT t.eq((SELECT count(*)::int FROM public.game_series WHERE host_id = t.id('host')), 1, 'the host reads their series');
SELECT t.as_user(t.id('other'));
SELECT t.eq((SELECT count(*)::int FROM public.game_series), 0, 'another member does not');
SELECT t.eq((SELECT count(*)::int FROM public.hosted_games WHERE id LIKE 'series-%' AND rrule ->> 'freq' = 'weekly'), 3,
  'other members see the created dates and that they repeat');
SELECT t.reset();

-- once each; places and requests are not copied
SELECT t.eq(private_sec.extend_game_series(t.series_of('g1')), 0, 'running the generator again creates nothing new');
INSERT INTO public.game_participants (game_id, user_id) VALUES ('g1', t.id('other'));
SELECT t.eq(private_sec.extend_game_series(t.series_of('g1'), now() + interval '7 days'), 1, 'a week later, one more date');
SELECT t.eq((SELECT count(*)::int FROM public.game_participants p JOIN public.hosted_games g ON g.id = p.game_id
             WHERE g.series_id = t.series_of('g1')), 1, 'players are not copied to new dates');

-- an edit to the latest date carries forward
UPDATE public.hosted_games SET title = 'Thursday run (new gym)', location = 'New Gym'
 WHERE id = (SELECT id FROM public.hosted_games WHERE series_id = t.series_of('g1') ORDER BY date DESC LIMIT 1);
SELECT t.eq(private_sec.extend_game_series(t.series_of('g1'), now() + interval '14 days'), 1, 'the next week');
SELECT t.eq((SELECT title FROM public.hosted_games WHERE series_id = t.series_of('g1') ORDER BY date DESC LIMIT 1),
  'Thursday run (new gym)', 'copies the latest date as edited');

-- ---- refusals ----------------------------------------------------------------------------------------------------------------
SELECT t.as_user(t.id('host'));
SELECT t.lives(t.mk('g2', 'host', NULL, now() + interval '2 days'), 'fixture: another game');
SELECT t.throws($q$SELECT public.game_series_start('g2', 'daily')$q$, 'every week or every 2 weeks', 'only weekly or every 2 weeks');
SELECT t.throws($q$SELECT public.game_series_start('g1', 'weekly')$q$, 'already part of a series', 'a game in a series cannot start another');
SELECT t.throws(format($q$SELECT public.game_series_start('g2', 'weekly', %L)$q$, (now() - interval '1 day')::date), 'on or after',
  'the last date cannot be before the first game');
SELECT t.as_user(t.id('other'));
SELECT t.throws($q$SELECT public.game_series_start('g2', 'weekly')$q$, 'Only the host', 'only the host');
SELECT t.as_anon();
SELECT t.throws($q$SELECT public.game_series_start('g2', 'weekly')$q$, 'permission denied', 'visitors cannot');
SELECT t.reset();
SET LOCAL session_replication_role = replica;
INSERT INTO public.hosted_games (id, host_id, sport, title, date, max_players, timezone) VALUES
  ('g-past', t.id('host'), 'basketball', 'Past', now() - interval '1 day', 10, 'America/New_York'),
  ('g-cancel', t.id('host'), 'basketball', 'Called off', now() + interval '2 days', 10, 'America/New_York');
UPDATE public.hosted_games SET cancelled_at = now() WHERE id = 'g-cancel';
SET LOCAL session_replication_role = origin;
SELECT t.as_user(t.id('host'));
SELECT t.throws($q$SELECT public.game_series_start('g-past', 'weekly')$q$, 'upcoming', 'a past game cannot repeat');
SELECT t.throws($q$SELECT public.game_series_start('g-cancel', 'weekly')$q$, 'upcoming', 'nor a cancelled one');
SELECT t.reset();

-- ---- every 2 weeks, and a last date ----------------------------------------------------------------------------------------------
SELECT t.as_user(t.id('host'));
SELECT t.eq((public.game_series_start('g2', 'biweekly') ->> 'created')::int, 1, 'every 2 weeks: from a game 2 days out, one more date within 4 weeks');
SELECT t.lives(t.mk('g3', 'host', NULL, now() + interval '1 day'), 'fixture: a third game');
SELECT t.eq((public.game_series_start('g3', 'weekly', ((now() + interval '9 days') AT TIME ZONE 'America/New_York')::date) ->> 'created')::int, 1,
  'with a last date 9 days out: one more date');
SELECT t.reset();
SELECT t.eq((SELECT ended_reason FROM public.game_series WHERE id = t.series_of('g3')), 'until_reached', 'and the series ends there');

-- ---- daylight saving: the same local time across the change (America/New_York, 14 March 2027) -----------------------------------
SET LOCAL session_replication_role = replica;
INSERT INTO public.hosted_games (id, host_id, sport, title, date, max_players, timezone, series_id)
  VALUES ('g-dst', t.id('host'), 'basketball', 'DST run', '2027-03-04 19:00 America/New_York', 10, 'America/New_York', '00000000-0000-4000-8000-000000000930');
INSERT INTO public.game_series (id, host_id, freq) VALUES ('00000000-0000-4000-8000-000000000930', t.id('host'), 'weekly');
SET LOCAL session_replication_role = origin;
SELECT t.eq(private_sec.extend_game_series('00000000-0000-4000-8000-000000000930', '2027-03-01 12:00 America/New_York'), 3,
  'fixture: three dates created across the change');
SELECT t.eq((SELECT array_agg(to_char(date AT TIME ZONE 'America/New_York', 'MM-DD HH24:MI') ORDER BY date)::text
               FROM public.hosted_games WHERE series_id = '00000000-0000-4000-8000-000000000930'),
  '{"03-04 19:00","03-11 19:00","03-18 19:00","03-25 19:00"}', 'all at 7 pm local, before and after the change');

-- ---- the host is checked again -------------------------------------------------------------------------------------------------
SELECT t.as_user(t.id('mgr'));
SELECT t.lives(t.mk('g-team', 'mgr', 't930', now() + interval '2 days'), 'fixture: a manager hosts under the team');
SELECT t.eq((public.game_series_start('g-team', 'weekly') ->> 'created')::int, 3, 'and makes it repeat');
SELECT t.reset();
DELETE FROM public.team_members WHERE team_id = 't930' AND user_id = t.id('mgr');
SELECT t.eq(private_sec.extend_game_series(t.series_of('g-team'), now() + interval '7 days'), 0, 'once no longer a manager, nothing is created');
SELECT t.eq((SELECT ended_reason FROM public.game_series WHERE id = t.series_of('g-team')), 'host_not_eligible', 'and the series ends');

UPDATE public.profiles SET suspended_at = now() WHERE id = t.id('host');
SELECT t.eq(private_sec.extend_game_series(t.series_of('g2'), now() + interval '14 days'), 0, 'a suspended host''s series creates nothing');
SELECT t.eq((SELECT ended_reason FROM public.game_series WHERE id = t.series_of('g2')), 'host_not_eligible', 'and ends');
UPDATE public.profiles SET suspended_at = NULL WHERE id = t.id('host');

SELECT t.as_user(t.id('teen'));
SELECT t.lives(t.mk('g-teen', 'teen', 't930teen', now() + interval '2 days'), 'fixture: a 17-year-old hosts under their team');
SELECT t.eq((public.game_series_start('g-teen', 'weekly') ->> 'created')::int, 3, 'and can make it repeat');
SELECT t.reset();

-- ---- stopping, and running out of live dates ----------------------------------------------------------------------------------------
SELECT t.as_user(t.id('other'));
SELECT t.throws(format('SELECT public.game_series_stop(%L)', t.series_of('g1')), 'Only the host', 'only the host stops a series');
SELECT t.as_user(t.id('host'));
SELECT t.eq(public.game_series_stop(t.series_of('g1')), true, 'the host stops it');
SELECT t.eq(public.game_series_stop(t.series_of('g1')), false, 'stopping again changes nothing');
SELECT t.reset();
SELECT t.eq((SELECT count(*)::int FROM public.hosted_games WHERE series_id = t.series_of('g1') AND rrule IS NOT NULL), 0,
  'its dates no longer say they repeat');
SELECT t.eq((SELECT count(*)::int FROM public.hosted_games WHERE series_id = t.series_of('g1') AND cancelled_at IS NULL), 6,
  'dates already created stay');
SELECT t.eq(private_sec.extend_game_series(t.series_of('g1'), now() + interval '21 days'), 0, 'a stopped series creates nothing');

UPDATE public.hosted_games SET cancelled_at = now() WHERE series_id = t.series_of('g-teen');
SELECT t.eq(private_sec.extend_game_series(t.series_of('g-teen')), 0, 'with every date cancelled, nothing is created');
SELECT t.eq((SELECT ended_reason FROM public.game_series WHERE id = t.series_of('g-teen')), 'no_live_game', 'and the series ends');

SELECT t.ok((private_sec.extend_all_game_series() ->> 'failed')::int = 0, 'the daily run goes through every running series');

ROLLBACK;
