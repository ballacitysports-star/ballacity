-- PRIV-2A: private storage for the exact location of youth-inclusive games.
--
-- Exact location is readable only by the host, the roster, a verified guardian of someone on the roster, a manager of
-- the game's team and an admin/owner of its organization. A signed-in stranger of any age, a pending requester (adult or
-- minor), a guardian of a pending child, a waitlisted player and a guardian whose link was revoked read nothing. The
-- private table is not in realtime and cannot be written by a client. With the switch on, new youth-inclusive games are
-- stored coarse publicly and exact privately; an edit that round-trips the coarse values cannot destroy the exact copy;
-- the one-time batch function coarsens existing rows (the exact copy stays private; there is no inverse).

BEGIN;
SELECT t.person('host', 35), t.person('stranger', 28), t.person('teenstranger', 16), t.person('player', 30),
       t.person('kid', 10), t.person('kidguardian', 41), t.person('pendkid', 11), t.person('pendguardian', 42),
       t.person('manager', 37), t.person('orgowner', 44), t.person('waiter', 29), t.person('revoked', 43);
SELECT t.guardian('kidguardian', 'kid');
SELECT t.guardian('pendguardian', 'pendkid');
SELECT t.team('tm', 'manager');
INSERT INTO public.trainer_orgs (id, owner_id, name, handle) VALUES (t.id('org'), t.id('orgowner'), 'Org', 'orgx');

-- youth (8-12), no-age-limit, 21-40 adult-only, and a team-run youth game
ALTER TABLE public.hosted_games DISABLE TRIGGER validate_hosted_game_age_range;
INSERT INTO public.hosted_games (id, host_id, sport, title, date, min_age, max_age, location, neighborhood, lat, lng, team_id) VALUES
 ('g-youth',  t.id('host'), 'basketball', 'U12',      now()+interval '2 days', 8,  12,   'Lincoln Elementary Gym, 12 Oak St', 'Midtown', 33.77712, -84.38812, NULL),
 ('g-noage',  t.id('host'), 'basketball', 'All ages', now()+interval '2 days', NULL, NULL, 'Park Court, 5 Elm St',            '',        33.70011, -84.30011, NULL),
 ('g-adult',  t.id('host'), 'basketball', '21-40',    now()+interval '2 days', 21, 40,   'Rec Center, 1 Main St',             'Westside',33.80055, -84.40044, NULL),
 ('g-team',   t.id('host'), 'basketball', 'Team run', now()+interval '2 days', 8,  12,   'School Gym, 9 Pine St',            'Eastside',33.90077, -84.50066, 'tm');
UPDATE public.hosted_games SET org_id = t.id('org') WHERE id = 'g-noage';
ALTER TABLE public.hosted_games ENABLE TRIGGER validate_hosted_game_age_range;

SELECT t.eq((SELECT count(*)::int FROM public.hosted_game_private), 4 - 1, 'flag OFF: the three youth-inclusive games each have a private exact copy; the adult-only one does not');
SELECT t.eq((SELECT location FROM public.hosted_games WHERE id = 'g-youth'), 'Lincoln Elementary Gym, 12 Oak St', 'flag OFF: hosted_games is unchanged (still exact), so this step alone closes nothing');
SELECT t.eq((SELECT lat FROM public.hosted_game_private WHERE game_id = 'g-youth'), 33.77712::numeric, 'the private copy is exact');

-- roster / requests
SET LOCAL session_replication_role = replica;
INSERT INTO public.game_participants (game_id, user_id) VALUES ('g-youth', t.id('player')), ('g-youth', t.id('kid'));
INSERT INTO public.join_requests (game_id, player_id, host_id, idempotency_key, status) VALUES ('g-youth', t.id('pendkid'), t.id('host'), 'k1', 'pending'), ('g-youth', t.id('teenstranger'), t.id('host'), 'k2', 'pending');
INSERT INTO public.game_position_waitlist (game_id, position, user_id, created_at) VALUES ('g-youth', 'any', t.id('waiter'), now());
SET LOCAL session_replication_role = origin;
-- a guardian whose link was revoked / never verified
INSERT INTO public.guardian_links (parent_user_id, child_user_id, relationship, status, verified_at) VALUES (t.id('revoked'), t.id('kid'), 'parent', 'revoked', now());

