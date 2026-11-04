-- R1: the account id of a 17-year-old who hosts a youth-inclusive game is in the public game row. This test follows that id into every other
-- readable table and asserts that an unrelated account learns nothing more about the person from it, while related people keep access.
BEGIN;
SELECT t.person('teenhost', 17), t.person('quiet', 17), t.person('stranger', 33), t.person('teenstranger', 15), t.person('guardian', 40),
       t.person('adulthost', 36), t.person('mgr', 38), t.person('mate', 29), t.person('player', 27), t.person('modone', 39),
       t.person('adminone', 45), t.person('follower', 26);
SELECT t.guardian('guardian', 'teenhost');
SELECT t.team('pubteam', 'mgr');
INSERT INTO public.user_roles (user_id, role) VALUES (t.id('modone'), 'moderator'), (t.id('adminone'), 'admin');
SET LOCAL session_replication_role = replica;
INSERT INTO public.hosted_games (id, host_id, sport, title, date, min_age, max_age, location, neighborhood, host_snapshot) VALUES
  ('mh', t.id('teenhost'), 'basketball', 'U15 run', now() + interval '3 days', 12, 15, 'Gym, 1 A St', 'North', '{"neutral": true}'::jsonb),
  ('ah', t.id('adulthost'), 'basketball', 'Kids run', now() + interval '3 days', 12, 15, 'Gym, 2 A St', 'South', '{"name":"Adulthost"}'::jsonb);
INSERT INTO public.game_participants (game_id, user_id) VALUES ('mh', t.id('player'));
INSERT INTO public.team_members (team_id, user_id) VALUES ('pubteam', t.id('teenhost')), ('pubteam', t.id('quiet')), ('pubteam', t.id('mate')), ('pubteam', t.id('adulthost'));
INSERT INTO public.skill_ratings (user_id, sport, mu, sigma, low, high, status, label)
  SELECT t.id(h), 'basketball', 25, 8, 1, 5, 'established', 'x' FROM unnest(ARRAY['teenhost', 'quiet', 'adulthost']) h;
INSERT INTO public.team_posts (team_id, author_id, kind, title, moderation_status) VALUES ('pubteam', t.id('teenhost'), 'recap', 'Nice game', 'approved'), ('pubteam', t.id('quiet'), 'recap', 'Quiet recap', 'approved');
INSERT INTO public.post_comments (subject_type, subject_id, author_id, body, moderation_status) SELECT 'team_post', id::text, t.id('teenhost'), 'gg', 'approved' FROM public.team_posts WHERE author_id = t.id('quiet');
INSERT INTO public.skill_votes (game_id, voter_id, subject_id, sport, vote) VALUES ('mh', t.id('adulthost'), t.id('teenhost'), 'basketball', 1);
INSERT INTO public.follows (follower_id, followee_id) VALUES (t.id('teenhost'), t.id('adulthost')), (t.id('follower'), t.id('teenhost'));
SET LOCAL session_replication_role = origin;
SELECT t.reel('teenhost', 'a');
SELECT t.reel('quiet', 'q');

CREATE FUNCTION t.seen(tbl text, col text, who text DEFAULT 'teenhost') RETURNS integer LANGUAGE plpgsql AS $f$
DECLARE n integer;
BEGIN EXECUTE format('SELECT count(*) FROM public.%I WHERE %I = %L', tbl, col, t.id(who)) INTO n; RETURN n;
EXCEPTION WHEN insufficient_privilege THEN RETURN 0;  -- refused outright counts as nothing learned
END $f$;
GRANT EXECUTE ON FUNCTION t.seen(text, text, text) TO anon, authenticated;

