-- P2-3: team chat (supabase/migrations/20261109100000_team_chat.sql). A mixed-age team:
--   * who is in the chat: adults on the roster, 13-17s only with a linked guardian AND messaging 'teammates'/'peers',
--     the guardians of any minor on the team; never an under-13, a teen without a guardian or with 'guardian_only',
--     or a stranger;
--   * messages are written only through send_team_chat_message, start pending, are read only once approved, are
--     rate-limited, can be hidden by staff only and reported by members only;
--   * direct-message rules for minors are unchanged.
BEGIN;

SELECT t.person('owner', 40), t.person('coach', 31), t.person('adultplayer', 25), t.person('stranger', 35),
       t.person('teen', 15), t.person('parent', 44), t.person('teennoguard', 16), t.person('teenguardonly', 14),
       t.person('teenparent', 45), t.person('kid', 11), t.person('kidparent', 39);
SELECT t.guardian('parent', 'teen');
SELECT t.guardian('teenparent', 'teenguardonly');
SELECT t.guardian('kidparent', 'kid');
INSERT INTO public.child_controls (child_user_id, messaging) VALUES
  (t.id('teen'), 'teammates'), (t.id('teenguardonly'), 'guardian_only'), (t.id('teennoguard'), 'teammates'),
  (t.id('kid'), 'teammates')
ON CONFLICT (child_user_id) DO UPDATE SET messaging = EXCLUDED.messaging;

SELECT t.team('hawks', 'owner');
SELECT t.member('hawks', 'coach', 'coach');
SELECT t.member('hawks', 'adultplayer', 'player');
SELECT t.member('hawks', 'teen', 'player');
SELECT t.member('hawks', 'teennoguard', 'player');
SELECT t.member('hawks', 'teenguardonly', 'player');
SELECT t.member('hawks', 'kid', 'player');

-- ---- who is in the chat ----------------------------------------------------------------------------
CREATE TEMP TABLE who (handle text, expected boolean);
INSERT INTO who VALUES ('owner', true), ('coach', true), ('adultplayer', true), ('teen', true), ('parent', true),
  ('teenparent', true), ('kidparent', true), ('teennoguard', false), ('teenguardonly', false), ('kid', false),
  ('stranger', false);
SELECT t.ok((SELECT bool_and(private_sec.team_chat_member('hawks', t.id(handle)) = expected) FROM who),
  'adults, a teen with a guardian and teammates messaging, and minors'' guardians are in; nobody else');
SELECT t.ok(NOT private_sec.team_chat_member('hawks', t.id('teennoguard')), 'a teen with no linked guardian is out');
SELECT t.ok(NOT private_sec.team_chat_member('hawks', t.id('teenguardonly')), 'a teen whose control is guardian-only is out');
SELECT t.ok(NOT private_sec.team_chat_member('hawks', t.id('kid')), 'an under-13 is out (their guardian takes part)');
SELECT t.ok(private_sec.team_chat_member('hawks', t.id('kidparent')), 'the under-13''s guardian is in');

-- ---- sending and reading ---------------------------------------------------------------------------------
CREATE TEMP TABLE msg (name text PRIMARY KEY, id uuid);
GRANT ALL ON msg TO anon, authenticated;

SELECT t.as_user(t.id('teen'));
INSERT INTO msg VALUES ('teen1', public.send_team_chat_message('hawks', '  See you at practice!  '));
SELECT t.eq(t.count('SELECT 1 FROM public.team_chat_messages WHERE id IN (SELECT id FROM msg)'), 1,
  'the sender sees their own pending message');
SELECT t.reset();
SELECT t.eq((SELECT moderation_status || ':' || body FROM public.team_chat_messages WHERE id = (SELECT id FROM msg)),
  'pending:See you at practice!', 'it is stored pending, trimmed');

SELECT t.as_user(t.id('adultplayer'));
SELECT t.eq(t.count('SELECT 1 FROM public.team_chat_messages'), 0, 'others do not see a pending message');
SELECT t.reset();

UPDATE public.team_chat_messages SET moderation_status = 'approved' WHERE id = (SELECT id FROM msg);

SELECT t.as_user(t.id('adultplayer'));
SELECT t.eq(t.count('SELECT 1 FROM public.team_chat_messages'), 1, 'members read an approved message');
SELECT t.reset();
SELECT t.as_user(t.id('parent'));
SELECT t.eq(t.count('SELECT 1 FROM public.team_chat_messages'), 1, 'a minor''s guardian reads it too');
SELECT t.reset();
SELECT t.as_user(t.id('stranger'));
SELECT t.eq(t.count('SELECT 1 FROM public.team_chat_messages'), 0, 'a stranger reads nothing');
SELECT t.throws($$SELECT public.send_team_chat_message('hawks', 'hi')$$, 'NOT_IN_TEAM_CHAT', 'and cannot post');
SELECT t.reset();
SELECT t.as_user(t.id('kid'));
SELECT t.eq(t.count('SELECT 1 FROM public.team_chat_messages'), 0, 'an under-13 reads nothing');
SELECT t.throws($$SELECT public.send_team_chat_message('hawks', 'hi')$$, 'NOT_IN_TEAM_CHAT', 'or posts');
SELECT t.reset();
SELECT t.as_user(t.id('teenguardonly'));
SELECT t.throws($$SELECT public.send_team_chat_message('hawks', 'hi')$$, 'NOT_IN_TEAM_CHAT',
  'a guardian-only teen cannot post');