CREATE FUNCTION t.vis_private(g text) RETURNS int LANGUAGE sql AS $f$ SELECT count(*)::int FROM public.hosted_game_private WHERE game_id = g $f$;

SELECT t.as_anon();
SELECT t.eq(t.count('SELECT 1 FROM public.hosted_game_private'), 0, 'anonymous: nothing (no privilege)');
SELECT t.reset();
SELECT t.as_user(t.id('stranger'));
SELECT t.eq(t.vis_private('g-youth'), 0, 'unrelated signed-in adult: no exact location');
SELECT t.as_user(t.id('teenstranger'));
SELECT t.eq(t.vis_private('g-youth'), 0, 'a 16-year-old with a PENDING request: no exact location');
SELECT t.as_user(t.id('pendguardian'));
SELECT t.eq(t.vis_private('g-youth'), 0, 'guardian of a child with a PENDING request: no exact location');
SELECT t.as_user(t.id('waiter'));
SELECT t.eq(t.vis_private('g-youth'), 0, 'waitlisted player: no exact location');
SELECT t.as_user(t.id('revoked'));
SELECT t.eq(t.vis_private('g-youth'), 0, 'guardian whose link was revoked: no exact location');
SELECT t.as_user(t.id('player'));
SELECT t.eq(t.vis_private('g-youth'), 1, 'approved participant: exact location');
SELECT t.eq(t.vis_private('g-noage'), 0, 'but only for the game they are on');
SELECT t.as_user(t.id('kid'));
SELECT t.eq(t.vis_private('g-youth'), 1, 'approved minor participant: exact location');
SELECT t.as_user(t.id('kidguardian'));
SELECT t.eq(t.vis_private('g-youth'), 1, 'verified guardian of an approved participant: exact location');
SELECT t.as_user(t.id('host'));
SELECT t.eq(t.vis_private('g-youth'), 1, 'host: exact location');
SELECT t.as_user(t.id('manager'));
SELECT t.eq(t.vis_private('g-team'), 1, 'team manager of the game''s team: exact location');
SELECT t.eq(t.vis_private('g-youth'), 0, 'and not for a game that is not their team''s');
SELECT t.as_user(t.id('orgowner'));
SELECT t.eq(t.vis_private('g-noage'), 1, 'owner of the game''s organization: exact location');
SELECT t.eq(t.vis_private('g-youth'), 0, 'and not for another game');

-- no client writes
SELECT t.as_user(t.id('host'));
SELECT t.throws(format('UPDATE public.hosted_game_private SET lat = 1 WHERE game_id = %L', 'g-youth'), 'permission denied', 'even the host cannot write the private table directly');
SELECT t.throws(format('INSERT INTO public.hosted_game_private (game_id, lat) VALUES (%L, 1)', 'g-adult'), 'permission denied', 'no client insert');
SELECT t.throws(format('DELETE FROM public.hosted_game_private WHERE game_id = %L', 'g-youth'), 'permission denied', 'no client delete');
SELECT t.reset();

SELECT t.eq((SELECT count(*)::int FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'hosted_game_private'), 0, 'the private table is not in the realtime publication');
SELECT t.eq((SELECT count(*)::int FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'hosted_games'), 1, 'hosted_games still is (so its columns must be coarse before it is safe)');

-- turn coarsening ON (the later step)
SELECT set_config('app.confirm_activate_youth_coarsening', 'yes', true);
UPDATE public.app_settings SET value = '{"coarsen": true, "app_adoption_confirmed": "2c-verified"}' WHERE key = 'youth_location_privacy';

