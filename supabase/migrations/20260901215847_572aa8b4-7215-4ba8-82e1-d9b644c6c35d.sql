REVOKE ALL ON FUNCTION public.sync_profile_age_category() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_minor_privacy_floor() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_minor_messaging() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_game_min_age_policy() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.age_category_from_birthday(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.age_category_from_birthday(date) TO authenticated, service_role;