SELECT t.reset();
SELECT t.as_anon();
SELECT t.throws($$SELECT public.send_team_chat_message('hawks', 'hi')$$, 'permission denied',
  'signed-out visitors cannot call it');
SELECT t.reset();

SELECT t.as_user(t.id('adultplayer'));
SELECT t.throws($$INSERT INTO public.team_chat_messages (team_id, sender_id, body) VALUES ('hawks', auth.uid(), 'x')$$,
  'permission denied', 'nobody writes the table directly');
SELECT t.throws($$SELECT public.send_team_chat_message('hawks', '   ')$$, 'INVALID_MESSAGE', 'an empty message is refused');
SELECT t.reset();

-- ---- staff hide, members report ---------------------------------------------------------------------
SELECT t.as_user(t.id('adultplayer'));
SELECT t.throws(format('SELECT public.hide_team_chat_message(%L, true)', (SELECT id FROM msg)), 'NOT_TEAM_STAFF',
  'a player cannot hide a message');
SELECT t.ok(public.report_team_chat_message((SELECT id FROM msg), 'inappropriate', 'test') IS NOT NULL,
  'a member reports a message');
SELECT t.reset();
SELECT t.eq((SELECT subject_type || ':' || reported_id::text FROM public.user_reports WHERE team_chat_message_id = (SELECT id FROM msg)),
  'team_chat_message:' || t.id('teen')::text, 'the report names the message and its sender');

SELECT t.as_user(t.id('teen'));
SELECT t.throws(format('SELECT public.report_team_chat_message(%L, %L)', (SELECT id FROM msg), 'spam'), 'CANNOT_REPORT_SELF',
  'nobody reports their own message');
SELECT t.reset();
SELECT t.as_user(t.id('stranger'));
SELECT t.throws(format('SELECT public.report_team_chat_message(%L, %L)', (SELECT id FROM msg), 'spam'), 'MESSAGE_NOT_FOUND',
  'a stranger cannot report it');
SELECT t.reset();

SELECT t.as_user(t.id('coach'));
SELECT public.hide_team_chat_message((SELECT id FROM msg), true);
SELECT t.eq(t.count('SELECT 1 FROM public.team_chat_messages'), 1, 'staff still see a hidden message, to unhide it');
SELECT t.reset();
SELECT t.as_user(t.id('adultplayer'));
SELECT t.eq(t.count('SELECT 1 FROM public.team_chat_messages'), 0, 'members no longer see it');
SELECT t.reset();

-- ---- nobody can ask about someone else ---------------------------------------------------------------
SELECT t.as_user(t.id('stranger'));
SELECT t.throws(format('SELECT private_sec.team_chat_member(%L, %L)', 'hawks', t.id('teen')), 'permission denied',
  'a member cannot ask whether someone else (a teen) is in a chat');
SELECT t.ok(NOT public.can_use_team_chat('hawks'), 'can_use_team_chat answers only for the caller');
SELECT t.reset();
SELECT t.as_user(t.id('teen'));
SELECT t.ok(public.can_use_team_chat('hawks'), 'the eligible teen is told they are in');
SELECT t.reset();

-- ---- rate limit, hidden team, unchanged DMs, switch ------------------------------------------------------
SELECT t.as_user(t.id('owner'));
SELECT count(public.send_team_chat_message('hawks', 'm' || g)) FROM generate_series(1, 20) g;
SELECT t.throws($$SELECT public.send_team_chat_message('hawks', 'one more')$$, 'RATE_LIMITED',
  'more than 20 messages a minute are refused');
SELECT t.reset();

SELECT t.ok(public.minor_messaging_block(t.id('stranger'), t.id('teen')) IS NOT NULL,
  'direct messages between a stranger and a teen are still blocked');

UPDATE public.teams SET moderator_hidden_at = now() WHERE id = 'hawks';
SELECT t.ok(NOT private_sec.team_chat_member('hawks', t.id('owner')), 'a team hidden by a moderator has no chat');

SELECT t.eq((SELECT value->>'enabled' FROM public.app_settings WHERE key = 'team_chat'), 'false',
  'the team_chat switch ships off');

ROLLBACK;
