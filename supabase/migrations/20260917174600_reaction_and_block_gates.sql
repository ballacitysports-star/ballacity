-- Two narrow, additive gaps found alongside comments' existing protections:
--
-- 1. post_reactions (likes) INSERT had no minor-content check, while its own
--    SELECT policy (20260915174129) and post_comments' INSERT policy
--    (20260907234853) both already use private_sec.can_comment_on_minor_content.
--    Any adult could still react to a child_under_13/teen_13_15's content even
--    though the identical adult was already blocked from commenting on it.
--
-- 2. Neither post_comments nor post_reactions checked blocks_exist_between at
--    all — a blocked relationship didn't stop commenting/reacting on either
--    side, unlike messages, follows, and team invites, which already do.
--
-- private_sec.blocked_from_interacting is a thin wrapper kept in the private
-- schema (unlike the pre-existing public.blocks_exist_between, which is
-- directly RPC-callable by any authenticated user for any two arbitrary ids —
-- a pre-existing, unrelated issue, not changed here) so future RLS policies
-- can converge on one non-public entry point instead of each calling
-- public.blocks_exist_between directly.
CREATE OR REPLACE FUNCTION private_sec.blocked_from_interacting(_a uuid, _b uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.blocks_exist_between(_a, _b);
$$;

REVOKE ALL ON FUNCTION private_sec.blocked_from_interacting(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private_sec.blocked_from_interacting(uuid, uuid) TO authenticated, service_role;

-- post_reactions INSERT: add both the minor-content gate (matching this
-- table's own SELECT policy and post_comments' INSERT policy) and the block
-- check, in one pass.
DROP POLICY IF EXISTS "Users can add their own reactions" ON public.post_reactions;
CREATE POLICY "Users can add their own reactions"
ON public.post_reactions FOR INSERT TO authenticated
WITH CHECK (
  auth.uid() = user_id
  AND private_sec.can_comment_on_minor_content(
        auth.uid(), private_sec.comment_subject_owner(subject_type, subject_id)
      )
  AND NOT private_sec.blocked_from_interacting(
        auth.uid(), private_sec.comment_subject_owner(subject_type, subject_id)
      )
);

-- post_comments INSERT: already has the minor-content gate; add the block
-- check alongside it.
DROP POLICY IF EXISTS "Users can insert their own comments" ON public.post_comments;
CREATE POLICY "Users can insert their own comments"
ON public.post_comments FOR INSERT TO authenticated
WITH CHECK (
  auth.uid() = author_id
  AND private_sec.can_comment_on_minor_content(
        auth.uid(), private_sec.comment_subject_owner(subject_type, subject_id)
      )
  AND NOT private_sec.blocked_from_interacting(
        auth.uid(), private_sec.comment_subject_owner(subject_type, subject_id)
      )
);
