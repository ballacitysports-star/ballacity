-- A check vouches for the stored object that was checked (20261106120500): replacing the file at the same path, before or after
-- the message is sent, does not carry the check over.
BEGIN;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated, service_role;

SELECT t.person('sender', 30), t.person('friend', 31);
INSERT INTO public.conversations (id, created_by) VALUES (t.id('chat'), t.id('sender'));
INSERT INTO public.conversation_participants (conversation_id, user_id) VALUES (t.id('chat'), t.id('sender')), (t.id('chat'), t.id('friend'));
CREATE TEMP TABLE p212 AS SELECT t.id('chat') || '/' || t.id('sender') || '/' AS dir;
GRANT SELECT ON p212 TO PUBLIC;

-- the sender uploads three files; the server checks each and records the object id it checked
SELECT t.as_user(t.id('sender'));
SELECT t.lives(format($q$INSERT INTO storage.objects (id, bucket_id, name, owner) VALUES (%L, 'message-attachments', %L, auth.uid())$q$,
  t.id('obj-good'), (SELECT dir FROM p212) || 'good.png'), 'the sender uploads a file');
SELECT t.lives(format($q$INSERT INTO storage.objects (id, bucket_id, name, owner) VALUES (%L, 'message-attachments', %L, auth.uid())$q$,
  t.id('obj-swap'), (SELECT dir FROM p212) || 'swap.png'), 'and another');
SELECT t.lives(format($q$INSERT INTO storage.objects (id, bucket_id, name, owner) VALUES (%L, 'message-attachments', %L, auth.uid())$q$,
  t.id('obj-after'), (SELECT dir FROM p212) || 'after.png'), 'and a third');
SELECT t.reset();
INSERT INTO public.message_attachment_checks (path, user_id, conversation_id, kind, mime, bytes, object_id)
SELECT (SELECT dir FROM p212) || f, t.id('sender'), t.id('chat'), 'image', 'image/png', 10, t.id('obj-' || split_part(f, '.', 1))
  FROM unnest(ARRAY['good.png', 'swap.png', 'after.png']) f;
INSERT INTO public.message_attachment_checks (path, user_id, conversation_id, kind, mime, bytes)  -- recorded before this migration
VALUES ((SELECT dir FROM p212) || 'legacy.png', t.id('sender'), t.id('chat'), 'image', 'image/png', 10);
INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('message-attachments', (SELECT dir FROM p212) || 'legacy.png', t.id('sender'));

-- 1. after the check, the sender deletes the checked file and uploads another at the same path
SELECT t.as_user(t.id('sender'));
SELECT t.eq(t.changed(format($q$DELETE FROM storage.objects WHERE bucket_id = 'message-attachments' AND name = %L$q$, (SELECT dir FROM p212) || 'swap.png')), 1,
            'the sender can still delete their own unsent file');
SELECT t.throws(format($q$INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('message-attachments', %L, auth.uid())$q$, (SELECT dir FROM p212) || 'swap.png'),
            'row-level security', 'but cannot upload another file at a path that has been checked');
SELECT t.reset();
-- even if a replacement got there some other way (e.g. a policy gap), it is a new object and the check does not cover it
INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('message-attachments', (SELECT dir FROM p212) || 'swap.png', t.id('sender'));
SELECT t.as_user(t.id('sender'));
SELECT t.throws(format($q$INSERT INTO public.messages (conversation_id, sender_id, attachment_path) VALUES (%L, %L, %L)$q$,
  t.id('chat'), t.id('sender'), (SELECT dir FROM p212) || 'swap.png'), 'changed after it was checked', 'a message naming the swapped file is refused');
SELECT t.throws(format($q$INSERT INTO public.messages (conversation_id, sender_id, attachment_path) VALUES (%L, %L, %L)$q$,
  t.id('chat'), t.id('sender'), (SELECT dir FROM p212) || 'gone.png'), 'ATTACHMENT_NOT_CHECKED', 'and so is one naming a path that was never checked');
SELECT t.throws(format($q$INSERT INTO public.messages (conversation_id, sender_id, attachment_path) VALUES (%L, %L, %L)$q$,
  t.id('chat'), t.id('sender'), (SELECT dir FROM p212) || 'legacy.png'), 'changed after it was checked', 'a check with no object id (recorded before the binding) is refused');

-- 2. the untouched checked file is sent normally
SELECT t.lives(format($q$INSERT INTO public.messages (id, conversation_id, sender_id, attachment_path) VALUES (%L, %L, %L, %L)$q$,
  t.id('m-good'), t.id('chat'), t.id('sender'), (SELECT dir FROM p212) || 'good.png'), 'the checked, unchanged file is sent');
-- 3. a file deleted after the check and never replaced cannot be sent
SELECT t.eq(t.changed(format($q$DELETE FROM storage.objects WHERE bucket_id = 'message-attachments' AND name = %L$q$, (SELECT dir FROM p212) || 'after.png')), 1,
            'the sender deletes a checked file before sending');
SELECT t.throws(format($q$INSERT INTO public.messages (conversation_id, sender_id, attachment_path) VALUES (%L, %L, %L)$q$,
  t.id('chat'), t.id('sender'), (SELECT dir FROM p212) || 'after.png'), 'changed after it was checked', 'a message naming a checked file that is gone is refused');

-- 4. after sending, the file the recipient reads cannot be swapped: delete works, re-upload at that path does not
SELECT t.eq(t.changed(format($q$DELETE FROM storage.objects WHERE bucket_id = 'message-attachments' AND name = %L$q$, (SELECT dir FROM p212) || 'good.png')), 1,
            'the sender may delete a sent file (unsend)');
SELECT t.throws(format($q$INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('message-attachments', %L, auth.uid())$q$, (SELECT dir FROM p212) || 'good.png'),
            'row-level security', 'but cannot put a different file where the recipient will read it');
-- a fresh path still uploads normally
SELECT t.lives(format($q$INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('message-attachments', %L, auth.uid())$q$, (SELECT dir FROM p212) || 'new.png'),
            'a new, unchecked path uploads normally');
SELECT t.reset();

-- 5. the server path is unaffected, and nobody else can use the helper
SELECT t.as_service();
SELECT t.lives(format($q$INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('message-attachments', %L, %L)$q$, (SELECT dir FROM p212) || 'good.png', t.id('sender')),
            'the service role can still write at a checked path (the clean rewrite)');
SELECT t.reset();
SELECT t.ok(NOT has_function_privilege('anon', 'private_sec.message_attachment_path_checked(text)', 'EXECUTE'), 'anonymous cannot call the path helper');
SELECT t.ok((SELECT prosecdef FROM pg_proc WHERE oid = 'private_sec.message_attachment_path_checked(text)'::regprocedure), 'the helper is SECURITY DEFINER (members cannot read the check table)');
ROLLBACK;
