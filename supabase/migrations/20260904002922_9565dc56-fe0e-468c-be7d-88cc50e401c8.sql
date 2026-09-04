-- 1. Honour child_controls.messaging = 'teammates'
CREATE OR REPLACE FUNCTION public.shares_team(_a uuid, _b uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.team_members ma
    JOIN public.team_members mb ON mb.team_id = ma.team_id
    WHERE ma.user_id = _a AND mb.user_id = _b
  )
$$;

REVOKE EXECUTE ON FUNCTION public.shares_team(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.shares_team(uuid, uuid) TO authenticated;

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
  -- to their own linked guardians, 'teammates' limits them to people who share
  -- one of their teams (guardians always allowed). Checked before the cohort
  -- rules below so a restricted child is never reachable through shared-context
  -- fallbacks such as co-participation in a game.
  IF ca IN ('child_under_13','teen_13_15','teen_16_17') THEN
    SELECT messaging INTO ctrl FROM public.child_controls WHERE child_user_id = _a;
    IF ctrl = 'off' THEN RETURN false; END IF;
    IF ctrl = 'guardian_only' AND NOT public.is_guardian_of(_b, _a) THEN RETURN false; END IF;
    IF ctrl = 'teammates'
       AND NOT public.is_guardian_of(_b, _a)
       AND NOT public.shares_team(_a, _b) THEN RETURN false; END IF;
  END IF;
  IF cb IN ('child_under_13','teen_13_15','teen_16_17') THEN
    SELECT messaging INTO ctrl FROM public.child_controls WHERE child_user_id = _b;
    IF ctrl = 'off' THEN RETURN false; END IF;
    IF ctrl = 'guardian_only' AND NOT public.is_guardian_of(_a, _b) THEN RETURN false; END IF;
    IF ctrl = 'teammates'
       AND NOT public.is_guardian_of(_a, _b)
       AND NOT public.shares_team(_b, _a) THEN RETURN false; END IF;
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

-- 2. Guardian control over AI analysis
CREATE OR REPLACE FUNCTION public.ai_analysis_allowed(_user uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE cohort text; guardian_ok boolean; own boolean;
BEGIN
  cohort := public.age_cohort_of(_user);
  IF cohort IN ('child_under_13','teen_13_15','teen_16_17') THEN
    SELECT ai_analysis INTO guardian_ok FROM public.child_controls WHERE child_user_id = _user;
    IF guardian_ok IS DISTINCT FROM true THEN RETURN false; END IF;
  END IF;
  SELECT ai_processing INTO own FROM public.privacy_preferences WHERE user_id = _user;
  RETURN COALESCE(own, true);
END $$;

REVOKE EXECUTE ON FUNCTION public.ai_analysis_allowed(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ai_analysis_allowed(uuid) TO authenticated, service_role;

-- Clamp the child's own toggle so no code path can read a permissive value
CREATE OR REPLACE FUNCTION public.clamp_ai_processing_for_minors()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE cohort text; guardian_ok boolean;
BEGIN
  cohort := public.age_cohort_of(NEW.user_id);
  IF cohort IN ('child_under_13','teen_13_15','teen_16_17') THEN
    SELECT ai_analysis INTO guardian_ok FROM public.child_controls WHERE child_user_id = NEW.user_id;
    IF guardian_ok IS DISTINCT FROM true THEN
      NEW.ai_processing := false;
      NEW.ai_training_opt_in := false;
    END IF;
  END IF;
  RETURN NEW;
END $$;

REVOKE EXECUTE ON FUNCTION public.clamp_ai_processing_for_minors() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_clamp_ai_processing_for_minors ON public.privacy_preferences;
CREATE TRIGGER trg_clamp_ai_processing_for_minors
BEFORE INSERT OR UPDATE ON public.privacy_preferences
FOR EACH ROW EXECUTE FUNCTION public.clamp_ai_processing_for_minors();

-- When a guardian changes ai_analysis, re-apply the clamp to the child's row
CREATE OR REPLACE FUNCTION public.reclamp_ai_on_controls_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.ai_analysis IS DISTINCT FROM true THEN
    UPDATE public.privacy_preferences
       SET ai_processing = false, ai_training_opt_in = false
     WHERE user_id = NEW.child_user_id
       AND (ai_processing IS DISTINCT FROM false OR ai_training_opt_in IS DISTINCT FROM false);
  END IF;
  RETURN NEW;
END $$;

REVOKE EXECUTE ON FUNCTION public.reclamp_ai_on_controls_change() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_reclamp_ai_on_controls_change ON public.child_controls;
CREATE TRIGGER trg_reclamp_ai_on_controls_change
AFTER INSERT OR UPDATE OF ai_analysis ON public.child_controls
FOR EACH ROW EXECUTE FUNCTION public.reclamp_ai_on_controls_change();

-- Backfill existing rows
UPDATE public.privacy_preferences p
   SET ai_processing = false, ai_training_opt_in = false
 WHERE public.age_cohort_of(p.user_id) IN ('child_under_13','teen_13_15','teen_16_17')
   AND COALESCE((SELECT c.ai_analysis FROM public.child_controls c WHERE c.child_user_id = p.user_id), false) IS DISTINCT FROM true
   AND (p.ai_processing IS DISTINCT FROM false OR p.ai_training_opt_in IS DISTINCT FROM false);