-- ================= unrelated viewers learn nothing about the host through other tables =================
SELECT t.as_anon();
SELECT t.eq(t.seen('team_members', 'user_id'), 0, 'anonymous: no team roster row');
SELECT t.eq(t.seen('skill_ratings', 'user_id'), 0, 'anonymous: no skill rating');
SELECT t.eq(t.seen('highlight_reels', 'user_id'), 0, 'anonymous: no reel');
SELECT t.eq(t.seen('team_posts', 'author_id'), 0, 'anonymous: no team post by this author');
SELECT t.eq(t.seen('skill_votes', 'subject_id'), 0, 'anonymous: no skill vote');
SELECT t.eq(t.seen('follows', 'follower_id'), 0, 'anonymous: no follow');
SELECT t.eq(t.seen('post_comments', 'author_id'), 0, 'anonymous: no comment by this author');
SELECT t.eq(t.seen('skill_ratings', 'user_id', 'adulthost'), 1, 'anonymous: an adult host''s rating is still public (unchanged)');
SELECT t.as_user(t.id('stranger'));
SELECT t.eq(t.seen('team_members', 'user_id'), 0, 'stranger: no team roster row');
SELECT t.eq(t.seen('skill_ratings', 'user_id'), 0, 'stranger: no skill rating');
SELECT t.eq(t.seen('highlight_reels', 'user_id'), 0, 'stranger: no reel');
SELECT t.eq(t.seen('team_posts', 'author_id'), 0, 'stranger: no team post by this author');
SELECT t.eq(t.seen('skill_votes', 'subject_id'), 0, 'stranger: no skill vote');
SELECT t.eq(t.seen('follows', 'follower_id'), 0, 'stranger: no follow');
SELECT t.eq(t.seen('post_comments', 'author_id'), 0, 'stranger: no comment by this author');
SELECT t.eq(t.seen('highlight_reels', 'user_id', 'quiet'), 1, 'stranger: a 17-year-old who hosts nothing keeps their members-visible reel (unchanged)');
SELECT t.eq(t.seen('team_posts', 'author_id', 'quiet'), 1, 'stranger: and their public team post');
SELECT t.eq(t.seen('team_members', 'user_id', 'adulthost'), 1, 'stranger: an adult host''s roster row is visible (unchanged)');
SELECT t.eq(t.seen('skill_ratings', 'user_id', 'adulthost'), 1, 'stranger: an adult host''s rating is visible (unchanged)');
SELECT t.eq(t.seen('team_members', 'user_id', 'quiet'), 1, 'stranger: a 17-year-old who hosts nothing is listed as before');
SELECT t.eq(t.seen('skill_ratings', 'user_id', 'quiet'), 1, 'stranger: and their rating is visible as before');
SELECT t.as_user(t.id('teenstranger'));
SELECT t.eq(t.seen('team_members', 'user_id'), 0, 'teen stranger: no team roster row');
SELECT t.eq(t.seen('skill_ratings', 'user_id'), 0, 'teen stranger: no skill rating');
SELECT t.eq(t.seen('team_posts', 'author_id'), 0, 'teen stranger: no team post by this author');
SELECT t.eq(t.seen('highlight_reels', 'user_id'), 0, 'teen stranger: no reel');

-- ================= related people keep what they need =================
SELECT t.as_user(t.id('teenhost'));
SELECT t.eq(t.seen('team_posts', 'author_id'), 1, 'the host sees their own post');
SELECT t.eq(t.seen('team_members', 'user_id'), 1, 'the host sees their own roster row');
SELECT t.eq(t.seen('skill_ratings', 'user_id'), 1, 'and their own rating');
SELECT t.as_user(t.id('guardian'));
SELECT t.eq(t.seen('team_members', 'user_id'), 1, 'the guardian sees the roster row');
SELECT t.eq(t.seen('skill_ratings', 'user_id'), 1, 'and the rating');
SELECT t.as_user(t.id('mate'));
SELECT t.eq(t.seen('team_posts', 'author_id'), 1, 'a teammate sees the host''s team post');
SELECT t.eq(t.seen('highlight_reels', 'user_id'), 1, 'and the reel');
SELECT t.eq(t.seen('team_members', 'user_id'), 1, 'a teammate sees the roster row');
SELECT t.eq(t.seen('skill_ratings', 'user_id'), 1, 'and the rating');
SELECT t.as_user(t.id('mgr'));
SELECT t.eq(t.seen('team_members', 'user_id'), 1, 'the team manager sees the roster row');
SELECT t.eq(t.seen('skill_ratings', 'user_id'), 1, 'and the rating');
SELECT t.as_user(t.id('player'));
SELECT t.eq(t.seen('skill_ratings', 'user_id'), 1, 'a player in the game sees the rating');
SELECT t.as_user(t.id('follower'));
SELECT t.eq(t.seen('skill_ratings', 'user_id'), 1, 'an accepted follower sees the rating');
SELECT t.as_user(t.id('modone'));
SELECT t.eq(t.seen('team_members', 'user_id'), 1, 'a moderator sees the roster row');
SELECT t.eq(t.seen('skill_ratings', 'user_id'), 1, 'and the rating');
SELECT t.as_user(t.id('adminone'));
SELECT t.eq(t.seen('skill_ratings', 'user_id'), 1, 'an administrator sees the rating');
SELECT t.reset();

