-- Make "Unsend" work.
--
-- unsend_message clears a message's body and attachment and stamps deleted_at,
-- leaving a tombstone. messages_body_or_attachment_chk required every row to
-- have visible text or an attachment, so that update was refused for every
-- message, text or file: unsending has never succeeded (no message in the
-- database has ever carried a deleted_at).
--
-- A message that has been unsent is allowed to be empty. A live message still
-- has to have text or a file, so blank or empty sends are refused as before.

ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_body_or_attachment_chk;

ALTER TABLE public.messages ADD CONSTRAINT messages_body_or_attachment_chk CHECK (
  deleted_at IS NOT NULL
  OR (body IS NOT NULL AND length(btrim(body)) > 0)
  OR attachment_path IS NOT NULL
);
