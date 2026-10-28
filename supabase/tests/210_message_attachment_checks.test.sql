-- A message can carry an attachment only after the server has checked that file
-- for this sender and this conversation, and the stored type is the checked one,
-- not the one the client claimed.
BEGIN;

SELECT t.person('sender', 30), t.person('friend', 31), t.person('intruder', 29);
INSERT INTO public.conversations (id, created_by) VALUES (t.id('chat'), t.id('sender')), (t.id('other-chat'), t.id('sender'));
INSERT INTO public.conversation_participants (conversation_id, user_id) VALUES
  (t.id('chat'), t.id('sender')), (t.id('chat'), t.id('friend')),
  (t.id('other-chat'), t.id('sender')), (t.id('other-chat'), t.id('intruder'));

-- The server (service role) records a checked file.
INSERT INTO public.message_attachment_checks (path, user_id, conversation_id, kind, mime, bytes)
VALUES (t.id('chat') || '/' || t.id('sender') || '/ok.png', t.id('sender'), t.id('chat'), 'image', 'image/png', 1234);

SELECT t.as_user(t.id('sender'));
SELECT t.lives(format($q$INSERT INTO public.messages (id, conversation_id, sender_id, body) VALUES (%L, %L, %L, 'no file')$q$,
  t.id('plain'), t.id('chat'), t.id('sender')), 'a message with no attachment is unaffected');
SELECT t.throws(format($q$INSERT INTO public.messages (conversation_id, sender_id, attachment_path, attachment_type) VALUES (%L, %L, %L, 'image/png')$q$,
  t.id('chat'), t.id('sender'), t.id('chat') || '/' || t.id('sender') || '/unchecked.html'),
  'ATTACHMENT_NOT_CHECKED', 'an attachment that was never checked is refused');
SELECT t.lives(format($q$INSERT INTO public.messages (id, conversation_id, sender_id, attachment_path, attachment_type, attachment_size) VALUES (%L, %L, %L, %L, 'application/x-msdownload', 1)$q$,
  t.id('checked'), t.id('chat'), t.id('sender'), t.id('chat') || '/' || t.id('sender') || '/ok.png'),
  'a checked attachment is accepted even when the client claims another type');
SELECT t.reset();
SELECT t.eq((SELECT attachment_type FROM public.messages WHERE id = t.id('checked')), 'image/png', 'and the stored type is the checked one');
SELECT t.eq((SELECT attachment_size FROM public.messages WHERE id = t.id('checked')), 1234, 'and the stored size is the checked size');

-- A check belongs to its sender and its conversation.
SELECT t.as_user(t.id('friend'));
SELECT t.throws(format($q$INSERT INTO public.messages (conversation_id, sender_id, attachment_path) VALUES (%L, %L, %L)$q$,
  t.id('chat'), t.id('friend'), t.id('chat') || '/' || t.id('sender') || '/ok.png'),
  'ATTACHMENT_NOT_CHECKED', 'another participant cannot reuse the sender''s checked file');
SELECT t.as_user(t.id('sender'));
SELECT t.throws(format($q$INSERT INTO public.messages (conversation_id, sender_id, attachment_path) VALUES (%L, %L, %L)$q$,
  t.id('other-chat'), t.id('sender'), t.id('chat') || '/' || t.id('sender') || '/ok.png'),
  'ATTACHMENT_NOT_CHECKED', 'and the sender cannot move it into a different conversation');

-- Nobody but the server can write a check.
SELECT t.throws(format($q$INSERT INTO public.message_attachment_checks (path, user_id, conversation_id, kind, mime, bytes) VALUES (%L, %L, %L, 'image', 'image/png', 1)$q$,
  t.id('chat') || '/' || t.id('sender') || '/forged.png', t.id('sender'), t.id('chat')),
  'permission denied', 'a member cannot write their own check');
SELECT t.as_anon();
SELECT t.throws($q$SELECT 1 FROM public.message_attachment_checks$q$, 'permission denied', 'a visitor cannot read them');
SELECT t.reset();

ROLLBACK;
