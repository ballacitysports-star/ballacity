-- WP 2.0 (20261119100000_game_invites): only a game's host invites to it, and only while it is upcoming, open and has room; a
-- player the host may not reach gets one neutral answer; the notification carries the real game; accepting approves the place
-- request through every insert check; a private game opens to its invitee; the old contact-request path cannot name a game the
-- sender does not host or forge its details.
BEGIN;
SELECT t.person('host', 35), t.person('other', 31), t.person('ana', 28), t.person('ben', 30), t.person('cal', 40),
       t.person('dee', 25), t.person('eve', 16), t.person('fay', 29), t.person('gus', 33);

SET LOCAL session_replication_role = replica;
INSERT INTO public.hosted_games (id, host_id, sport, title, date, max_players, is_private, joins_closed, cancelled_at, min_age, timezone) VALUES
  ('gopen',   t.id('host'),  'basketball', 'Open run',    date_trunc('day', now()) + interval '3 days 23 hours', 10, false, false, NULL, NULL, 'America/New_York'),
  ('gpaid',   t.id('host'),  'basketball', 'Paid run',    now() + interval '3 days', 10, false, false, NULL, NULL, NULL),
  ('gpriv',   t.id('host'),  'basketball', 'Private run', now() + interval '3 days', 10, true,  false, NULL, NULL, NULL),
  ('gcancel', t.id('host'),  'basketball', 'Called off',  now() + interval '3 days', 10, false, false, now(), NULL, NULL),
  ('gpast',   t.id('host'),  'basketball', 'Last week',   now() - interval '3 days', 10, false, false, NULL, NULL, NULL),
  ('gclosed', t.id('host'),  'basketball', 'Closed run',  now() + interval '3 days', 10, false, true,  NULL, NULL, NULL),
  ('gfull',   t.id('host'),  'basketball', 'One seat',    now() + interval '3 days', 1,  false, false, NULL, NULL, NULL),
  ('gtwo',    t.id('host'),  'basketball', 'Two seats',   now() + interval '3 days', 2,  false, false, NULL, NULL, NULL),
  ('gadult',  t.id('host'),  'basketball', 'Thirty plus', now() + interval '3 days', 10, false, false, NULL, 30,   NULL),
  ('gshut',   t.id('host'),  'basketball', 'Soon closed', now() + interval '3 days', 10, false, false, NULL, NULL, NULL),
  ('gbulk',   t.id('host'),  'basketball', 'Bulk run',    now() + interval '3 days', 10, false, false, NULL, NULL, NULL),
  ('gother',  t.id('other'), 'basketball', 'Other run',   now() + interval '3 days', 10, false, false, NULL, NULL, NULL);
INSERT INTO public.game_payment_settings (game_id, host_id, entry_fee, requires_approval) VALUES
  ('gopen', t.id('host'), 0, true), ('gpaid', t.id('host'), 10, true), ('gtwo', t.id('host'), 0, true);
INSERT INTO public.game_participants (game_id, user_id) VALUES ('gopen', t.id('gus')), ('gfull', t.id('gus')), ('gbulk', t.id('gus'));
INSERT INTO public.player_availabilities (id, user_id, sports, skill_level, status, time_slots, timezone, last_confirmed_at)
SELECT md5('post:' || h)::uuid, t.id(h), ARRAY['Basketball'], 'All Levels', 'open', '[{"weekday":2,"start":"18:00","end":"20:00"}]'::jsonb,
       'America/New_York', now()
  FROM unnest(ARRAY['ana', 'ben', 'cal', 'dee', 'eve', 'gus']) h;
INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES (t.id('cal'), t.id('host'));
INSERT INTO public.privacy_preferences (user_id, allow_invites) VALUES (t.id('dee'), 'nobody')
  ON CONFLICT (user_id) DO UPDATE SET allow_invites = 'nobody';
SET LOCAL session_replication_role = origin;

CREATE FUNCTION t.inv(_game text, _who text) RETURNS text LANGUAGE sql AS $f$
  SELECT format('SELECT public.game_invite_player(%L, %L::uuid)', _game, t.id(_who)) $f$;
CREATE FUNCTION t.invite_id(_game text, _who text) RETURNS uuid LANGUAGE sql SECURITY DEFINER AS $f$
  SELECT id FROM public.game_invites WHERE game_id = _game AND invitee_id = t.id(_who) ORDER BY created_at DESC LIMIT 1 $f$;
GRANT EXECUTE ON FUNCTION t.inv(text, text), t.invite_id(text, text) TO authenticated;

