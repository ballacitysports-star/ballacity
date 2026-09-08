-- Say WHY minor messaging was refused, instead of "not available".
--
-- The guard raised one blanket message: "messaging between adults and minors
-- is not available." That is not what the rule says. An adult may message a
-- 16-17 year old freely; may message a 13-15 year old they share a game with;
-- may message a child they are the guardian of. The blanket wording told a
-- host none of that, gave no reason, and offered no way forward — a host who
-- simply needed the player to join their game first had no way to know it.
--
-- So the decision now carries a reason code. `minor_messaging_block_reason`
-- returns NULL when messaging is allowed, or a stable code naming the branch
-- that refused. `minor_messaging_allowed` becomes a thin wrapper over it, so
-- there is still exactly one copy of this logic: a safety control with two
-- near-identical implementations would eventually disagree, and the wrong one
-- would be the one being enforced.
--
-- The branches, ordering and flag defaults below are transcribed unchanged
-- from the previous definition. This migration is about what the caller is
-- told, not about who may message whom.

CREATE OR REPLACE FUNCTION public.minor_messaging_block_reason(_a uuid, _b uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE ca text; cb text; child uuid; adult_id uuid; ctrl text;
BEGIN
  ca := public.age_cohort_of(_a);
  cb := public.age_cohort_of(_b);

  -- Guardian-set controls, checked first so a restricted child is never
  -- reachable through the shared-context fallbacks further down.
  IF ca IN ('child_under_13','teen_13_15','teen_16_17') THEN
    SELECT messaging INTO ctrl FROM public.child_controls WHERE child_user_id = _a;
    IF ctrl = 'off' THEN RETURN 'messaging_off'; END IF;
    IF ctrl = 'guardian_only' AND NOT public.is_guardian_of(_b, _a) THEN
      RETURN 'guardian_only';
    END IF;
    IF ctrl = 'teammates'
       AND NOT public.is_guardian_of(_b, _a)
       AND NOT public.shares_team(_a, _b) THEN RETURN 'teammates_only'; END IF;
  END IF;
  IF cb IN ('child_under_13','teen_13_15','teen_16_17') THEN
    SELECT messaging INTO ctrl FROM public.child_controls WHERE child_user_id = _b;
    IF ctrl = 'off' THEN RETURN 'messaging_off'; END IF;
    IF ctrl = 'guardian_only' AND NOT public.is_guardian_of(_a, _b) THEN
      RETURN 'guardian_only';
    END IF;
    IF ctrl = 'teammates'
       AND NOT public.is_guardian_of(_a, _b)
       AND NOT public.shares_team(_b, _a) THEN RETURN 'teammates_only'; END IF;
  END IF;

  -- Adult <-> under-13.
  IF (ca = 'child_under_13' AND cb = 'adult') OR (cb = 'child_under_13' AND ca = 'adult') THEN
    child := CASE WHEN ca = 'child_under_13' THEN _a ELSE _b END;
    adult_id := CASE WHEN ca = 'child_under_13' THEN _b ELSE _a END;
    IF public.is_guardian_of(adult_id, child) THEN RETURN NULL; END IF;
    IF public.age_policy_flag('child_adult_dm_requires_guardian_link', true) THEN
      RETURN 'child_needs_guardian';
    END IF;
    IF public.shares_game_or_chat(_a, _b) THEN RETURN NULL; END IF;
    RETURN 'child_needs_shared_game';
  END IF;

  -- Adult <-> 13-15 requires a shared game or an existing conversation.
  IF (ca = 'teen_13_15' AND cb = 'adult') OR (cb = 'teen_13_15' AND ca = 'adult') THEN
    IF public.age_policy_flag('teen_adult_dm_requires_shared_context', true) THEN
      IF public.shares_game_or_chat(_a, _b) THEN RETURN NULL; END IF;
      RETURN 'teen_needs_shared_game';
    END IF;
    RETURN NULL;
  END IF;

  RETURN NULL;
END $function$;

REVOKE ALL ON FUNCTION public.minor_messaging_block_reason(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.minor_messaging_block_reason(uuid, uuid) TO authenticated, service_role;

-- One source of truth: the boolean is now derived from the reason.
CREATE OR REPLACE FUNCTION public.minor_messaging_allowed(_a uuid, _b uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public.minor_messaging_block_reason(_a, _b) IS NULL
$function$;

-- Raise the specific reason so the client can explain it. The code stays in
-- the message, after the prefix, for callers that only see the string.
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
