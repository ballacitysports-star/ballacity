-- Let a recipient accept a message request again.
--
-- guard_message_recipient_update (20260915214808) stops a recipient changing
-- anything on a message but read_at. accept_conversation is how a recipient
-- accepts a request, and it clears is_request on the thread's messages — a
-- change that guard refuses, so every Accept failed with
-- "MESSAGE_FIELD_FORBIDDEN: recipients may only mark a message read." and the
-- request could never be answered.
--
-- The guard now also lets is_request go from true to false, which is exactly
-- what accepting does. Nothing else moves: a recipient still cannot touch the
-- body, sender, timestamps or attachments, and cannot turn a message back into
-- a request. Clients cannot reach is_request at all — authenticated holds
-- UPDATE on read_at only — so in practice this path is accept_conversation.

CREATE OR REPLACE FUNCTION public.guard_message_recipient_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  baseline public.messages;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() = OLD.sender_id THEN
    RETURN NEW;
  END IF;

  baseline := OLD;
  baseline.read_at := NEW.read_at;
  -- Accepting a request clears the flag; it is never set back.
  IF OLD.is_request AND NOT NEW.is_request THEN
    baseline.is_request := false;
  END IF;
  IF to_jsonb(NEW) IS DISTINCT FROM to_jsonb(baseline) THEN
    RAISE EXCEPTION 'MESSAGE_FIELD_FORBIDDEN: recipients may only mark a message read or accept a request.'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_message_recipient_update() FROM PUBLIC, anon, authenticated;
