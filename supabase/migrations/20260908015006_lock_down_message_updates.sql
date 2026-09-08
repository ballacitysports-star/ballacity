-- Stop a conversation participant from rewriting the other person's messages.
--
-- `authenticated` held UPDATE on every column of public.messages, and the
-- policy that allows it ("Recipients mark read") only checks that the caller
-- is a participant. RLS cannot restrict columns, so the grant was the only
-- thing standing between a participant and the rest of the row. Anyone you
-- were in a thread with could rewrite the body of your messages, reattribute
-- them by changing sender_id, backdate created_at, soft-delete them via
-- deleted_at, or move them into another conversation.
--
-- The only update the client actually performs is markConversationRead()
-- setting read_at on messages it did not send, so that is all the grant needs
-- to allow. Everything else that legitimately writes to these tables does so
-- with privileges of its own and is unaffected:
--
--   * unsend_message, accept_conversation, decline_conversation — SECURITY DEFINER
--   * all five triggers on messages, including bump_conversation_last_message
--     which maintains conversations.last_message_at — SECURITY DEFINER
--   * moderation (deleted_at) and account deletion (body scrub) — service_role
--
-- Verified against the live schema before writing this: those are the only
-- writers, and no client code updates public.conversations at all.

-- 1) Messages: read_at is the only column a member may change.
REVOKE UPDATE ON public.messages FROM authenticated;
GRANT UPDATE (read_at) ON public.messages TO authenticated;

-- Belt and braces alongside the column grant: a member may only mark messages
-- read that somebody else sent. Marking your own message read is meaningless,
-- and the client already filters that way, so this costs nothing and narrows
-- the surface if the grant above is ever widened again by accident.
DROP POLICY IF EXISTS "Recipients mark read" ON public.messages;
CREATE POLICY "Recipients mark read"
  ON public.messages FOR UPDATE
  TO authenticated
  USING (
    public.is_conversation_participant(conversation_id, auth.uid())
    AND sender_id <> auth.uid()
  )
  WITH CHECK (
    public.is_conversation_participant(conversation_id, auth.uid())
    AND sender_id <> auth.uid()
  );

-- 2) Conversations: members never write to this table directly.
--
-- The same over-grant let a participant rewrite accepted_by (accepting on the
-- other person's behalf, or un-accepting them), reassign game_id or
-- created_by, and even change the primary key. accept_conversation and
-- decline_conversation are SECURITY DEFINER and last_message_at is maintained
-- by a trigger, so nothing needs this grant.
REVOKE UPDATE ON public.conversations FROM authenticated;

DROP POLICY IF EXISTS "Participants update conversations" ON public.conversations;
