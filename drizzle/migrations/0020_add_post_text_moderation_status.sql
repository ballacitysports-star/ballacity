ALTER TABLE public.team_posts
  ADD COLUMN IF NOT EXISTS moderation_status text NOT NULL DEFAULT 'approved';
ALTER TABLE public.post_comments
  ADD COLUMN IF NOT EXISTS moderation_status text NOT NULL DEFAULT 'approved';

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

CREATE OR REPLACE FUNCTION public.enforce_post_text_moderation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _text_changed boolean;
BEGIN
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