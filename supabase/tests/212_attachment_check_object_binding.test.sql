-- A check vouches for the stored object that was checked (20261106120500): its id AND its version. Replacing the file at the same
-- path, before or after the message is sent, by any writer, does not carry the check over, and once checked, the path is final.
BEGIN;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated, service_role;

SELECT t.person('sender', 30), t.person('friend', 31);
INSERT INTO public.conversations (id, created_by) VALUES (t.id('chat'), t.id('sender'));
INSERT INTO public.conversation_participants (conversation_id, user_id) VALUES (t.id('chat'), t.id('sender')), (t.id('chat'), t.id('friend'));
CREATE TEMP TABLE p212 AS SELECT t.id('chat') || '/' || t.id('sender') || '/' AS dir;
GRANT SELECT ON p212 TO PUBLIC;

-- Storage's write for a signed upload URL: it runs as the service role (outside RLS, which was checked only when the URL was signed),
-- stamps the token's signer as owner, and with upsert in the token is INSERT ... ON CONFLICT (bucket_id, name) DO UPDATE:
-- the same object id, a new version, new bytes. sim212(path, owner, version) reproduces that statement.
CREATE FUNCTION pg_temp.storage_put(_path text, _owner uuid, _version text) RETURNS void LANGUAGE sql AS $f$
  INSERT INTO storage.objects (bucket_id, name, owner, owner_id, version, metadata)
  VALUES ('message-attachments', _path, _owner, _owner::text, _version, '{"size": 2}')
  ON CONFLICT (bucket_id, name) DO UPDATE
    SET version = EXCLUDED.version, owner = EXCLUDED.owner, owner_id = EXCLUDED.owner_id, metadata = EXCLUDED.metadata
$f$;
GRANT EXECUTE ON FUNCTION pg_temp.storage_put(text, uuid, text) TO PUBLIC;

-- the sender uploads files; the server checks each and records the object id and version it checked
SELECT t.as_user(t.id('sender'));
SELECT t.lives(format($q$INSERT INTO storage.objects (id, bucket_id, name, owner, version) VALUES (%L, 'message-attachments', %L, auth.uid(), 'v1')$q$,
  t.id('obj-good'), (SELECT dir FROM p212) || 'good.png'), 'the sender uploads a file');
SELECT t.lives(format($q$INSERT INTO storage.objects (id, bucket_id, name, owner, version) VALUES (%L, 'message-attachments', %L, auth.uid(), 'v1')$q$,
  t.id('obj-swap'), (SELECT dir FROM p212) || 'swap.png'), 'and another');
SELECT t.lives(format($q$INSERT INTO storage.objects (id, bucket_id, name, owner, version) VALUES (%L, 'message-attachments', %L, auth.uid(), 'v1')$q$,
  t.id('obj-after'), (SELECT dir FROM p212) || 'after.png'), 'and a third');
SELECT t.lives(format($q$INSERT INTO storage.objects (id, bucket_id, name, owner, version) VALUES (%L, 'message-attachments', %L, auth.uid(), 'v1')$q$,
  t.id('obj-upsert'), (SELECT dir FROM p212) || 'upsert.png'), 'and a fourth, through a signed URL minted with upsert');
SELECT t.lives(format($q$INSERT INTO storage.objects (id, bucket_id, name, owner, version) VALUES (%L, 'message-attachments', %L, auth.uid(), 'v1')$q$,
  t.id('obj-sent'), (SELECT dir FROM p212) || 'sent.png'), 'and a fifth');
SELECT t.reset();
INSERT INTO public.message_attachment_checks (path, user_id, conversation_id, kind, mime, bytes, object_id, object_version)
SELECT (SELECT dir FROM p212) || f, t.id('sender'), t.id('chat'), 'image', 'image/png', 10, t.id('obj-' || split_part(f, '.', 1)), 'v1'
  FROM unnest(ARRAY['good.png', 'swap.png', 'after.png', 'upsert.png', 'sent.png']) f;
INSERT INTO public.message_attachment_checks (path, user_id, conversation_id, kind, mime, bytes)  -- recorded before this migration
VALUES ((SELECT dir FROM p212) || 'legacy.png', t.id('sender'), t.id('chat'), 'image', 'image/png', 10);
INSERT INTO storage.objects (bucket_id, name, owner, version) VALUES ('message-attachments', (SELECT dir FROM p212) || 'legacy.png', t.id('sender'), 'v1');
INSERT INTO public.message_attachment_checks (path, user_id, conversation_id, kind, mime, bytes, object_id)  -- id but no version
VALUES ((SELECT dir FROM p212) || 'noversion.png', t.id('sender'), t.id('chat'), 'image', 'image/png', 10, t.id('obj-noversion'));
INSERT INTO storage.objects (id, bucket_id, name, owner, version) VALUES (t.id('obj-noversion'), 'message-attachments', (SELECT dir FROM p212) || 'noversion.png', t.id('sender'), 'v1');

