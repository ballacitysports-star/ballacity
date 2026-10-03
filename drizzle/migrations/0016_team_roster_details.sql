CREATE TABLE public.team_roster_details (
  team_id text NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  birth_year smallint CHECK (birth_year BETWEEN 1940 AND 2030),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.team_roster_details TO authenticated;
GRANT ALL ON public.team_roster_details TO service_role;
ALTER TABLE public.team_roster_details ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Team managers manage roster details" ON public.team_roster_details
  FOR ALL TO authenticated
  USING (public.is_team_manager(team_id, auth.uid()))
  WITH CHECK (public.is_team_manager(team_id, auth.uid()));