ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS formats jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS cadences jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS venue_addresses jsonb NOT NULL DEFAULT '[]'::jsonb;