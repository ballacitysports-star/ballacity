DROP VIEW IF EXISTS public.trainer_orgs_public;

CREATE POLICY "orgs are publicly viewable" ON public.trainer_orgs
  FOR SELECT TO anon USING (hidden_at IS NULL);

REVOKE SELECT ON public.trainer_orgs FROM anon;
GRANT SELECT (
  id, owner_id, name, handle, bio, avatar, avatar_url, cover_url, city, website,
  verified, address, place_id, geo, category, amenities, photos, hours, timezone,
  created_at, updated_at, hidden_at
) ON public.trainer_orgs TO anon;