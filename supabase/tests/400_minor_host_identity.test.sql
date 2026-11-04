-- G4: a minor host's identity is not retrievable by unrelated users; organizer details come through get_game_organizer; a minor cannot host
-- while their profile is readable beyond their relations.
BEGIN;
SELECT t.person('teenhost', 17), t.person('guardian', 40), t.person('player', 29), t.person('teenmate', 16), t.person('stranger', 33),
       t.person('teenstranger', 15), t.person('modone', 39), t.person('adminone', 45), t.person('adulthost', 36), t.person('kidstranger', 11),
       t.person('othermgr', 41);
SELECT t.guardian('guardian', 'teenhost');
INSERT INTO public.user_roles (user_id, role) VALUES (t.id('modone'), 'moderator'), (t.id('adminone'), 'admin');
ALTER TABLE public.hosted_games DISABLE TRIGGER validate_hosted_game_age_range;

-- a game a minor hosts (inserted directly: the approval rules are tested in 330/335) and one an adult hosts
SET LOCAL session_replication_role = replica;
INSERT INTO public.hosted_games (id, host_id, sport, title, date, min_age, max_age, location, neighborhood, host_snapshot) VALUES
  ('mh', t.id('teenhost'), 'basketball', 'U15 run', now()+interval '3 days', 12, 15, 'Gym, 1 A St', 'North', '{"neutral": true}'::jsonb),
  ('mhp', t.id('teenhost'), 'basketball', 'Private teen run', now()+interval '3 days', 12, 15, 'Gym, 2 A St', 'North', '{"neutral": true}'::jsonb),
  ('ah', t.id('adulthost'), 'basketball', 'Adult host run', now()+interval '3 days', 12, 15, 'Gym, 3 A St', 'South', '{"name":"Adulthost"}'::jsonb);
UPDATE public.hosted_games SET is_private = true WHERE id = 'mhp';
INSERT INTO public.game_participants (game_id, user_id) VALUES ('mh', t.id('player')), ('mh', t.id('teenmate'));
SET LOCAL session_replication_role = origin;
-- (reviews about minors are covered by PRIV-1, test 310; that migration is a separate pull request)

CREATE FUNCTION t.org(g text) RETURNS text LANGUAGE sql AS $f$
  SELECT COALESCE((SELECT kind || '|' || COALESCE(display_name, '-') || '|' || relation FROM public.get_game_organizer(g)), 'none') $f$;
GRANT EXECUTE ON FUNCTION t.org(text) TO anon, authenticated;
CREATE FUNCTION t.nm(u text) RETURNS text LANGUAGE sql AS $f$ SELECT COALESCE((SELECT display_name FROM public.visible_avatars(ARRAY[t.id(u)])), '-') $f$;
GRANT EXECUTE ON FUNCTION t.nm(text) TO anon, authenticated;