INSERT INTO public.hosted_games (id, host_id, sport, title, date, min_age, max_age, location, neighborhood, lat, lng) VALUES
 ('n-youth', t.id('host'), 'basketball', 'new youth',  now()+interval '3 days', 10, 14, 'Oak Elementary, 3 Oak St', 'Decatur', 33.12345, -84.54321),
 ('n-noage', t.id('host'), 'basketball', 'new no-age', now()+interval '3 days', NULL, NULL, 'Some Park, 7 Elm St', '', 33.55555, -84.66666),
 ('n-adult', t.id('host'), 'basketball', 'new adult',  now()+interval '3 days', 21, NULL, 'Adult Gym, 2 Main St', 'Midtown', 33.11111, -84.22222);
SELECT t.eq((SELECT location FROM public.hosted_games WHERE id = 'n-youth'), 'Decatur', 'flag ON: new youth game is stored with the neighborhood label only');
SELECT t.eq((SELECT lat::text || ',' || lng::text FROM public.hosted_games WHERE id = 'n-youth'), '33.12,-84.54', 'flag ON: coordinates are rounded to 2 decimals');
SELECT t.eq((SELECT location FROM public.hosted_games WHERE id = 'n-noage'), 'Location shared after you join', 'flag ON: no neighborhood given -> generic label (no-age-limit game is youth-inclusive)');
SELECT t.eq((SELECT location FROM public.hosted_game_private WHERE game_id = 'n-youth'), 'Oak Elementary, 3 Oak St', 'the exact venue is kept privately');
SELECT t.eq((SELECT lat FROM public.hosted_game_private WHERE game_id = 'n-youth'), 33.12345::numeric, 'with exact coordinates');
SELECT t.eq((SELECT location FROM public.hosted_games WHERE id = 'n-adult'), 'Adult Gym, 2 Main St', 'flag ON: an adult-only game is untouched');
SELECT t.eq(t.vis_private('n-adult'), 0, 'and has no private row');

-- an edit that round-trips the coarse values must not destroy the exact ones
UPDATE public.hosted_games SET title = 'renamed', location = 'Decatur', lat = 33.12, lng = -84.54 WHERE id = 'n-youth';
SELECT t.eq((SELECT location FROM public.hosted_game_private WHERE game_id = 'n-youth'), 'Oak Elementary, 3 Oak St', 'round-tripping coarse values leaves the exact location intact');
-- the host really moves the game
UPDATE public.hosted_games SET location = 'New Gym, 8 Cedar St', lat = 33.99999, lng = -84.88888 WHERE id = 'n-youth';
SELECT t.eq((SELECT location FROM public.hosted_game_private WHERE game_id = 'n-youth'), 'New Gym, 8 Cedar St', 'a real change is stored exactly');
SELECT t.eq((SELECT location FROM public.hosted_games WHERE id = 'n-youth'), 'Decatur', 'and the public row stays coarse');
-- age range changes
UPDATE public.hosted_games SET min_age = 21, max_age = NULL WHERE id = 'n-youth';
SELECT t.eq((SELECT location FROM public.hosted_games WHERE id = 'n-youth'), 'New Gym, 8 Cedar St', 'becoming adult-only restores the exact location');
SELECT t.eq(t.vis_private('n-youth'), 0, 'and removes the private row');
UPDATE public.hosted_games SET min_age = 8, max_age = 12 WHERE id = 'n-youth';
SELECT t.eq((SELECT location FROM public.hosted_games WHERE id = 'n-youth'), 'Decatur', 'becoming youth-inclusive again coarsens it');
SELECT t.eq((SELECT location FROM public.hosted_game_private WHERE game_id = 'n-youth'), 'New Gym, 8 Cedar St', 'and keeps the exact one privately');

-- what a stranger sees through the ordinary table and what a participant sees through both
SELECT t.as_user(t.id('stranger'));
SELECT t.eq((SELECT location FROM public.hosted_games WHERE id = 'n-youth'), 'Decatur', 'stranger via hosted_games: coarse');
SELECT t.eq(t.vis_private('n-youth'), 0, 'stranger via the private table: nothing');
SELECT t.reset();

