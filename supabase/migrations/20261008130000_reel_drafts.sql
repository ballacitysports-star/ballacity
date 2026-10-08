-- Reel drafts: a new reel can wait, private to its owner, until they post it.
--
-- `is_draft` defaults to false, so nothing changes for any existing reel and
-- applying this migration on its own changes no one's visibility. Only code
-- that deliberately creates a reel with is_draft = true (the Reels upload) makes
-- a draft; posting sets it back to false.
--
-- It is deliberately separate from `hidden_at`, which also carries safety holds
-- and moderation. A Post button must never be able to release a reel the safety
-- check held back, so posting only touches is_draft and every existing hidden_at
-- rule keeps applying afterwards.
--
-- Every public read of a reel (the SELECT policy via reel_publicly_visible, the
-- feed and per-user RPCs) goes through reel_audience(), so gating it here gates
-- them all. The body below is the existing definition plus the is_draft line.
ALTER TABLE public.highlight_reels
  ADD COLUMN IF NOT EXISTS is_draft boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.reel_audience(_reel_id uuid)
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN r.id IS NULL THEN 'none'
    WHEN r.hidden_at IS NOT NULL OR r.status <> 'completed' THEN 'none'
    WHEN r.is_draft THEN 'none'
    WHEN public.age_cohort_of(r.user_id) IN ('child_under_13', 'teen_13_15') THEN 'none'
    WHEN public.child_features_locked(r.user_id) THEN 'none'
    WHEN public.age_cohort_of(r.user_id) = 'teen_16_17' THEN 'members'
    ELSE 'public'
  END
  FROM (SELECT * FROM public.highlight_reels WHERE id = _reel_id) r;
$function$;
