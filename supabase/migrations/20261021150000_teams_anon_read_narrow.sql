-- Narrow what an anonymous visitor can read from `teams`.
--
-- Until now `teams` was readable by anon in full: `GRANT SELECT ... TO anon`
-- plus a `teams_public_read` policy with no TO clause, i.e. every column of
-- every unhidden row. That reached the owner's user id (`owner_id`,
-- `listed_by`), staff names, availability, refund rules and the age groups the
-- team works with, to anyone holding the publishable key.
--
-- Only columns change here, not which rows are visible. Several server
-- functions (team posts, tryouts) query `teams` through the anonymous client
-- even for a signed-in viewer, and a parent finding a youth team's tryout
-- relies on that, so hiding rows from anon would break them. Youth and teen
-- teams are kept off the public *pages* in application code (`isPublicOrg`,
-- `toPublicTeam`).
--
--   * anon keeps SELECT on the columns the public pages, the sitemap, the
--     signed-out team preview and the embedded team cards use, and no more;
--   * the row rule is unchanged (unhidden, or a hidden team the viewer manages),
--     now written once per role so a later change to one cannot loosen the other.
--
-- Reading anything else as anon (`select=*`, `owner_id`, `staff`, ...) now fails
-- with a permission error instead of returning it. Nothing in the app does that
-- any more: `listTeams` requires a session.

REVOKE SELECT ON public.teams FROM anon;
GRANT SELECT (
  id, name, city, sports, kind, tagline, age_groups, hidden_at, updated_at,
  handle, bio, verified, founded, positions_needed, avatar, avatar_url
) ON public.teams TO anon;

DROP POLICY IF EXISTS "teams_public_read" ON public.teams;

CREATE POLICY "teams_read_signed_in"
  ON public.teams FOR SELECT TO authenticated
  USING (hidden_at IS NULL OR private_sec.viewer_manages_team(id));

CREATE POLICY "teams_read_anon"
  ON public.teams FOR SELECT TO anon
  USING (hidden_at IS NULL);
