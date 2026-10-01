REVOKE SELECT ON public.trainer_orgs FROM anon;
GRANT SELECT (
  id, owner_id, name, handle, bio, avatar, city, website, verified,
  created_at, updated_at, avatar_url, cover_url, address, place_id, geo,
  category, amenities, photos, hours, timezone, hidden_at, listed_by,
  listed_at, claimed_at
) ON public.trainer_orgs TO anon;