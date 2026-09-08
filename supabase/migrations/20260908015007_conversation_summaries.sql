-- Summarise the inbox in one query instead of downloading every message.
--
-- listMyConversations() fetched every message in every conversation the member
-- belongs to, with no limit, purely to work out two things per thread: the most
-- recent message body, and how many messages are unread. That is the member's
-- entire message history over the wire on every inbox load, and PostgREST caps
-- rows, so past that cap the query silently truncates — older threads lose
-- their preview and report zero unread, with nothing to indicate it happened.
--
-- DISTINCT ON gives the latest message per conversation in a single pass, which
-- PostgREST cannot express, hence a function.
--
-- SECURITY INVOKER (the default) on purpose: this must see exactly what the
-- caller can see. The existing "Participants read messages" policy on
-- public.messages therefore still applies to every row considered here, so a
-- member can only ever summarise threads they are part of.

CREATE OR REPLACE FUNCTION public.list_conversation_summaries()
 RETURNS TABLE (
   conversation_id uuid,
   last_body text,
   last_created_at timestamptz,
   last_sender_id uuid,
   unread integer
 )
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH mine AS (
    SELECT cp.conversation_id
    FROM public.conversation_participants cp
    WHERE cp.user_id = auth.uid()
  ),
  latest AS (
    SELECT DISTINCT ON (m.conversation_id)
      m.conversation_id, m.body, m.created_at, m.sender_id
    FROM public.messages m
    JOIN mine ON mine.conversation_id = m.conversation_id
    ORDER BY m.conversation_id, m.created_at DESC
  ),
  counts AS (
    SELECT m.conversation_id, count(*)::int AS unread
    FROM public.messages m
    JOIN mine ON mine.conversation_id = m.conversation_id
    WHERE m.sender_id <> auth.uid() AND m.read_at IS NULL
    GROUP BY m.conversation_id
  )
  SELECT
    mine.conversation_id,
    latest.body,
    latest.created_at,
    latest.sender_id,
    COALESCE(counts.unread, 0)
  FROM mine
  LEFT JOIN latest ON latest.conversation_id = mine.conversation_id
  LEFT JOIN counts ON counts.conversation_id = mine.conversation_id
$function$;

REVOKE ALL ON FUNCTION public.list_conversation_summaries() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_conversation_summaries() TO authenticated;
