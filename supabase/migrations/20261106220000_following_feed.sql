-- Following feed (backlog P1-3).
--
-- Posts from the people the caller follows, newest first, a page at a time. The function
-- runs as the caller (SECURITY INVOKER), so the posts table's row level security still
-- decides what comes back: a followers-only post appears because the caller follows its
-- author, a team or family post only if the caller is in that team or family, and
-- nothing pending, held, hidden, deleted or across a block.
--
-- Only person posts by followed accounts for now. Team and facility posts join once entity
-- follows (PR #317) are in.

CREATE OR REPLACE FUNCTION public.following_feed(_before timestamptz DEFAULT NULL, _limit integer DEFAULT 20)
RETURNS SETOF public.posts
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT p.*
  FROM public.posts p
  WHERE auth.uid() IS NOT NULL
    AND p.posted_as = 'person'
    AND p.deleted_at IS NULL
    AND p.author_id IN (SELECT f.followee_id FROM public.follows f WHERE f.follower_id = auth.uid())
    AND (_before IS NULL OR p.created_at < _before)
  ORDER BY p.created_at DESC
  LIMIT least(greatest(coalesce(_limit, 20), 1), 50);
$$;

REVOKE ALL ON FUNCTION public.following_feed(timestamptz, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.following_feed(timestamptz, integer) TO authenticated, service_role;
