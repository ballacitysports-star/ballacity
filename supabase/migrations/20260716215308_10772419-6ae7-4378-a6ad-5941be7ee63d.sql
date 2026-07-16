-- 1. Extend messages
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS reply_to_id uuid NULL REFERENCES public.messages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS is_request boolean NOT NULL DEFAULT false;

-- 2. Extend conversations
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS accepted_by uuid[] NOT NULL DEFAULT '{}';

-- Backfill: existing conversations are accepted by both participants
UPDATE public.conversations c
SET accepted_by = ARRAY(
  SELECT user_id FROM public.conversation_participants WHERE conversation_id = c.id
)
WHERE cardinality(c.accepted_by) = 0;

-- 3. Reactions table
CREATE TABLE IF NOT EXISTS public.message_reactions (
  message_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  emoji text NOT NULL CHECK (emoji IN ('❤️','😂','😮','😢','🔥','👍')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id, emoji)
);

GRANT SELECT, INSERT, DELETE ON public.message_reactions TO authenticated;
GRANT ALL ON public.message_reactions TO service_role;

ALTER TABLE public.message_reactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "reactions_select_participants" ON public.message_reactions
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.messages m
      WHERE m.id = message_reactions.message_id
        AND public.is_conversation_participant(m.conversation_id, auth.uid())
    )
  );

CREATE POLICY "reactions_insert_own" ON public.message_reactions
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.messages m
      WHERE m.id = message_reactions.message_id
        AND public.is_conversation_participant(m.conversation_id, auth.uid())
    )
  );

CREATE POLICY "reactions_delete_own" ON public.message_reactions
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- 4. Trigger: mark new messages as is_request when recipient hasn't accepted
CREATE OR REPLACE FUNCTION public.set_message_request_flag()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _accepted uuid[];
  _recipients uuid[];
BEGIN
  SELECT accepted_by INTO _accepted FROM public.conversations WHERE id = NEW.conversation_id;
  SELECT array_agg(user_id) INTO _recipients
    FROM public.conversation_participants
    WHERE conversation_id = NEW.conversation_id AND user_id <> NEW.sender_id;

  -- Request if any recipient hasn't accepted this thread yet
  IF _recipients IS NOT NULL AND EXISTS (
    SELECT 1 FROM unnest(_recipients) r WHERE NOT (r = ANY(COALESCE(_accepted, '{}'::uuid[])))
  ) THEN
    NEW.is_request := true;
  END IF;

  -- Sender is implicitly accepted
  IF NEW.sender_id IS NOT NULL AND NOT (NEW.sender_id = ANY(COALESCE(_accepted, '{}'::uuid[]))) THEN
    UPDATE public.conversations
      SET accepted_by = array_append(COALESCE(accepted_by, '{}'::uuid[]), NEW.sender_id)
      WHERE id = NEW.conversation_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_message_request_flag_trg ON public.messages;
CREATE TRIGGER set_message_request_flag_trg
  BEFORE INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.set_message_request_flag();

-- 5. RPCs
CREATE OR REPLACE FUNCTION public.accept_conversation(_conv uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _me uuid := auth.uid();
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE='28000'; END IF;
  IF NOT public.is_conversation_participant(_conv, _me) THEN
    RAISE EXCEPTION 'Not a participant' USING ERRCODE='42501';
  END IF;
  UPDATE public.conversations
    SET accepted_by = (
      SELECT ARRAY(SELECT DISTINCT unnest(array_append(COALESCE(accepted_by,'{}'::uuid[]), _me)))
    )
    WHERE id = _conv;
  UPDATE public.messages
    SET is_request = false
    WHERE conversation_id = _conv AND is_request = true;
END;
$$;

CREATE OR REPLACE FUNCTION public.decline_conversation(_conv uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _me uuid := auth.uid();
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE='28000'; END IF;
  DELETE FROM public.conversation_participants
    WHERE conversation_id = _conv AND user_id = _me;
END;
$$;

CREATE OR REPLACE FUNCTION public.unsend_message(_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _me uuid := auth.uid();
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE='28000'; END IF;
  UPDATE public.messages
    SET body = NULL,
        attachment_path = NULL,
        attachment_type = NULL,
        attachment_name = NULL,
        attachment_size = NULL,
        deleted_at = now()
    WHERE id = _id AND sender_id = _me AND deleted_at IS NULL;
END;
$$;

-- 6. Realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE public.message_reactions;
