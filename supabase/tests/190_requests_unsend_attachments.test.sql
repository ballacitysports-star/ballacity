-- Four rules in messaging that the client cannot enforce for itself:
--   * a refusal says whose account the rule is about (the sender's or the other person's),
--   * a recipient can accept a message request and do nothing else to the message,
--   * unsending empties a message, but only the sender can do it and a live message still needs content,
--   * a file nobody has sent yet is private to whoever uploaded it.
BEGIN;

-- The test platform stub gives API roles no table grants on storage.objects;
-- Supabase gives them all and leaves the rest to RLS. Mirror that here (rolled
-- back with the transaction) so the policies are what is being tested.
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated;

SELECT t.person('alice', 30), t.person('bob', 31), t.person('carol', 32),
       t.person('parent', 41), t.person('teen', 14);
SELECT t.guardian('parent', 'teen');
UPDATE public.child_controls SET messaging = 'peers' WHERE child_user_id = t.id('teen');

INSERT INTO public.conversations (id, created_by) VALUES (t.id('conv'), t.id('alice')), (t.id('other'), t.id('carol'));
INSERT INTO public.conversation_participants (conversation_id, user_id) VALUES
  (t.id('conv'), t.id('alice')), (t.id('conv'), t.id('bob')),
  (t.id('other'), t.id('carol')), (t.id('other'), t.id('bob'));

-- ---- a refusal names whose account it is about ---------------------------------
-- The app words the message differently for the sender's own restriction and for
-- the other person's, so the database has to say which it is.
SELECT t.as_user(t.id('alice'));
SELECT t.throws(format('SELECT public.create_direct_conversation(%L)', t.id('teen')),
  'MINOR_MESSAGING_BLOCKED:teen_needs_shared_game:other', 'an adult is told the restriction is on the other person');
SELECT t.as_user(t.id('teen'));
SELECT t.throws(format('SELECT public.create_direct_conversation(%L)', t.id('alice')),
  'MINOR_MESSAGING_BLOCKED:teen_needs_shared_game:self', 'and the 13-15 is told it is on their own account');
SELECT t.reset();

UPDATE public.child_controls SET messaging = 'off' WHERE child_user_id = t.id('teen');
SELECT t.as_user(t.id('alice'));
SELECT t.throws(format('SELECT public.create_direct_conversation(%L)', t.id('teen')),
  'MINOR_MESSAGING_BLOCKED:messaging_off:other', 'messaging switched off: the adult is told it is the other person''s setting');
SELECT t.as_user(t.id('teen'));
SELECT t.throws(format('SELECT public.create_direct_conversation(%L)', t.id('alice')),
  'MINOR_MESSAGING_BLOCKED:messaging_off:self', 'and the teen is told it is their own');
SELECT t.reset();

-- ---- a recipient accepts a request, and can do nothing else to the message ------
SELECT t.as_user(t.id('alice'));
SELECT t.lives(format($q$INSERT INTO public.messages (id, conversation_id, sender_id, body) VALUES (%L, %L, %L, 'hi, new here')$q$,
  t.id('m1'), t.id('conv'), t.id('alice')), 'a first message to someone who has not accepted');
SELECT t.reset();
SELECT t.ok((SELECT is_request FROM public.messages WHERE id = t.id('m1')), 'starts as a request');

SELECT t.as_user(t.id('bob'));
SELECT t.lives(format('SELECT public.accept_conversation(%L)', t.id('conv')), 'the recipient accepts the request');
SELECT t.reset();
SELECT t.ok(NOT (SELECT is_request FROM public.messages WHERE id = t.id('m1')), 'which clears the request flag');

-- The guard on messages sees the recipient's identity even inside accept_conversation,
-- so a recipient may clear the flag and nothing else. Acting as bob on the table directly:
SELECT set_config('request.jwt.claim.sub', t.id('bob')::text, true);
SELECT t.throws(format($q$UPDATE public.messages SET is_request = true WHERE id = %L$q$, t.id('m1')),
  'MESSAGE_FIELD_FORBIDDEN', 'a recipient cannot turn a message back into a request');
SELECT t.throws(format($q$UPDATE public.messages SET body = 'edited' WHERE id = %L$q$, t.id('m1')),
  'MESSAGE_FIELD_FORBIDDEN', 'or change what it says');
SELECT t.throws(format($q$UPDATE public.messages SET sender_id = %L WHERE id = %L$q$, t.id('bob'), t.id('m1')),
  'MESSAGE_FIELD_FORBIDDEN', 'or who sent it');
SELECT t.lives(format($q$UPDATE public.messages SET read_at = now() WHERE id = %L$q$, t.id('m1')),
  'but can still mark it read');
SELECT set_config('request.jwt.claim.sub', '', true);

-- ---- unsending -----------------------------------------------------------------
INSERT INTO public.messages (id, conversation_id, sender_id, body) VALUES (t.id('m2'), t.id('conv'), t.id('alice'), 'oops');
INSERT INTO public.messages (id, conversation_id, sender_id, attachment_path, attachment_type, attachment_name, attachment_size)
VALUES (t.id('m3'), t.id('conv'), t.id('alice'), t.id('conv') || '/' || t.id('alice') || '/wrong.png', 'image/png', 'wrong.png', 10);

