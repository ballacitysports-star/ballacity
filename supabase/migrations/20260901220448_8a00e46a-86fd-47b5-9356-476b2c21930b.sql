-- Anon retained a table-wide SELECT on public.profiles, which bypassed the
-- column-level grants that keep birthday/age_category/moderation_state private.
-- Revoke it; anon keeps the explicit safe-column grants already in place.
REVOKE SELECT ON public.profiles FROM anon;

GRANT SELECT (
  id, username, display_name, avatar_initials, bio, sport, created_at, updated_at,
  links, city, avatar_url, cover_url, graduating_class, account_type, sport_levels,
  search_radius_mi, active_profile_id, default_profile_id, suspended_at,
  suspended_reason, avatar_visibility
) ON public.profiles TO anon;

-- Age helpers are for signed-in members only.
REVOKE ALL ON FUNCTION public.my_age_category() FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.my_age_category() TO authenticated;

REVOKE ALL ON FUNCTION public.minor_messaging_allowed(uuid, uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.minor_messaging_allowed(uuid, uuid) TO authenticated;