-- ================= 1. who may invite, to what =================
SELECT t.as_user(t.id('other'));
SELECT t.throws(t.inv('gopen', 'ana'), 'NOT_GAME_HOST', 'someone else cannot invite to the host''s game');
SELECT t.as_user(t.id('host'));
SELECT t.throws(t.inv('nosuchgame', 'ana'), 'NOT_GAME_HOST', 'nor can anyone to a game that does not exist');
SELECT t.throws(t.inv('gcancel', 'ana'), 'GAME_NOT_OPEN', 'not to a cancelled game');
SELECT t.throws(t.inv('gpast', 'ana'), 'GAME_NOT_OPEN', 'not to a game that has started');
SELECT t.throws(t.inv('gclosed', 'ana'), 'GAME_NOT_OPEN', 'not to a game closed to joins');
SELECT t.throws(t.inv('gfull', 'ana'), 'GAME_FULL', 'not to a full game');
SELECT t.throws(t.inv('gopen', 'gus'), 'ALREADY_IN_GAME', 'not someone already on the roster');
SELECT t.throws(t.inv('gopen', 'host'), 'SELF_INVITE', 'not themselves');

-- ================= 2. players the host may not reach: one answer =================
SELECT t.throws(t.inv('gopen', 'fay'), 'INVITE_NOT_AVAILABLE', 'a player with no open post');
SELECT t.throws(t.inv('gopen', 'cal'), 'INVITE_NOT_AVAILABLE', 'a player who blocked the host (the block is not revealed)');
SELECT t.throws(t.inv('gopen', 'dee'), 'INVITE_NOT_AVAILABLE', 'a player who accepts no invitations');
SELECT t.throws(t.inv('gopen', 'eve'), 'INVITE_NOT_AVAILABLE', 'a minor the host has no connection with');
SELECT t.throws(t.inv('gadult', 'ana'), 'INVITE_NOT_AVAILABLE', 'a player outside the game''s age range (age not revealed)');
SELECT t.reset();
SELECT t.as_anon();
SELECT t.throws(t.inv('gopen', 'ana'), 'permission denied', 'a visitor cannot invite');
SELECT t.reset();
SELECT t.eq((SELECT count(*)::int FROM public.game_invites), 0, 'no refused invitation left a row');
SELECT t.eq((SELECT count(*)::int FROM public.notifications WHERE type = 'game_invite'), 0, 'or a notification');

-- ================= 3. an invitation =================
SELECT t.as_user(t.id('host'));
SELECT t.lives(t.inv('gopen', 'ana'), 'the host invites a player to an open game');
SELECT t.lives(t.inv('gopen', 'ana'), 'inviting again while one is pending');
SELECT t.reset();
SELECT t.eq((SELECT count(*)::int FROM public.game_invites WHERE game_id = 'gopen' AND invitee_id = t.id('ana')), 1, 'gives the same invitation');
SELECT t.eq((SELECT count(*)::int FROM public.notifications WHERE user_id = t.id('ana') AND type = 'game_invite'), 1, 'and one notification');
SELECT t.eq((SELECT title FROM public.notifications WHERE user_id = t.id('ana') AND type = 'game_invite'), 'You''re invited to Open run',
  'the notification names the real game');
SELECT t.eq((SELECT body FROM public.notifications WHERE user_id = t.id('ana') AND type = 'game_invite'),
  'basketball · ' || to_char((date_trunc('day', now()) + interval '3 days 23 hours') AT TIME ZONE 'America/New_York', 'Dy, Mon FMDD "at" FMHH12:MI AM'),
  'with its sport and time in the game''s timezone');
SELECT t.eq((SELECT link FROM public.notifications WHERE user_id = t.id('ana') AND type = 'game_invite'),
  '/games/gopen?invite=1&from=' || t.id('host') || '&inv=' || t.invite_id('gopen', 'ana')
    || '&exp=' || floor(extract(epoch FROM date_trunc('day', now()) + interval '3 days 23 hours') * 1000)::bigint,
  'and links to the game with the invitation');
SELECT t.eq((SELECT availability_id FROM public.game_invites WHERE game_id = 'gopen' AND invitee_id = t.id('ana')), md5('post:ana')::uuid,
  'the invitation records the post it answered');

SELECT t.as_user(t.id('ana'));
SELECT t.eq(t.count('SELECT 1 FROM public.game_invites'), 1, 'the invitee reads it');
SELECT t.throws($q$INSERT INTO public.game_invites (game_id, host_id, invitee_id) VALUES ('gother', t.id('other'), t.id('ana'))$q$,
  'permission denied', 'clients cannot write invitations directly');