SELECT t.as_user(t.id('bob'));
SELECT t.lives(format('SELECT public.unsend_message(%L)', t.id('m2')), 'asking to unsend someone else''s message does not error');
SELECT t.reset();
SELECT t.ok((SELECT deleted_at IS NULL AND body = 'oops' FROM public.messages WHERE id = t.id('m2')),
  'but changes nothing: only the sender can unsend');

SELECT t.as_user(t.id('alice'));
SELECT t.lives(format('SELECT public.unsend_message(%L)', t.id('m2')), 'the sender unsends a text message');
SELECT t.lives(format('SELECT public.unsend_message(%L)', t.id('m3')), 'and a message that is only a file');
SELECT t.reset();
SELECT t.ok((SELECT body IS NULL AND deleted_at IS NOT NULL FROM public.messages WHERE id = t.id('m2')),
  'the text is gone and the message is marked removed');
SELECT t.ok((SELECT attachment_path IS NULL AND attachment_name IS NULL AND deleted_at IS NOT NULL FROM public.messages WHERE id = t.id('m3')),
  'the file reference is gone too');

-- Being allowed to be empty after unsend must not let a live message be empty.
SELECT t.as_user(t.id('alice'));
SELECT t.throws(format($q$INSERT INTO public.messages (conversation_id, sender_id, body) VALUES (%L, %L, '   ')$q$,
  t.id('conv'), t.id('alice')), 'messages_body_or_attachment_chk', 'a blank message is still refused');
SELECT t.throws(format($q$INSERT INTO public.messages (conversation_id, sender_id) VALUES (%L, %L)$q$,
  t.id('conv'), t.id('alice')), 'messages_body_or_attachment_chk', 'and so is one with nothing in it');
SELECT t.reset();

-- ---- a file nobody has sent yet is private to whoever uploaded it ----------------
-- The one object in the bucket is the file under test. Every "cannot read" below is paired
-- with a "can read" for someone else, so a query that fails outright cannot pass for it.
INSERT INTO storage.objects (bucket_id, name, owner)
VALUES ('message-attachments', t.id('conv') || '/' || t.id('alice') || '/draft.png', t.id('alice'));

SELECT t.as_user(t.id('alice'));
SELECT t.eq(t.count($q$SELECT 1 FROM storage.objects WHERE bucket_id = 'message-attachments'$q$), 1, 'the uploader reads their own unsent file');
SELECT t.as_user(t.id('bob'));
SELECT t.eq(t.count($q$SELECT 1 FROM storage.objects WHERE bucket_id = 'message-attachments'$q$), 0,
  'the other person in the conversation cannot read it, or list it');
SELECT t.as_user(t.id('carol'));
SELECT t.eq(t.count($q$SELECT 1 FROM storage.objects WHERE bucket_id = 'message-attachments'$q$), 0, 'someone outside the conversation cannot either');
SELECT t.reset();

-- Once a message in that conversation carries it, the other person can read it.
INSERT INTO public.messages (id, conversation_id, sender_id, attachment_path, attachment_type, attachment_name, attachment_size)
VALUES (t.id('m4'), t.id('conv'), t.id('alice'), t.id('conv') || '/' || t.id('alice') || '/draft.png', 'image/png', 'draft.png', 10);
SELECT t.as_user(t.id('bob'));
SELECT t.eq(t.count($q$SELECT 1 FROM storage.objects WHERE bucket_id = 'message-attachments'$q$), 1, 'sent: the other person reads it');
SELECT t.as_user(t.id('carol'));
SELECT t.eq(t.count($q$SELECT 1 FROM storage.objects WHERE bucket_id = 'message-attachments'$q$), 0, 'but an outsider still cannot');
SELECT t.reset();

-- A message in a different conversation that points at the same file does not open it up.
INSERT INTO public.messages (conversation_id, sender_id, attachment_path, attachment_type, attachment_name, attachment_size)
VALUES (t.id('other'), t.id('carol'), t.id('conv') || '/' || t.id('alice') || '/draft.png', 'image/png', 'draft.png', 10);
SELECT t.as_user(t.id('carol'));
SELECT t.eq(t.count($q$SELECT 1 FROM storage.objects WHERE bucket_id = 'message-attachments'$q$), 0,
  'a reference from another conversation does not expose it');
SELECT t.reset();

-- A removed message stops exposing its file.
UPDATE public.messages SET deleted_at = now() WHERE id = t.id('m4');
SELECT t.as_user(t.id('bob'));
SELECT t.eq(t.count($q$SELECT 1 FROM storage.objects WHERE bucket_id = 'message-attachments'$q$), 0, 'once the message is removed the other person cannot read it');
SELECT t.as_user(t.id('alice'));
SELECT t.eq(t.count($q$SELECT 1 FROM storage.objects WHERE bucket_id = 'message-attachments'$q$), 1, 'the uploader still can');
SELECT t.reset();

ROLLBACK;
