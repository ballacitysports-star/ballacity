DROP POLICY IF EXISTS "team_posts public read" ON public.team_posts;

CREATE POLICY "team_posts public read"
ON public.team_posts
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.teams t
    WHERE t.id = team_posts.team_id
      AND (
        t.hidden_at IS NULL
        OR t.owner_id = auth.uid()
        OR public.is_team_member(t.id, auth.uid())
      )
  )
);