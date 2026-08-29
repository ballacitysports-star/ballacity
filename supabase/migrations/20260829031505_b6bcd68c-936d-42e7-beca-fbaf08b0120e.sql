ALTER TABLE public.highlight_reels
  ADD COLUMN IF NOT EXISTS ai_timeline jsonb,
  ADD COLUMN IF NOT EXISTS ai_edit_plan jsonb,
  ADD COLUMN IF NOT EXISTS ai_coaching jsonb,
  ADD COLUMN IF NOT EXISTS ai_transcript jsonb,
  ADD COLUMN IF NOT EXISTS frame_times double precision[],
  ADD COLUMN IF NOT EXISTS audio_path text;