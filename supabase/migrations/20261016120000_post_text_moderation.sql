-- AI text moderation for team posts and comments.
--
-- Every new or edited post/comment starts 'pending' and is visible only to its
-- author (and a team post's managers) until server code has screened it:
--   'approved' → visible as before
--   'held'     → the screen could not clear it (or was unavailable); hidden from
--                everyone else until a superadmin approves it
--   'pending'  → not screened yet (e.g. written straight through the API,
--                skipping the server function); hidden the same way
-- Blocked text is never inserted at all (the server function refuses it).
--
-- Only server code (the service role, auth.uid() IS NULL) may set the status, so
-- a client cannot approve its own text. The read gate is a RESTRICTIVE policy, so
-- it applies on top of every existing SELECT policy without rewriting them.

ALTER TABLE public.team_posts
  ADD COLUMN IF NOT EXISTS moderation_status text NOT NULL DEFAULT 'approved';
ALTER TABLE public.post_comments
  ADD COLUMN IF NOT EXISTS moderation_status text NOT NULL DEFAULT 'approved';

-- Existing rows were backfilled 'approved' above; new rows start pending.
ALTER TABLE public.team_posts ALTER COLUMN moderation_status SET DEFAULT 'pending';
ALTER TABLE public.post_comments ALTER COLUMN moderation_status SET DEFAULT 'pending';

ALTER TABLE public.team_posts DROP CONSTRAINT IF EXISTS team_posts_moderation_status_check;
ALTER TABLE public.team_posts ADD CONSTRAINT team_posts_moderation_status_check
  CHECK (moderation_status IN ('pending', 'approved', 'held'));
ALTER TABLE public.post_comments DROP CONSTRAINT IF EXISTS post_comments_moderation_status_check;
ALTER TABLE public.post_comments ADD CONSTRAINT post_comments_moderation_status_check
  CHECK (moderation_status IN ('pending', 'approved', 'held'));

CREATE INDEX IF NOT EXISTS team_posts_moderation_status_idx
  ON public.team_posts (moderation_status) WHERE moderation_status <> 'approved';
CREATE INDEX IF NOT EXISTS post_comments_moderation_status_idx
  ON public.post_comments (moderation_status) WHERE moderation_status <> 'approved';

-- ---------------------------------------------------------------------------
-- Status guard: users never set the status; changing the text re-queues it.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_post_text_moderation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _text_changed boolean;
BEGIN
  -- Service role (server code) and nested system writes manage the status.
  IF auth.uid() IS NULL OR pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.moderation_status := 'pending';
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'team_posts' THEN
    _text_changed := NEW.title IS DISTINCT FROM OLD.title
      OR NEW.body IS DISTINCT FROM OLD.body
      OR NEW.location IS DISTINCT FROM OLD.location;
  ELSE
    -- Soft-deleting a comment replaces its body with a placeholder: not new text.
    _text_changed := NEW.body IS DISTINCT FROM OLD.body AND NEW.deleted_at IS NULL;
  END IF;

  NEW.moderation_status := CASE WHEN _text_changed THEN 'pending' ELSE OLD.moderation_status END;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_post_text_moderation() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS team_posts_text_moderation ON public.team_posts;
CREATE TRIGGER team_posts_text_moderation
  BEFORE INSERT OR UPDATE ON public.team_posts
  FOR EACH ROW EXECUTE FUNCTION public.enforce_post_text_moderation();

DROP TRIGGER IF EXISTS post_comments_text_moderation ON public.post_comments;
CREATE TRIGGER post_comments_text_moderation
  BEFORE INSERT OR UPDATE ON public.post_comments
  FOR EACH ROW EXECUTE FUNCTION public.enforce_post_text_moderation();

-- ---------------------------------------------------------------------------
-- Read gate: unscreened or held text is visible to its author only (and, for
-- team posts, the team's managers, who can already see and edit every post on
-- their team — without this, a manager's edit to someone else's post would fail
-- RLS the moment the edit re-queues it).
-- RESTRICTIVE, so it is ANDed with every permissive SELECT policy.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "team_posts_moderated_read" ON public.team_posts;
CREATE POLICY "team_posts_moderated_read"
  ON public.team_posts AS RESTRICTIVE FOR SELECT
  USING (
    moderation_status = 'approved'
    OR author_id = auth.uid()
    OR private_sec.viewer_manages_team(team_id)
  );

DROP POLICY IF EXISTS "post_comments_moderated_read" ON public.post_comments;
CREATE POLICY "post_comments_moderated_read"
  ON public.post_comments AS RESTRICTIVE FOR SELECT
  USING (moderation_status = 'approved' OR author_id = auth.uid());