-- deleting a game removes its private copy
DELETE FROM public.hosted_games WHERE id = 'n-noage';
SELECT t.eq(t.vis_private('n-noage'), 0, 'deleting a game cascades to its private copy');

-- the backfill statement is idempotent and only copies youth-inclusive games
INSERT INTO public.hosted_game_private (game_id, location, lat, lng)
SELECT g.id, g.location, g.lat, g.lng FROM public.hosted_games g
 WHERE NOT public.game_age_range_is_adult_only(g.min_age, g.max_age)
ON CONFLICT (game_id) DO NOTHING;
SELECT t.eq((SELECT location FROM public.hosted_game_private WHERE game_id = 'n-youth'), 'New Gym, 8 Cedar St', 'the backfill never overwrites an existing exact copy with a coarse one');
ROLLBACK;

-- ===== One-time coarsening of existing rows ============================================================
BEGIN;
SELECT t.person('host', 35), t.person('stranger', 28);
ALTER TABLE public.hosted_games DISABLE TRIGGER validate_hosted_game_age_range;
-- legacy rows: inserted while the flag is OFF, exactly as production holds them today
INSERT INTO public.hosted_games (id, host_id, sport, title, date, min_age, max_age, location, neighborhood, lat, lng) VALUES
 ('l-youth1', t.id('host'), 'basketball', 'u12',  now()+interval '2 days', 8, 12, 'Lincoln Elementary Gym, 12 Oak St', 'Midtown', 33.77712, -84.38812),
 ('l-youth2', t.id('host'), 'basketball', 'open', now()+interval '2 days', NULL, NULL, 'Park Court, 5 Elm St', '', 33.70011, -84.30011),
 ('l-adult',  t.id('host'), 'basketball', '21+',  now()+interval '2 days', 21, NULL, 'Rec Center, 1 Main St', 'Westside', 33.80055, -84.40044);
ALTER TABLE public.hosted_games ENABLE TRIGGER validate_hosted_game_age_range;
SELECT set_config('app.confirm_activate_youth_coarsening', 'yes', true);
UPDATE public.app_settings SET value = '{"coarsen": true, "app_adoption_confirmed": "2c-verified"}' WHERE key = 'youth_location_privacy';   -- flag already on in this scenario
SELECT t.eq((SELECT count(*)::int FROM public.hosted_game_private WHERE game_id LIKE 'l-%'), 2, 'legacy youth games were copied by the 2A backfill/sync');
SELECT t.eq((SELECT public.coarsen_existing_youth_games(1)), 1, 'batch of 1 coarsens one game');
SELECT t.eq((SELECT public.coarsen_existing_youth_games(200)), 1, 'the next call coarsens the remaining one');
SELECT t.eq((SELECT public.coarsen_existing_youth_games(200)), 0, 'idempotent: a third call changes nothing');
SELECT t.eq((SELECT location FROM public.hosted_games WHERE id = 'l-youth1'), 'Midtown', 'public location is now the label');
SELECT t.eq((SELECT location FROM public.hosted_games WHERE id = 'l-youth2'), 'Location shared after you join', 'no neighborhood -> generic label');
SELECT t.eq((SELECT lat::text FROM public.hosted_games WHERE id = 'l-youth1'), '33.78', 'coordinates rounded');
SELECT t.eq((SELECT location FROM public.hosted_game_private WHERE game_id = 'l-youth1'), 'Lincoln Elementary Gym, 12 Oak St', 'THE EXACT COPY IS INTACT (the coarsening update did not overwrite it)');
SELECT t.eq((SELECT lat FROM public.hosted_game_private WHERE game_id = 'l-youth1'), 33.77712::numeric, 'with exact coordinates');
SELECT t.eq((SELECT location FROM public.hosted_games WHERE id = 'l-adult'), 'Rec Center, 1 Main St', 'the adult-only game is untouched');
-- a stranger now sees only the coarse rows
SELECT t.as_user(t.id('stranger'));
SELECT t.eq((SELECT location FROM public.hosted_games WHERE id = 'l-youth1'), 'Midtown', 'stranger reads coarse');
SELECT t.eq((SELECT count(*)::int FROM public.hosted_game_private), 0, 'and cannot read the private table');
SELECT t.reset();
-- an old client edits the title and sends back what it was given
UPDATE public.hosted_games SET title = 'renamed', location = 'Midtown', lat = 33.78, lng = -84.39 WHERE id = 'l-youth1';
SELECT t.eq((SELECT location FROM public.hosted_game_private WHERE game_id = 'l-youth1'), 'Lincoln Elementary Gym, 12 Oak St', 'a round-tripped coarse edit does not clobber the exact copy');
-- there is no way back into the public columns
SELECT t.eq((SELECT count(*)::int FROM pg_proc WHERE proname = 'restore_exact_youth_games'), 0, 'no function puts exact values back into the public columns');
SELECT t.eq((SELECT location FROM public.hosted_games WHERE id = 'l-youth1'), 'Midtown', 'the public row stays coarse');
SELECT t.eq((SELECT location FROM public.hosted_game_private WHERE game_id = 'l-youth1'), 'Lincoln Elementary Gym, 12 Oak St', 'and the exact copy is still there');
ROLLBACK;

