ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS sport_levels jsonb NOT NULL DEFAULT '{}'::jsonb;