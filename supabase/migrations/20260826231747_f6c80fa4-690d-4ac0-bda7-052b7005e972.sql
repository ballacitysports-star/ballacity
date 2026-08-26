ALTER TABLE public.hosted_games ADD COLUMN IF NOT EXISTS series_id uuid;
CREATE INDEX IF NOT EXISTS hosted_games_series_id_idx ON public.hosted_games (series_id) WHERE series_id IS NOT NULL;