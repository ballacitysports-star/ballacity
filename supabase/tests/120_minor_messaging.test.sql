-- Who may start a conversation with a minor, and that no client path around
-- create_direct_conversation exists. Two families, so a guardian's power over
-- one family's children is shown to stop at the family line.
BEGIN;

SELECT t.person('host', 35), t.person('parentone', 41), t.person('parenttwo', 40),
       t.person('kidone', 10), t.person('teenone', 14),
       t.person('kidtwo', 11), t.person('teentwo', 16);
-- Family one: parentone has two children. Family two: parenttwo has two.
SELECT t.guardian('parentone', 'kidone');
SELECT t.guardian('parentone', 'teenone');
SELECT t.guardian('parenttwo', 'kidtwo');
SELECT t.guardian('parenttwo', 'teentwo');

-- A new guardian link starts a child on the safest messaging setting.
SELECT t.eq((SELECT messaging FROM public.child_controls WHERE child_user_id = t.id('kidone')), 'guardian_only',
  'a linked child defaults to guardian-only messaging');
SELECT t.as_user(t.id('host'));
SELECT t.throws(format('SELECT public.create_direct_conversation(%L)', t.id('teentwo')),
  'MINOR_MESSAGING_BLOCKED:recipient_restricted:other', 'so a stranger cannot reach even a 16-17 until the guardian opens it up');
SELECT t.reset();
-- The caller is told only that the recipient is restricted (20261113120000, SEC-2b); the rule that refused is checked here internally.
SELECT t.eq(public.minor_messaging_block(t.id('host'), t.id('teentwo')), 'guardian_only:other', 'internally: the guardian-only control refused');

-- The age rules below apply once a guardian has opened messaging to peers.
UPDATE public.child_controls SET messaging = 'peers';

-- ---- adults and the youngest ------------------------------------------------
SELECT t.as_user(t.id('host'));
SELECT t.throws(format('SELECT public.create_direct_conversation(%L)', t.id('kidone')),
  'MINOR_MESSAGING_BLOCKED:recipient_restricted:other', 'an adult who is not the guardian cannot message an under-13');
SELECT t.throws(format('SELECT public.create_direct_conversation(%L)', t.id('teenone')),
  'MINOR_MESSAGING_BLOCKED:recipient_restricted:other', 'an adult cannot message a 13-15 without a shared game');
SELECT t.reset();
SELECT t.eq(public.minor_messaging_block(t.id('host'), t.id('kidone')), 'child_needs_guardian:other', 'internally: the under-13 rule refused');
SELECT t.eq(public.minor_messaging_block(t.id('host'), t.id('teenone')), 'teen_needs_shared_game:other', 'internally: the 13-15 rule refused');
SELECT t.as_user(t.id('host'));
SELECT t.lives(format('SELECT public.create_direct_conversation(%L)', t.id('teentwo')),
  'an adult may message a 16-17 once messaging is open to peers');
SELECT t.reset();

-- The refusal holds from the minor's side too.
SELECT t.as_user(t.id('kidone'));
SELECT t.throws(format('SELECT public.create_direct_conversation(%L)', t.id('host')),
  'MINOR_MESSAGING_BLOCKED', 'an under-13 cannot start a conversation with an adult stranger');
SELECT t.as_user(t.id('teenone'));
SELECT t.throws(format('SELECT public.create_direct_conversation(%L)', t.id('host')),
  'MINOR_MESSAGING_BLOCKED:teen_needs_shared_game', 'a 13-15 cannot start one either');
SELECT t.reset();

-- ---- a guardian reaches their own child, and only their own -----------------
SELECT t.as_user(t.id('parentone'));
SELECT t.lives(format('SELECT public.create_direct_conversation(%L)', t.id('kidone')),
  'a guardian can message their own child');
SELECT t.lives(format('SELECT public.create_direct_conversation(%L)', t.id('teenone')),
  'and their other child');
