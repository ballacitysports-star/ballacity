-- Ages 13-15: reels stay with the family unless a verified guardian approves ONE team.
--
-- Replaces the earlier "signed-in members" option for 13-15. From now on a 13-15
-- reel is never public, never member-wide, never searchable. The only audiences are:
--   the player and their verified guardian(s)            [default for every reel]
--   the verified members and coaching staff of ONE team  [only if a guardian approves]
-- A player cannot broaden this. They can narrow it: clear their own reel's approval.
--
-- Everything is checked in the database, every time:
--   * team_share_team_id / guardian_team_approved_* can only be written by server code
--     (auth.uid() IS NULL, the service role) unless the write clears them;
--   * the approval names a guardian who is still verified, a team the player is
--     still on, and a reel that is completed, posted and not on a safety hold;
--   * teen_reel_viewer_access() re-checks all of that on every read, so ending the
--     guardian link, leaving the team, a lock, a suspension or a safety hold stops
--     access at once, with no cleanup needed.
--
-- Ages 16-17 and adults are unchanged. Under-13 clips are unchanged (family posts).

ALTER TABLE public.highlight_reels
  ADD COLUMN IF NOT EXISTS guardian_team_approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS guardian_team_approved_at timestamptz;

-- 13-15 reels are never shown beyond the family and one approved team. 'members' is gone.
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
    WHEN public.age_cohort_of(r.user_id) = 'teen_13_15' THEN 'none'
    WHEN public.age_cohort_of(r.user_id) = 'teen_16_17' THEN 'members'
    ELSE 'public'
  END
  FROM (SELECT * FROM public.highlight_reels WHERE id = _reel_id) r;
$function$;

-- The guardian's media-visibility control can no longer be set to 'members' by anyone.
UPDATE public.child_controls SET media_visibility = 'guardian' WHERE media_visibility = 'members';

CREATE OR REPLACE FUNCTION public.guard_members_media_visibility()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.media_visibility = 'members' THEN
    RAISE EXCEPTION 'MEMBERS_SHARING_NOT_AVAILABLE'
      USING HINT = 'Reels from children and young teens are shared only with the family and, if a guardian approves, one team.';
  END IF;
  RETURN NEW;
END $$;

-- The family-post team guard must leave 13-15 reels to the guard below.
CREATE OR REPLACE FUNCTION public.guard_family_post_team()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.team_share_team_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.team_share_team_id IS NOT DISTINCT FROM OLD.team_share_team_id THEN
    RETURN NEW;
  END IF;
  IF NEW.subject_child_id IS NULL THEN
    IF public.age_cohort_of(NEW.user_id) = 'teen_13_15' THEN
      RETURN NEW; -- guard_teen_reel_team decides
    END IF;
    RAISE EXCEPTION 'FAMILY_TEAM_NOT_FAMILY_POST';
  END IF;
  IF NOT public.family_team_share_enabled() THEN
    RAISE EXCEPTION 'FAMILY_TEAM_SHARE_OFF';
  END IF;
  IF NOT public.is_guardian_of(NEW.user_id, NEW.subject_child_id) THEN
    RAISE EXCEPTION 'FAMILY_POST_NOT_GUARDIAN';
  END IF;
  IF NOT public.family_child_allows(NEW.subject_child_id, 'team') THEN
    RAISE EXCEPTION 'FAMILY_TEAM_NOT_ALLOWED';
  END IF;
  IF public.team_role_of(NEW.team_share_team_id, NEW.subject_child_id) IS NULL THEN
    RAISE EXCEPTION 'FAMILY_TEAM_CHILD_NOT_ON_TEAM';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.guard_teen_reel_team()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE cleared boolean; c text;
