-- A file that has been uploaded but not sent is private to whoever uploaded it.
--
-- Attachments are now uploaded as soon as they are picked, so that Send has
-- little or nothing left to wait for. The read policy let every participant of
-- a conversation read — and list — everything under that conversation's
-- folder. That was harmless while a file existed only for the instant between
-- its upload and the message that referenced it. With uploads on pick, a file
-- can sit there for as long as the sender takes to compose, or indefinitely if
-- they change their mind and close the app, and the other person could read it
-- through the storage API even though no screen shows it. Visibility in the UI
-- is not an authorization boundary, so the policy now says it.
--
-- A participant may read an object when either
--   - they uploaded it (second path segment is their id), which is also what
--     lets the upload itself succeed, since a new row is checked against the
--     read policy on its way back out; or
--   - a message in that conversation points at it.
-- The reference check also means an unsent message's file stops being readable
-- by the recipient the moment the message is unsent or removed, and that a
-- message in one conversation cannot be used to read a file from another.
--
-- The lookup runs once per object read, so messages gets an index on the path.
--
-- Sending and viewing attachments behave exactly as before for the people who
-- can see the message; only files nobody has sent yet are affected.

CREATE INDEX IF NOT EXISTS messages_attachment_path_idx
  ON public.messages (attachment_path)
  WHERE attachment_path IS NOT NULL;

DROP POLICY IF EXISTS "msg_attach_read_participants" ON storage.objects;

CREATE POLICY "msg_attach_read_participants"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'message-attachments'
  AND public.is_conversation_participant(
    (split_part(name, '/', 1))::uuid,
    auth.uid()
  )
  AND (
    auth.uid()::text = split_part(name, '/', 2)
    OR EXISTS (
      SELECT 1
      FROM public.messages m
      WHERE m.attachment_path = objects.name
        AND m.conversation_id = (split_part(objects.name, '/', 1))::uuid
        AND m.deleted_at IS NULL
    )
  )
);