-- ================= the id stays what it is; nothing else gives a name =================
SELECT t.as_user(t.id('stranger'));
SELECT t.ok((SELECT host_id = t.id('teenhost') FROM public.hosted_games WHERE id = 'mh'), 'the game row still carries the owner id (ownership and policies depend on it)');
SELECT t.eq((SELECT display_name FROM public.visible_avatars(ARRAY[t.id('teenhost')])), NULL, 'the id still gives no name');
SELECT t.eq(t.count('SELECT 1 FROM public.profiles WHERE id = ''' || t.id('teenhost') || ''''), 0, 'nor a profile');
SELECT t.reset();

-- ================= the restriction does not end with the game: the game row, and the id in it, stay readable
UPDATE public.hosted_games SET cancelled_at = now() WHERE id = 'mh';
SELECT t.as_user(t.id('stranger'));
SELECT t.eq(t.seen('team_members', 'user_id'), 0, 'after the game is cancelled the roster row is still hidden from strangers');
SELECT t.eq(t.seen('skill_ratings', 'user_id'), 0, 'and the rating');
SELECT t.eq(t.seen('team_posts', 'author_id'), 0, 'and the team post');
SELECT t.eq(t.seen('highlight_reels', 'user_id'), 0, 'and the reel');
SELECT t.eq(t.seen('post_comments', 'author_id'), 0, 'and comments');
SELECT t.reset();
UPDATE public.hosted_games SET completed_at = now(), date = now() - interval '30 days' WHERE id = 'mh';
SELECT t.as_user(t.id('stranger'));
SELECT t.eq(t.seen('team_members', 'user_id'), 0, 'a completed game from last month changes nothing');
SELECT t.reset();

-- ================= comments and reactions by the host do not resolve the id (second review round)
SET LOCAL session_replication_role = replica;
INSERT INTO public.post_comments (subject_type, subject_id, author_id, body, moderation_status) VALUES ('game', 'ah', t.id('teenhost'), 'see you there', 'approved');
SET LOCAL session_replication_role = origin;
SELECT t.as_anon();
SELECT t.eq(t.seen('post_comments', 'author_id'), 0, 'anonymous: a comment by the host on an adult''s game is hidden');
SELECT t.as_user(t.id('stranger'));
SELECT t.eq(t.seen('post_comments', 'author_id'), 0, 'stranger: the same');
SELECT t.as_user(t.id('teenhost'));
SELECT t.ok(t.seen('post_comments', 'author_id') >= 1, 'the host sees their own comments');
SELECT t.as_user(t.id('mate'));
SELECT t.ok(t.seen('post_comments', 'author_id') >= 1, 'a teammate sees them');
SELECT t.reset();

-- ================= a team the host owns would link the id to a name (teams.owner_id is readable)
SELECT t.as_user(t.id('teenhost'));
SELECT t.throws($q$INSERT INTO public.teams (id, kind, name, handle, owner_id) VALUES ('mine', 'team', 'Teen Team', 'teenteam', auth.uid())$q$, 'MINOR_HOST_TEAM_OWNER', 'a minor who has hosted a youth game cannot create a team they own');
SELECT t.as_user(t.id('quiet'));
SELECT t.lives($q$INSERT INTO public.teams (id, kind, name, handle, owner_id) VALUES ('quietteam', 'team', 'Quiet Team', 'quietteam', auth.uid())$q$, 'a minor who has never hosted can');
SELECT t.reset();
SET LOCAL session_replication_role = replica;
INSERT INTO public.hosted_games (id, host_id, sport, title, date, min_age, max_age, location, neighborhood, host_snapshot) VALUES
  ('q1', t.id('quiet'), 'basketball', 'Quiet run', now() + interval '4 days', 12, 15, 'Gym', 'North', '{"neutral": true}'::jsonb);
SET LOCAL session_replication_role = origin;
SELECT t.throws($q$UPDATE public.hosted_games SET max_age = 15 WHERE id = 'q1'$q$, 'MINOR_HOST_TEAM_OWNER', 'and then cannot publish a youth game while owning a visible team');
UPDATE public.teams SET hidden_at = now() WHERE id = 'quietteam';
SELECT t.lives($q$UPDATE public.hosted_games SET max_age = 15 WHERE id = 'q1'$q$, 'unless the team is hidden');

-- ================= grants =================
SELECT t.eq(has_function_privilege('anon', 'private_sec.minor_host_hidden(uuid)', 'EXECUTE'), true, 'the helper must be callable by anonymous policy evaluation');
ROLLBACK;
