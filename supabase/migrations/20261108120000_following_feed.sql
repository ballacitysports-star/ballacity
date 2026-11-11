-- Following (backlog P1-3; Home feed decisions F2, docs/design/home-feed.md).
--
-- 1. following_feed(_before, _limit): posts, newest first, a page at a time, from
--      * people the caller follows (follows);
--      * teams the caller follows (entity follows, #317) or belongs to;
--      * facilities the caller follows (entity follows).
--    It runs as the caller (SECURITY INVOKER), so the posts table's row level security still decides what comes back:
--    an audience the caller is not in, anything pending, held, hidden or deleted, and anything across a block stay out.
-- 2. following_team_news(_before, _limit): team announcements and recaps from teams the caller follows or belongs to.
--    Also SECURITY INVOKER over team_posts, so its read rules (moderation, hidden posts and teams) still apply. It
--    returns no venue columns: announcements and recaps carry none, and team_posts' venue columns are not readable by
--    clients (D0).
-- Signed-in callers only. At most 50 rows per page.
--
-- Rollback: docs/rollbacks/20261108120000_following_feed.down.sql.

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
    AND p.deleted_at IS NULL
    AND (_before IS NULL OR p.created_at < _before)
    AND (
      (p.posted_as = 'person'
        AND p.author_id IN (SELECT f.followee_id FROM public.follows f WHERE f.follower_id = auth.uid()))
      OR (p.posted_as = 'team'
        AND (p.team_id IN (SELECT ef.target_id FROM public.entity_follows ef
                            WHERE ef.follower_id = auth.uid() AND ef.target_kind = 'team')
             OR public.is_team_member(p.team_id, auth.uid())))
      OR (p.posted_as = 'org'
        AND p.org_id::text IN (SELECT ef.target_id FROM public.entity_follows ef
                                WHERE ef.follower_id = auth.uid() AND ef.target_kind = 'org'))
    )
  ORDER BY p.created_at DESC
  LIMIT least(greatest(coalesce(_limit, 20), 1), 50);
$$;

REVOKE ALL ON FUNCTION public.following_feed(timestamptz, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.following_feed(timestamptz, integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.following_team_news(_before timestamptz DEFAULT NULL, _limit integer DEFAULT 20)
RETURNS TABLE (id uuid, team_id text, kind text, title text, body text, image_url text, created_at timestamptz)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT p.id, p.team_id, p.kind, p.title, p.body, p.image_url, p.created_at
  FROM public.team_posts p
  WHERE auth.uid() IS NOT NULL
    AND p.kind IN ('announcement', 'recap')
    AND p.moderation_status = 'approved'
    AND p.hidden_at IS NULL
    AND (_before IS NULL OR p.created_at < _before)
    AND (p.team_id IN (SELECT ef.target_id FROM public.entity_follows ef
                        WHERE ef.follower_id = auth.uid() AND ef.target_kind = 'team')
         OR public.is_team_member(p.team_id, auth.uid()))
  ORDER BY p.created_at DESC
  LIMIT least(greatest(coalesce(_limit, 20), 1), 50);
$$;

REVOKE ALL ON FUNCTION public.following_team_news(timestamptz, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.following_team_news(timestamptz, integer) TO authenticated, service_role;
