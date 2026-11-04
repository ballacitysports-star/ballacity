-- A chat attachment check vouches for the exact file that was checked, not for whatever later sits at the same path.
--
-- WHY. 20261028120000 made a message with an attachment require a server check row for its path, sender and conversation. The
-- row named the PATH only. The sender may delete their own unsent file (msg_attach_delete_sender) and upload another at the same
-- path, so after a passing check they could swap in a file that was never typed, size-checked, cleaned or scanned, and send it.
--
-- WHAT THIS DOES. The server now stores the checked object's storage.objects.id in message_attachment_checks.object_id
-- (finalizeAttachment in src/lib/message-attachment-finalize.server.ts reads the id before downloading and again after every check,
-- and records nothing if it moved). The trigger accepts a message only while the object at that path still has that id. A deleted
-- and re-uploaded file is a new row with a new id. Senders have no UPDATE policy on this bucket, so the bytes of an object cannot
-- change under the same id.
-- A checked path is also burned for browser uploads (RESTRICTIVE insert policy below): once a check exists, the sender cannot put
-- another file there, so a file swapped in AFTER the message was sent (delete, then upload at the same path, which the recipient
-- would read through msg_attach_read_participants) is refused too. The client names every upload `{ms timestamp}-{name}` and a
-- refused file has no check row, so a normal re-pick never reuses a checked path.
--
-- ORDER OF ROLLOUT: the app first (it writes object_id, and on a database without this column retries without it), then this
-- migration. A check recorded before this migration has no object_id and is refused at send; the client re-checks on the next pick.
-- Existing messages are not touched. Server code (auth.uid() IS NULL) stays exempt, as before.
--
-- ROLLBACK: re-run the function body from 20261028120000; DROP POLICY "msg_attach_checked_path_is_final" ON storage.objects;
-- DROP FUNCTION private_sec.message_attachment_path_checked(text); ALTER TABLE public.message_attachment_checks DROP COLUMN object_id.

DO $guard$
BEGIN
  IF to_regclass('public.message_attachment_checks') IS NULL THEN
    RAISE EXCEPTION 'attachment check binding: public.message_attachment_checks is missing; apply 20261028120000_message_attachment_checks first';
  END IF;
  IF to_regclass('storage.objects') IS NULL THEN
    RAISE EXCEPTION 'attachment check binding: storage.objects is missing';
  END IF;
  IF to_regnamespace('private_sec') IS NULL THEN
    RAISE EXCEPTION 'attachment check binding: schema private_sec is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'messages_require_checked_attachment'
                   AND tgrelid = 'public.messages'::regclass) THEN
    RAISE EXCEPTION 'attachment check binding: trigger messages_require_checked_attachment is missing; apply 20261028120000 first';
  END IF;
END
$guard$;

ALTER TABLE public.message_attachment_checks ADD COLUMN IF NOT EXISTS object_id uuid;
COMMENT ON COLUMN public.message_attachment_checks.object_id IS
  'storage.objects.id of the message-attachments object the server checked; the message-insert trigger requires the same object to still be at the path.';

CREATE OR REPLACE FUNCTION public.messages_require_checked_attachment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE chk public.message_attachment_checks%ROWTYPE;
BEGIN
  IF NEW.attachment_path IS NULL OR auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT * INTO chk FROM public.message_attachment_checks
   WHERE path = NEW.attachment_path
     AND user_id = NEW.sender_id
     AND conversation_id = NEW.conversation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ATTACHMENT_NOT_CHECKED: this file has not been checked, so it cannot be sent.'
      USING ERRCODE = '42501';
  END IF;
  IF chk.object_id IS NULL OR chk.object_id IS DISTINCT FROM (
       SELECT o.id FROM storage.objects o
        WHERE o.bucket_id = 'message-attachments' AND o.name = NEW.attachment_path) THEN
    RAISE EXCEPTION 'ATTACHMENT_NOT_CHECKED: this file changed after it was checked, so it cannot be sent.'
      USING ERRCODE = '42501';
  END IF;
  NEW.attachment_type := chk.mime;
  NEW.attachment_size := chk.bytes;
  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.messages_require_checked_attachment() FROM PUBLIC, anon, authenticated;

-- A path the server has checked can never be uploaded to again from the browser (see WHAT THIS DOES).
CREATE OR REPLACE FUNCTION private_sec.message_attachment_path_checked(_path text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.message_attachment_checks c WHERE c.path = _path)
$function$;
REVOKE ALL ON FUNCTION private_sec.message_attachment_path_checked(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private_sec.message_attachment_path_checked(text) TO authenticated, service_role;

DROP POLICY IF EXISTS "msg_attach_checked_path_is_final" ON storage.objects;
CREATE POLICY "msg_attach_checked_path_is_final" ON storage.objects AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (bucket_id IS DISTINCT FROM 'message-attachments' OR NOT private_sec.message_attachment_path_checked(name));
