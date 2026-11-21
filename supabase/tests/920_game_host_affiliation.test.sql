-- WP 3.0 (20261121100000_game_host_affiliation): a game's team must be one its host owns or manages; a game without a team may
-- be hosted only by an adult; editing other fields of an existing game, a team's deletion and the server are not limited.
BEGIN;
SELECT t.person('adult', 34), t.person('owner2', 45), t.person('mgr', 38), t.person('coach', 41), t.person('capt', 29),
       t.person('player', 27), t.person('teen', 17), t.person('kid', 15);
INSERT INTO auth.users (id, email, email_confirmed_at, raw_user_meta_data)
  VALUES (t.id('noage'), 'noage920@example.test', now(), '{"display_name":"Noage","account_type":"player"}');

SET LOCAL session_replication_role = replica;
INSERT INTO public.teams (id, owner_id, kind, name, handle) VALUES
  ('t-adult', t.id('adult'),  'team', 'Adult Run',  't920adult'),
  ('t-other', t.id('owner2'), 'team', 'Other Club', 't920other'),
  ('t-teen',  t.id('teen'),   'team', 'Teen Squad', 't920teen'),
  ('t-teen2', t.id('teen'),   'team', 'Teen Two',   't920teen2'),
  ('t-del',   t.id('owner2'), 'team', 'Gone Soon',  't920del');
INSERT INTO public.team_members (team_id, user_id, role) VALUES
  ('t-other', t.id('mgr'),    'manager'),
  ('t-other', t.id('coach'),  'coach'),
  ('t-other', t.id('capt'),   'captain'),
  ('t-other', t.id('player'), 'player'),
  ('t-del',   t.id('teen'),   'manager');
SET LOCAL session_replication_role = origin;

CREATE FUNCTION t.host_sql(_id text, _host text, _team text) RETURNS text LANGUAGE sql AS $f$
  SELECT format($q$INSERT INTO public.hosted_games (id, host_id, sport, title, date, max_players, team_id)
                   VALUES (%L, %L, 'basketball', 'Run', now() + interval '3 days', 10, %L)$q$, _id, t.id(_host), _team)
$f$;

SELECT t.eq(has_function_privilege('authenticated', 'private_sec.enforce_game_host_affiliation()', 'EXECUTE'), false,
  'members cannot call the trigger function');

-- ---- hosting as oneself ----------------------------------------------------------------------------
SELECT t.as_user(t.id('adult'));
SELECT t.lives(t.host_sql('g-self', 'adult', NULL), 'an adult hosts as themselves, without a team');
SELECT t.as_user(t.id('teen'));
SELECT t.throws(t.host_sql('g-teen-self', 'teen', NULL), 'Only adults can host a game without a team profile',
  'a 17-year-old cannot host without a team');
SELECT t.lives(t.host_sql('g-teen-team', 'teen', 't-teen'), 'a 17-year-old still hosts under their own team');
SELECT t.as_user(t.id('noage'));
SELECT t.throws(t.host_sql('g-noage', 'noage', NULL), 'adult', 'an account of unknown age cannot host without a team (fails closed)');
SELECT t.as_user(t.id('kid'));
SELECT t.throws(t.host_sql('g-kid', 'kid', NULL), 'CHILD_CANNOT_HOST', 'a 15-year-old still cannot host at all');

-- ---- the team must be one the host owns or manages ---------------------------------------------------
SELECT t.as_user(t.id('adult'));
SELECT t.lives(t.host_sql('g-own', 'adult', 't-adult'), 'the owner hosts under their team');
SELECT t.throws(t.host_sql('g-steal', 'adult', 't-other'), 'own or manage', 'nobody can put another team on their game');
SELECT t.as_user(t.id('mgr'));
SELECT t.lives(t.host_sql('g-mgr', 'mgr', 't-other'), 'a manager hosts under the team');
SELECT t.as_user(t.id('coach'));
SELECT t.lives(t.host_sql('g-coach', 'coach', 't-other'), 'so does a coach');
SELECT t.as_user(t.id('capt'));
SELECT t.throws(t.host_sql('g-capt', 'capt', 't-other'), 'own or manage', 'a captain does not');
SELECT t.as_user(t.id('player'));
SELECT t.throws(t.host_sql('g-player', 'player', 't-other'), 'own or manage', 'nor a player on the team');
SELECT t.as_user(t.id('adult'));
SELECT t.throws(format($q$INSERT INTO public.hosted_games (id, host_id, sport, title, date, team_id)
  VALUES ('g-ghost', %L, 'basketball', 'Run', now() + interval '3 days', 'no-such-team')$q$, t.id('adult')), '',
  'a team id that does not exist is refused');
SELECT t.reset();
SELECT t.eq((SELECT count(*)::int FROM public.hosted_games WHERE id LIKE 'g-%'), 5, 'five games were written, none of the refused ones');

-- ---- changing an existing game -----------------------------------------------------------------------
SELECT t.as_user(t.id('adult'));
SELECT t.lives($q$UPDATE public.hosted_games SET title = 'Renamed' WHERE id = 'g-own'$q$, 'editing other fields is unaffected');
SELECT t.throws($q$UPDATE public.hosted_games SET team_id = 't-other' WHERE id = 'g-own'$q$, 'own or manage',
  'moving a game to a team the host does not manage is refused');
SELECT t.lives($q$UPDATE public.hosted_games SET team_id = NULL WHERE id = 'g-own'$q$, 'an adult may move their game to themselves');
SELECT t.lives($q$UPDATE public.hosted_games SET team_id = 't-adult' WHERE id = 'g-self'$q$, 'and onto their own team');
SELECT t.as_user(t.id('teen'));
SELECT t.throws($q$UPDATE public.hosted_games SET team_id = NULL WHERE id = 'g-teen-team'$q$, 'Only adults',
  'a 17-year-old cannot take the team off their game');
SELECT t.lives($q$UPDATE public.hosted_games SET team_id = 't-teen2' WHERE id = 'g-teen-team'$q$, 'but can move it to another team they own');
SELECT t.reset();

-- a game written before this rule, under a team its host does not manage, can still be edited (only a change is checked)
SET LOCAL session_replication_role = replica;
INSERT INTO public.hosted_games (id, host_id, sport, title, date, max_players, team_id)
  VALUES ('g-legacy', t.id('player'), 'basketball', 'Old run', now() + interval '3 days', 10, 't-other');
SET LOCAL session_replication_role = origin;
SELECT t.as_user(t.id('player'));
SELECT t.lives($q$UPDATE public.hosted_games SET title = 'Old run, renamed' WHERE id = 'g-legacy'$q$, 'an older game keeps working for edits');
SELECT t.reset();

-- ---- a team's deletion, and the server -----------------------------------------------------------------
SELECT t.as_user(t.id('teen'));
SELECT t.lives(t.host_sql('g-del', 'teen', 't-del'), 'a 17-year-old manager hosts under the team');
SELECT t.as_user(t.id('owner2'));
SELECT t.lives($q$DELETE FROM public.teams WHERE id = 't-del'$q$, 'its owner can still delete the team');
SELECT t.reset();
SELECT t.eq((SELECT count(*)::int FROM public.hosted_games WHERE id = 'g-del' AND team_id IS NULL), 1,
  'the game stays, without the team (the foreign key''s cascade is not refused)');
SELECT t.lives(t.host_sql('g-server', 'teen', NULL), 'the server (no signed-in member) is not limited here');

ROLLBACK;
