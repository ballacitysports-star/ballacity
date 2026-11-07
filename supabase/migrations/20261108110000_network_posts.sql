-- Network posts (backlog P1-2, database layer).
--
-- A post is a short update from a person, a team or a facility, shown to one audience.
-- It is a new table, so nothing that reads team_posts changes. team_posts keeps tryouts,
-- clinics, recaps and team announcements until events (P2-1). Comments and reactions on
-- posts come in a follow-up, once the comment owner lookup in PR #320 has landed.
--
-- Who posts as what (checked by guard_post_write, for every write):
--   posted_as 'person'  the author themselves. team_id is set only for audience 'team'
--                       (a team the author belongs to).
--   posted_as 'team'    a manager of team_id posts for the team.
--   posted_as 'org'     the facility's owner or an admin posts for org_id.
--
-- Audiences:
--   public     anyone, signed in or not
--   followers  people who follow the author; for a team or facility post, people who follow that team or facility
--   team       members of team_id
--   family     the author's verified guardians and the author's verified children
--
-- Minors (author's age cohort), the same shape as reels:
--   under 13 or no date of birth   cannot post (POST_AGE_NOT_ALLOWED)
--   13-15                          team or family only
--   16-17                          followers, team or family; never public
--   an account still waiting for a parent's approval cannot post (POST_LOCKED)
-- The caps apply on every write, so an edit cannot widen a minor's audience.
--
-- Moderation: the existing enforce_post_text_moderation trigger forces every member
-- write to 'pending' (author-only), and server code settles it to approved or held, as
-- for team posts and comments. Nobody but the author sees a post that is not approved,
-- or one that is hidden or deleted.
--
-- Blocks: a post is never shown across a block, in either direction.

CREATE TABLE IF NOT EXISTS public.posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  posted_as text NOT NULL DEFAULT 'person' CHECK (posted_as IN ('person', 'team', 'org')),
  team_id text REFERENCES public.teams(id) ON DELETE CASCADE,
  org_id uuid REFERENCES public.trainer_orgs(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'update' CHECK (kind IN ('update', 'announcement', 'achievement', 'recap')),
  audience text NOT NULL CHECK (audience IN ('public', 'followers', 'team', 'family')),
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  image_url text CHECK (image_url IS NULL OR char_length(image_url) <= 1000),
  moderation_status text NOT NULL DEFAULT 'pending' CHECK (moderation_status IN ('pending', 'approved', 'held')),
  hidden_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS posts_created_idx ON public.posts (created_at DESC);
CREATE INDEX IF NOT EXISTS posts_author_idx ON public.posts (author_id, created_at DESC);
CREATE INDEX IF NOT EXISTS posts_team_idx ON public.posts (team_id, created_at DESC) WHERE team_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS posts_org_idx ON public.posts (org_id, created_at DESC) WHERE org_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS posts_moderation_idx ON public.posts (moderation_status) WHERE moderation_status <> 'approved';

ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.posts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.posts TO anon, authenticated;
GRANT INSERT (id, posted_as, team_id, org_id, kind, audience, body, image_url, author_id) ON public.posts TO authenticated;
GRANT UPDATE (kind, audience, body, image_url, deleted_at) ON public.posts TO authenticated;
GRANT DELETE ON public.posts TO authenticated;
GRANT ALL ON public.posts TO service_role;

-- ------------------------------------------------------------------ audience caps
-- The audiences an author may use, by age cohort. Empty means they cannot post.
CREATE OR REPLACE FUNCTION private_sec.post_audiences_allowed(_author uuid)
RETURNS text[]
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE public.age_cohort_of(_author)
    WHEN 'adult' THEN ARRAY['public', 'followers', 'team', 'family']
    WHEN 'teen_16_17' THEN ARRAY['followers', 'team', 'family']
    WHEN 'teen_13_15' THEN ARRAY['team', 'family']
    ELSE ARRAY[]::text[]
  END;
$$;

REVOKE ALL ON FUNCTION private_sec.post_audiences_allowed(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private_sec.post_audiences_allowed(uuid) TO service_role;

-- ------------------------------------------------------------------ write guard
CREATE OR REPLACE FUNCTION public.guard_post_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _allowed text[];
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- Who a post is from never changes.
    IF NEW.author_id IS DISTINCT FROM OLD.author_id OR NEW.posted_as IS DISTINCT FROM OLD.posted_as
       OR NEW.team_id IS DISTINCT FROM OLD.team_id OR NEW.org_id IS DISTINCT FROM OLD.org_id THEN
      RAISE EXCEPTION 'POST_OWNER_FIXED';
    END IF;
    -- A soft-deleted post stays deleted.
    IF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
      RAISE EXCEPTION 'POST_DELETED';
    END IF;
    NEW.updated_at := now();
    -- Deleting is always allowed, even if the author's audience cap has since dropped.
    IF NEW.deleted_at IS NOT NULL THEN
      RETURN NEW;
    END IF;
  END IF;

  -- Server code (service role) and nested system writes settle moderation and hide rows;
  -- the checks below are for what members write.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' AND public.child_features_locked(NEW.author_id) THEN
    RAISE EXCEPTION 'POST_LOCKED';
  END IF;

  _allowed := private_sec.post_audiences_allowed(NEW.author_id);
  IF cardinality(_allowed) = 0 THEN
    RAISE EXCEPTION 'POST_AGE_NOT_ALLOWED';
  END IF;
  IF NOT (NEW.audience = ANY (_allowed)) THEN
    RAISE EXCEPTION 'POST_AUDIENCE_NOT_ALLOWED';
  END IF;

  IF NEW.posted_as = 'person' THEN
    IF NEW.org_id IS NOT NULL THEN
      RAISE EXCEPTION 'POST_TARGET_INVALID';
    END IF;
    IF NEW.audience = 'team' THEN
      IF NEW.team_id IS NULL OR NOT public.is_team_member(NEW.team_id, NEW.author_id) THEN
        RAISE EXCEPTION 'POST_TARGET_INVALID';
      END IF;
    ELSIF NEW.team_id IS NOT NULL THEN
      RAISE EXCEPTION 'POST_TARGET_INVALID';
    END IF;
  ELSIF NEW.posted_as = 'team' THEN
    IF NEW.team_id IS NULL OR NEW.org_id IS NOT NULL
       OR NOT public.is_team_manager(NEW.team_id, NEW.author_id) THEN
      RAISE EXCEPTION 'POST_TARGET_INVALID';
    END IF;
    -- A team's followers come from entity follows (#317); family is a person's audience.
    IF NEW.audience NOT IN ('public', 'team', 'followers') THEN
      RAISE EXCEPTION 'POST_AUDIENCE_NOT_ALLOWED';
    END IF;
  ELSIF NEW.posted_as = 'org' THEN
    IF NEW.org_id IS NULL OR NEW.team_id IS NOT NULL
       OR NOT (EXISTS (SELECT 1 FROM public.trainer_orgs o WHERE o.id = NEW.org_id AND o.owner_id = NEW.author_id)
               OR public.is_trainer_org_admin(NEW.org_id, NEW.author_id)) THEN
      RAISE EXCEPTION 'POST_TARGET_INVALID';
    END IF;
    -- A facility's followers come from entity follows (#317).
    IF NEW.audience NOT IN ('public', 'followers') THEN
      RAISE EXCEPTION 'POST_AUDIENCE_NOT_ALLOWED';
    END IF;
  END IF;

  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.guard_post_write() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_post_write() TO service_role;

-- "aa_" so it runs before the moderation trigger forces the status.
DROP TRIGGER IF EXISTS aa_guard_post_write ON public.posts;
CREATE TRIGGER aa_guard_post_write
BEFORE INSERT OR UPDATE ON public.posts
FOR EACH ROW EXECUTE FUNCTION public.guard_post_write();

DROP TRIGGER IF EXISTS posts_text_moderation ON public.posts;
CREATE TRIGGER posts_text_moderation
BEFORE INSERT OR UPDATE ON public.posts
FOR EACH ROW EXECUTE FUNCTION public.enforce_post_text_moderation();

-- ------------------------------------------------------------------ who sees a post
CREATE OR REPLACE FUNCTION private_sec.can_view_post(
  _author uuid, _posted_as text, _team text, _org uuid, _audience text, _viewer uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _viewer IS NOT NULL AND _viewer = _author THEN
    RETURN true;
  END IF;
  IF _viewer IS NOT NULL AND public.blocks_exist_between(_viewer, _author) THEN
    RETURN false;
  END IF;
  -- A hidden team or facility hides what it posted.
  IF _posted_as = 'team' AND EXISTS (SELECT 1 FROM public.teams t WHERE t.id = _team AND t.hidden_at IS NOT NULL) THEN
    RETURN false;
  END IF;
  IF _posted_as = 'org' AND EXISTS (SELECT 1 FROM public.trainer_orgs o WHERE o.id = _org AND o.hidden_at IS NOT NULL) THEN
    RETURN false;
  END IF;
  -- Belt and braces: a post can never be shown to more people than its author may reach
  -- today (a birthday correction can lower the cap after the post was written).
  IF NOT (_audience = ANY (private_sec.post_audiences_allowed(_author))) THEN
    RETURN false;
  END IF;

  IF _audience = 'public' THEN
    RETURN true;
  END IF;
  IF _viewer IS NULL THEN
    RETURN false;
  END IF;
  IF _audience = 'followers' THEN
    -- A person's followers (follows); a team's or facility's followers (entity follows, #317).
    IF _posted_as = 'team' THEN
      RETURN EXISTS (SELECT 1 FROM public.entity_follows ef
                      WHERE ef.follower_id = _viewer AND ef.target_kind = 'team' AND ef.target_id = _team);
    ELSIF _posted_as = 'org' THEN
      RETURN EXISTS (SELECT 1 FROM public.entity_follows ef
                      WHERE ef.follower_id = _viewer AND ef.target_kind = 'org' AND ef.target_id = _org::text);
    END IF;
    RETURN EXISTS (SELECT 1 FROM public.follows f WHERE f.follower_id = _viewer AND f.followee_id = _author);
  ELSIF _audience = 'team' THEN
    RETURN _team IS NOT NULL
       AND (public.is_team_member(_team, _viewer) OR public.is_team_manager(_team, _viewer));
  ELSIF _audience = 'family' THEN
    RETURN public.is_guardian_of(_viewer, _author) OR public.is_guardian_of(_author, _viewer);
  END IF;
  RETURN false;
END $$;

REVOKE ALL ON FUNCTION private_sec.can_view_post(uuid, text, text, uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private_sec.can_view_post(uuid, text, text, uuid, text, uuid) TO anon, authenticated, service_role;

DROP POLICY IF EXISTS posts_read_by_audience ON public.posts;
CREATE POLICY posts_read_by_audience ON public.posts
  FOR SELECT TO anon, authenticated
  USING (private_sec.can_view_post(author_id, posted_as, team_id, org_id, audience, auth.uid()));

DROP POLICY IF EXISTS posts_moderated_read ON public.posts;
CREATE POLICY posts_moderated_read ON public.posts
  AS RESTRICTIVE FOR SELECT TO anon, authenticated
  USING ((moderation_status = 'approved' AND hidden_at IS NULL AND deleted_at IS NULL) OR author_id = auth.uid());

DROP POLICY IF EXISTS posts_author_insert ON public.posts;
CREATE POLICY posts_author_insert ON public.posts
  FOR INSERT TO authenticated
  WITH CHECK (author_id = auth.uid());

DROP POLICY IF EXISTS posts_author_update ON public.posts;
CREATE POLICY posts_author_update ON public.posts
  FOR UPDATE TO authenticated
  USING (author_id = auth.uid())
  WITH CHECK (author_id = auth.uid());

-- The author deletes their post; a team's managers can also remove what was posted for or
-- to their team.
DROP POLICY IF EXISTS posts_author_or_manager_delete ON public.posts;
CREATE POLICY posts_author_or_manager_delete ON public.posts
  FOR DELETE TO authenticated
  USING (author_id = auth.uid() OR (team_id IS NOT NULL AND public.is_team_manager(team_id, auth.uid())));

-- ------------------------------------------------------------------ feature flag
-- The app shows posts only when this is on. Off until the owner turns it on.
INSERT INTO public.app_settings (key, value, description, is_public)
VALUES ('network_posts', '{"enabled": false}'::jsonb,
        'Network posts and the Home feed (P1-2). Off until released.', true)
ON CONFLICT (key) DO NOTHING;
