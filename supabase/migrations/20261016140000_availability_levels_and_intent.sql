-- Player availability posts: several competitive levels per sport, and whether
-- the player is available as a guest, to try out for a team, or both.
--
-- skill_levels: { "<sport>": "<tier> · <tier>" } for every listed sport. The
--   existing skill_level column keeps the primary sport's tiers so current
--   readers and filters are unchanged.
-- looking_for: any of 'guest', 'tryout'. Empty means the player didn't say.

ALTER TABLE public.player_availabilities
  ADD COLUMN IF NOT EXISTS skill_levels jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS looking_for text[] NOT NULL DEFAULT '{}';

ALTER TABLE public.player_availabilities
  DROP CONSTRAINT IF EXISTS player_availabilities_skill_levels_check;
ALTER TABLE public.player_availabilities
  ADD CONSTRAINT player_availabilities_skill_levels_check
  CHECK (jsonb_typeof(skill_levels) = 'object' AND length(skill_levels::text) <= 4000);

ALTER TABLE public.player_availabilities
  DROP CONSTRAINT IF EXISTS player_availabilities_looking_for_check;
ALTER TABLE public.player_availabilities
  ADD CONSTRAINT player_availabilities_looking_for_check
  CHECK (looking_for <@ ARRAY['guest', 'tryout']::text[]);

-- No backfill: readers fall back to skill_level for the primary sport when
-- skill_levels has no entry, and an UPDATE here would fire the row triggers
-- (updated_at, location privacy) on every existing post.

CREATE INDEX IF NOT EXISTS player_availabilities_looking_for_idx
  ON public.player_availabilities USING gin (looking_for)
  WHERE status = 'open';
