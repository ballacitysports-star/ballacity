-- Back-filled into git on 2026-09-12. Not authored here.
--
-- Applied directly to production by the Lovable agent (created_by
-- apikey@lovable.dev, version 20260912013327); present in no branch of this
-- repository. Recorded verbatim so `supabase db push` treats it as applied.
--
-- Effect: closes the same team-member privilege escalation that
-- 20260910000000_team_role_and_post_guards.sql on this branch closes, by a
-- different mechanism. `team_members_manager_update` previously allowed
-- `user_id = auth.uid()` so a member could edit their own jersey and position,
-- and its WITH CHECK only refused `role = 'owner'` — so the same statement
-- could set role = 'manager'. This splits the policy in two and pins the role
-- on a self-update by comparing it to the value already stored, read through a
-- definer helper. That is how it gets at OLD from inside a WITH CHECK.
--
-- BOTH mechanisms are deliberately kept. They are not redundant:
--
--   * These policies enforce the pin at the RLS layer, consistent with the rest
--     of the schema, and a blocked self-update simply affects zero rows.
--   * The trigger in 20260910000000 additionally refuses any write where
--     OLD.role = 'owner'. The manager policy below does not: its USING admits a
--     row whose current role is owner, and its WITH CHECK only constrains the
--     new value, so a manager could demote the owner's roster row. The trigger
--     also raises NOT_TEAM_MANAGER / OWNER_ROLE_FIXED, which
--     teamRosterErrorMessage() turns into a readable message instead of a
--     silent no-op.
--
-- Removing either one weakens the guard. See the note on
-- guard_team_member_role_change() for the other half of this pairing.

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
