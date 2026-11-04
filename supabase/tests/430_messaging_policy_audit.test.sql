-- R7: stranger-to-minor direct messaging. Locks the protections that existed before and, since the R7 authorization migration, the
-- refusals that close the former exceptions E1 to E4 (E5 is covered in 460). See docs/privacy/r7-messaging-audit.md.
BEGIN;
SELECT t.person('adult', 35), t.person('adulttwo', 36), t.person('parent', 41), t.person('kid', 10), t.person('teen14', 14),
       t.person('teen17', 17), t.person('selfteen', 17), t.person('selfteen14', 14), t.person('selfteenb', 16), t.person('shared', 30);
SELECT t.guardian('parent', 'kid');
SELECT t.guardian('parent', 'teen14');
SELECT t.guardian('parent', 'teen17');

-- ---- creation and participants: no client path other than create_direct_conversation
SELECT t.as_user(t.id('adult'));
SELECT t.eq(t.changed($q$INSERT INTO public.conversations (created_by) VALUES (t.id('adult'))$q$), 0, 'a client cannot create a conversation directly');
SELECT t.reset();
SELECT t.as_user(t.id('adult'));
SELECT t.throws($q$INSERT INTO public.conversation_participants (conversation_id, user_id) SELECT id, t.id('adult') FROM public.conversations LIMIT 1$q$, 'permission denied', 'a client cannot add a participant');
SELECT t.reset();
INSERT INTO public.conversations (id, created_by) VALUES ('11111111-1111-1111-1111-111111111111', t.id('parent'));
INSERT INTO public.conversation_participants (conversation_id, user_id) VALUES ('11111111-1111-1111-1111-111111111111', t.id('parent')), ('11111111-1111-1111-1111-111111111111', t.id('kid'));
SELECT t.as_user(t.id('adult'));
SELECT t.eq(t.count('SELECT 1 FROM public.messages WHERE conversation_id = ''11111111-1111-1111-1111-111111111111'''), 0, 'a non-participant reads no messages');
SELECT t.eq(t.count('SELECT 1 FROM public.conversation_participants WHERE conversation_id = ''11111111-1111-1111-1111-111111111111'''), 0, 'and does not see who is in a conversation');
SELECT t.throws($q$INSERT INTO public.messages (conversation_id, sender_id, body) VALUES ('11111111-1111-1111-1111-111111111111', t.id('adult'), 'hi')$q$, 'MINOR_MESSAGING_BLOCKED', 'a non-participant cannot send into a child''s conversation (refused by the minor rule before row security is reached)');
SELECT t.reset();

-- ---- delivery is re-checked on every message: guardian revocation and control changes take effect in an existing conversation
SELECT t.as_user(t.id('parent'));
SELECT t.lives($q$INSERT INTO public.messages (conversation_id, sender_id, body) VALUES ('11111111-1111-1111-1111-111111111111', t.id('parent'), 'dinner')$q$, 'a guardian can message their child');
SELECT t.reset();
UPDATE public.guardian_links SET status = 'revoked' WHERE child_user_id = t.id('kid');
SELECT t.as_user(t.id('parent'));
SELECT t.throws($q$INSERT INTO public.messages (conversation_id, sender_id, body) VALUES ('11111111-1111-1111-1111-111111111111', t.id('parent'), 'again')$q$, 'MINOR_MESSAGING_BLOCKED', 'after the guardian link is revoked an existing conversation with the under-13 stops delivering');
SELECT t.reset();

-- ---- stranger adult to each cohort, as the product behaves today
SELECT t.as_user(t.id('adult'));
SELECT t.throws(format('SELECT public.create_direct_conversation(%L)', t.id('kid')), 'MINOR_MESSAGING_BLOCKED', 'adult stranger to an under-13: refused');
SELECT t.throws(format('SELECT public.create_direct_conversation(%L)', t.id('teen14')), 'MINOR_MESSAGING_BLOCKED', 'adult stranger to a linked 13-15: refused');
SELECT t.throws(format('SELECT public.create_direct_conversation(%L)', t.id('teen17')), 'MINOR_MESSAGING_BLOCKED:guardian_only', 'adult stranger to a linked 16-17: refused (guardian-only default)');
SELECT t.throws(format('SELECT public.create_direct_conversation(%L)', t.id('selfteen14')), 'MINOR_MESSAGING_BLOCKED:needs_guardian_link:other', 'adult stranger to an unlinked 13-15: refused (the child needs a linked guardian first)');
SELECT t.throws(format('SELECT public.create_direct_conversation(%L)', t.id('selfteen')), 'MINOR_MESSAGING_BLOCKED:needs_guardian_link:other', 'E1 closed: adult stranger to an unlinked 16-17 is refused');
SELECT t.lives(format('SELECT public.create_direct_conversation(%L)', t.id('adulttwo')), 'adult to adult: allowed');
SELECT t.reset();
SELECT t.as_user(t.id('selfteenb'));
SELECT t.throws(format('SELECT public.create_direct_conversation(%L)', t.id('selfteen')), 'MINOR_MESSAGING_BLOCKED', 'E2 closed: two unrelated unlinked 16-17 year olds cannot open a conversation');
SELECT t.reset();

-- ---- a guardian who opens messaging to peers lets an adult stranger reach a 16-17 (existing test 120 asserts this)
UPDATE public.child_controls SET messaging = 'peers' WHERE child_user_id = t.id('teen17');
SELECT t.as_user(t.id('shared'));
SELECT t.throws(format('SELECT public.create_direct_conversation(%L)', t.id('teen17')), 'MINOR_MESSAGING_BLOCKED:needs_connection:other', 'E3 closed: "peers" chosen by the guardian does not authorize an adult stranger');
SELECT t.reset();

-- ---- blocks
INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES (t.id('adulttwo'), t.id('adult'));
SELECT t.as_user(t.id('adult'));
SELECT t.throws($q$INSERT INTO public.messages (conversation_id, sender_id, body) SELECT conversation_id, t.id('adult'), 'x' FROM public.conversation_participants WHERE user_id = t.id('adult') AND conversation_id IN (SELECT conversation_id FROM public.conversation_participants WHERE user_id = t.id('adulttwo')) LIMIT 1$q$, 'block', 'a block stops messages in an existing conversation');
SELECT t.reset();

-- ---- grants
SELECT t.eq(has_function_privilege('anon', 'public.create_direct_conversation(uuid, text)', 'EXECUTE'), false, 'anonymous cannot create conversations');
SELECT t.eq(has_table_privilege('anon', 'public.messages', 'SELECT'), false, 'anonymous cannot read messages');
ROLLBACK;
