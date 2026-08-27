ALTER TABLE public.hosted_games
  ADD COLUMN IF NOT EXISTS ends_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS all_day boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS timezone text,
  ADD COLUMN IF NOT EXISTS arrive_early_min integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rrule jsonb,
  ADD COLUMN IF NOT EXISTS reminder_offsets integer[] NOT NULL DEFAULT '{}'::integer[];

-- Backfill ends_at from the free-text duration ("90 min", "1.5 h", "2 hours").
UPDATE public.hosted_games
SET ends_at = date + (
  CASE
    WHEN duration ~* 'h' THEN (COALESCE(NULLIF(regexp_replace(duration, '[^0-9.]', '', 'g'), ''), '1.5')::numeric * 60)
    ELSE COALESCE(NULLIF(regexp_replace(duration, '[^0-9.]', '', 'g'), ''), '90')::numeric
  END
) * interval '1 minute'
WHERE ends_at IS NULL;

UPDATE public.hosted_games SET timezone = 'America/New_York' WHERE timezone IS NULL;

CREATE INDEX IF NOT EXISTS hosted_games_ends_at_idx ON public.hosted_games (ends_at);