SELECT t.throws(format('SELECT public.create_direct_conversation(%L)', t.id('kidtwo')),
  'MINOR_MESSAGING_BLOCKED:recipient_restricted:other', 'but not another family''s under-13');
SELECT t.reset();
SELECT t.eq(public.minor_messaging_block(t.id('parentone'), t.id('kidtwo')), 'child_needs_guardian:other', 'internally: the under-13 rule refused');

-- ---- guardian-set controls --------------------------------------------------
UPDATE public.child_controls SET messaging = 'off' WHERE child_user_id = t.id('teentwo');
SELECT t.as_user(t.id('host'));
SELECT t.throws(format('SELECT public.create_direct_conversation(%L)', t.id('teentwo')),
  'MINOR_MESSAGING_BLOCKED:recipient_restricted:other', 'messaging switched off blocks an adult who could otherwise reach a 16-17');
SELECT t.reset();
SELECT t.eq(public.minor_messaging_block(t.id('host'), t.id('teentwo')), 'messaging_off:other', 'internally: the messaging-off control refused');
SELECT t.as_user(t.id('teentwo'));
SELECT t.throws(format('SELECT public.create_direct_conversation(%L)', t.id('host')),
  'MINOR_MESSAGING_BLOCKED:messaging_off:self', 'and blocks the child starting one (told about their own account)');
SELECT t.reset();

UPDATE public.child_controls SET messaging = 'guardian_only' WHERE child_user_id = t.id('teentwo');
SELECT t.as_user(t.id('host'));
SELECT t.throws(format('SELECT public.create_direct_conversation(%L)', t.id('teentwo')),
  'MINOR_MESSAGING_BLOCKED:recipient_restricted:other', 'guardian-only blocks a stranger');
SELECT t.as_user(t.id('parentone'));
SELECT t.throws(format('SELECT public.create_direct_conversation(%L)', t.id('teentwo')),
  'MINOR_MESSAGING_BLOCKED:recipient_restricted:other', 'and another family''s guardian');
SELECT t.reset();
SELECT t.eq(public.minor_messaging_block(t.id('parentone'), t.id('teentwo')), 'guardian_only:other', 'internally: the guardian-only control refused');
SELECT t.as_user(t.id('parenttwo'));
SELECT t.lives(format('SELECT public.create_direct_conversation(%L)', t.id('teentwo')),
  'but their own guardian can');
SELECT t.reset();

UPDATE public.child_controls SET messaging = 'teammates' WHERE child_user_id = t.id('teentwo');
SELECT t.as_user(t.id('host'));
SELECT t.throws(format('SELECT public.create_direct_conversation(%L)', t.id('teentwo')),
  'MINOR_MESSAGING_BLOCKED:recipient_restricted:other', 'teammates-only blocks a non-teammate');
SELECT t.reset();
SELECT t.eq(public.minor_messaging_block(t.id('host'), t.id('teentwo')), 'teammates_only:other', 'internally: the teammates-only control refused');
SELECT t.team('squad', 'host');
SELECT t.member('squad', 'teentwo');
SELECT t.as_user(t.id('host'));
SELECT t.lives(format('SELECT public.create_direct_conversation(%L)', t.id('teentwo')),
  'and admits a teammate');
SELECT t.reset();

-- ---- no way around the function ----------------------------------------------
SELECT t.as_user(t.id('parentone'));
SELECT t.lives(format('SELECT public.create_direct_conversation(%L)', t.id('kidone')), 'setup: a family thread exists');
SELECT t.reset();
SELECT t.as_user(t.id('host'));
SELECT t.eq(t.count(format('SELECT 1 FROM public.conversation_participants WHERE user_id = %L', t.id('kidone'))), 0,
  'a stranger cannot read who is in a child''s conversations');
SELECT t.throws(format($q$INSERT INTO public.conversation_participants (conversation_id, user_id)
  SELECT conversation_id, %L FROM public.conversation_participants LIMIT 1$q$, t.id('host')),
  'permission denied', 'a client cannot add itself to someone else''s conversation');
SELECT t.reset();

ROLLBACK;
