-- Owners can hide their own listings from the public (games, team posts, teams,
-- trainer profiles, gyms), a moderator's Hide still holds, and the people linked
-- to a listing keep seeing it. The only way to change an owner's hide is
-- set_listing_hidden, which re-checks that the caller owns or manages the listing.
BEGIN;

SELECT t.person('host', 33), t.person('player', 29), t.person('stranger', 31),
       t.person('teamowner', 40), t.person('member', 27), t.person('manager', 36),
       t.person('coach', 38), t.person('gymowner', 45), t.person('modone', 50);
INSERT INTO public.user_roles (user_id, role) VALUES (t.id('modone'), 'moderator');

-- ---- games -----------------------------------------------------------------
INSERT INTO public.hosted_games (id, host_id, sport, title, date, min_age, max_age)
VALUES ('hide-g1', t.id('host'), 'basketball', 'Sunday run', now() + interval '3 days', 21, 40);
INSERT INTO public.game_participants (game_id, user_id) VALUES ('hide-g1', t.id('player'));

SELECT t.as_anon();
SELECT t.eq(t.count('SELECT 1 FROM public.hosted_games WHERE id = ''hide-g1'''), 1, 'game: a visitor sees a public game');
SELECT t.as_user(t.id('stranger'));
SELECT t.throws('SELECT public.set_listing_hidden(''game'', ''hide-g1'', true)', 'LISTING_NOT_FOUND', 'game: a stranger cannot hide it');
SELECT t.as_user(t.id('host'));
SELECT t.throws('UPDATE public.hosted_games SET owner_hidden_at = now() WHERE id = ''hide-g1''', 'LISTING_HIDE_RPC_ONLY', 'game: the host cannot write the hide directly');
SELECT t.throws('UPDATE public.hosted_games SET hidden_at = now() WHERE id = ''hide-g1''', 'LISTING_HIDDEN_MODERATOR_ONLY', 'game: nor the moderators'' column');
SELECT t.lives('UPDATE public.hosted_games SET title = ''Sunday run (updated)'' WHERE id = ''hide-g1''', 'game: ordinary edits still work');
SELECT t.ok(public.set_listing_hidden('game', 'hide-g1', true) IS NOT NULL, 'game: the host hides it');
SELECT t.as_anon();
SELECT t.eq(t.count('SELECT 1 FROM public.hosted_games WHERE id = ''hide-g1'''), 0, 'game: a visitor no longer sees it');
SELECT t.as_user(t.id('stranger'));
SELECT t.eq(t.count('SELECT 1 FROM public.hosted_games WHERE id = ''hide-g1'''), 0, 'game: nor a signed-in stranger');
SELECT t.as_user(t.id('host'));
SELECT t.eq(t.count('SELECT 1 FROM public.hosted_games WHERE id = ''hide-g1'''), 1, 'game: the host still sees it');
SELECT t.as_user(t.id('player'));
SELECT t.eq(t.count('SELECT 1 FROM public.hosted_games WHERE id = ''hide-g1'''), 1, 'game: a player who joined still sees it');
SELECT t.as_user(t.id('host'));
SELECT t.ok(public.set_listing_hidden('game', 'hide-g1', false) IS NULL, 'game: the host shows it again');
SELECT t.as_anon();
SELECT t.eq(t.count('SELECT 1 FROM public.hosted_games WHERE id = ''hide-g1'''), 1, 'game: visible again');
SELECT t.reset();

-- A moderator's Hide holds against the host, and an unhide does not reveal the host's hide.
UPDATE public.hosted_games SET hidden_at = now() WHERE id = 'hide-g1';
SELECT t.as_user(t.id('host'));
SELECT t.ok(public.set_listing_hidden('game', 'hide-g1', false) IS NOT NULL, 'game: the host cannot undo a moderator''s hide');
SELECT t.eq(t.count('SELECT 1 FROM public.hosted_games WHERE id = ''hide-g1'''), 1, 'game: the host still sees their own hidden game');
SELECT t.as_user(t.id('player'));
SELECT t.eq(t.count('SELECT 1 FROM public.hosted_games WHERE id = ''hide-g1'''), 0, 'game: a player does not see a moderator-hidden game');
SELECT t.reset();
UPDATE public.hosted_games SET hidden_at = NULL WHERE id = 'hide-g1';
SELECT t.eq((SELECT hidden_at IS NULL FROM public.hosted_games WHERE id = 'hide-g1'), true, 'game: a moderator unhide shows it again');
SELECT t.as_user(t.id('host'));
SELECT t.lives('SELECT public.set_listing_hidden(''game'', ''hide-g1'', true)', 'game: hide again');
SELECT t.reset();
UPDATE public.hosted_games SET hidden_at = now() WHERE id = 'hide-g1';
UPDATE public.hosted_games SET hidden_at = NULL WHERE id = 'hide-g1';
SELECT t.eq((SELECT hidden_at IS NOT NULL FROM public.hosted_games WHERE id = 'hide-g1'), true,
  'game: a moderator unhide does not reveal what the host hid');
