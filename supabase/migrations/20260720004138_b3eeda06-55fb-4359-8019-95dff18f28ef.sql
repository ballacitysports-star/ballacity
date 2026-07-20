
DROP POLICY IF EXISTS "team_posts owner insert" ON public.team_posts;
DROP POLICY IF EXISTS "team_posts owner update" ON public.team_posts;
DROP POLICY IF EXISTS "team_posts owner delete" ON public.team_posts;

-- Any authenticated user can create a post as themselves
CREATE POLICY "team_posts authenticated insert"
  ON public.team_posts FOR INSERT
  TO authenticated
  WITH CHECK (author_id = auth.uid());

-- Authors can update their own posts; team owners can update any post on their team
CREATE POLICY "team_posts author or team owner update"
  ON public.team_posts FOR UPDATE
  TO authenticated
  USING (
    author_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.teams t WHERE t.id = team_posts.team_id AND t.owner_id = auth.uid())
  )
  WITH CHECK (
    author_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.teams t WHERE t.id = team_posts.team_id AND t.owner_id = auth.uid())
  );

-- Authors can delete their own posts; team owners can delete any post on their team
CREATE POLICY "team_posts author or team owner delete"
  ON public.team_posts FOR DELETE
  TO authenticated
  USING (
    author_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.teams t WHERE t.id = team_posts.team_id AND t.owner_id = auth.uid())
  );
