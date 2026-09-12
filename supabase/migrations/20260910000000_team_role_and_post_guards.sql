-- Three ways team authorization could be bypassed, closed together.
--
-- 1. `team_members_manager_update` allows `user_id = auth.uid()` so a member can
--    edit their own jersey/position. Its WITH CHECK only refuses `role = 'owner'`,
--    so the same statement could set `role = 'manager'` — granting invite, remove
--    and role-assign rights to anyone already on the roster. `team_set_member_role`
--    checks this correctly; the table policy simply routed around it. RLS WITH
--    CHECK cannot see OLD, so the column is pinned with a trigger instead.
-- 2. `team_posts` INSERT checked only `author_id = auth.uid()`, so any signed-in
--    user could post to any team, `kind = 'announcement'` included.
-- 3. `teams` and `team_posts` SELECT were `USING (true)` with no `hidden_at`
--    filter, so moderation hid a team's roster while leaving its profile and
--    every post publicly readable.

-- ============ 1. role changes ============

-- SECURITY INVOKER on purpose: `team_role_of` is already SECURITY DEFINER and
-- executable by `authenticated`, so the guard needs no elevated rights of its
-- own and does not join the set of definer trigger routines revoked earlier.
--
-- PAIRED WITH 20260912013327. That migration closes the same escalation at the
-- RLS layer, pinning role on a self-update against the stored value. Keep both:
-- it does not refuse a write where OLD.role = 'owner' (its manager policy
-- admits the owner's row and only constrains the new value), and a policy
-- rejection is a silent zero-row result, whereas this raises NOT_TEAM_MANAGER /
-- OWNER_ROLE_FIXED for teamRosterErrorMessage() to render. Deleting either as
-- "duplication" reopens part of the hole.
CREATE OR REPLACE FUNCTION public.guard_team_member_role_change()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE _me uuid := auth.uid();
BEGIN
  IF NEW.role IS NOT DISTINCT FROM OLD.role THEN
    RETURN NEW;
  END IF;

  -- `transfer_team_ownership` opens this for the length of its own transaction.
  IF coalesce(current_setting('app.team_transfer', true), '') = 'on' THEN
    RETURN NEW;
  END IF;

  IF _me IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;

  IF NEW.role = 'owner' OR OLD.role = 'owner' THEN
    RAISE EXCEPTION 'OWNER_ROLE_FIXED';
  END IF;

  -- coalesce to '' first: a non-member yields NULL, and `NULL NOT IN (...)` is
  -- NULL, which plpgsql treats as false — the check would pass silently.
  IF coalesce(public.team_role_of(NEW.team_id, _me)::text, '') NOT IN ('owner','manager') THEN
    RAISE EXCEPTION 'NOT_TEAM_MANAGER';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS guard_team_member_role_change_trg ON public.team_members;
CREATE TRIGGER guard_team_member_role_change_trg
  BEFORE UPDATE ON public.team_members
  FOR EACH ROW EXECUTE FUNCTION public.guard_team_member_role_change();

-- ============ 2. team_posts writes ============

-- Needed by the `teams` SELECT policy below, which applies to anon as well.
-- `auth.uid()` is NULL for anon, so `team_role_of` returns NULL and this is
-- false — it leaks nothing. Mirrors the existing grant on `is_team_member`.
GRANT EXECUTE ON FUNCTION public.is_team_manager(text, uuid) TO anon;

DROP POLICY IF EXISTS "team_posts authenticated insert" ON public.team_posts;
CREATE POLICY "team_posts member insert"
  ON public.team_posts FOR INSERT
  TO authenticated
  WITH CHECK (
    author_id = auth.uid()
    AND public.is_team_member(team_id, auth.uid())
    AND (kind <> 'announcement' OR public.is_team_manager(team_id, auth.uid()))
  );

-- Moderation was owner-only, which left managers and coaches unable to clean up
-- their own team's board.
DROP POLICY IF EXISTS "team_posts author or team owner update" ON public.team_posts;
CREATE POLICY "team_posts author or manager update"
  ON public.team_posts FOR UPDATE
  TO authenticated
  USING (author_id = auth.uid() OR public.is_team_manager(team_id, auth.uid()))
  WITH CHECK (author_id = auth.uid() OR public.is_team_manager(team_id, auth.uid()));

DROP POLICY IF EXISTS "team_posts author or team owner delete" ON public.team_posts;
CREATE POLICY "team_posts author or manager delete"
  ON public.team_posts FOR DELETE
  TO authenticated
  USING (author_id = auth.uid() OR public.is_team_manager(team_id, auth.uid()));

-- ============ 3. soft-hide actually hides ============

DROP POLICY IF EXISTS "Teams are publicly readable" ON public.teams;
CREATE POLICY "teams_public_read"
  ON public.teams FOR SELECT
  USING (hidden_at IS NULL OR public.is_team_manager(id, auth.uid()));

DROP POLICY IF EXISTS "team_posts public read" ON public.team_posts;
CREATE POLICY "team_posts_public_read"
  ON public.team_posts FOR SELECT
  USING (
    (
      hidden_at IS NULL
      AND EXISTS (SELECT 1 FROM public.teams t WHERE t.id = team_posts.team_id AND t.hidden_at IS NULL)
    )
    OR public.is_team_manager(team_id, auth.uid())
  );
