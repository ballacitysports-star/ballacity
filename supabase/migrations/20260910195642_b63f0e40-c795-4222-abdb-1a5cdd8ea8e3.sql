DROP POLICY IF EXISTS "orgs are viewable by authenticated" ON public.trainer_orgs;
DROP POLICY IF EXISTS "orgs are viewable by signed-in users" ON public.trainer_orgs;

CREATE POLICY "Visible orgs viewable by signed-in users"
ON public.trainer_orgs
FOR SELECT
TO authenticated
USING (
  hidden_at IS NULL
  OR owner_id = auth.uid()
  OR public.is_trainer_org_admin(id, auth.uid())
  OR public.is_trainer_org_member(id, auth.uid())
  OR public.is_moderator(auth.uid())
);