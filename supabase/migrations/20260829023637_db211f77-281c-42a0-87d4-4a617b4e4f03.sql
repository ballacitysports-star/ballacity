ALTER TABLE public.highlight_reels
  ADD COLUMN IF NOT EXISTS ai_analysis jsonb,
  ADD COLUMN IF NOT EXISTS ai_moments jsonb,
  ADD COLUMN IF NOT EXISTS ai_sport text,
  ADD COLUMN IF NOT EXISTS suggested_clip jsonb,
  ADD COLUMN IF NOT EXISTS frame_paths text[];