-- 1. H1: after the check, Storage overwrites the checked file through the sender's signed upload URL (same id, new version)
SELECT t.as_service();
SELECT t.throws(format($q$SELECT pg_temp.storage_put(%L, %L, 'v2')$q$, (SELECT dir FROM p212) || 'upsert.png', t.id('sender')),
            'ATTACHMENT_PATH_FINAL', 'H1: Storage''s privileged upsert for the sender''s signed URL cannot overwrite a checked file');
SELECT t.reset();
SELECT t.eq((SELECT version FROM storage.objects WHERE bucket_id = 'message-attachments' AND name = (SELECT dir FROM p212) || 'upsert.png'), 'v1',
            'the checked bytes (version) are still the ones at the path');
-- even if an overwrite got there some other way (a superuser, as in this setup), the new version is not what was checked
SELECT pg_temp.storage_put((SELECT dir FROM p212) || 'upsert.png', t.id('sender'), 'v2');
SELECT t.eq((SELECT id FROM storage.objects WHERE bucket_id = 'message-attachments' AND name = (SELECT dir FROM p212) || 'upsert.png'), t.id('obj-upsert'),
            '(the overwrite kept the object id, as Storage''s upsert does)');
SELECT t.as_user(t.id('sender'));
SELECT t.throws(format($q$INSERT INTO public.messages (conversation_id, sender_id, attachment_path) VALUES (%L, %L, %L)$q$,
  t.id('chat'), t.id('sender'), (SELECT dir FROM p212) || 'upsert.png'), 'changed after it was checked',
  'H1: a message naming a file overwritten in place (same id, new version) is refused');
SELECT t.throws(format($q$INSERT INTO public.messages (conversation_id, sender_id, attachment_path) VALUES (%L, %L, %L)$q$,
  t.id('chat'), t.id('sender'), (SELECT dir FROM p212) || 'noversion.png'), 'changed after it was checked',
  'a check with an id but no version is refused');

-- 2. the sender deletes the checked (unsent) file and uploads another at the same path
SELECT t.eq(t.changed(format($q$DELETE FROM storage.objects WHERE bucket_id = 'message-attachments' AND name = %L$q$, (SELECT dir FROM p212) || 'swap.png')), 1,
            'the sender can still delete their own unsent file');
SELECT t.throws(format($q$INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('message-attachments', %L, auth.uid())$q$, (SELECT dir FROM p212) || 'swap.png'),
            'ATTACHMENT_PATH_FINAL', 'but cannot upload another file at a path that has been checked');
SELECT t.reset();
SELECT t.as_service();
SELECT t.throws(format($q$SELECT pg_temp.storage_put(%L, %L, 'v9')$q$, (SELECT dir FROM p212) || 'swap.png', t.id('sender')),
            'ATTACHMENT_PATH_FINAL', 'H1: nor through a second signed URL minted before the check (Storage''s privileged insert)');
SELECT t.reset();
-- even if a replacement got there some other way (a superuser), it is a new object and the check does not cover it
INSERT INTO storage.objects (bucket_id, name, owner, version) VALUES ('message-attachments', (SELECT dir FROM p212) || 'swap.png', t.id('sender'), 'v1');
SELECT t.as_user(t.id('sender'));
SELECT t.throws(format($q$INSERT INTO public.messages (conversation_id, sender_id, attachment_path) VALUES (%L, %L, %L)$q$,
  t.id('chat'), t.id('sender'), (SELECT dir FROM p212) || 'swap.png'), 'changed after it was checked', 'a message naming the swapped file is refused');
SELECT t.throws(format($q$INSERT INTO public.messages (conversation_id, sender_id, attachment_path) VALUES (%L, %L, %L)$q$,
  t.id('chat'), t.id('sender'), (SELECT dir FROM p212) || 'gone.png'), 'ATTACHMENT_NOT_CHECKED', 'and so is one naming a path that was never checked');
SELECT t.throws(format($q$INSERT INTO public.messages (conversation_id, sender_id, attachment_path) VALUES (%L, %L, %L)$q$,
  t.id('chat'), t.id('sender'), (SELECT dir FROM p212) || 'legacy.png'), 'changed after it was checked', 'a check with no object id (recorded before the binding) is refused');

-- 3. the untouched checked file is sent normally
SELECT t.lives(format($q$INSERT INTO public.messages (id, conversation_id, sender_id, attachment_path) VALUES (%L, %L, %L, %L)$q$,
  t.id('m-good'), t.id('chat'), t.id('sender'), (SELECT dir FROM p212) || 'good.png'), 'the checked, unchanged file is sent');
-- 4. a file deleted after the check and never replaced cannot be sent
SELECT t.eq(t.changed(format($q$DELETE FROM storage.objects WHERE bucket_id = 'message-attachments' AND name = %L$q$, (SELECT dir FROM p212) || 'after.png')), 1,
            'the sender deletes a checked file before sending');
