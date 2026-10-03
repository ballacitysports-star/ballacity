CREATE OR REPLACE FUNCTION public.reel_audience(_reel_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN r.id IS NULL THEN 'none'
    WHEN r.hidden_at IS NOT NULL OR r.status <> 'completed' THEN 'none'
    WHEN public.child_features_locked(r.user_id) THEN 'none'
    WHEN public.age_cohort_of(r.user_id) IN ('child_under_13', 'teen_13_15', 'teen_16_17')
         AND private_sec.guardian_public_profile(r.user_id)
         AND COALESCE((SELECT c.media_visibility FROM public.child_controls c WHERE c.child_user_id = r.user_id), 'guardian') <> 'private'
      THEN 'public'
    WHEN public.age_cohort_of(r.user_id) IN ('child_under_13', 'teen_13_15') THEN 'none'
    WHEN public.age_cohort_of(r.user_id) = 'teen_16_17' THEN 'members'
    ELSE 'public'
  END
  FROM (SELECT * FROM public.highlight_reels WHERE id = _reel_id) r;
$function$;