REVOKE SELECT (age_category) ON public.profiles FROM anon;
REVOKE SELECT (age_category) ON public.profiles FROM authenticated;
REVOKE UPDATE (age_category) ON public.profiles FROM anon;

REVOKE EXECUTE ON FUNCTION public.owns_player_profile(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.player_profiles_set_cohort() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.owns_player_profile(uuid) TO authenticated, service_role;