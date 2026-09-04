CREATE OR REPLACE FUNCTION public.roster_row_visible(_team_id text, _member_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE cohort text; caller uuid;
BEGIN
  IF _member_user_id IS NULL THEN RETURN true; END IF;

  cohort := public.age_cohort_of(_member_user_id);

  -- Adults (and unresolvable cohorts) stay public, exactly as before this rule.
  IF cohort NOT IN ('child_under_13','teen_13_15','teen_16_17') THEN
    RETURN true;
  END IF;

  caller := auth.uid();

  -- 16-17 mirrors reel_audience()'s 'members' treatment: signed-in only.
  IF cohort = 'teen_16_17' AND caller IS NOT NULL THEN RETURN true; END IF;

  IF caller IS NULL THEN RETURN false; END IF;
  IF caller = _member_user_id THEN RETURN true; END IF;
  IF public.is_guardian_of(caller, _member_user_id) THEN RETURN true; END IF;
  IF public.is_team_manager(_team_id, caller) THEN RETURN true; END IF;

  RETURN false;
END $function$;

REVOKE ALL ON FUNCTION public.roster_row_visible(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.roster_row_visible(text, uuid) TO anon, authenticated, service_role;

DROP POLICY IF EXISTS "team_members_read" ON public.team_members;
CREATE POLICY "team_members_read" ON public.team_members
FOR SELECT TO anon, authenticated
USING (
  EXISTS (SELECT 1 FROM public.teams t WHERE t.id = team_members.team_id AND t.hidden_at IS NULL)
  AND public.roster_row_visible(team_members.team_id, team_members.user_id)
);