CREATE TABLE public.team_posts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  team_id text NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  author_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('tryout','pickup','clinic','announcement','recap')),
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  event_date timestamptz,
  location text,
  price integer,
  spots_max integer,
  spots_taken integer NOT NULL DEFAULT 0,
  pinned boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX team_posts_team_id_created_at_idx ON public.team_posts (team_id, created_at DESC);

GRANT SELECT ON public.team_posts TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.team_posts TO authenticated;
GRANT ALL ON public.team_posts TO service_role;

ALTER TABLE public.team_posts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team_posts public read"
  ON public.team_posts FOR SELECT
  USING (true);

CREATE POLICY "team_posts owner insert"
  ON public.team_posts FOR INSERT
  TO authenticated
  WITH CHECK (
    author_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.teams t WHERE t.id = team_id AND t.owner_id = auth.uid())
  );

CREATE POLICY "team_posts owner update"
  ON public.team_posts FOR UPDATE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.teams t WHERE t.id = team_id AND t.owner_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.teams t WHERE t.id = team_id AND t.owner_id = auth.uid()));

CREATE POLICY "team_posts owner delete"
  ON public.team_posts FOR DELETE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.teams t WHERE t.id = team_id AND t.owner_id = auth.uid()));

CREATE TRIGGER team_posts_touch_updated_at
  BEFORE UPDATE ON public.team_posts
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();