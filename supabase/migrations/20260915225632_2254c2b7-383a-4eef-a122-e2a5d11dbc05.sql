-- 1) Internal trigger helper must not be directly callable via the API
REVOKE EXECUTE ON FUNCTION public.guard_profile_moderation_fields() FROM PUBLIC, anon, authenticated;

-- 2) Availability location privacy: honour precise vs approximate for the address too
CREATE OR REPLACE FUNCTION public.apply_availability_location_privacy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _mode text := COALESCE(public.privacy_text(NEW.user_id, 'location_precision'), 'approximate');
BEGIN
  IF _mode = 'hidden' THEN
    NEW.lat := NULL; NEW.lng := NULL; NEW.formatted_address := NULL; NEW.place_id := NULL; NEW.city := NULL;
  ELSIF _mode = 'city' THEN
    NEW.lat := NULL; NEW.lng := NULL; NEW.formatted_address := NULL; NEW.place_id := NULL;
  ELSIF _mode IN ('exact', 'precise') THEN
    -- user explicitly opted into precise sharing: keep as provided
    NULL;
  ELSE
    -- 'approximate' (default): coarse coordinates and no street-level address
    NEW.lat := round(NEW.lat, 2);
    NEW.lng := round(NEW.lng, 2);
    NEW.place_id := NULL;
    IF NEW.formatted_address IS NOT NULL AND position(',' in NEW.formatted_address) > 0 THEN
      NEW.formatted_address := btrim(substring(NEW.formatted_address from position(',' in NEW.formatted_address) + 1));
    ELSIF NEW.formatted_address IS NOT NULL THEN
      NEW.formatted_address := COALESCE(NEW.city, NEW.formatted_address);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Backfill existing rows so already-stored street addresses are coarsened
UPDATE public.player_availabilities a
SET place_id = NULL,
    lat = round(a.lat, 2),
    lng = round(a.lng, 2),
    formatted_address = CASE
      WHEN a.formatted_address IS NULL THEN NULL
      WHEN position(',' in a.formatted_address) > 0
        THEN btrim(substring(a.formatted_address from position(',' in a.formatted_address) + 1))
      ELSE COALESCE(a.city, a.formatted_address)
    END
WHERE COALESCE(public.privacy_text(a.user_id, 'location_precision'), 'approximate')
      NOT IN ('exact', 'precise', 'hidden', 'city');

-- 3) Private reviews: require the reviewee to be a person, not a gym/team/org
DROP POLICY IF EXISTS "Reviewees view their private reviews" ON public.reviews;
CREATE POLICY "Reviewees view their private reviews"
ON public.reviews
FOR SELECT
TO authenticated
USING (
  is_private = true
  AND reviewee_id = (auth.uid())::text
  AND reviewee_kind NOT IN ('gym', 'team', 'org', 'trainer_org')
);