SELECT t.throws(format($q$INSERT INTO public.messages (conversation_id, sender_id, attachment_path) VALUES (%L, %L, %L)$q$,
  t.id('chat'), t.id('sender'), (SELECT dir FROM p212) || 'after.png'), 'changed after it was checked', 'a message naming a checked file that is gone is refused');

-- 5. after sending, the file the recipient reads cannot be swapped: not deleted while the message is live, not re-uploaded, not overwritten
SELECT t.eq(t.changed(format($q$DELETE FROM storage.objects WHERE bucket_id = 'message-attachments' AND name = %L$q$, (SELECT dir FROM p212) || 'good.png')), 0,
            'H1: the sender cannot delete a file a live message names (the first step of a swap after sending)');
SELECT t.throws(format($q$INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('message-attachments', %L, auth.uid())$q$, (SELECT dir FROM p212) || 'good.png'),
            'ATTACHMENT_PATH_FINAL', 'nor put a different file where the recipient will read it');
SELECT t.reset();
SELECT t.as_service();
SELECT t.throws(format($q$SELECT pg_temp.storage_put(%L, %L, 'v2')$q$, (SELECT dir FROM p212) || 'good.png', t.id('sender')),
            'ATTACHMENT_PATH_FINAL', 'H1: nor overwrite it through a signed upload URL after sending');
SELECT t.reset();
SELECT t.eq((SELECT version FROM storage.objects WHERE bucket_id = 'message-attachments' AND name = (SELECT dir FROM p212) || 'good.png'), 'v1',
            'the recipient still reads the bytes that were checked');
-- unsend still removes the file: unsend_message clears the reference first, then the client deletes
SELECT t.as_user(t.id('sender'));
SELECT t.lives(format($q$SELECT public.unsend_message(%L)$q$, t.id('m-good')), 'the sender unsends the message');
SELECT t.eq(t.changed(format($q$DELETE FROM storage.objects WHERE bucket_id = 'message-attachments' AND name = %L$q$, (SELECT dir FROM p212) || 'good.png')), 1,
            'and can then delete the file');
SELECT t.throws(format($q$INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('message-attachments', %L, auth.uid())$q$, (SELECT dir FROM p212) || 'good.png'),
            'ATTACHMENT_PATH_FINAL', 'and the path stays burned');
-- a fresh path still uploads normally, and Storage's upsert on an unchecked path still works
SELECT t.lives(format($q$INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('message-attachments', %L, auth.uid())$q$, (SELECT dir FROM p212) || 'new.png'),
            'a new, unchecked path uploads normally');
SELECT t.reset();
SELECT t.as_service();
SELECT t.lives(format($q$SELECT pg_temp.storage_put(%L, %L, 'v2')$q$, (SELECT dir FROM p212) || 'new.png', t.id('sender')),
            'Storage may still overwrite an UNCHECKED upload (the sender re-picking before the check)');
SELECT t.reset();

-- 6. the server path is unaffected: its clean rewrite happens before the check exists, and the service key itself (no end-user
--    owner) or service code with the transaction flag may still write at a checked path
SELECT t.as_service();
SELECT t.lives(format($q$SELECT pg_temp.storage_put(%L, NULL, 'v5')$q$, (SELECT dir FROM p212) || 'sent.png'),
            'the service key itself (no end-user owner) can still write at a checked path');
SELECT t.lives(format($q$SELECT set_config('ballacity.storage_service_write', 'on', true), pg_temp.storage_put(%L, %L, 'v6')$q$, (SELECT dir FROM p212) || 'sent.png', t.id('sender')),
            'and so can service code that set the transaction flag');
SELECT set_config('ballacity.storage_service_write', '', true);
SELECT t.reset();
SELECT t.as_user(t.id('sender'));
SELECT t.throws(format($q$SELECT set_config('ballacity.storage_service_write', 'on', true); INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('message-attachments', %L, auth.uid())$q$,
            (SELECT dir FROM p212) || 'swap.png'), 'ATTACHMENT_PATH_FINAL', 'an API role setting the flag gains nothing');
SELECT set_config('ballacity.storage_service_write', '', true);
SELECT t.reset();
SELECT t.ok(NOT has_function_privilege('anon', 'private_sec.message_attachment_path_checked(text)', 'EXECUTE'), 'anonymous cannot call the path helper');
SELECT t.ok((SELECT prosecdef FROM pg_proc WHERE oid = 'private_sec.message_attachment_path_checked(text)'::regprocedure), 'the helper is SECURITY DEFINER (members cannot read the check table)');
SELECT t.ok((SELECT NOT prosecdef FROM pg_proc WHERE oid = 'private_sec.storage_write_is_trusted(uuid,text)'::regprocedure), 'the trust test runs as the writer (it reads current_user)');
ROLLBACK;
