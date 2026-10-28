-- Messages are checked when they are sent, not only when the conversation is
-- created: a guardian who switches messaging off, or a block, stops an existing
-- thread. And a message cannot be rewritten after it is sent.
BEGIN;

SELECT t.person('guardian', 41), t.person('teen', 16), t.person('adult', 35), t.person('blocker', 30), t.person('annoyer', 30);
SELECT t.guardian('guardian', 'teen');
UPDATE public.child_controls SET messaging = 'peers' WHERE child_user_id = t.id('teen');

INSERT INTO public.conversations (id, created_by) VALUES (t.id('thread'), t.id('adult')), (t.id('blockthread'), t.id('annoyer'));
INSERT INTO public.conversation_participants (conversation_id, user_id) VALUES
  (t.id('thread'), t.id('adult')), (t.id('thread'), t.id('teen')),
  (t.id('blockthread'), t.id('blocker')), (t.id('blockthread'), t.id('annoyer'));

-- ---- an open thread works ---------------------------------------------------
SELECT t.as_user(t.id('adult'));
SELECT t.lives(format($q$INSERT INTO public.messages (id, conversation_id, sender_id, body) VALUES (%L, %L, %L, 'see you at 6')$q$,
  t.id('m1'), t.id('thread'), t.id('adult')), 'an adult messages a 16-17 in an open thread');
SELECT t.throws(format($q$INSERT INTO public.messages (conversation_id, sender_id, body) VALUES (%L, %L, 'as someone else')$q$,
  t.id('thread'), t.id('teen')), 'row-level security', 'but not as the other participant');
SELECT t.reset();

-- ---- the guardian turns messaging off ----------------------------------------
UPDATE public.child_controls SET messaging = 'off' WHERE child_user_id = t.id('teen');
SELECT t.as_user(t.id('adult'));
SELECT t.throws(format($q$INSERT INTO public.messages (conversation_id, sender_id, body) VALUES (%L, %L, 'hello?')$q$,
  t.id('thread'), t.id('adult')), 'MINOR_MESSAGING_BLOCKED', 'an adult can no longer send into the existing thread');
SELECT t.as_user(t.id('teen'));
SELECT t.throws(format($q$INSERT INTO public.messages (conversation_id, sender_id, body) VALUES (%L, %L, 'reply')$q$,
  t.id('thread'), t.id('teen')), 'MINOR_MESSAGING_BLOCKED', 'and the teen cannot send either');
SELECT t.reset();

-- ---- a block stops the thread -------------------------------------------------
INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES (t.id('blocker'), t.id('annoyer'));
SELECT t.as_user(t.id('annoyer'));
SELECT t.throws(format($q$INSERT INTO public.messages (conversation_id, sender_id, body) VALUES (%L, %L, 'please reply')$q$,
  t.id('blockthread'), t.id('annoyer')), 'block', 'a blocked person cannot message the one who blocked them');
SELECT t.as_user(t.id('blocker'));
SELECT t.throws(format($q$INSERT INTO public.messages (conversation_id, sender_id, body) VALUES (%L, %L, 'actually')$q$,
  t.id('blockthread'), t.id('blocker')), 'block', 'and the blocker cannot message them while the block stands');
SELECT t.reset();

-- ---- a sent message cannot be rewritten ----------------------------------------
SELECT t.as_user(t.id('adult'));
SELECT t.eq(t.changed(format($q$UPDATE public.messages SET body = 'edited' WHERE id = %L$q$, t.id('m1'))), 0,
  'the sender cannot edit what they sent');
SELECT t.as_user(t.id('teen'));
SELECT t.throws(format($q$UPDATE public.messages SET body = 'rewritten' WHERE id = %L$q$, t.id('m1')), 'permission denied',
  'the recipient cannot rewrite it either');
SELECT t.lives(format($q$UPDATE public.messages SET read_at = now() WHERE id = %L$q$, t.id('m1')),
  'the recipient can mark it read');
SELECT t.reset();

ROLLBACK;
