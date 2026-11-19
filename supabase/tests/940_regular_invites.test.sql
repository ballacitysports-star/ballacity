-- WP 3.2a (20261123100000_regular_invites): a host may invite an adult who played in one of their games in the last 90 days,
-- without an open availability post, unless blocked, suspended, opted out, outside the game's age range or set to "nobody";
-- minors keep the post-based path; the host's list of regulars shows where each stands for the game.
BEGIN;
SELECT t.person('host', 35), t.person('other', 40), t.person('reg', 25), t.person('reg2', 33), t.person('old', 29),
       t.person('teen', 17), t.person('opt', 31), t.person('blk', 30), t.person('sus', 28), t.person('nobody', 27),
       t.person('cxl', 26), t.person('stranger', 32), t.person('poster', 34);

SET LOCAL session_replication_role = replica;
INSERT INTO public.hosted_games (id, host_id, sport, title, date, max_players, min_age, cancelled_at) VALUES
  ('past1',  t.id('host'),  'basketball', 'Last week',      now() - interval '10 days',  10, NULL, NULL),
  ('past2',  t.id('host'),  'basketball', 'Two weeks ago',  now() - interval '17 days',  10, NULL, NULL),
  ('ancient', t.id('host'), 'basketball', 'Months ago',     now() - interval '120 days', 10, NULL, NULL),
  ('pastcx', t.id('host'),  'basketball', 'Called off',     now() - interval '5 days',   10, NULL, now() - interval '6 days'),
  ('next',   t.id('host'),  'basketball', 'Next week',      now() + interval '3 days',   10, NULL, NULL),
  ('next30', t.id('host'),  'basketball', 'Thirty plus',    now() + interval '3 days',   10, 30,   NULL),
  ('onext',  t.id('other'), 'basketball', 'Other run',      now() + interval '3 days',   10, NULL, NULL);
INSERT INTO public.game_participants (game_id, user_id) VALUES
  ('past1', t.id('reg')), ('past2', t.id('reg')), ('past1', t.id('reg2')), ('past1', t.id('teen')), ('past1', t.id('opt')),
  ('past1', t.id('blk')), ('past1', t.id('sus')), ('past1', t.id('nobody')), ('ancient', t.id('old')), ('pastcx', t.id('cxl')),
  ('next', t.id('reg2'));
UPDATE public.privacy_preferences SET allow_regular_invites = false WHERE user_id = t.id('opt');
UPDATE public.privacy_preferences SET allow_invites = 'nobody' WHERE user_id = t.id('nobody');
INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES (t.id('blk'), t.id('host'));
UPDATE public.profiles SET suspended_at = now() WHERE id = t.id('sus');
INSERT INTO public.player_availabilities (id, user_id, sports, skill_level, status, time_slots, timezone, last_confirmed_at)
  VALUES (md5('post:poster')::uuid, t.id('poster'), ARRAY['Basketball'], 'All Levels', 'open',
          '[{"weekday":2,"start":"18:00","end":"20:00"}]'::jsonb, 'America/New_York', now());
SET LOCAL session_replication_role = origin;

CREATE FUNCTION t.invite(_game text, _who text) RETURNS text LANGUAGE sql AS $f$
  SELECT format('SELECT public.game_invite_player(%L, %L)', _game, t.id(_who))
$f$;

-- ---- the setting and the privileges -------------------------------------------------------------------------------------------
SELECT t.eq((SELECT column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'privacy_preferences'
             AND column_name = 'allow_regular_invites'), 'true', 'the setting is on by default');
SELECT t.eq(has_function_privilege('anon', 'public.my_regular_players(text)', 'EXECUTE'), false, 'visitors cannot list regulars');
SELECT t.eq(has_function_privilege('authenticated', 'private_sec.regular_invitable(uuid,uuid)', 'EXECUTE'), false,
  'members cannot ask the helper directly');

-- ---- who can be invited without a post ------------------------------------------------------------------------------------------
SELECT t.as_user(t.id('host'));
SELECT t.lives(t.invite('next', 'reg'), 'an adult who played last week is invited without a post');
SELECT t.reset();
SELECT t.eq((SELECT count(*)::int FROM public.game_invites WHERE game_id = 'next' AND invitee_id = t.id('reg') AND availability_id IS NULL), 1,
  'the invitation names no post');