SELECT t.throws($q$UPDATE public.game_invites SET status = 'accepted'$q$, 'permission denied', 'or change them');
SELECT t.as_user(t.id('host'));
SELECT t.eq(t.count('SELECT 1 FROM public.game_invites'), 1, 'the host reads it');
SELECT t.as_user(t.id('other'));
SELECT t.eq(t.count('SELECT 1 FROM public.game_invites'), 0, 'nobody else does');
SELECT t.throws(format('SELECT public.game_respond_invite(%L, true)', t.invite_id('gopen', 'ana')), 'INVITE_NOT_FOUND',
  'and nobody else can answer it');
SELECT t.throws(format('SELECT public.game_cancel_invite(%L)', t.invite_id('gopen', 'ana')), 'INVITE_NOT_FOUND',
  'or withdraw it');
SELECT t.reset();

-- ================= 4. accepting =================
SELECT t.as_user(t.id('ana'));
SELECT t.eq((public.game_respond_invite(t.invite_id('gopen', 'ana'), true)) ->> 'status', 'accepted', 'the invitee accepts');
SELECT t.reset();
SELECT t.eq((SELECT status FROM public.join_requests WHERE game_id = 'gopen' AND player_id = t.id('ana')), 'approved',
  'accepting approves their place request on an approval game');
SELECT t.eq((SELECT join_request_id FROM public.game_invites WHERE game_id = 'gopen' AND invitee_id = t.id('ana')),
  (SELECT id FROM public.join_requests WHERE game_id = 'gopen' AND player_id = t.id('ana')), 'the invitation points at it');
SELECT t.eq((SELECT count(*)::int FROM public.notifications WHERE user_id = t.id('host') AND type = 'game_invite_accepted'), 1,
  'the host is told');
SELECT t.as_user(t.id('ana'));
SELECT t.lives($q$INSERT INTO public.game_participants (game_id, user_id) VALUES ('gopen', t.id('ana'))$q$,
  'and the player then takes the place, through the join gate');
SELECT t.eq((public.game_respond_invite(t.invite_id('gopen', 'ana'), false)) ->> 'status', 'accepted', 'answering again changes nothing');
SELECT t.reset();

-- An existing request is approved, not duplicated.
SELECT t.as_user(t.id('ben'));
INSERT INTO public.join_requests (game_id, player_id, host_id, idempotency_key) VALUES ('gpaid', t.id('ben'), t.id('host'), 'join:gpaid');
SELECT t.as_user(t.id('host'));
SELECT t.lives(t.inv('gpaid', 'ben'), 'the host invites a player who already asked');
SELECT t.as_user(t.id('ben'));
SELECT t.eq((public.game_respond_invite(t.invite_id('gpaid', 'ben'), true)) ->> 'status', 'accepted', 'they accept');
SELECT t.reset();
SELECT t.eq((SELECT count(*)::int || ':' || min(status) FROM public.join_requests WHERE game_id = 'gpaid' AND player_id = t.id('ben')),
  '1:approved', 'their one request is approved (payment still follows)');

-- A game that closed meanwhile; a game that filled.
SELECT t.as_user(t.id('host'));
SELECT t.lives(t.inv('gshut', 'ana'), 'invited to a game');
SELECT t.lives(t.inv('gtwo', 'ana'), 'invited to a small game');
SELECT t.reset();
UPDATE public.hosted_games SET joins_closed = true WHERE id = 'gshut';
SET LOCAL session_replication_role = replica;
INSERT INTO public.game_participants (game_id, user_id) VALUES ('gtwo', t.id('gus')), ('gtwo', t.id('ben'));
SET LOCAL session_replication_role = origin;
SELECT t.as_user(t.id('ana'));
SELECT t.eq((public.game_respond_invite(t.invite_id('gshut', 'ana'), true)) ->> 'status', 'expired', 'a game closed since the invitation: expired');
SELECT t.eq((public.game_respond_invite(t.invite_id('gtwo', 'ana'), true)) ->> 'status', 'full', 'a game that filled: full');
SELECT t.reset();
SELECT t.eq((SELECT count(*)::int FROM public.join_requests WHERE player_id = t.id('ana') AND game_id IN ('gshut', 'gtwo')), 0,
  'neither creates a request');
SELECT t.eq((SELECT status FROM public.game_invites WHERE game_id = 'gtwo' AND invitee_id = t.id('ana')), 'pending',
  'the full game''s invitation waits');

-- Declining.
SELECT t.as_user(t.id('host'));
SELECT t.lives(t.inv('gadult', 'ben'), 'a player inside the age range can be invited');
SELECT t.as_user(t.id('ben'));
SELECT t.eq((public.game_respond_invite(t.invite_id('gadult', 'ben'), false)) ->> 'status', 'declined', 'they decline');
SELECT t.as_user(t.id('host'));
SELECT t.throws(t.inv('gadult', 'ben'), 'INVITE_DECLINED_RECENTLY', 'the host cannot invite them again this week');
SELECT t.reset();