BEGIN
  IF NEW.subject_child_id IS NOT NULL THEN
    RETURN NEW; -- a family post: handled by guard_family_post_team
  END IF;
  IF TG_OP = 'UPDATE'
     AND NEW.team_share_team_id IS NOT DISTINCT FROM OLD.team_share_team_id
     AND NEW.guardian_team_approved_by IS NOT DISTINCT FROM OLD.guardian_team_approved_by
     AND NEW.guardian_team_approved_at IS NOT DISTINCT FROM OLD.guardian_team_approved_at THEN
    RETURN NEW;
  END IF;

  cleared := NEW.team_share_team_id IS NULL
         AND NEW.guardian_team_approved_by IS NULL
         AND NEW.guardian_team_approved_at IS NULL;
  IF cleared THEN
    RETURN NEW; -- anyone may narrow a reel back to the family
  END IF;

  c := public.age_cohort_of(NEW.user_id);
  IF c IS DISTINCT FROM 'teen_13_15' THEN
    RAISE EXCEPTION 'TEEN_TEAM_NOT_AVAILABLE';
  END IF;
  -- Only server code, acting for a guardian, can widen. A player cannot.
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'TEEN_TEAM_GUARDIAN_ONLY';
  END IF;
  IF NEW.team_share_team_id IS NULL OR NEW.guardian_team_approved_by IS NULL THEN
    RAISE EXCEPTION 'TEEN_TEAM_INCOMPLETE';
  END IF;
  IF NOT public.is_guardian_of(NEW.guardian_team_approved_by, NEW.user_id) THEN
    RAISE EXCEPTION 'TEEN_TEAM_GUARDIAN_ONLY';
  END IF;
  IF public.child_features_locked(NEW.user_id)
     OR public.team_role_of(NEW.team_share_team_id, NEW.user_id) IS NULL THEN
    RAISE EXCEPTION 'TEEN_TEAM_NOT_ON_TEAM';
  END IF;
  IF NEW.is_draft OR NEW.status <> 'completed' OR NEW.hidden_at IS NOT NULL THEN
    RAISE EXCEPTION 'TEEN_TEAM_NOT_READY';
  END IF;
  NEW.guardian_team_approved_at := COALESCE(NEW.guardian_team_approved_at, now());
  RETURN NEW;
END $$;

REVOKE EXECUTE ON FUNCTION public.guard_teen_reel_team() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_teen_reel_team ON public.highlight_reels;
CREATE TRIGGER trg_guard_teen_reel_team
BEFORE INSERT OR UPDATE OF team_share_team_id, guardian_team_approved_by, guardian_team_approved_at
ON public.highlight_reels
FOR EACH ROW EXECUTE FUNCTION public.guard_teen_reel_team();

-- The one check for a 13-15 reel: 'owner' (the player), 'guardian', 'team' or 'none'.
CREATE OR REPLACE FUNCTION public.teen_reel_viewer_access(_reel_id uuid, _viewer uuid)
RETURNS text
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE r record;
BEGIN
  IF _viewer IS NULL THEN
    RETURN 'none';
  END IF;
  SELECT user_id, subject_child_id, status, hidden_at, is_draft, team_share_team_id,
         guardian_team_approved_by INTO r
  FROM public.highlight_reels WHERE id = _reel_id;
  IF NOT FOUND OR r.subject_child_id IS NOT NULL OR r.hidden_at IS NOT NULL
     OR public.age_cohort_of(r.user_id) IS DISTINCT FROM 'teen_13_15'
     OR public.child_features_locked(r.user_id) THEN
    RETURN 'none';
  END IF;

  IF _viewer = r.user_id THEN
    RETURN 'owner';
  END IF;
  IF public.is_guardian_of(_viewer, r.user_id) THEN
    RETURN 'guardian';
  END IF;

  IF r.status = 'completed' AND NOT r.is_draft
     AND r.team_share_team_id IS NOT NULL
     AND r.guardian_team_approved_by IS NOT NULL
     AND public.is_guardian_of(r.guardian_team_approved_by, r.user_id)
     AND public.team_role_of(r.team_share_team_id, r.user_id) IS NOT NULL
     AND public.team_role_of(r.team_share_team_id, _viewer) IS NOT NULL
     AND public.age_cohort_of(_viewer) IS DISTINCT FROM 'child_under_13'
     AND NOT public.child_features_locked(_viewer)
     AND NOT EXISTS (SELECT 1 FROM public.profiles p
                     WHERE p.id = _viewer AND p.suspended_at IS NOT NULL) THEN
    RETURN 'team';
  END IF;
  RETURN 'none';
END $$;

REVOKE EXECUTE ON FUNCTION public.teen_reel_viewer_access(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.teen_reel_viewer_access(uuid, uuid) TO service_role;

-- 13-15 reels a team member may watch because a guardian approved their team.
CREATE OR REPLACE FUNCTION public.teen_reels_visible_to(_viewer uuid)
RETURNS TABLE (reel_id uuid, title text, caption text, created_at timestamptz, via text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT h.id, COALESCE(NULLIF(h.ai_title, ''), h.title), h.ai_caption, h.created_at, 'team'::text
  FROM public.highlight_reels h
  WHERE h.subject_child_id IS NULL
    AND h.team_share_team_id IS NOT NULL
    AND h.guardian_team_approved_by IS NOT NULL
    AND public.teen_reel_viewer_access(h.id, _viewer) = 'team'
  ORDER BY h.created_at DESC
  LIMIT 50;
$$;

REVOKE EXECUTE ON FUNCTION public.teen_reels_visible_to(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.teen_reels_visible_to(uuid) TO service_role;
