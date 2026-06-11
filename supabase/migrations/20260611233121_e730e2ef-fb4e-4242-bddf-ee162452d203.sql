
ALTER TABLE public.highlight_reels
  ADD COLUMN IF NOT EXISTS ai_title text,
  ADD COLUMN IF NOT EXISTS ai_caption text,
  ADD COLUMN IF NOT EXISTS ai_hashtags text[],
  ADD COLUMN IF NOT EXISTS thumbnail_path text,
  ADD COLUMN IF NOT EXISTS processing_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;