SELECT t.eq((SELECT moderator_hidden_at IS NULL FROM public.hosted_games WHERE id = 'hide-g1'), true, 'game: and the moderator hide is cleared');

-- A moderator (a signed-in person with the role) can write the columns too.
SELECT t.as_user(t.id('modone'));
SELECT t.lives('UPDATE public.hosted_games SET hidden_at = now() WHERE id = ''hide-g1''', 'game: a moderator can hide');
SELECT t.reset();

-- ---- teams and trainer profiles ---------------------------------------------
SELECT t.team('hide-squad', 'teamowner');
SELECT t.member('hide-squad', 'member'), t.member('hide-squad', 'manager', 'coach');
INSERT INTO public.teams (id, owner_id, kind, name, handle) VALUES ('hide-coach', t.id('coach'), 'coach', 'Coach Dana', 'dana');

SELECT t.as_anon();
SELECT t.eq(t.count('SELECT 1 FROM public.teams WHERE id = ''hide-squad'''), 1, 'team: a visitor sees a team');
SELECT t.as_user(t.id('stranger'));
SELECT t.throws('SELECT public.set_listing_hidden(''team'', ''hide-squad'', true)', 'LISTING_NOT_FOUND', 'team: a stranger cannot hide it');
SELECT t.as_user(t.id('member'));
SELECT t.throws('SELECT public.set_listing_hidden(''team'', ''hide-squad'', true)', 'LISTING_NOT_FOUND', 'team: nor an ordinary member');
SELECT t.as_user(t.id('teamowner'));
SELECT t.throws('SELECT public.set_listing_hidden(''trainer'', ''hide-squad'', true)', 'LISTING_NOT_FOUND', 'team: a team is not a trainer profile');
SELECT t.throws('UPDATE public.teams SET owner_hidden_at = now() WHERE id = ''hide-squad''', 'LISTING_HIDE_RPC_ONLY', 'team: no direct write');
SELECT t.lives('UPDATE public.teams SET tagline = ''Hello'' WHERE id = ''hide-squad''', 'team: ordinary edits still work');
SELECT t.ok(public.set_listing_hidden('team', 'hide-squad', true) IS NOT NULL, 'team: the owner hides it');
SELECT t.as_anon();
SELECT t.eq(t.count('SELECT 1 FROM public.teams WHERE id = ''hide-squad'''), 0, 'team: a visitor no longer sees it');
SELECT t.as_user(t.id('stranger'));
SELECT t.eq(t.count('SELECT 1 FROM public.teams WHERE id = ''hide-squad'''), 0, 'team: nor a signed-in stranger');
SELECT t.eq(t.count('SELECT 1 FROM public.team_members WHERE team_id = ''hide-squad'''), 0, 'team: nor its roster');
SELECT t.as_user(t.id('member'));
SELECT t.eq(t.count('SELECT 1 FROM public.teams WHERE id = ''hide-squad'''), 1, 'team: a member still sees it');
SELECT t.as_user(t.id('manager'));
SELECT t.eq(t.count('SELECT 1 FROM public.teams WHERE id = ''hide-squad'''), 1, 'team: a manager still sees it');
SELECT t.ok(public.set_listing_hidden('team', 'hide-squad', false) IS NULL, 'team: a manager can show it again');
SELECT t.as_anon();
SELECT t.eq(t.count('SELECT 1 FROM public.teams WHERE id = ''hide-squad'''), 1, 'team: visible again');
SELECT t.reset();

-- A moderator's hide on a team hides it from its own members too.
UPDATE public.teams SET hidden_at = now() WHERE id = 'hide-squad';
SELECT t.as_user(t.id('member'));
SELECT t.eq(t.count('SELECT 1 FROM public.teams WHERE id = ''hide-squad'''), 0, 'team: a moderator-hidden team is hidden from members');
SELECT t.as_user(t.id('teamowner'));
SELECT t.ok(public.set_listing_hidden('team', 'hide-squad', false) IS NOT NULL, 'team: the owner cannot undo a moderator''s hide');
SELECT t.reset();
UPDATE public.teams SET hidden_at = NULL WHERE id = 'hide-squad';

-- Trainer profile
SELECT t.as_user(t.id('stranger'));
SELECT t.throws('SELECT public.set_listing_hidden(''trainer'', ''hide-coach'', true)', 'LISTING_NOT_FOUND', 'trainer: a stranger cannot hide it');
SELECT t.as_user(t.id('coach'));
SELECT t.throws('SELECT public.set_listing_hidden(''team'', ''hide-coach'', true)', 'LISTING_NOT_FOUND', 'trainer: a trainer profile is not a team');
SELECT t.ok(public.set_listing_hidden('trainer', 'hide-coach', true) IS NOT NULL, 'trainer: the trainer hides their profile');
SELECT t.as_anon();
SELECT t.eq(t.count('SELECT 1 FROM public.teams WHERE id = ''hide-coach'''), 0, 'trainer: a visitor no longer sees it');
SELECT t.as_user(t.id('coach'));
SELECT t.eq(t.count('SELECT 1 FROM public.teams WHERE id = ''hide-coach'''), 1, 'trainer: they still see it');
SELECT t.ok(public.set_listing_hidden('trainer', 'hide-coach', false) IS NULL, 'trainer: and show it again');
SELECT t.reset();

