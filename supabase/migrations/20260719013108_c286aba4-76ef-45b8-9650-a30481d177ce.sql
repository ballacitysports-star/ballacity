
ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS availability_overrides jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Discard existing trainer weekly slots per product decision (fresh start on the new calendar).
UPDATE public.teams
  SET availability_slots = '[]'::jsonb
  WHERE kind = 'coach';