-- ===== Age-based viewers and game shapes (explicit cohorts) ===========================================
BEGIN;
SELECT t.person('host', 35), t.person('adultstranger', 28), t.person('teen17', 17), t.person('teen14', 14), t.person('child9', 9),
       t.person('kidplayer', 10), t.person('kidguardian', 41), t.person('teenplayer', 16), t.person('teenguardian', 42);
SELECT t.guardian('kidguardian', 'kidplayer'); SELECT t.guardian('teenguardian', 'teenplayer');
ALTER TABLE public.hosted_games DISABLE TRIGGER validate_hosted_game_age_range;
INSERT INTO public.hosted_games (id, host_id, sport, title, date, min_age, max_age, location, neighborhood, lat, lng) VALUES
 ('s-18',     t.id('host'), 'basketball', '18+',        now()+interval '2 days', 18,   NULL, 'A, 1 St', 'N1', 33.11111, -84.11111),
 ('s-21-40',  t.id('host'), 'basketball', '21-40',      now()+interval '2 days', 21,   40,   'B, 2 St', 'N2', 33.22222, -84.22222),
 ('s-8-12',   t.id('host'), 'basketball', '8-12',       now()+interval '2 days', 8,    12,   'C, 3 St', 'N3', 33.33333, -84.33333),
 ('s-13-17',  t.id('host'), 'basketball', '13-17',      now()+interval '2 days', 13,   17,   'D, 4 St', 'N4', 33.44444, -84.44444),
 ('s-16-30',  t.id('host'), 'basketball', '16-30 mixed',now()+interval '2 days', 16,   30,   'E, 5 St', 'N5', 33.55555, -84.55555),
 ('s-open',   t.id('host'), 'basketball', 'no limit',   now()+interval '2 days', NULL, NULL, 'F, 6 St', 'N6', 33.66666, -84.66666),
 ('s-maxonly',t.id('host'), 'basketball', 'up to 17',   now()+interval '2 days', NULL, 17,   'G, 7 St', 'N7', 33.77777, -84.77777),
 ('s-invert', t.id('host'), 'basketball', 'inverted',   now()+interval '2 days', 40,   30,   'H, 8 St', 'N8', 33.88888, -84.88888);
ALTER TABLE public.hosted_games ENABLE TRIGGER validate_hosted_game_age_range;
SELECT t.eq((SELECT string_agg(game_id, ',' ORDER BY game_id) FROM public.hosted_game_private WHERE game_id LIKE 's-%'),
  's-13-17,s-16-30,s-8-12,s-invert,s-maxonly,s-open', '18+ and 21-40 are adult-only; every other shape is youth-inclusive (no limit, max-only, mixed, inverted too)');
