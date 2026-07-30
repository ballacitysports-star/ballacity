-- 1) trainer_orgs: keep the listing public, but hide phone/email from anonymous visitors.
REVOKE SELECT ON public.trainer_orgs FROM anon;
GRANT SELECT (
  id, owner_id, name, handle, bio, avatar, city, website, verified,
  created_at, updated_at, avatar_url, cover_url, address, place_id, geo,
  category, amenities, photos, hours, timezone
) ON public.trainer_orgs TO anon;

-- Signed-in users keep full access (including contact details).
GRANT SELECT ON public.trainer_orgs TO authenticated;
GRANT ALL ON public.trainer_orgs TO service_role;

-- 2) profiles: birthday stays owner-only (read via public.get_my_birthday()).
REVOKE SELECT (birthday) ON public.profiles FROM anon, authenticated;
-- sport_levels was added after the earlier column grants, leaving it unreadable.
GRANT SELECT (sport_levels) ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;

-- 3) SECURITY DEFINER helpers must not be callable by anonymous visitors.
REVOKE EXECUTE ON FUNCTION public.has_verified_gym_visit(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_verified_gym_visit(uuid, uuid) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.is_gym_admin_text(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_gym_admin_text(text, uuid) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.moderate_gym_review(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.moderate_gym_review(uuid, boolean) TO authenticated, service_role;

-- Trigger function: never called directly by clients.
REVOKE EXECUTE ON FUNCTION public.enforce_gym_review() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_gym_review() TO service_role;