GRANT SELECT (
  id, username, display_name, avatar_initials, bio, sport, created_at, updated_at,
  links, city, avatar_url, cover_url, graduating_class, account_type, sport_levels
) ON public.profiles TO anon;

DROP POLICY IF EXISTS "Profiles viewable by anon" ON public.profiles;
CREATE POLICY "Profiles viewable by anon"
  ON public.profiles FOR SELECT TO anon USING (true);

GRANT EXECUTE ON FUNCTION public.profile_ages(uuid[]) TO anon;