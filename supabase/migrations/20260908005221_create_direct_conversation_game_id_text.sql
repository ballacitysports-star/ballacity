-- Fix: messaging a game's host fails for every game created in the app.
--
-- create_direct_conversation declared `_game_id uuid`, but the column it
-- writes to — conversations.game_id — is TEXT, and game ids are text too:
-- hosted_games.id is `text PRIMARY KEY`, and addHostedGame() mints ids of the
-- form `host-<base36>-<random>`. Passing one of those into a uuid parameter
-- fails the cast before the function body ever runs:
--
--   invalid input syntax for type uuid: "host-mfk2p1q-x8ha"
--
-- so the RPC raised and the caller showed "Couldn't open chat". Games whose id
-- happened to be a uuid worked, which is why this looked intermittent rather
-- than broken.
--
-- The parameter type is part of the signature, so CREATE OR REPLACE would add
-- an overload and leave the uuid version resolvable — PostgREST could still
-- pick it. Drop it first, then create the text version.

DROP FUNCTION IF EXISTS public.create_direct_conversation(uuid, uuid);

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
BEGIN
  IF _me IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;
  IF _me = _other_user THEN
    RAISE EXCEPTION 'Cannot message yourself';
  END IF;

  IF NOT public.minor_messaging_allowed(_me, _other_user) THEN
    RAISE EXCEPTION 'MINOR_MESSAGING_BLOCKED: messaging between adults and minors is not available.';
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

-- Same grants the dropped uuid version carried, so access is unchanged.
REVOKE ALL ON FUNCTION public.create_direct_conversation(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_direct_conversation(uuid, text) TO authenticated, service_role;
