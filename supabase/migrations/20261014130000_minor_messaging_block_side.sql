-- Say WHOSE restriction refused a message, not just which rule.
--
-- `minor_messaging_block_reason` names the rule, but every rule can apply to
-- either party: a 14-year-old messaging an adult host is refused with the
-- same `teen_needs_shared_game` as an adult host messaging that 14-year-old,
-- and a child whose guardian turned messaging off is refused with the same
-- `messaging_off` whichever way the message goes. The client had to guess,
-- and guessed "the other person", so a teen requesting a spot was told "You
-- can message this player once they've joined one of your games" — about
-- themselves — and a teen whose own messaging was off was told the host's
-- guardian had turned it off.
--
-- `minor_messaging_block` returns `<code>:<side>`, where side is `self` when
-- the rule concerns _a (the sender) and `other` when it concerns _b.
-- `minor_messaging_block_reason` becomes a wrapper over it, so the policy
-- still exists exactly once. Branches, ordering and flag defaults are
-- transcribed unchanged from 20260908010532: this changes what the caller is
-- told, not who may message whom.
--
-- The raised text becomes `MINOR_MESSAGING_BLOCKED:<code>:<side>`. Clients
-- that read only the code stop at the second colon, so older builds keep
-- working.

CREATE OR REPLACE FUNCTION public.minor_messaging_block(_a uuid, _b uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE ca text; cb text; ctrl text; side text;
BEGIN
  ca := public.age_cohort_of(_a);
  cb := public.age_cohort_of(_b);

  -- Guardian-set controls, checked first so a restricted child is never
  -- reachable through the shared-context fallbacks further down.
  IF ca IN ('child_under_13','teen_13_15','teen_16_17') THEN
    SELECT messaging INTO ctrl FROM public.child_controls WHERE child_user_id = _a;
    IF ctrl = 'off' THEN RETURN 'messaging_off:self'; END IF;
    IF ctrl = 'guardian_only' AND NOT public.is_guardian_of(_b, _a) THEN
      RETURN 'guardian_only:self';
    END IF;
    IF ctrl = 'teammates'
       AND NOT public.is_guardian_of(_b, _a)
       AND NOT public.shares_team(_a, _b) THEN RETURN 'teammates_only:self'; END IF;
  END IF;
  IF cb IN ('child_under_13','teen_13_15','teen_16_17') THEN
    SELECT messaging INTO ctrl FROM public.child_controls WHERE child_user_id = _b;
    IF ctrl = 'off' THEN RETURN 'messaging_off:other'; END IF;
    IF ctrl = 'guardian_only' AND NOT public.is_guardian_of(_a, _b) THEN
      RETURN 'guardian_only:other';
    END IF;
    IF ctrl = 'teammates'
       AND NOT public.is_guardian_of(_a, _b)
       AND NOT public.shares_team(_b, _a) THEN RETURN 'teammates_only:other'; END IF;
  END IF;

  -- Adult <-> under-13. The side is the child's.
  IF (ca = 'child_under_13' AND cb = 'adult') OR (cb = 'child_under_13' AND ca = 'adult') THEN
    side := CASE WHEN ca = 'child_under_13' THEN 'self' ELSE 'other' END;
    IF public.is_guardian_of(CASE WHEN ca = 'child_under_13' THEN _b ELSE _a END,
                             CASE WHEN ca = 'child_under_13' THEN _a ELSE _b END) THEN
      RETURN NULL;
    END IF;
    IF public.age_policy_flag('child_adult_dm_requires_guardian_link', true) THEN
      RETURN 'child_needs_guardian:' || side;
    END IF;
    IF public.shares_game_or_chat(_a, _b) THEN RETURN NULL; END IF;
    RETURN 'child_needs_shared_game:' || side;
  END IF;

  -- Adult <-> 13-15 requires a shared game or an existing conversation. The
  -- side is the teen's.
  IF (ca = 'teen_13_15' AND cb = 'adult') OR (cb = 'teen_13_15' AND ca = 'adult') THEN
    IF public.age_policy_flag('teen_adult_dm_requires_shared_context', true) THEN
      IF public.shares_game_or_chat(_a, _b) THEN RETURN NULL; END IF;
      RETURN 'teen_needs_shared_game:' || CASE WHEN ca = 'teen_13_15' THEN 'self' ELSE 'other' END;
    END IF;
    RETURN NULL;
  END IF;

  RETURN NULL;
END $function$;

REVOKE ALL ON FUNCTION public.minor_messaging_block(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.minor_messaging_block(uuid, uuid) TO authenticated, service_role;

-- One source of truth: the reason (and through it minor_messaging_allowed) is
-- derived from the full decision.
CREATE OR REPLACE FUNCTION public.minor_messaging_block_reason(_a uuid, _b uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT NULLIF(split_part(public.minor_messaging_block(_a, _b), ':', 1), '')
$function$;

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
  _block text;
BEGIN
  IF _me IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;
  IF _me = _other_user THEN
    RAISE EXCEPTION 'Cannot message yourself';
  END IF;

  _block := public.minor_messaging_block(_me, _other_user);
  IF _block IS NOT NULL THEN
    RAISE EXCEPTION 'MINOR_MESSAGING_BLOCKED:%', _block;
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

CREATE OR REPLACE FUNCTION public.enforce_minor_messaging()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  other uuid;
  block text;
BEGIN
  FOR other IN
    SELECT user_id FROM public.conversation_participants
    WHERE conversation_id = NEW.conversation_id AND user_id <> NEW.sender_id
  LOOP
    block := public.minor_messaging_block(NEW.sender_id, other);
    IF block IS NOT NULL THEN
      RAISE EXCEPTION 'MINOR_MESSAGING_BLOCKED:%', block;
    END IF;
  END LOOP;
  RETURN NEW;
END;
$function$;
