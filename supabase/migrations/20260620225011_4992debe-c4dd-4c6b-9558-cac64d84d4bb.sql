ALTER TABLE public.location_denial_events ADD COLUMN IF NOT EXISTS sport text;
CREATE INDEX IF NOT EXISTS location_denial_events_sport_idx ON public.location_denial_events (sport, created_at DESC);