-- Pro Analytics for highlight reels: 0-100 ratings, timestamped biomechanics
-- cues, playstyle archetype, style comps and a scout report. Written by the
-- reel pipeline's "analytics" step; nullable, so existing reels are unchanged.
ALTER TABLE public.highlight_reels
  ADD COLUMN IF NOT EXISTS ai_advanced_analytics jsonb;
