CREATE TABLE public.tryout_evaluations (
  rsvp_id uuid PRIMARY KEY REFERENCES public.tryout_rsvps(id) ON DELETE CASCADE,
  post_id uuid NOT NULL,
  team_id text NOT NULL,
  attended boolean NOT NULL DEFAULT false,
  score smallint CHECK (score BETWEEN 1 AND 10),
  notes text CHECK (char_length(notes) <= 1000),
  updated_by uuid NOT NULL DEFAULT auth.uid(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tryout_evaluations_post_idx ON public.tryout_evaluations(post_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tryout_evaluations TO authenticated;
GRANT ALL ON public.tryout_evaluations TO service_role;
ALTER TABLE public.tryout_evaluations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Team managers manage tryout evaluations" ON public.tryout_evaluations
  FOR ALL TO authenticated
  USING (public.is_team_manager(team_id, auth.uid()))
  WITH CHECK (
    public.is_team_manager(team_id, auth.uid())
    AND EXISTS (SELECT 1 FROM public.tryout_rsvps r WHERE r.id = rsvp_id AND r.team_id = tryout_evaluations.team_id AND r.post_id = tryout_evaluations.post_id)
  );