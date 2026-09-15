-- 1. follows: only the parties involved, or mutually visible profiles
DROP POLICY IF EXISTS "Follows are readable by signed-in users" ON public.follows;
CREATE POLICY "Follows readable by involved or visible users"
ON public.follows FOR SELECT TO authenticated
USING (
  auth.uid() = follower_id
  OR auth.uid() = followee_id
  OR (
    private_sec.profile_visibility_of(follower_id) = ANY (ARRAY['public','members'])
    AND private_sec.profile_visibility_of(followee_id) = ANY (ARRAY['public','members'])
  )
);

-- 2. post_reactions: same subject-visibility gate as post_comments
DROP POLICY IF EXISTS "Reactions are readable by signed-in users" ON public.post_reactions;
CREATE POLICY "Reactions are readable by permitted viewers"
ON public.post_reactions FOR SELECT TO anon, authenticated
USING (
  private_sec.can_comment_on_minor_content(
    auth.uid(),
    private_sec.comment_subject_owner(subject_type, subject_id)
  )
);

-- 3. profiles: sensitive columns unreadable/unwritable through the Data API
REVOKE SELECT (avatar_url_private, suspended_at, suspended_reason, moderation_state)
  ON public.profiles FROM anon, authenticated;
REVOKE UPDATE (avatar_url_private, suspended_at, suspended_reason, moderation_state)
  ON public.profiles FROM anon, authenticated;
GRANT ALL ON public.profiles TO service_role;

-- 4. has_entitlement not callable anonymously
REVOKE EXECUTE ON FUNCTION public.has_entitlement(uuid, text, text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_entitlement(uuid, text, text) TO authenticated, service_role;
