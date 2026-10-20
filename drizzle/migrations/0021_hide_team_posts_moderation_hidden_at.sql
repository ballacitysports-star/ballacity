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
    NEW.hidden_at := NULL;
    RETURN NEW;
  END IF;

  NEW.hidden_at := OLD.hidden_at;

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

DROP POLICY IF EXISTS "team_posts_moderated_read" ON public.team_posts;
CREATE POLICY "team_posts_moderated_read"
  ON public.team_posts AS RESTRICTIVE FOR SELECT
  USING (
    (moderation_status = 'approved' AND hidden_at IS NULL)
    OR author_id = auth.uid()
    OR private_sec.viewer_manages_team(team_id)
  );

DROP POLICY IF EXISTS "post_comments_moderated_read" ON public.post_comments;
CREATE POLICY "post_comments_moderated_read"
  ON public.post_comments AS RESTRICTIVE FOR SELECT
  USING (
    (moderation_status = 'approved' AND hidden_at IS NULL)
    OR author_id = auth.uid()
  );
