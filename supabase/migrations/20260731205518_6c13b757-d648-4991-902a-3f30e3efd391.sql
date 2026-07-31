REVOKE SELECT ON public.profiles FROM authenticated;
REVOKE SELECT ON public.profiles FROM anon;

GRANT SELECT (id, username, display_name, avatar_initials, bio, sport, created_at, updated_at, links, city, avatar_url, cover_url, graduating_class, account_type, sport_levels)
  ON public.profiles TO authenticated;
GRANT SELECT (id, username, display_name, avatar_initials, bio, sport, created_at, updated_at, links, city, avatar_url, cover_url, graduating_class, account_type, sport_levels)
  ON public.profiles TO anon;