-- Resolve the owner of a commentable subject (nullable when unresolvable)
CREATE OR REPLACE FUNCTION public.comment_subject_owner(_subject_type text, _subject_id text)
RETURNS uuid
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE sid uuid; owner_id uuid;
BEGIN
  BEGIN
    sid := _subject_id::uuid;
  EXCEPTION WHEN others THEN
    RETURN NULL;
  END;

  IF _subject_type = 'highlight_reel' THEN
    SELECT user_id INTO owner_id FROM public.highlight_reels WHERE id = sid;
  ELSIF _subject_type = 'team_post' THEN
    SELECT author_id INTO owner_id FROM public.team_posts WHERE id = sid;
  ELSIF _subject_type = 'game' THEN
    SELECT host_id INTO owner_id FROM public.hosted_games WHERE id = sid;
  END IF;

  RETURN owner_id;
END $$;

-- Who may comment on (and read comments on) a minor's content
CREATE OR REPLACE FUNCTION public.can_comment_on_minor_content(_commenter uuid, _content_owner uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE cohort text;
BEGIN
  -- Unresolvable owner: not a minor-protection case
  IF _content_owner IS NULL THEN RETURN true; END IF;

  cohort := public.age_cohort_of(_content_owner);
  IF cohort NOT IN ('child_under_13','teen_13_15','teen_16_17') THEN
    RETURN true;
  END IF;

  -- Anonymous callers are never permitted on a minor's thread
  IF _commenter IS NULL THEN RETURN false; END IF;

  IF _commenter = _content_owner THEN RETURN true; END IF;
  IF public.is_guardian_of(_commenter, _content_owner) THEN RETURN true; END IF;
  IF public.shares_team(_commenter, _content_owner) THEN RETURN true; END IF;

  RETURN false;
END $$;

REVOKE ALL ON FUNCTION public.can_comment_on_minor_content(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_comment_on_minor_content(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.can_comment_on_minor_content(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_comment_on_minor_content(uuid, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.comment_subject_owner(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.comment_subject_owner(text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.comment_subject_owner(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.comment_subject_owner(text, text) TO service_role;

-- Insert gate
DROP POLICY IF EXISTS "Users can insert their own comments" ON public.post_comments;
CREATE POLICY "Users can insert their own comments"
ON public.post_comments FOR INSERT TO authenticated
WITH CHECK (
  auth.uid() = author_id
  AND public.can_comment_on_minor_content(
        auth.uid(),
        public.comment_subject_owner(subject_type, subject_id)
      )
);

-- Read gate
DROP POLICY IF EXISTS "Comments are readable by everyone" ON public.post_comments;
CREATE POLICY "Comments are readable by permitted viewers"
ON public.post_comments FOR SELECT TO authenticated
USING (
  public.can_comment_on_minor_content(
    auth.uid(),
    public.comment_subject_owner(subject_type, subject_id)
  )
);