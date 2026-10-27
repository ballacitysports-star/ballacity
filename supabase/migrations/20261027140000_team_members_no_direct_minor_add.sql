-- A minor joins a team through an invite their guardian approves (and a waiver
-- where the team has one): team_invite_player, team_respond_invite and
-- guardian_approve_team_invite. Those are SECURITY DEFINER functions and write
-- team_members as the table's owner.
--
-- The manager insert policy let a coach write the row directly, for anyone: a
-- coach could put a 10 or 14 year old on a roster with no invite, no guardian
-- approval and no waiver. The app never does this (every roster change goes
-- through the functions above), so a manager may now add only members who are not
-- minors directly. Adding a minor still works, through the invite.

DROP POLICY IF EXISTS "team_members_manager_write" ON public.team_members;
CREATE POLICY "team_members_manager_write"
ON public.team_members
FOR INSERT
TO authenticated
WITH CHECK (
  public.is_team_manager(team_id, auth.uid())
  AND role <> 'owner'::team_role
  AND NOT public.is_minor(user_id)
);
