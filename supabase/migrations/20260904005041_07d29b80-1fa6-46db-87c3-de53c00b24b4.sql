GRANT EXECUTE ON FUNCTION public.comment_subject_owner(text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.can_comment_on_minor_content(uuid, uuid) TO anon;

DROP POLICY IF EXISTS "Comments are readable by permitted viewers" ON public.post_comments;
CREATE POLICY "Comments are readable by permitted viewers"
ON public.post_comments
FOR SELECT
TO anon, authenticated
USING (
  public.can_comment_on_minor_content(
    auth.uid(),
    public.comment_subject_owner(subject_type, subject_id)
  )
);