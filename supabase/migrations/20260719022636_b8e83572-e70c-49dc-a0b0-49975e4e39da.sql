ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS availability_rules jsonb NOT NULL DEFAULT '[]'::jsonb;