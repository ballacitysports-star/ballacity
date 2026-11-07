-- P2-2: one private coach identity per person, kept in step with roster roles.
--
-- account_profiles gets kind 'coach' while the person is owner, manager or coach on at
-- least one team, and loses it when they no longer are. Only the server writes it, and
-- only the person can read it.
BEGIN;

SELECT t.person('owner', 35), t.person('coachy', 40), t.person('playerone', 16),
       t.person('captainx', 17), t.person('stranger', 30);
SELECT t.team('alpha', 'owner');
SELECT t.team('bravo', 'owner');

CREATE FUNCTION pg_temp.coach_rows(_h text) RETURNS int LANGUAGE sql AS $$
  SELECT count(*)::int FROM public.account_profiles
  WHERE user_id = t.id(_h) AND kind = 'coach'
$$;

-- Owners
SELECT t.eq(pg_temp.coach_rows('owner'), 1, 'a team owner has a coach identity');
SELECT t.eq(pg_temp.coach_rows('owner'), 1, 'owning two teams still gives exactly one');

-- Roles that do and do not count
SELECT t.member('alpha', 'playerone', 'player');
SELECT t.member('alpha', 'captainx', 'captain');
SELECT t.eq(pg_temp.coach_rows('playerone'), 0, 'a player has no coach identity');
SELECT t.eq(pg_temp.coach_rows('captainx'), 0, 'a captain has no coach identity');

SELECT t.member('alpha', 'coachy', 'coach');
SELECT t.eq(pg_temp.coach_rows('coachy'), 1, 'becoming a coach creates it');
SELECT t.member('bravo', 'coachy', 'manager');
SELECT t.eq(pg_temp.coach_rows('coachy'), 1, 'coaching one team and managing another: still one');

-- It follows the roster
SELECT t.as_user(t.id('owner'));
SELECT t.lives(format($q$UPDATE public.team_members SET role = 'player' WHERE team_id = 'alpha' AND user_id = %L$q$, t.id('coachy')),
  'the owner demotes the coach to player on one team');
SELECT t.reset();
SELECT t.eq(pg_temp.coach_rows('coachy'), 1, 'demoted on one team but still managing another: kept');

UPDATE public.profiles SET active_profile_id =
  (SELECT id FROM public.account_profiles WHERE user_id = t.id('coachy') AND kind = 'coach')
WHERE id = t.id('coachy');
DELETE FROM public.team_members WHERE team_id = 'bravo' AND user_id = t.id('coachy');
SELECT t.eq(pg_temp.coach_rows('coachy'), 0, 'no coaching role left anywhere: removed');
SELECT t.eq(
  (SELECT active_profile_id FROM public.profiles WHERE id = t.id('coachy')),
  (SELECT id FROM public.account_profiles WHERE user_id = t.id('coachy') AND kind = 'player'),
  'someone acting as the removed coach identity falls back to their player profile');

SELECT t.as_user(t.id('owner'));
SELECT t.lives(format($q$UPDATE public.team_members SET role = 'coach' WHERE team_id = 'alpha' AND user_id = %L$q$, t.id('playerone')),
  'the owner promotes a player to coach');
SELECT t.reset();
SELECT t.eq(pg_temp.coach_rows('playerone'), 1, 'promoting a player to coach creates it');

-- A deleted team takes its owner's role with it.
DELETE FROM public.teams WHERE id = 'bravo';
SELECT t.eq(pg_temp.coach_rows('owner'), 1, 'owner of a remaining team keeps it');
DELETE FROM public.teams WHERE id = 'alpha';
SELECT t.eq(pg_temp.coach_rows('owner'), 0, 'owner of no team loses it');
SELECT t.eq(pg_temp.coach_rows('playerone'), 0, 'and so does the coach of the deleted team');

-- Clients cannot fake, change or remove it.
SELECT t.team('charlie', 'owner');
SELECT t.as_user(t.id('stranger'));
SELECT t.throws(
  format($q$INSERT INTO public.account_profiles (user_id, kind) VALUES (%L, 'coach')$q$, t.id('stranger')),
  'row-level security', 'a person with no coaching role cannot give themselves a coach identity');
SELECT t.eq(t.count(format($q$SELECT 1 FROM public.account_profiles WHERE user_id = %L$q$, t.id('owner'))), 0,
  'nobody else can read a coach identity');
SELECT t.reset();

SELECT t.as_user(t.id('owner'));
SELECT t.eq(t.count($q$SELECT 1 FROM public.account_profiles WHERE kind = 'coach'$q$), 1,
  'the person can read their own');
SELECT t.eq(t.changed($q$DELETE FROM public.account_profiles WHERE kind = 'coach'$q$), 0,
  'and cannot delete it');
SELECT t.eq(t.changed($q$UPDATE public.account_profiles SET kind = 'coach' WHERE kind = 'player'$q$), 0,
  'or turn another profile into one');
SELECT t.reset();
SELECT t.eq(pg_temp.coach_rows('owner'), 1, 'it is still there');

-- The functions are not callable through the API.
SELECT t.ok(NOT has_function_privilege('authenticated', 'private_sec.sync_coach_profile(uuid)', 'EXECUTE'),
  'signed-in clients cannot call the sync directly');
SELECT t.ok(NOT has_function_privilege('anon', 'private_sec.sync_coach_profile(uuid)', 'EXECUTE'),
  'nor can anonymous visitors');

ROLLBACK;