SET LOCAL session_replication_role = replica;
INSERT INTO public.game_participants (game_id, user_id) VALUES ('s-8-12', t.id('kidplayer')), ('s-13-17', t.id('teenplayer'));
INSERT INTO public.join_requests (game_id, player_id, host_id, idempotency_key, status) VALUES
  ('s-8-12', t.id('child9'), t.id('host'), 'q1', 'pending'), ('s-13-17', t.id('teen14'), t.id('host'), 'q2', 'pending');
SET LOCAL session_replication_role = origin;
CREATE FUNCTION t.vp(g text) RETURNS int LANGUAGE sql AS $f$ SELECT count(*)::int FROM public.hosted_game_private WHERE game_id = g $f$;
SELECT t.as_user(t.id('adultstranger'));  SELECT t.eq(t.vp('s-8-12') + t.vp('s-13-17') + t.vp('s-open'), 0, 'adult stranger: no exact location of any youth-inclusive game');
SELECT t.as_user(t.id('teen17'));         SELECT t.eq(t.vp('s-8-12') + t.vp('s-13-17') + t.vp('s-open'), 0, '16-17 stranger: none');
SELECT t.as_user(t.id('teen14'));         SELECT t.eq(t.vp('s-13-17'), 0, '13-15 with a PENDING request to that game: none');
SELECT t.as_user(t.id('child9'));         SELECT t.eq(t.vp('s-8-12'), 0, 'under-13 with a PENDING request to that game: none');
SELECT t.as_user(t.id('kidplayer'));      SELECT t.eq(t.vp('s-8-12'), 1, 'under-13 on the roster: exact');
SELECT t.eq(t.vp('s-13-17'), 0, '... but not for a game they are not on');
SELECT t.as_user(t.id('kidguardian'));    SELECT t.eq(t.vp('s-8-12'), 1, 'verified guardian of the under-13 on the roster: exact');
SELECT t.as_user(t.id('teenplayer'));     SELECT t.eq(t.vp('s-13-17'), 1, '16-year-old on the roster: exact');
SELECT t.as_user(t.id('teenguardian'));   SELECT t.eq(t.vp('s-13-17'), 1, 'verified guardian of the 16-year-old on the roster: exact');
SELECT t.eq(t.vp('s-8-12'), 0, '... and nothing for another child''s game');
SELECT t.as_user(t.id('host'));           SELECT t.eq(t.vp('s-8-12') + t.vp('s-13-17') + t.vp('s-open') + t.vp('s-16-30'), 4, 'the adult host: exact, for every game they host');
SELECT t.as_anon();                        SELECT t.eq(t.count('SELECT 1 FROM public.hosted_game_private'), 0, 'anonymous: nothing');
SELECT t.reset();
-- switching the guard on does not change who can read, and strangers of every age see only the coarse form
SELECT set_config('app.confirm_activate_youth_coarsening', 'yes', true);
UPDATE public.app_settings SET value = '{"coarsen": true, "app_adoption_confirmed": "2c-verified"}' WHERE key = 'youth_location_privacy';
INSERT INTO public.hosted_games (id, host_id, sport, title, date, min_age, max_age, location, neighborhood, lat, lng) VALUES
  ('c-8-12', t.id('host'), 'basketball', 'new youth', now()+interval '3 days', 8, 12, 'Oak Elementary, 3 Oak St', 'Decatur', 33.12345, -84.54321);
SELECT t.as_user(t.id('adultstranger'));
SELECT t.eq((SELECT location FROM public.hosted_games WHERE id = 'c-8-12'), 'Decatur', 'flag on: an adult stranger reads only the neighborhood label');
SELECT t.eq((SELECT lat::text FROM public.hosted_games WHERE id = 'c-8-12'), '33.12', 'and a rounded coordinate');
SELECT t.as_user(t.id('teen17'));
SELECT t.eq((SELECT location FROM public.hosted_games WHERE id = 'c-8-12'), 'Decatur', 'a 16-17 stranger: the same');
SELECT t.as_user(t.id('child9'));
SELECT t.eq((SELECT location FROM public.hosted_games WHERE id = 'c-8-12'), 'Decatur', 'an under-13 with no relation to the game: the same');
SELECT t.reset();
ROLLBACK;

