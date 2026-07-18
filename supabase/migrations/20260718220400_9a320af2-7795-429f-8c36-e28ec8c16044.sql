
ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS format text,
  ADD COLUMN IF NOT EXISTS venues text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS cadence text,
  ADD COLUMN IF NOT EXISTS positions_needed jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS rating_system text,
  ADD COLUMN IF NOT EXISTS rating_min text,
  ADD COLUMN IF NOT EXISTS rating_max text,
  ADD COLUMN IF NOT EXISTS distances text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS session_types text[] NOT NULL DEFAULT '{}';
