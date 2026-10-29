-- A comment is readable (and writable) only when the thing it is on is visible to the viewer.
--
-- The comment policies checked only the subject owner's age (can_comment_on_minor_content).
-- Nothing checked the subject itself, so the comments on a hidden or draft reel, on a reel linked
-- to a game that is not public, or on a private game were readable by anyone who knew the
-- subject's id, anonymous visitors included. A stranger could also comment on a hidden reel.
--
-- The fix asks the subject's own table, through the viewer's own row level security, whether the
-- viewer can see that row. So the rule for "can see this reel" or "can see this game" stays in
-- one place (the reel and game policies) instead of being copied here. The subquery runs as the
-- querying role, so it is subject to those policies. The owner, a player in a private game, and
-- a host keep what they had before, because those policies already let them read the subject.
--
-- The age rule stays in place: both conditions must hold. Public reels and public games are
-- readable by visitors as before.
--
-- Rolling back: restoring the old policies re-opens the leak. Fix forward instead.

DROP POLICY IF EXISTS "Comments are readable by permitted viewers" ON public.post_comments;
CREATE POLICY "Comments are readable by permitted viewers"
ON public.post_comments FOR SELECT TO anon, authenticated
USING (
  private_sec.can_comment_on_minor_content(auth.uid(), private_sec.comment_subject_owner(subject_type, subject_id))
  AND (
    (subject_type = 'highlight_reel' AND EXISTS (
      SELECT 1 FROM public.highlight_reels r WHERE r.id::text = post_comments.subject_id))
    OR (subject_type = 'game' AND EXISTS (
      SELECT 1 FROM public.hosted_games g WHERE g.id::text = post_comments.subject_id))
    OR (subject_type = 'team_post' AND EXISTS (
      SELECT 1 FROM public.team_posts tp WHERE tp.id::text = post_comments.subject_id))
  )
);

DROP POLICY IF EXISTS "Users can insert their own comments" ON public.post_comments;
CREATE POLICY "Users can insert their own comments"
ON public.post_comments FOR INSERT TO authenticated
WITH CHECK (
  auth.uid() = author_id
  AND private_sec.can_comment_on_minor_content(auth.uid(), private_sec.comment_subject_owner(subject_type, subject_id))
  AND (
    (subject_type = 'highlight_reel' AND EXISTS (
      SELECT 1 FROM public.highlight_reels r WHERE r.id::text = post_comments.subject_id))
    OR (subject_type = 'game' AND EXISTS (
      SELECT 1 FROM public.hosted_games g WHERE g.id::text = post_comments.subject_id))
    OR (subject_type = 'team_post' AND EXISTS (
      SELECT 1 FROM public.team_posts tp WHERE tp.id::text = post_comments.subject_id))
  )
);
