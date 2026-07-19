
GRANT SELECT ON public.trainer_orgs TO anon;
GRANT SELECT ON public.trainer_org_members TO anon;

CREATE POLICY "orgs are publicly viewable"
  ON public.trainer_orgs FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "org members are publicly viewable"
  ON public.trainer_org_members FOR SELECT
  TO anon
  USING (true);