-- ---- gyms --------------------------------------------------------------------
INSERT INTO public.trainer_orgs (id, owner_id, name, handle) VALUES (t.id('hide-gym'), t.id('gymowner'), 'Apex Hub', 'apexhub');
SELECT t.as_anon();
SELECT t.eq(t.count('SELECT 1 FROM public.trainer_orgs'), 1, 'gym: a visitor sees a gym');
SELECT t.as_user(t.id('stranger'));
SELECT t.throws(format('SELECT public.set_listing_hidden(''gym'', %L, true)', t.id('hide-gym')), 'LISTING_NOT_FOUND', 'gym: a stranger cannot hide it');
SELECT t.as_user(t.id('gymowner'));
SELECT t.throws(format('UPDATE public.trainer_orgs SET owner_hidden_at = now() WHERE id = %L', t.id('hide-gym')), 'LISTING_HIDE_RPC_ONLY', 'gym: no direct write');
SELECT t.ok(public.set_listing_hidden('gym', t.id('hide-gym')::text, true) IS NOT NULL, 'gym: the owner hides it');
SELECT t.as_anon();
SELECT t.eq(t.count('SELECT 1 FROM public.trainer_orgs'), 0, 'gym: a visitor no longer sees it');
SELECT t.as_user(t.id('stranger'));
SELECT t.eq(t.count('SELECT 1 FROM public.trainer_orgs'), 0, 'gym: nor a signed-in stranger');
SELECT t.as_user(t.id('gymowner'));
SELECT t.eq(t.count('SELECT 1 FROM public.trainer_orgs'), 1, 'gym: the owner still sees it');
SELECT t.ok(public.set_listing_hidden('gym', t.id('hide-gym')::text, false) IS NULL, 'gym: and shows it again');
SELECT t.reset();

-- ---- team posts ---------------------------------------------------------------
INSERT INTO public.team_posts (id, team_id, author_id, kind, title, body, moderation_status)
VALUES (t.id('hide-post'), 'hide-squad', t.id('member'), 'recap', 'Win', 'We won', 'approved');
UPDATE public.team_posts SET moderation_status = 'approved' WHERE id = t.id('hide-post');

SELECT t.as_anon();
SELECT t.eq(t.count(format('SELECT 1 FROM public.team_posts WHERE id = %L', t.id('hide-post'))), 1, 'post: a visitor sees an approved post');
SELECT t.as_user(t.id('stranger'));
SELECT t.throws(format('SELECT public.set_listing_hidden(''post'', %L, true)', t.id('hide-post')), 'LISTING_NOT_FOUND', 'post: a stranger cannot hide it');
SELECT t.as_user(t.id('member'));
SELECT t.throws(format('UPDATE public.team_posts SET owner_hidden_at = now() WHERE id = %L', t.id('hide-post')), 'LISTING_HIDE_RPC_ONLY', 'post: no direct write');
SELECT t.ok(public.set_listing_hidden('post', t.id('hide-post')::text, true) IS NOT NULL, 'post: its author hides it');
SELECT t.as_anon();
SELECT t.eq(t.count(format('SELECT 1 FROM public.team_posts WHERE id = %L', t.id('hide-post'))), 0, 'post: a visitor no longer sees it');
SELECT t.as_user(t.id('stranger'));
SELECT t.eq(t.count(format('SELECT 1 FROM public.team_posts WHERE id = %L', t.id('hide-post'))), 0, 'post: nor a stranger');
SELECT t.as_user(t.id('member'));
SELECT t.eq(t.count(format('SELECT 1 FROM public.team_posts WHERE id = %L', t.id('hide-post'))), 1, 'post: the author still sees it');
SELECT t.as_user(t.id('teamowner'));
SELECT t.eq(t.count(format('SELECT 1 FROM public.team_posts WHERE id = %L', t.id('hide-post'))), 1, 'post: the team''s manager still sees it');
SELECT t.ok(public.set_listing_hidden('post', t.id('hide-post')::text, false) IS NULL, 'post: a manager can show it again');
SELECT t.as_anon();
SELECT t.eq(t.count(format('SELECT 1 FROM public.team_posts WHERE id = %L', t.id('hide-post'))), 1, 'post: visible again');
SELECT t.reset();

-- ---- the function itself ---------------------------------------------------------
SELECT t.as_anon();
SELECT t.throws('SELECT public.set_listing_hidden(''game'', ''hide-g1'', true)', 'permission denied', 'a visitor cannot call it at all');
SELECT t.reset();
SELECT t.as_user(t.id('host'));
SELECT t.throws('SELECT public.set_listing_hidden(''nothing'', ''x'', true)', 'UNKNOWN_LISTING_KIND', 'an unknown kind is refused');
SELECT t.reset();

ROLLBACK;
