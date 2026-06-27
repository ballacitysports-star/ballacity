
ALTER TABLE public.messages ALTER COLUMN body DROP NOT NULL;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS attachment_path text;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS attachment_type text;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS attachment_name text;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS attachment_size integer;
ALTER TABLE public.messages ADD CONSTRAINT messages_body_or_attachment_chk
  CHECK (
    (body IS NOT NULL AND length(btrim(body)) > 0)
    OR attachment_path IS NOT NULL
  );

-- Storage policies for message-attachments bucket
-- Path convention: <conversation_id>/<sender_id>/<filename>
CREATE POLICY "msg_attach_read_participants"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'message-attachments'
  AND public.is_conversation_participant(
    (split_part(name, '/', 1))::uuid,
    auth.uid()
  )
);

CREATE POLICY "msg_attach_insert_sender"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'message-attachments'
  AND auth.uid()::text = split_part(name, '/', 2)
  AND public.is_conversation_participant(
    (split_part(name, '/', 1))::uuid,
    auth.uid()
  )
);

CREATE POLICY "msg_attach_delete_sender"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'message-attachments'
  AND auth.uid()::text = split_part(name, '/', 2)
);