-- ===== Coarsening cannot be started early and cannot be undone ==========================================
BEGIN;
SELECT t.person('host', 35);
SELECT t.eq((SELECT value ->> 'coarsen' FROM public.app_settings WHERE key = 'youth_location_privacy'), 'false', 'the switch is seeded off');
SELECT t.throws($q$UPDATE public.app_settings SET value = '{"coarsen": true}' WHERE key = 'youth_location_privacy'$q$, 'COARSENING_NOT_READY', 'cannot be turned on without the adoption confirmation');
SELECT t.throws($q$UPDATE public.app_settings SET value = '{"coarsen": true, "app_adoption_confirmed": "yes"}' WHERE key = 'youth_location_privacy'$q$, 'COARSENING_NOT_READY', 'a wrong confirmation value does not count');
SELECT t.throws($q$UPDATE public.app_settings SET value = '{"coarsen": true, "app_adoption_confirmed": "2c-verified"}' WHERE key = 'youth_location_privacy'$q$, 'COARSENING_NOT_CONFIRMED', 'nor without the typed session confirmation');
SELECT t.throws($q$SELECT public.coarsen_existing_youth_games(10)$q$, 'COARSENING_NOT_ACTIVE', 'the batch function refuses while the switch is off');
SELECT t.as_user(t.id('host'));
SELECT t.eq(t.changed($q$UPDATE public.app_settings SET value = '{"coarsen": true, "app_adoption_confirmed": "2c-verified"}' WHERE key = 'youth_location_privacy'$q$), 0, 'no client can touch the setting at all (row-level security hides the row)');
SELECT t.reset();
-- a youth game with no private copy (a copy was lost) blocks activation
INSERT INTO public.hosted_games (id, host_id, sport, title, date, min_age, max_age, location, neighborhood, lat, lng) VALUES
  ('x-youth', t.id('host'), 'basketball', 'u12', now()+interval '2 days', 8, 12, 'Gym, 1 St', 'Midtown', 33.1, -84.1);
DELETE FROM public.hosted_game_private WHERE game_id = 'x-youth';
SELECT set_config('app.confirm_activate_youth_coarsening', 'yes', true);
SELECT t.throws($q$UPDATE public.app_settings SET value = '{"coarsen": true, "app_adoption_confirmed": "2c-verified"}' WHERE key = 'youth_location_privacy'$q$, 'no exact private copy', 'cannot be turned on while a youth game has no exact private copy');
INSERT INTO public.hosted_game_private (game_id, location, lat, lng) VALUES ('x-youth', 'Gym, 1 St', 33.1, -84.1);
SELECT t.lives($q$UPDATE public.app_settings SET value = '{"coarsen": true, "app_adoption_confirmed": "2c-verified"}' WHERE key = 'youth_location_privacy'$q$, 'with everything in place it can be turned on, on purpose');
SELECT t.ok((SELECT value ? 'activated_at' FROM public.app_settings WHERE key = 'youth_location_privacy'), 'and records when');
SELECT t.throws($q$UPDATE public.app_settings SET value = '{"coarsen": false}' WHERE key = 'youth_location_privacy'$q$, 'COARSENING_IRREVERSIBLE', 'once on it cannot be turned off');
SELECT t.throws($q$DELETE FROM public.app_settings WHERE key = 'youth_location_privacy'$q$, 'COARSENING_IRREVERSIBLE', 'nor deleted');
UPDATE public.app_settings SET value = '{"coarsen": true, "app_adoption_confirmed": "no"}' WHERE key = 'youth_location_privacy';
SELECT t.eq((SELECT value ->> 'app_adoption_confirmed' FROM public.app_settings WHERE key = 'youth_location_privacy'), '2c-verified', 'and the active value cannot be edited into something else');
SELECT t.lives($q$UPDATE public.app_settings SET value = '{"x": 1}' WHERE key = 'age_policy' AND false$q$, 'other settings are untouched by the guard');
ROLLBACK;

