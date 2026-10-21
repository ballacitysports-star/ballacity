-- Narrow what an anonymous visitor can read from `teams`.
--
-- Until now `teams` was readable by anon in full: `GRANT SELECT ... TO anon`
-- plus a `teams_public_read` policy with no TO clause, i.e. every column of
-- every unhidden row, youth and teen teams included. That reached the owner's
-- user id (`owner_id`, `listed_by`), staff names, availability, refund rules and
-- the age groups the team works with, to anyone holding the publishable key.
--
-- The public pages only need a handful of facts (the city pages, the sitemap
-- and the signed-out team preview all select an allow-list), so:
--
--   * anon keeps SELECT on those columns only, not on the whole table;
--   * anon sees a row only when it is not hidden and does not work with
--     under-18s, the same rule the app applies in `isPublicOrg()`;
--   * signed-in users keep the previous rule unchanged (unhidden rows, plus a
--     hidden team they manage).
--
-- Reading the allow-list through `select=*` as anon now fails with a permission
-- error rather than returning everything. Nothing in the app does that any
-- more: `listTeams` requires a session.

REVOKE SELECT ON public.teams FROM anon;
GRANT SELECT (
  id, name, city, sports, kind, tagline, age_groups, hidden_at, updated_at,
  handle, bio, verified, founded, positions_needed
) ON public.teams TO anon;

DROP POLICY IF EXISTS "teams_public_read" ON public.teams;

CREATE POLICY "teams_read_signed_in"
  ON public.teams FOR SELECT TO authenticated
  USING (hidden_at IS NULL OR private_sec.viewer_manages_team(id));

CREATE POLICY "teams_read_anon"
  ON public.teams FOR SELECT TO anon
  USING (
    hidden_at IS NULL
    AND NOT (COALESCE(age_groups, '{}'::text[]) && ARRAY['youth', 'teen']::text[])
  );