-- ================= 5. a private game =================
SELECT t.as_user(t.id('ben'));
SELECT t.eq(t.count($q$SELECT 1 FROM public.hosted_games WHERE id = 'gpriv'$q$), 0, 'a private game is hidden from a stranger');
SELECT t.as_user(t.id('host'));
SELECT t.lives(t.inv('gpriv', 'ben'), 'the host invites them');
SELECT t.as_user(t.id('ben'));
SELECT t.eq(t.count($q$SELECT 1 FROM public.hosted_games WHERE id = 'gpriv'$q$), 1, 'the invitee can open it');
SELECT t.as_user(t.id('ana'));
SELECT t.eq(t.count($q$SELECT 1 FROM public.hosted_games WHERE id = 'gpriv'$q$), 0, 'nobody else');
SELECT t.as_user(t.id('host'));
SELECT t.eq(public.game_cancel_invite(t.invite_id('gpriv', 'ben')), 'cancelled', 'the host withdraws the invitation');
SELECT t.as_user(t.id('ben'));
SELECT t.eq(t.count($q$SELECT 1 FROM public.hosted_games WHERE id = 'gpriv'$q$), 0, 'and the game is hidden again');
SELECT t.reset();

-- ================= 6. several at once =================
SELECT t.as_user(t.id('host'));
SELECT t.eq(public.game_invite_players('gbulk', ARRAY[t.id('ana'), t.id('cal'), t.id('fay'), t.id('gus')]),
  '{"invited": 1, "skipped": {"ALREADY_IN_GAME": 1, "INVITE_NOT_AVAILABLE": 2}}'::jsonb, 'a bulk invitation reports what it did');
SELECT t.throws(format('SELECT public.game_invite_players(%L, %L::uuid[])', 'gbulk',
  (SELECT array_agg(gen_random_uuid()) FROM generate_series(1, 31))), 'INVITE_LIMIT', 'at most 30 at once');
SELECT t.as_user(t.id('other'));
SELECT t.throws(format('SELECT public.game_invite_players(%L, %L::uuid[])', 'gbulk', ARRAY[t.id('ben')]), 'NOT_GAME_HOST',
  'only by the host');
SELECT t.reset();

-- ================= 7. the old path =================
SELECT t.as_user(t.id('other'));
SELECT t.throws(format($q$INSERT INTO public.availability_contact_requests (from_user_id, to_user_id, availability_id, kind, game_id, game_title)
  VALUES (t.id('other'), t.id('ben'), %L, 'invite', 'gopen', 'Free money')$q$, md5('post:ben')::uuid), 'NOT_GAME_HOST',
  'an old-style invitation to someone else''s game is refused');
SELECT t.as_user(t.id('host'));
SELECT t.throws(format($q$INSERT INTO public.availability_contact_requests (from_user_id, to_user_id, availability_id, kind, game_id)
  VALUES (t.id('host'), t.id('ben'), %L, 'invite', 'nosuchgame')$q$, md5('post:ben')::uuid), 'NOT_GAME_HOST',
  'as is one to a game that does not exist');
SELECT t.lives(format($q$INSERT INTO public.availability_contact_requests (from_user_id, to_user_id, availability_id, kind, game_id, game_title, game_location)
  VALUES (t.id('host'), t.id('ben'), %L, 'invite', 'gbulk', 'Free money', 'Somewhere else')$q$, md5('post:ben')::uuid),
  'the host''s own old-style invitation is accepted');
SELECT t.reset();
SELECT t.eq((SELECT game_title FROM public.availability_contact_requests WHERE game_id = 'gbulk'), 'Bulk run', 'with the real title');
SELECT t.eq((SELECT game_location FROM public.availability_contact_requests WHERE game_id = 'gbulk'),
  (SELECT location FROM public.hosted_games WHERE id = 'gbulk'), 'and the real place');
SELECT t.as_user(t.id('ben'));
SELECT t.throws($q$UPDATE public.availability_contact_requests SET game_title = 'Changed' WHERE game_id = 'gbulk'$q$, 'cannot be changed',
  'the recipient cannot rewrite the game details');
SELECT t.throws($q$UPDATE public.availability_contact_requests SET message = 'Changed' WHERE game_id = 'gbulk'$q$, 'cannot be changed',
  'or the message');
SELECT t.lives($q$UPDATE public.availability_contact_requests SET status = 'accepted' WHERE game_id = 'gbulk'$q$, 'but can still answer it');
SELECT t.reset();

SELECT t.eq(has_function_privilege('anon', 'public.game_respond_invite(uuid,boolean)', 'EXECUTE'), false, 'visitors cannot answer');
SELECT t.eq(has_table_privilege('authenticated', 'public.game_invites', 'INSERT'), false, 'no client insert grant');

ROLLBACK;
