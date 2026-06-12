ALTER TABLE public.highlight_reels
  ADD COLUMN IF NOT EXISTS processing_step text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS step_progress jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS last_step_at timestamptz;

CREATE INDEX IF NOT EXISTS highlight_reels_status_step_idx
  ON public.highlight_reels (status, processing_step);