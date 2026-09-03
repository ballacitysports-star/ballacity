CREATE OR REPLACE FUNCTION public.my_child_context()
 RETURNS TABLE(cohort text, age_review_required boolean, jurisdiction text, has_birthday boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT p.age_cohort,
         COALESCE(p.age_review_required, false),
         COALESCE(p.jurisdiction, 'US_FEDERAL'),
         EXISTS (SELECT 1 FROM public.profile_birthdays b WHERE b.user_id = p.id AND b.birthday IS NOT NULL)
  FROM public.profiles p WHERE p.id = auth.uid();
$function$;

REVOKE ALL ON FUNCTION public.my_child_context() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.my_child_context() FROM anon;
GRANT EXECUTE ON FUNCTION public.my_child_context() TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_child_context() TO service_role;