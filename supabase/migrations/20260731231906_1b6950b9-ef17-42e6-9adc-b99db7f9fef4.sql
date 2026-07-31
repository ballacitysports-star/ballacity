ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS search_radius_mi integer;

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_search_radius_mi_range;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_search_radius_mi_range
  CHECK (search_radius_mi IS NULL OR (search_radius_mi >= 1 AND search_radius_mi <= 12500));

GRANT SELECT (search_radius_mi) ON public.profiles TO anon, authenticated;