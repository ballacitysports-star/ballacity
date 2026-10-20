-- Make a moderator's "Hide" actually hide team posts and comments.
--
-- `hidden_at` on team_posts and post_comments is set only by superadmin server
-- code (the Moderation tab, service role). Two gaps made it ineffective:
--   1. Nothing read it for comments: the comment SELECT policies never checked
--      it, so a hidden comment stayed visible to everyone. For team posts, the
--      older "team_posts member read hidden" policy let any team member read
--      hidden posts through the API.
--   2. Nothing protected it: the UPDATE policies let a comment's author (and a
--      post's author or team managers) change any column, so they could clear
--      `hidden_at` and undo the hide with one API call.
--
-- Fix, on top of 20261016120000_post_text_moderation.sql:
--   * the RESTRICTIVE read gate now also requires `hidden_at IS NULL` for
--     everyone except the author (and, for team posts, the team's managers, who
--     could already see hidden posts on their team);
--   * the status-guard trigger now pins `hidden_at` too: only server code
--     (auth.uid() IS NULL) or nested system writes may hide or unhide.

CREATE OR REPLACE FUNCTION public.enforce_post_text_moderation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _text_changed boolean;
BEGIN
  -- Service role (server code) and nested system writes manage the status and
  -- moderator hides.
  IF auth.uid() IS NULL OR pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.moderation_status := 'pending';
    NEW.hidden_at := NULL;
    RETURN NEW;
  END IF;

  -- Only a moderator (server code) hides or unhides.
  NEW.hidden_at := OLD.hidden_at;

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

-- The triggers from 20261016120000 already call this function; nothing to recreate.

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
