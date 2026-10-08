-- Family posts: "Team & coaches only" visibility, and the child's own read-only view.
--
-- Visibility tiers for a family post (a parent's clip of their under-13 child):
--   Private        the parent, and the linked child (read-only; the parent can turn
--                  the child's view off per child)                         [default]
--   Team & coaches verified members and coaching staff of ONE team the parent chose
--   Protected link a private link the parent sends (separate migration)
--   Public         never. reel_audience() still returns 'none' for a family post,
--                  so it can never reach the feed, a profile or other members.
--
-- Nothing here changes who can read a reel through row-level security or storage:
-- viewers other than the parent are served only by server code that first calls
-- family_post_viewer_access(), the single check below, which runs on EVERY read.
--
-- The team tier is OFF until app_settings 'family_post_team_share' = {"enabled": true}
-- AND 'family_posts' = {"enabled": true}. Missing means off. The child's own view
-- needs only 'family_posts' and is on by default per child.

ALTER TABLE public.highlight_reels
  ADD COLUMN IF NOT EXISTS team_share_team_id text REFERENCES public.teams(id) ON DELETE SET NULL;

ALTER TABLE public.child_controls
  ADD COLUMN IF NOT EXISTS family_posts_child_view boolean NOT NULL DEFAULT true;

CREATE OR REPLACE FUNCTION public.family_posts_enabled()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE((SELECT (value ->> 'enabled')::boolean FROM public.app_settings
                   WHERE key = 'family_posts'), false);
$$;

CREATE OR REPLACE FUNCTION public.family_team_share_enabled()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.family_posts_enabled()
     AND COALESCE((SELECT (value ->> 'enabled')::boolean FROM public.app_settings
                   WHERE key = 'family_post_team_share'), false);
$$;

REVOKE EXECUTE ON FUNCTION public.family_posts_enabled() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.family_team_share_enabled() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.family_posts_enabled() TO service_role;
GRANT EXECUTE ON FUNCTION public.family_team_share_enabled() TO service_role;

-- Choosing a team must satisfy the rules even for a direct write.
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
    RAISE EXCEPTION 'FAMILY_TEAM_NOT_FAMILY_POST';
  END IF;
  IF NOT public.family_team_share_enabled() THEN
    RAISE EXCEPTION 'FAMILY_TEAM_SHARE_OFF';
  END IF;
  IF NOT public.is_guardian_of(NEW.user_id, NEW.subject_child_id) THEN
    RAISE EXCEPTION 'FAMILY_POST_NOT_GUARDIAN';
  END IF;
  IF public.team_role_of(NEW.team_share_team_id, NEW.subject_child_id) IS NULL THEN
    RAISE EXCEPTION 'FAMILY_TEAM_CHILD_NOT_ON_TEAM';
  END IF;
  RETURN NEW;
END $$;

REVOKE EXECUTE ON FUNCTION public.guard_family_post_team() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_family_post_team ON public.highlight_reels;
CREATE TRIGGER trg_guard_family_post_team
BEFORE INSERT OR UPDATE OF team_share_team_id ON public.highlight_reels
FOR EACH ROW EXECUTE FUNCTION public.guard_family_post_team();

-- The one access check. Returns 'child', 'team' or 'none'. Re-evaluated on every
-- read, so removing someone from the team, ending the guardian link, a safety
-- hold, or a switch being turned off stops access immediately.
CREATE OR REPLACE FUNCTION public.family_post_viewer_access(_reel_id uuid, _viewer uuid)
RETURNS text
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE r record;
BEGIN
  IF _viewer IS NULL OR NOT public.family_posts_enabled() THEN
    RETURN 'none';
  END IF;

  SELECT user_id, subject_child_id, status, hidden_at, team_share_team_id INTO r
  FROM public.highlight_reels WHERE id = _reel_id;

  IF NOT FOUND OR r.subject_child_id IS NULL OR r.status <> 'completed' OR r.hidden_at IS NOT NULL THEN
    RETURN 'none';
  END IF;
  -- The poster must still be a verified guardian, and the child's account unlocked.
  IF NOT public.is_guardian_of(r.user_id, r.subject_child_id)
     OR public.child_features_locked(r.subject_child_id) THEN
    RETURN 'none';
  END IF;

  -- The linked child: read-only, unless their parent turned it off.
  IF _viewer = r.subject_child_id THEN
    IF COALESCE((SELECT c.family_posts_child_view FROM public.child_controls c
                 WHERE c.child_user_id = r.subject_child_id), true) THEN
      RETURN 'child';
    END IF;
    RETURN 'none';
  END IF;

  -- Team & coaches: members and staff of the ONE team the parent chose, while the
  -- child is still on it. Never viewers under 13, suspended or locked accounts.
  IF r.team_share_team_id IS NOT NULL
     AND public.family_team_share_enabled()
     AND public.team_role_of(r.team_share_team_id, r.subject_child_id) IS NOT NULL
     AND public.team_role_of(r.team_share_team_id, _viewer) IS NOT NULL
     AND public.age_cohort_of(_viewer) IS DISTINCT FROM 'child_under_13'
     AND NOT public.child_features_locked(_viewer)
     AND NOT EXISTS (SELECT 1 FROM public.profiles p
                     WHERE p.id = _viewer AND p.suspended_at IS NOT NULL) THEN
    RETURN 'team';
  END IF;

  RETURN 'none';
END $$;

REVOKE EXECUTE ON FUNCTION public.family_post_viewer_access(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.family_post_viewer_access(uuid, uuid) TO service_role;

-- Family posts a viewer may open: the child's own, and those shared with a team
-- they belong to. Every row passes family_post_viewer_access().
CREATE OR REPLACE FUNCTION public.family_posts_visible_to(_viewer uuid)
RETURNS TABLE (reel_id uuid, title text, caption text, created_at timestamptz, via text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT h.id, COALESCE(NULLIF(h.ai_title, ''), h.title), h.ai_caption, h.created_at,
         public.family_post_viewer_access(h.id, _viewer)
  FROM public.highlight_reels h
  WHERE h.subject_child_id IS NOT NULL
    AND (h.subject_child_id = _viewer OR h.team_share_team_id IS NOT NULL)
    AND public.family_post_viewer_access(h.id, _viewer) <> 'none'
  ORDER BY h.created_at DESC
  LIMIT 50;
$$;

REVOKE EXECUTE ON FUNCTION public.family_posts_visible_to(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.family_posts_visible_to(uuid) TO service_role;
