CREATE OR REPLACE FUNCTION private_sec.team_member_stored_role(_team_id text, _user_id uuid)
RETURNS public.team_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.team_members WHERE team_id = _team_id AND user_id = _user_id
$$;

REVOKE ALL ON FUNCTION private_sec.team_member_stored_role(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private_sec.team_member_stored_role(text, uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS team_members_manager_update ON public.team_members;
DROP POLICY IF EXISTS team_members_self_update ON public.team_members;

CREATE POLICY team_members_manager_update ON public.team_members
FOR UPDATE TO authenticated
USING (is_team_manager(team_id, auth.uid()))
WITH CHECK (is_team_manager(team_id, auth.uid()) AND role <> 'owner'::public.team_role);

CREATE POLICY team_members_self_update ON public.team_members
FOR UPDATE TO authenticated
USING (user_id = auth.uid())
WITH CHECK (
  user_id = auth.uid()
  AND role = private_sec.team_member_stored_role(team_id, auth.uid())
);