-- Stop anyone joining a conversation they were never put in.
--
-- The "Creator adds participants" policy on conversation_participants read:
--
--   WITH CHECK (user_id = auth.uid() OR EXISTS (
--     SELECT 1 FROM conversations c
--     WHERE c.id = conversation_id AND c.created_by = auth.uid()))
--
-- The first branch is the problem: it permits *any* authenticated member to
-- insert a row naming themselves against *any* conversation id. Nothing checks
-- that they were invited, created it, or have any relationship to it at all.
-- Once that row exists, is_conversation_participant() returns true and the
-- SELECT policies on conversations and messages open the whole thread.
--
-- Verified against production before writing this (inside a transaction that
-- was rolled back): an outsider went from 0 visible messages in someone else's
-- thread to reading all of it, sending into it, and reacting to it, using only
-- the conversation's id. Ids are not secret — they sit in /messages/$id URLs
-- and in notification links.
--
-- This also bypassed create_direct_conversation entirely, which is where the
-- guardian and minor-messaging checks live. Reading was the unguarded part:
-- the BEFORE INSERT triggers on messages still gate *sending*, but no trigger
-- can gate a SELECT, so an adult who obtained a minor's conversation id could
-- read that minor's message history.
--
-- Nothing legitimate needs the grant. No client code inserts into
-- conversation_participants or conversations at all — every reference in
-- src/ is a .select() — and the one writer, create_direct_conversation, is
-- SECURITY DEFINER and so runs with the function owner's rights, not the
-- caller's. Removing the grant is therefore invisible to the app and closes
-- the hole at the only place that can close it.

-- 1) Membership is decided by create_direct_conversation, not by the client.
REVOKE INSERT ON public.conversation_participants FROM authenticated;
DROP POLICY IF EXISTS "Creator adds participants" ON public.conversation_participants;

-- 2) Same for the parent row: a member never creates a conversation directly.
--    Leaving this would let a client fabricate conversations that skipped the
--    RPC's consent, privacy and minor-messaging checks.
REVOKE INSERT ON public.conversations FROM authenticated;
DROP POLICY IF EXISTS "Authenticated create conversations" ON public.conversations;

-- 3) Two UPDATE grants with no UPDATE policy behind them. RLS denies by
--    default so they are inert today, but they are the same shape as the
--    messages over-grant fixed in 20260908015006: the day someone adds a
--    policy, the grant silently widens it to every column.
REVOKE UPDATE ON public.conversation_participants FROM authenticated;
REVOKE UPDATE ON public.message_reactions FROM authenticated;

-- 4) Say which rule refused a message, the way create_direct_conversation now
--    does. This trigger still raised the old blanket line, so a refusal on
--    *send* (rather than on opening the thread) reached the client with no
--    code in it and fell through to the generic wording, losing the specific,
--    actionable reason — "they need to join one of your games first" and so on.
CREATE OR REPLACE FUNCTION public.enforce_minor_messaging()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  other uuid;
  reason text;
BEGIN
  FOR other IN
    SELECT user_id FROM public.conversation_participants
    WHERE conversation_id = NEW.conversation_id AND user_id <> NEW.sender_id
  LOOP
    reason := public.minor_messaging_block_reason(NEW.sender_id, other);
    IF reason IS NOT NULL THEN
      RAISE EXCEPTION 'MINOR_MESSAGING_BLOCKED:%', reason;
    END IF;
  END LOOP;
  RETURN NEW;
END;
$function$;