-- ================= 1. who can learn the minor host's name =================
SELECT t.as_anon();
SELECT t.eq(t.nm('teenhost'), '-', 'anonymous: visible_avatars gives no name');
SELECT t.throws($q$SELECT * FROM public.get_game_organizer('mh')$q$, 'permission denied', 'anonymous: get_game_organizer is not callable');
SELECT t.eq(t.count('SELECT 1 FROM public.profiles WHERE id = ''' || t.id('teenhost') || ''''), 0, 'anonymous: the profile is not readable');
SELECT t.eq(t.count('SELECT 1 FROM public.hosted_games WHERE id = ''mh'''), 0, 'anonymous: the youth game itself is not listed');
SELECT t.as_user(t.id('stranger'));
SELECT t.eq(t.nm('teenhost'), '-', 'signed-in adult stranger: no name');
SELECT t.eq(t.org('mh'), 'neutral|-|none', 'signed-in adult stranger: a neutral organizer');
SELECT t.eq(t.count('SELECT 1 FROM public.profiles WHERE id = ''' || t.id('teenhost') || ''''), 0, 'signed-in adult stranger: the profile is not readable');
SELECT t.ok((SELECT host_snapshot ->> 'name' IS NULL AND host_snapshot ->> 'username' IS NULL AND host_snapshot ->> 'avatar' IS NULL FROM public.hosted_games WHERE id = 'mh'), 'the game''s host snapshot carries no name, username or photo');
SELECT t.eq(t.org('mhp'), 'none', 'a private game reveals nothing, not even that it exists');
SELECT t.eq(t.org('no-such-game'), 'none', 'nor does an unknown game');
SELECT t.eq(t.count('SELECT 1 FROM public.follows WHERE followee_id = ''' || t.id('teenhost') || ''''), 0, 'nor follow relationships');
SELECT t.as_user(t.id('teenstranger'));
SELECT t.eq(t.nm('teenhost'), '-', 'signed-in teen stranger: no name');
SELECT t.eq(t.org('mh'), 'neutral|-|none', 'signed-in teen stranger: a neutral organizer');
SELECT t.as_user(t.id('kidstranger'));
SELECT t.eq(t.org('mh'), 'neutral|-|none', 'signed-in under-13 stranger: a neutral organizer');
SELECT t.as_user(t.id('player'));
SELECT t.eq(t.nm('teenhost'), 'Teenhost', 'a player in the game: the name');
SELECT t.eq(t.org('mh'), 'minor|Teenhost|related', 'a player in the game: organizer details');
SELECT t.as_user(t.id('teenmate'));
SELECT t.eq(t.org('mh'), 'minor|Teenhost|related', 'a teen player in the game: organizer details');
SELECT t.as_user(t.id('guardian'));
SELECT t.eq(t.org('mh'), 'minor|Teenhost|guardian', 'the verified guardian: organizer details');
SELECT t.as_user(t.id('teenhost'));
SELECT t.eq(t.org('mh'), 'minor|Teenhost|self', 'the host themself');
SELECT t.eq(t.org('mhp'), 'minor|Teenhost|self', 'and their own private game');
SELECT t.as_user(t.id('modone'));
SELECT t.eq(t.org('mh'), 'minor|Teenhost|staff', 'a moderator');
SELECT t.as_user(t.id('adminone'));
SELECT t.eq(t.org('mh'), 'minor|Teenhost|staff', 'an administrator');
SELECT t.as_user(t.id('stranger'));
SELECT t.eq(t.org('ah'), 'adult|Adulthost|viewer', 'an adult host is shown as before');
SELECT t.as_user(t.id('othermgr'));
SELECT t.eq(t.org('mh'), 'neutral|-|none', 'a guardian or manager of someone else: neutral');
SELECT t.reset();

-- ================= 2. exposure paths =================
SELECT t.eq((SELECT count(*)::int FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename IN ('profiles', 'visible_avatars', 'reviews', 'privacy_preferences')), 0, 'realtime does not carry profiles, reviews or privacy preferences');
SELECT t.eq(has_function_privilege('anon', 'public.get_game_organizer(text)', 'EXECUTE'), false, 'anon cannot call the organizer lookup');
SELECT t.eq(has_function_privilege('authenticated', 'private_sec.organizer_details(uuid,uuid)', 'EXECUTE'), false, 'the helper that takes a chosen viewer is not callable by clients');

-- ================= 3. a minor cannot host while their profile is readable beyond their relations =================
SELECT t.person('teen2', 16); SELECT t.guardian('guardian', 'teen2');
SELECT t.as_user(t.id('guardian'));
SELECT set_config('t.ap2', public.grant_minor_hosting_approval(t.id('teen2'))::text, false);
SELECT t.reset();
UPDATE public.privacy_preferences SET profile_visibility = 'members' WHERE user_id = t.id('teen2');
INSERT INTO public.privacy_preferences (user_id, profile_visibility) SELECT t.id('teen2'), 'members' WHERE NOT EXISTS (SELECT 1 FROM public.privacy_preferences WHERE user_id = t.id('teen2'));
SELECT t.eq(private_sec.profile_visibility_of(t.id('teen2')), 'members', 'setup: the teen''s profile is visible to members');
SELECT t.as_user(t.id('teen2'));
SELECT t.throws(format($q$INSERT INTO public.hosted_games (id, host_id, sport, title, date, min_age, max_age, hosting_approval_id) VALUES ('h2', %L, 'basketball', 'Teen run', now()+interval '3 days', 8, 14, %L)$q$, t.id('teen2'), current_setting('t.ap2')),
  'MINOR_HOST_PROFILE_VISIBLE', 'a teen with a members-visible profile cannot publish a game that includes young people');
SELECT t.lives($q$UPDATE public.privacy_preferences SET profile_visibility = 'private' WHERE user_id = (SELECT auth.uid())$q$, 'they make the profile private');
SELECT t.lives(format($q$INSERT INTO public.hosted_games (id, host_id, sport, title, date, min_age, max_age, hosting_approval_id) VALUES ('h2', %L, 'basketball', 'Teen run', now()+interval '3 days', 8, 14, %L)$q$, t.id('teen2'), current_setting('t.ap2')),
  'and can publish');
SELECT t.throws($q$UPDATE public.privacy_preferences SET profile_visibility = 'members' WHERE user_id = (SELECT auth.uid())$q$, 'MINOR_HOST_PROFILE_VISIBLE', 'while the game is active the profile cannot be made visible again');
SELECT t.lives($q$UPDATE public.privacy_preferences SET profile_visibility = 'private' WHERE user_id = (SELECT auth.uid())$q$, 'staying private is fine');
SELECT t.reset();
SELECT t.throws(format($q$UPDATE public.child_controls SET public_profile = true, public_profile_authorized_by = %L WHERE child_user_id = %L$q$, t.id('guardian'), t.id('teen2')),
  'MINOR_HOST_PROFILE_VISIBLE', 'a guardian cannot make the hosting teen''s profile public (whatever path writes the control)');
UPDATE public.hosted_games SET cancelled_at = now() WHERE id = 'h2';
SELECT t.as_user(t.id('teen2'));
SELECT t.throws($q$UPDATE public.privacy_preferences SET profile_visibility = 'members' WHERE user_id = (SELECT auth.uid())$q$, 'MINOR_HOST_PROFILE_VISIBLE', 'cancelling the game does not release it: the game row (and the host id) stays readable, so the profile stays private until they are an adult');
SELECT t.reset();

-- adults are unaffected
UPDATE public.privacy_preferences SET profile_visibility = 'public' WHERE user_id = t.id('adulthost');
INSERT INTO public.privacy_preferences (user_id, profile_visibility) SELECT t.id('adulthost'), 'public' WHERE NOT EXISTS (SELECT 1 FROM public.privacy_preferences WHERE user_id = t.id('adulthost'));
SELECT t.as_user(t.id('adulthost'));
SELECT t.lives($q$INSERT INTO public.hosted_games (id, host_id, sport, title, date, min_age, max_age) VALUES ('ah2', (SELECT auth.uid()), 'basketball', 'Adult run', now()+interval '3 days', 8, 14)$q$, 'an adult with a public profile can host a youth-inclusive game as before');
SELECT t.reset();
ROLLBACK;
