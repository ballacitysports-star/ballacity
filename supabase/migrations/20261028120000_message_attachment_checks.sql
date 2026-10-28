-- A chat attachment is only accepted once the server has looked at it.
--
-- Until now a file went from the browser straight into the private
-- `message-attachments` bucket and the message row named it. Every check (type,
-- size) ran in the browser, `attachment_type` was whatever the browser said, and
-- pictures never went through the safety scan that profile photos get, so a
-- changed client could send any file type to anyone it could message, including
-- a minor.
--
-- The new server function `finalizeMessageAttachment` reads the stored bytes,
-- allows only JPG/PNG/WEBP pictures, MP4/MOV/WEBM videos and PDFs up to 20 MB,
-- scans pictures, deletes anything refused, and writes a row here. This trigger
-- then refuses a message whose attachment has no matching row for the same
-- sender and conversation, and replaces the type and size with the checked ones.
--
-- ORDER OF ROLLOUT: publish the app version that calls the server function
-- BEFORE applying this migration. An older open tab keeps sending attachments
-- without the check and will be refused until it reloads.
--
-- Existing messages are not touched. Server code (auth.uid() IS NULL) is exempt.
--
-- ROLLBACK: DROP TRIGGER messages_require_checked_attachment ON public.messages;
-- DROP FUNCTION public.messages_require_checked_attachment();
-- DROP TABLE public.message_attachment_checks; no message data changes.

CREATE TABLE IF NOT EXISTS public.message_attachment_checks (
  path text PRIMARY KEY,
  user_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('image', 'video', 'pdf')),
  mime text NOT NULL,
  bytes bigint NOT NULL,
  checked_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.message_attachment_checks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.message_attachment_checks FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.message_attachment_checks TO service_role;

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
  NEW.attachment_type := chk.mime;
  NEW.attachment_size := chk.bytes;
  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.messages_require_checked_attachment() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS messages_require_checked_attachment ON public.messages;
CREATE TRIGGER messages_require_checked_attachment
  BEFORE INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.messages_require_checked_attachment();
