-- "Unsend" never worked.
--
-- unsend_message (20260716215308) clears the text and any attachment of the sender's
-- own message and stamps deleted_at. messages_body_or_attachment_chk (20260627124305)
-- requires every row to have non-blank text or an attachment, so the UPDATE is
-- rejected for every message: text (body would be NULL, no attachment) and
-- attachment (attachment_path would be NULL) alike. The app shows the database's
-- error; nothing is ever unsent.
--
-- The rule is meant for messages being sent, not for ones that were taken back, so
-- an unsent row (deleted_at set) satisfies it. Added NOT VALID then validated, to
-- hold the table lock only briefly; every existing row already satisfies the
-- looser rule, so validation cannot fail.
-- Regression test: supabase/tests/270_team_message_host_actions.test.sql.

ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_body_or_attachment_chk;
ALTER TABLE public.messages
  ADD CONSTRAINT messages_body_or_attachment_chk
  CHECK (
    (body IS NOT NULL AND length(btrim(body)) > 0)
    OR attachment_path IS NOT NULL
    OR deleted_at IS NOT NULL
  ) NOT VALID;
ALTER TABLE public.messages VALIDATE CONSTRAINT messages_body_or_attachment_chk;