-- ===== A paid game: the exact venue needs a settled fee as well as a roster place =========================
BEGIN;
SELECT t.person('host', 35), t.person('paidplayer', 30), t.person('waitplayer', 31), t.person('freeplayer', 32), t.person('kid', 10), t.person('kidguardian', 41), t.person('stranger', 28);
SELECT t.guardian('kidguardian', 'kid');
INSERT INTO public.hosted_games (id, host_id, sport, title, date, min_age, max_age, location, neighborhood, lat, lng, price) VALUES
  ('pay-y', t.id('host'), 'basketball', 'paid youth', now()+interval '3 days', 8, 12, 'Gym, 9 Pine St', 'Midtown', 33.1, -84.1, 10),
  ('free-y', t.id('host'), 'basketball', 'free youth', now()+interval '3 days', 8, 12, 'Gym, 2 Pine St', 'Midtown', 33.2, -84.2, 0);
INSERT INTO public.game_payment_settings (game_id, host_id, entry_fee) VALUES ('pay-y', t.id('host'), 10);
SET LOCAL session_replication_role = replica;
INSERT INTO public.game_participants (game_id, user_id) VALUES
  ('pay-y', t.id('paidplayer')), ('pay-y', t.id('waitplayer')), ('pay-y', t.id('kid')), ('free-y', t.id('freeplayer')), ('free-y', t.id('kid'));
INSERT INTO public.payment_submissions (player_id, game_id, host_id, status) VALUES
  (t.id('paidplayer'), 'pay-y', t.id('host'), 'verified'),
  (t.id('waitplayer'), 'pay-y', t.id('host'), 'pending');
SET LOCAL session_replication_role = origin;
CREATE FUNCTION t.vp2(g text) RETURNS int LANGUAGE sql AS $$ SELECT count(*)::int FROM public.hosted_game_private WHERE game_id = g $$;
SELECT t.as_user(t.id('paidplayer'));  SELECT t.eq(t.vp2('pay-y'), 1, 'on the roster with a verified payment: exact');
SELECT t.as_user(t.id('waitplayer'));  SELECT t.eq(t.vp2('pay-y'), 0, 'on the roster but payment only pending: not yet');
SELECT t.as_user(t.id('kid'));         SELECT t.eq(t.vp2('pay-y'), 0, 'a child on the roster who has not paid: not yet');
                                       SELECT t.eq(t.vp2('free-y'), 1, 'but the child in a free game: exact');
SELECT t.as_user(t.id('kidguardian')); SELECT t.eq(t.vp2('pay-y'), 0, 'their guardian: not for the unpaid game');
                                       SELECT t.eq(t.vp2('free-y'), 1, 'and exact for the free one');
SELECT t.as_user(t.id('freeplayer'));  SELECT t.eq(t.vp2('free-y'), 1, 'a free game''s roster member: exact');
SELECT t.as_user(t.id('stranger'));    SELECT t.eq(t.vp2('pay-y') + t.vp2('free-y'), 0, 'a stranger: neither');
SELECT t.as_user(t.id('host'));        SELECT t.eq(t.vp2('pay-y') + t.vp2('free-y'), 2, 'the host: both');
SELECT t.reset();
-- the payment clears: the venue opens for the child's guardian too
SET LOCAL session_replication_role = replica;
INSERT INTO public.payment_submissions (player_id, game_id, host_id, status) VALUES (t.id('kid'), 'pay-y', t.id('host'), 'verified');
SET LOCAL session_replication_role = origin;
SELECT t.as_user(t.id('kid'));         SELECT t.eq(t.vp2('pay-y'), 1, 'once the payment is verified: exact');
SELECT t.as_user(t.id('kidguardian')); SELECT t.eq(t.vp2('pay-y'), 1, 'and for their verified guardian');
SELECT t.reset();
ROLLBACK;
