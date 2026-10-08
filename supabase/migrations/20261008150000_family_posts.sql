-- Family posts: a parent uploads a clip of their under-13 child to the PARENT's
-- account, tagged to the child through a verified guardian link.
--
-- Step one is deliberately private. A family post is never shown on the highlights
-- feed, a profile, or to any other member: reel_audience() returns 'none' for it,
-- so the only reader is the parent who owns the reel. It is not a way around the
-- under-13 rule that reels from children are never public.
--
-- The feature is OFF until app_settings has {"enabled": true} under the key
-- 'family_posts'. A missing row means off. It is enforced here, in the database,
-- not just in the UI.
--
-- Checked on INSERT, or when the tag changes:
--   * the feature switch is on;
--   * the poster is an active, verified guardian of that child (is_guardian_of);
--   * the child is in the under-13 band;
--   * the guardian has AI video analysis switched on for that child, because
--     every upload is analysed by AI and the parent controls that per child.
-- Rows that merely carry an existing tag (the pipeline updating a reel) pass.
--
-- Deleting the child's account deletes the family posts about them.
ALTER TABLE public.highlight_reels
  ADD COLUMN IF NOT EXISTS subject_child_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS highlight_reels_subject_child_idx
  ON public.highlight_reels (subject_child_id) WHERE subject_child_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.guard_family_post()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE enabled boolean;
BEGIN
  IF NEW.subject_child_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.subject_child_id IS NOT DISTINCT FROM OLD.subject_child_id THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE((value ->> 'enabled')::boolean, false) INTO enabled
  FROM public.app_settings WHERE key = 'family_posts';
  IF NOT COALESCE(enabled, false) THEN
    RAISE EXCEPTION 'FAMILY_POSTS_OFF';
  END IF;

  IF NOT public.is_guardian_of(NEW.user_id, NEW.subject_child_id) THEN
    RAISE EXCEPTION 'FAMILY_POST_NOT_GUARDIAN';
  END IF;

  IF public.age_cohort_of(NEW.subject_child_id) IS DISTINCT FROM 'child_under_13' THEN
    RAISE EXCEPTION 'FAMILY_POST_UNDER_13_ONLY';
  END IF;

  IF COALESCE((SELECT c.ai_analysis FROM public.child_controls c
               WHERE c.child_user_id = NEW.subject_child_id), false) IS NOT TRUE THEN
    RAISE EXCEPTION 'FAMILY_POST_AI_OFF';
  END IF;

  RETURN NEW;
END $$;

REVOKE EXECUTE ON FUNCTION public.guard_family_post() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_family_post ON public.highlight_reels;
CREATE TRIGGER trg_guard_family_post
BEFORE INSERT OR UPDATE OF subject_child_id ON public.highlight_reels
FOR EACH ROW EXECUTE FUNCTION public.guard_family_post();

-- reel_audience(): identical to the previous version plus one line, so a family
-- post is never visible to anyone but its owner.
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
    WHEN r.subject_child_id IS NOT NULL THEN 'none'
    WHEN public.age_cohort_of(r.user_id) = 'child_under_13' THEN 'none'
    WHEN public.child_features_locked(r.user_id) THEN 'none'
    -- 13-15: only when the guardian chose 'members', and then only to signed-in members.
    WHEN public.age_cohort_of(r.user_id) = 'teen_13_15' THEN
      CASE WHEN (SELECT c.media_visibility FROM public.child_controls c
                 WHERE c.child_user_id = r.user_id) = 'members'
           THEN 'members' ELSE 'none' END
    WHEN public.age_cohort_of(r.user_id) = 'teen_16_17' THEN 'members'
    ELSE 'public'
  END
  FROM (SELECT * FROM public.highlight_reels WHERE id = _reel_id) r;
$function$;
