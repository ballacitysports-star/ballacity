-- Anon could read manager status on teams it cannot see at all.
--
-- 20260910000000 added `GRANT EXECUTE ON FUNCTION public.is_team_manager(text,
-- uuid) TO anon`, because the `teams_public_read` policy it created has no TO
-- clause and so applies to anon, and a policy expression is evaluated with the
-- querying role's privileges. Without the grant an anonymous SELECT on `teams`
-- fails outright. The grant was necessary; its shape was wrong.
--
-- `is_team_manager` is SECURITY DEFINER, so it answers from inside the owner's
-- privileges and consults no policy. It also takes the user as a parameter. An
-- anonymous caller could therefore pass any uuid and any team id and read the
-- answer directly, bypassing both gates that protect that table:
--
--   * `teams_public_read` / `team_posts_public_read` hide a moderated team
--     (hidden_at IS NOT NULL) from anon entirely.
--   * `team_members_read` additionally requires
--     private_sec.roster_row_visible(team_id, user_id), which withholds a
--     minor's roster row from anon and from any signed-in caller who is not the
--     minor, their guardian, or a manager of that team.
--
-- Measured on production before writing this, in a rolled-back transaction: for
-- a team with hidden_at set and one manager on its roster, anon read 0 rows
-- from `teams`, 0 rows from `team_members`, and still got `true` back from
-- is_team_manager(that team, that user) — with an unrelated uuid returning
-- null, so the two are distinguishable. Given a target's uuid, anon could
-- enumerate owner/manager/coach relationships on moderated teams and past the
-- child-safety gate.
--
-- The original grant's comment claimed it mirrored an existing grant on
-- is_team_member. There is no such grant: is_team_member, team_role_of,
-- is_moderator and age_cohort_of are all unreachable by anon, and
-- is_team_manager was the only exception in the schema.
--
-- The fix is the shape private_sec.roster_row_visible already uses, and the
-- reason that function is safe to expose: take no caller parameter. A helper
-- that reads auth.uid() itself can only ever answer "do *I* manage this team",
-- which for anon is a constant false, so there is nothing to enumerate. The two
-- policies are repointed at it and anon loses is_team_manager.
--
-- `authenticated` keeps EXECUTE: `team_posts member insert` and the
-- author-or-manager update and delete policies are TO authenticated and pass
-- auth.uid() themselves, and src/lib/team-roster.ts relies on it. Re-granted
-- explicitly below because revoking from PUBLIC would otherwise take it away.

CREATE OR REPLACE FUNCTION private_sec.viewer_manages_team(_team text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL THEN false
    ELSE coalesce(public.is_team_manager(_team, auth.uid()), false)
  END
$$;

REVOKE EXECUTE ON FUNCTION private_sec.viewer_manages_team(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private_sec.viewer_manages_team(text) TO anon, authenticated;

-- Repoint both anon-facing policies. Same semantics for a signed-in manager:
-- they previously passed auth.uid() to is_team_manager and now the helper does.
DROP POLICY IF EXISTS "teams_public_read" ON public.teams;
CREATE POLICY "teams_public_read"
  ON public.teams FOR SELECT
  USING (hidden_at IS NULL OR private_sec.viewer_manages_team(id));

DROP POLICY IF EXISTS "team_posts_public_read" ON public.team_posts;
CREATE POLICY "team_posts_public_read"
  ON public.team_posts FOR SELECT
  USING (
    (
      hidden_at IS NULL
      AND EXISTS (SELECT 1 FROM public.teams t WHERE t.id = team_posts.team_id AND t.hidden_at IS NULL)
    )
    OR private_sec.viewer_manages_team(team_id)
  );

REVOKE EXECUTE ON FUNCTION public.is_team_manager(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_team_manager(text, uuid) TO authenticated;
