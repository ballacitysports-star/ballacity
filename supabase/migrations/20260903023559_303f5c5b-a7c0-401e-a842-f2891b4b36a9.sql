CREATE OR REPLACE FUNCTION public.default_profile_visibility_for(_user uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN public.age_cohort_of(_user) = 'adult' THEN 'public'
    WHEN public.age_cohort_of(_user) = 'teen_16_17' THEN 'members'
    WHEN public.age_cohort_of(_user) = 'teen_13_15' THEN 'members'
    ELSE 'private'  -- covers child_under_13 AND unknown
  END;
$function$;