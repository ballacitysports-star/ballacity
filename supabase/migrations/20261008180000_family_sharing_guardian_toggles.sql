-- Guardian opt-in for family-clip sharing, per child.
--
-- The global switches (app_settings) say the features exist. These two per-child
-- controls say whether THIS child's guardian wants them. Both default to OFF, so
-- turning the global switches on changes nothing for any family until a guardian
-- opts in.
--
--   family_posts_link_sharing  guardian may create private share links for clips of this child
--   family_posts_team_sharing  guardian may share clips of this child with one of their teams
--
-- Enforced in the database on every check. Switching one off stops access at once:
-- the link resolver and the team-access check re-read it each time.

ALTER TABLE public.child_controls
  ADD COLUMN IF NOT EXISTS family_posts_link_sharing boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS family_posts_team_sharing boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.family_child_allows(_child uuid, _kind text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE((SELECT CASE _kind
                            WHEN 'link' THEN c.family_posts_link_sharing
                            WHEN 'team' THEN c.family_posts_team_sharing
                          END
                   FROM public.child_controls c WHERE c.child_user_id = _child), false);
$$;

REVOKE EXECUTE ON FUNCTION public.family_child_allows(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.family_child_allows(uuid, text) TO service_role;

-- Link creation: also needs the guardian's opt-in for this child.
CREATE OR REPLACE FUNCTION public.guard_family_post_link()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE r record;
BEGIN
  IF NOT public.family_share_enabled() THEN
    RAISE EXCEPTION 'FAMILY_SHARE_OFF';
  END IF;

  SELECT user_id, subject_child_id, status, hidden_at INTO r
  FROM public.highlight_reels WHERE id = NEW.reel_id;

  IF r.subject_child_id IS NULL OR r.user_id IS DISTINCT FROM NEW.created_by THEN
    RAISE EXCEPTION 'FAMILY_SHARE_NOT_OWNER';
  END IF;
  IF NOT public.is_guardian_of(NEW.created_by, r.subject_child_id) THEN
    RAISE EXCEPTION 'FAMILY_POST_NOT_GUARDIAN';
  END IF;
  IF NOT public.family_child_allows(r.subject_child_id, 'link') THEN
    RAISE EXCEPTION 'FAMILY_SHARE_NOT_ALLOWED';
  END IF;
  IF r.status <> 'completed' OR r.hidden_at IS NOT NULL THEN
    RAISE EXCEPTION 'FAMILY_SHARE_NOT_READY';
  END IF;
  IF NEW.expires_at <= now() OR NEW.expires_at > now() + interval '31 days' THEN
    RAISE EXCEPTION 'FAMILY_SHARE_BAD_EXPIRY';
  END IF;
  IF (SELECT count(*) FROM public.family_post_links l
      WHERE l.reel_id = NEW.reel_id AND l.revoked_at IS NULL AND l.expires_at > now()) >= 5 THEN
    RAISE EXCEPTION 'FAMILY_SHARE_TOO_MANY';
  END IF;
  RETURN NEW;
END $$;

-- Link opening: re-checks the opt-in every time.
CREATE OR REPLACE FUNCTION public.resolve_family_post_link(_token_hash text)
RETURNS TABLE (
  reel_id uuid,
  owner_id uuid,
  title text,
  caption text,
  video_path text,
  playback_path text,
  thumbnail_path text
)
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE l record; r record;
BEGIN
  IF NOT public.family_share_enabled() THEN
    RETURN;
  END IF;

  SELECT * INTO l FROM public.family_post_links
  WHERE token_hash = _token_hash AND revoked_at IS NULL AND expires_at > now();
  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT h.id, h.user_id, h.subject_child_id, h.status, h.hidden_at, h.title AS t, h.ai_title,
         h.ai_caption, h.video_path AS vp, h.playback_path AS pp, h.thumbnail_path AS tp
  INTO r FROM public.highlight_reels h WHERE h.id = l.reel_id;

  IF NOT FOUND OR r.subject_child_id IS NULL OR r.status <> 'completed' OR r.hidden_at IS NOT NULL
     OR r.user_id IS DISTINCT FROM l.created_by
     OR NOT public.is_guardian_of(l.created_by, r.subject_child_id)
     OR NOT public.family_child_allows(r.subject_child_id, 'link') THEN
    RETURN;
  END IF;

  UPDATE public.family_post_links
     SET view_count = view_count + 1, last_viewed_at = now()
   WHERE id = l.id;

  RETURN QUERY SELECT r.id, r.user_id, COALESCE(NULLIF(r.ai_title, ''), r.t), r.ai_caption,
                      r.vp, r.pp, r.tp;
END $$;

-- Choosing a team: also needs the opt-in.
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
  IF NOT public.family_child_allows(NEW.subject_child_id, 'team') THEN
    RAISE EXCEPTION 'FAMILY_TEAM_NOT_ALLOWED';
  END IF;
  IF public.team_role_of(NEW.team_share_team_id, NEW.subject_child_id) IS NULL THEN
    RAISE EXCEPTION 'FAMILY_TEAM_CHILD_NOT_ON_TEAM';
  END IF;
  RETURN NEW;
END $$;

-- Team access: the opt-in is part of the single check.
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
  IF NOT public.is_guardian_of(r.user_id, r.subject_child_id)
     OR public.child_features_locked(r.subject_child_id) THEN
    RETURN 'none';
  END IF;

  IF _viewer = r.subject_child_id THEN
    IF COALESCE((SELECT c.family_posts_child_view FROM public.child_controls c
                 WHERE c.child_user_id = r.subject_child_id), true) THEN
      RETURN 'child';
    END IF;
    RETURN 'none';
  END IF;

  IF r.team_share_team_id IS NOT NULL
     AND public.family_team_share_enabled()
     AND public.family_child_allows(r.subject_child_id, 'team')
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
