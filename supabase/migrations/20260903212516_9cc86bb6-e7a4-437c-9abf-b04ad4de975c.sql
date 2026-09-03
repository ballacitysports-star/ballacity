-- Parental control values are 'on' | 'guardian_only' | 'off'. The messaging
-- guard only honoured 'off', so 'guardian_only' children could still exchange
-- DMs with non-guardians. Honour it on both sides of the conversation.
CREATE OR REPLACE FUNCTION public.minor_messaging_allowed(_a uuid, _b uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE ca text; cb text; child uuid; adult_id uuid; ctrl text;
BEGIN
  ca := public.age_cohort_of(_a);
  cb := public.age_cohort_of(_b);

  -- Child controls: 'off' blocks messaging, 'guardian_only' limits the child
  -- to their own linked guardians. Checked before the cohort rules below so a
  -- guardian-only child is never reachable through shared-context fallbacks.
  IF ca IN ('child_under_13','teen_13_15','teen_16_17') THEN
    SELECT messaging INTO ctrl FROM public.child_controls WHERE child_user_id = _a;
    IF ctrl = 'off' THEN RETURN false; END IF;
    IF ctrl = 'guardian_only' AND NOT public.is_guardian_of(_b, _a) THEN RETURN false; END IF;
  END IF;
  IF cb IN ('child_under_13','teen_13_15','teen_16_17') THEN
    SELECT messaging INTO ctrl FROM public.child_controls WHERE child_user_id = _b;
    IF ctrl = 'off' THEN RETURN false; END IF;
    IF ctrl = 'guardian_only' AND NOT public.is_guardian_of(_a, _b) THEN RETURN false; END IF;
  END IF;

  -- Adult <-> under-13
  IF (ca = 'child_under_13' AND cb = 'adult') OR (cb = 'child_under_13' AND ca = 'adult') THEN
    child := CASE WHEN ca = 'child_under_13' THEN _a ELSE _b END;
    adult_id := CASE WHEN ca = 'child_under_13' THEN _b ELSE _a END;
    IF public.is_guardian_of(adult_id, child) THEN RETURN true; END IF;
    IF public.age_policy_flag('child_adult_dm_requires_guardian_link', true) THEN RETURN false; END IF;
    RETURN public.shares_game_or_chat(_a, _b);
  END IF;

  -- Adult <-> 13-15 requires a shared game or existing conversation
  IF (ca = 'teen_13_15' AND cb = 'adult') OR (cb = 'teen_13_15' AND ca = 'adult') THEN
    IF public.age_policy_flag('teen_adult_dm_requires_shared_context', true) THEN
      RETURN public.shares_game_or_chat(_a, _b);
    END IF;
    RETURN true;
  END IF;

  RETURN true;
END $function$;