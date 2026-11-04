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
INSERT INTO public.highlight_reels (user_id, video_path) VALUES (t.id('teenhost'), 'p/v.mp4');
INSERT INTO public.team_posts (team_id, author_id, kind, title) VALUES ('pubteam', t.id('teenhost'), 'announcement', 'hello');
INSERT INTO public.skill_votes (game_id, voter_id, subject_id, sport, vote) VALUES ('mh', t.id('adulthost'), t.id('teenhost'), 'basketball', 1);
INSERT INTO public.follows (follower_id, followee_id) VALUES (t.id('teenhost'), t.id('adulthost')), (t.id('follower'), t.id('teenhost'));
SET LOCAL session_replication_role = origin;

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
SELECT t.eq(t.seen('skill_ratings', 'user_id', 'adulthost'), 1, 'anonymous: an adult host''s rating is still public (unchanged)');
SELECT t.as_user(t.id('stranger'));
SELECT t.eq(t.seen('team_members', 'user_id'), 0, 'stranger: no team roster row');
SELECT t.eq(t.seen('skill_ratings', 'user_id'), 0, 'stranger: no skill rating');
SELECT t.eq(t.seen('highlight_reels', 'user_id'), 0, 'stranger: no reel');
SELECT t.eq(t.seen('team_posts', 'author_id'), 0, 'stranger: no team post by this author');
SELECT t.eq(t.seen('skill_votes', 'subject_id'), 0, 'stranger: no skill vote');
SELECT t.eq(t.seen('follows', 'follower_id'), 0, 'stranger: no follow');
SELECT t.eq(t.seen('team_members', 'user_id', 'adulthost'), 1, 'stranger: an adult host''s roster row is visible (unchanged)');
SELECT t.eq(t.seen('skill_ratings', 'user_id', 'adulthost'), 1, 'stranger: an adult host''s rating is visible (unchanged)');
SELECT t.eq(t.seen('team_members', 'user_id', 'quiet'), 1, 'stranger: a 17-year-old who hosts nothing is listed as before');
SELECT t.eq(t.seen('skill_ratings', 'user_id', 'quiet'), 1, 'stranger: and their rating is visible as before');
SELECT t.as_user(t.id('teenstranger'));
SELECT t.eq(t.seen('team_members', 'user_id'), 0, 'teen stranger: no team roster row');
SELECT t.eq(t.seen('skill_ratings', 'user_id'), 0, 'teen stranger: no skill rating');
SELECT t.eq(t.seen('team_posts', 'author_id'), 0, 'teen stranger: no team post by this author');

-- ================= related people keep what they need =================
SELECT t.as_user(t.id('teenhost'));
SELECT t.eq(t.seen('team_members', 'user_id'), 1, 'the host sees their own roster row');
SELECT t.eq(t.seen('skill_ratings', 'user_id'), 1, 'and their own rating');
SELECT t.as_user(t.id('guardian'));
SELECT t.eq(t.seen('team_members', 'user_id'), 1, 'the guardian sees the roster row');
SELECT t.eq(t.seen('skill_ratings', 'user_id'), 1, 'and the rating');
SELECT t.as_user(t.id('mate'));
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

-- ================= the restriction ends with the game =================
UPDATE public.hosted_games SET cancelled_at = now() WHERE id = 'mh';
SELECT t.as_user(t.id('stranger'));
SELECT t.eq(t.seen('team_members', 'user_id'), 1, 'after the game is cancelled the roster row is listed as before');
SELECT t.eq(t.seen('skill_ratings', 'user_id'), 1, 'and the rating is visible as before');
SELECT t.reset();

-- ================= grants =================
SELECT t.eq(has_function_privilege('anon', 'private_sec.minor_host_hidden(uuid)', 'EXECUTE'), true, 'the helper must be callable by anonymous policy evaluation');
ROLLBACK;
