-- ROLLBACK for supabase/migrations/20261109100000_team_chat.sql (P2-3).
-- NOT a migration. It removes team chat: the message table (and every team chat message in it), the send, hide and
-- report functions, the membership checks, the user_reports column and subject kind, and the switch. Reports already
-- filed about team chat messages are kept, without the link to the deleted message, as subject 'message'.
-- The app must be on a version with the team_chat switch off, or the chat tab errors. It refuses to run unless:
--     PGOPTIONS="-c app.confirm_drop_team_chat=yes" psql ... -f <this file>
BEGIN;
DO $guard$
BEGIN
  IF current_setting('app.confirm_drop_team_chat', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'Refusing to run: this deletes every team chat message. Set app.confirm_drop_team_chat=yes for the session to proceed deliberately.';
  END IF;
END
$guard$;

UPDATE public.user_reports SET subject_type = 'message' WHERE subject_type = 'team_chat_message';
ALTER TABLE public.user_reports DROP CONSTRAINT IF EXISTS user_reports_subject_type_check;
ALTER TABLE public.user_reports ADD CONSTRAINT user_reports_subject_type_check
  CHECK (subject_type IN ('user', 'game', 'message', 'reel', 'payment'));
ALTER TABLE public.user_reports DROP COLUMN IF EXISTS team_chat_message_id;

DROP FUNCTION IF EXISTS public.report_team_chat_message(uuid, text, text);
DROP FUNCTION IF EXISTS public.hide_team_chat_message(uuid, boolean);
DROP FUNCTION IF EXISTS public.send_team_chat_message(text, text);
DROP TABLE IF EXISTS public.team_chat_messages;
DROP FUNCTION IF EXISTS public.can_use_team_chat(text);
DROP FUNCTION IF EXISTS private_sec.in_team_chat(text);
DROP FUNCTION IF EXISTS private_sec.team_chat_member(text, uuid);
DELETE FROM public.app_settings WHERE key = 'team_chat';

COMMIT;