SELECT t.eq((SELECT count(*)::int FROM public.notifications WHERE user_id = t.id('reg') AND type = 'game_invite'), 1,
  'and the player is told, as for any invitation');
SELECT t.as_user(t.id('host'));
SELECT t.throws(t.invite('next', 'stranger'), 'INVITE_NOT_AVAILABLE', 'someone who never played with the host and has no post: no');
SELECT t.throws(t.invite('next', 'old'), 'INVITE_NOT_AVAILABLE', 'someone who last played 120 days ago: no');
SELECT t.throws(t.invite('next', 'cxl'), 'INVITE_NOT_AVAILABLE', 'a place in a cancelled game does not count');
SELECT t.throws(t.invite('next', 'teen'), 'INVITE_NOT_AVAILABLE', 'a 17-year-old keeps the post-based path');
SELECT t.throws(t.invite('next', 'opt'), 'INVITE_NOT_AVAILABLE', 'a player who turned it off: no');
SELECT t.throws(t.invite('next', 'blk'), 'INVITE_NOT_AVAILABLE', 'a player who blocked the host: no');
SELECT t.throws(t.invite('next', 'sus'), 'INVITE_NOT_AVAILABLE', 'a suspended account: no');
SELECT t.throws(t.invite('next', 'nobody'), 'INVITE_NOT_AVAILABLE', 'a player whose invitations are set to nobody: no');
SELECT t.throws(t.invite('next30', 'reg'), 'INVITE_NOT_AVAILABLE', 'outside the game''s age range: no');
SELECT t.throws(t.invite('next', 'reg2'), 'ALREADY_IN_GAME', 'someone already in the game is not invited again');
SELECT t.lives(t.invite('next', 'poster'), 'the post-based path still works');
SELECT t.as_user(t.id('other'));
SELECT t.throws(t.invite('onext', 'reg'), 'INVITE_NOT_AVAILABLE', 'another host cannot invite this host''s regulars');
SELECT t.reset();

-- the player turns the setting back on: invitable again
SELECT t.as_user(t.id('opt'));
SELECT t.lives($q$UPDATE public.privacy_preferences SET allow_regular_invites = true WHERE user_id = auth.uid()$q$, 'a player changes their own setting');
SELECT t.as_user(t.id('host'));
SELECT t.lives(t.invite('next', 'opt'), 'and can be invited again');
SELECT t.as_user(t.id('reg'));
SELECT t.eq(t.changed(format($q$UPDATE public.privacy_preferences SET allow_regular_invites = false WHERE user_id = %L$q$, t.id('opt'))), 0,
  'nobody changes another member''s setting');
SELECT t.reset();

-- ---- the host's list --------------------------------------------------------------------------------------------------------------
SELECT t.as_user(t.id('host'));
SELECT t.eq((SELECT array_agg(status ORDER BY status)::text FROM public.my_regular_players('next')
              WHERE user_id IN (t.id('reg'), t.id('reg2'), t.id('opt'))), '{in_game,invited,invited}',
  'the list shows who is in the game and who is invited');
SELECT t.eq((SELECT count(*)::int FROM public.my_regular_players('next')
              WHERE user_id IN (t.id('stranger'), t.id('old'), t.id('cxl'), t.id('teen'), t.id('blk'), t.id('sus'))), 0,
  'people who are not regulars, minors, blocked or suspended accounts are not listed');
SELECT t.eq((SELECT games FROM public.my_regular_players('next') WHERE user_id = t.id('reg')), 2, 'it counts the games played together');
SELECT t.as_user(t.id('other'));
SELECT t.throws($q$SELECT * FROM public.my_regular_players('next')$q$, 'NOT_GAME_HOST', 'only the game''s host sees the list');
SELECT t.as_anon();
SELECT t.throws($q$SELECT * FROM public.my_regular_players('next')$q$, 'permission denied', 'visitors cannot');
SELECT t.reset();

-- bulk invites follow the same rule
SELECT t.as_user(t.id('host'));
SELECT t.lives(format('SELECT public.game_invite_players(%L, ARRAY[%L, %L]::uuid[])', 'next30', t.id('reg'), t.id('stranger')),
  'a bulk invitation goes through');
SELECT t.reset();
SELECT t.eq((SELECT count(*)::int FROM public.game_invites WHERE game_id = 'next30'), 0, 'and refuses the same players one by one');

ROLLBACK;
