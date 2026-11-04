-- A chat attachment check vouches for the exact file that was checked, not for whatever later sits at the same path.
--
-- WHY. 20261028120000 made a message with an attachment require a server check row for its path, sender and conversation. The
-- row named the PATH only. The sender may delete their own unsent file (msg_attach_delete_sender) and upload another at the same
-- path, so after a passing check they could swap in a file that was never typed, size-checked, cleaned or scanned, and send it.
--
-- WHAT THIS DOES. The server now stores the checked object's storage.objects.id AND version in message_attachment_checks
-- (object_id, object_version; finalizeAttachment in src/lib/message-attachment-finalize.server.ts reads both through Storage's
-- info() before downloading and again after every check, and records nothing if either moved). The trigger accepts a message only
-- while the object at that path still has that id and that version. A deleted and re-uploaded file is a new id; an overwrite in
-- place is a new version.
--
-- WHY THE VERSION, AND WHY TRIGGERS ON storage.objects. The client uploads attachments through a signed upload URL. Storage checks
-- RLS only when it signs the URL; the PUT (the token lives two hours) is written by Storage itself as the service role, outside RLS.
-- With upsert in the token that write is `INSERT ... ON CONFLICT (bucket_id, name) DO UPDATE`: same id, new version, new bytes. So
-- "senders have no UPDATE policy" did NOT mean the bytes behind an id were fixed: a sender could upload a benign file, let the server
-- check it, then PUT a different file through the same token. Two triggers below close that for every writer, because triggers fire
-- for Storage's privileged writes and RLS does not:
--   * BEFORE UPDATE: a message-attachments row whose path has a check row cannot be changed;
--   * BEFORE INSERT: a checked path cannot be uploaded to again (the old RESTRICTIVE policy did this for API roles only; a second
--     signed URL minted before the check would otherwise slip past it after a delete).
-- Both exempt only trusted writers (private_sec.storage_write_is_trusted, 20261106120000): a superuser, non-API service code with
-- the transaction-local flag, or the service key itself writing a row with no end-user owner. Storage stamps the token's signer as
-- the owner of a signed-URL write, so that write is not trusted although it runs as the service role. The server's own clean
-- rewrite happens before the check row exists, so it is unaffected.
-- A checked path is burned for good: once a check exists nobody but a trusted writer can put another file there, so a file swapped
-- in AFTER the message was sent (which the recipient would read through msg_attach_read_participants) is refused. The client names
-- every upload `{ms timestamp}-{name}` and a refused file has no check row, so a normal re-pick never reuses a checked path.
-- The sender may still delete their own unsent file, but no longer one a live (not unsent) message names: unsend_message clears
-- attachment_path first, and the client removes the file after it, so unsend keeps working.
--
-- ORDER OF ROLLOUT: the app first (it writes object_id and object_version, and on a database without these columns retries without
-- them), then this migration. A check recorded before this migration has no object_id/object_version and is refused at send; the
-- client re-checks on the next pick. Existing messages are not touched. Server code (auth.uid() IS NULL) stays exempt at send.
--
-- ROLLBACK: re-run the function body from 20261028120000; DROP TRIGGER message_attachment_checked_is_final ON storage.objects;
-- DROP FUNCTION private_sec.message_attachment_refuse_rewrite(); recreate msg_attach_delete_sender from 20260627124305;
-- DROP FUNCTION private_sec.message_attachment_in_live_message(text); DROP INDEX public.messages_attachment_path_live_idx;
-- DROP POLICY "msg_attach_checked_path_is_final" ON storage.objects; DROP FUNCTION private_sec.message_attachment_path_checked(text);
-- ALTER TABLE public.message_attachment_checks DROP COLUMN object_id, DROP COLUMN object_version.

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
  IF to_regprocedure('private_sec.storage_write_is_trusted(uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'attachment check binding: private_sec.storage_write_is_trusted is missing; apply 20261106120000_private_image_staging first';
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
ALTER TABLE public.message_attachment_checks ADD COLUMN IF NOT EXISTS object_version text;
COMMENT ON COLUMN public.message_attachment_checks.object_version IS
  'storage.objects.version of the checked object; an overwrite in place (same id) gets a new version, so the message-insert trigger requires both to match.';

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
  IF chk.object_id IS NULL OR chk.object_version IS NULL OR NOT EXISTS (
       SELECT 1 FROM storage.objects o
        WHERE o.bucket_id = 'message-attachments' AND o.name = NEW.attachment_path
          AND o.id = chk.object_id AND o.version = chk.object_version) THEN
    RAISE EXCEPTION 'ATTACHMENT_NOT_CHECKED: this file changed after it was checked, so it cannot be sent.'
      USING ERRCODE = '42501';
  END IF;
  NEW.attachment_type := chk.mime;
  NEW.attachment_size := chk.bytes;
  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.messages_require_checked_attachment() FROM PUBLIC, anon, authenticated;

-- A path the server has checked can never be written again except by a trusted writer (see WHAT THIS DOES).
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
DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_storage_admin') THEN
    GRANT EXECUTE ON FUNCTION private_sec.message_attachment_path_checked(text) TO supabase_storage_admin;
  END IF;
END
$grant$;

DROP POLICY IF EXISTS "msg_attach_checked_path_is_final" ON storage.objects;
CREATE POLICY "msg_attach_checked_path_is_final" ON storage.objects AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (bucket_id IS DISTINCT FROM 'message-attachments' OR NOT private_sec.message_attachment_path_checked(name));

-- Every writer, Storage's own signed-URL writes included (see WHY THE VERSION). SECURITY INVOKER: the trust test reads current_user.
CREATE OR REPLACE FUNCTION private_sec.message_attachment_refuse_rewrite()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF NEW.bucket_id IS DISTINCT FROM 'message-attachments'
     AND (TG_OP = 'INSERT' OR OLD.bucket_id IS DISTINCT FROM 'message-attachments') THEN
    RETURN NEW;
  END IF;
  IF private_sec.storage_write_is_trusted(NEW.owner, NEW.owner_id) THEN
    RETURN NEW;
  END IF;
  IF (NEW.bucket_id = 'message-attachments' AND private_sec.message_attachment_path_checked(NEW.name))
     OR (TG_OP = 'UPDATE' AND OLD.bucket_id = 'message-attachments' AND private_sec.message_attachment_path_checked(OLD.name)) THEN
    RAISE EXCEPTION 'ATTACHMENT_PATH_FINAL: this attachment has been checked and cannot be replaced.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION private_sec.message_attachment_refuse_rewrite() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS message_attachment_checked_is_final ON storage.objects;
CREATE TRIGGER message_attachment_checked_is_final BEFORE INSERT OR UPDATE ON storage.objects
  FOR EACH ROW EXECUTE FUNCTION private_sec.message_attachment_refuse_rewrite();

-- The sender may delete their own file only while no live message names it. Unsend (unsend_message) clears attachment_path and
-- stamps deleted_at before the client removes the file, so it still works; deleting a sent file and putting another in its place is
-- what this stops (the re-upload is also refused by the trigger above).
CREATE OR REPLACE FUNCTION private_sec.message_attachment_in_live_message(_path text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.messages m WHERE m.attachment_path = _path AND m.deleted_at IS NULL)
$function$;
REVOKE ALL ON FUNCTION private_sec.message_attachment_in_live_message(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private_sec.message_attachment_in_live_message(text) TO authenticated, service_role;
CREATE INDEX IF NOT EXISTS messages_attachment_path_live_idx ON public.messages (attachment_path)
  WHERE attachment_path IS NOT NULL AND deleted_at IS NULL;

DROP POLICY IF EXISTS "msg_attach_delete_sender" ON storage.objects;
CREATE POLICY "msg_attach_delete_sender" ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'message-attachments'
  AND auth.uid()::text = split_part(name, '/', 2)
  AND NOT private_sec.message_attachment_in_live_message(name)
);
