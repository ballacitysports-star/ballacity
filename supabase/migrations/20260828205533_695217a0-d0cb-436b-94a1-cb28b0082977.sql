ALTER TABLE public.hosted_games
  ALTER COLUMN lat DROP NOT NULL,
  ALTER COLUMN lng DROP NOT NULL,
  ALTER COLUMN distance_mi DROP NOT NULL;

UPDATE public.hosted_games
SET lat = NULL, lng = NULL
WHERE lat IS NOT NULL AND lng IS NOT NULL
  AND round(lat::numeric, 4) = 50 AND round(lng::numeric, 4) = 50;

UPDATE public.hosted_games
SET distance_mi = NULL
WHERE distance_mi IS NOT NULL;