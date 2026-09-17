-- create_direct_conversation had no block-check: two blocked users could still
-- get an empty conversation + conversation_participants rows created (the
-- first real message was already blocked by the existing
-- enforce_block_on_message trigger, so no content ever crossed — impact was
-- limited to an unwanted empty thread appearing in both inboxes). Same shape
-- as the family-architecture audit's finding B1, but for blocks rather than
-- minors, never fixed until now.
--
-- Checked first, before the minor-messaging check, so a blocked pair always
-- sees "one of you blocked the other" rather than a more specific age/shared-
-- game reason code that would otherwise leak past an intentional block. Body
-- is otherwise byte-for-byte the live function from
-- 20260908010532_minor_messaging_block_reason.sql.
CREATE OR REPLACE FUNCTION public.create_direct_conversation(
  _other_user uuid,
  _game_id text DEFAULT NULL::text
)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _me uuid := auth.uid();
  _existing uuid;
  _new_id uuid;
  _mode text;
  _reason text;
BEGIN
  IF _me IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;
  IF _me = _other_user THEN
    RAISE EXCEPTION 'Cannot message yourself';
  END IF;

  IF public.blocks_exist_between(_me, _other_user) THEN
    RAISE EXCEPTION 'Messaging is unavailable because one of you blocked the other';
  END IF;

  _reason := public.minor_messaging_block_reason(_me, _other_user);
  IF _reason IS NOT NULL THEN
    RAISE EXCEPTION 'MINOR_MESSAGING_BLOCKED:%', _reason;
  END IF;

  SELECT cp1.conversation_id INTO _existing
  FROM public.conversation_participants cp1
  JOIN public.conversation_participants cp2
    ON cp1.conversation_id = cp2.conversation_id
  WHERE cp1.user_id = _me AND cp2.user_id = _other_user
  LIMIT 1;

  IF _existing IS NOT NULL THEN
    RETURN _existing;
  END IF;

  _mode := COALESCE(public.privacy_text(_other_user, 'allow_messages'), 'everyone');
  IF _mode = 'nobody' THEN
    RAISE EXCEPTION 'This player is not accepting new messages.';
  ELSIF _mode = 'shared' AND NOT public.shares_game_or_chat(_me, _other_user) THEN
    RAISE EXCEPTION 'This player only accepts messages from people they share a game or chat with.';
  END IF;

  INSERT INTO public.conversations (created_by, game_id)
  VALUES (_me, _game_id)
  RETURNING id INTO _new_id;

  INSERT INTO public.conversation_participants (conversation_id, user_id)
  VALUES (_new_id, _me), (_new_id, _other_user);

  RETURN _new_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_direct_conversation(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_direct_conversation(uuid, text) TO authenticated, service_role;
