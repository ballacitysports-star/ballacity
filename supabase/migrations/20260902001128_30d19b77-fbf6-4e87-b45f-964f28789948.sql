-- 1. Column-level SELECT on profiles: hide birthday and avatar_url_private.
REVOKE SELECT ON public.profiles FROM anon;
REVOKE SELECT ON public.profiles FROM authenticated;

GRANT SELECT (
  id, username, display_name, avatar_initials, bio, sport, created_at, updated_at,
  links, city, avatar_url, cover_url, graduating_class, account_type, sport_levels,
  search_radius_mi, active_profile_id, default_profile_id, suspended_at,
  suspended_reason, avatar_visibility, moderation_state, age_category
) ON public.profiles TO anon;

GRANT SELECT (
  id, username, display_name, avatar_initials, bio, sport, created_at, updated_at,
  links, city, avatar_url, cover_url, graduating_class, account_type, sport_levels,
  search_radius_mi, active_profile_id, default_profile_id, suspended_at,
  suspended_reason, avatar_visibility, moderation_state, age_category
) ON public.profiles TO authenticated;

GRANT ALL ON public.profiles TO service_role;

-- 2. Trigger-only helper should not be callable through the API.
REVOKE ALL ON FUNCTION public.sync_profile_birthday() FROM anon, authenticated;