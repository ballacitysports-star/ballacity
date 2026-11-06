-- D0 (owner decision, 2026-11-06): the exact venue of a youth team's post is not public.
--
-- Until now anyone, signed out included, could read team_posts.location,
-- formatted_address, place_id, lat and lng for every team, so a U12 tryout's street
-- address and coordinates were public. Hosted games already hide youth games from
-- anonymous visitors (20261029150000_hosted_games_anon_minors_guard.sql).
--
-- Rule: a team's venue is public only when the team is known to be adult-only: every
-- member is a confirmed adult, its age_groups do not include 'youth' or 'teen', and it
-- is either listed for adults (age_groups include 'adult') or has at least one adult
-- player or captain. Anything else (a minor or an unknown-age member, a youth or teen
-- listing, or a new team with only its owner or staff) counts as a youth team (owner
-- decision, 2026-11-06: private until known adult-only). For a youth team's posts the
-- venue is readable only by:
--   * the team's members (any role, staff included),
--   * guardians of the team's members,
--   * people registered for that event, the person who registered them, and their
--     guardians,
--   * admins and superadmins.
-- Everyone else still sees the post itself (title, time, price, spots), just not where.
-- Other teams' venues stay public, as today.
--
-- How: SELECT on the five venue columns is revoked from the client roles (row level
-- security cannot hide columns), and public.team_post_venues(ids) returns the venue of
-- each post the caller can see and is allowed to locate. The service role is unchanged.
--
-- Note for later migrations: client SELECT on team_posts is now granted per column. A new
-- column added to team_posts must be granted explicitly to anon and authenticated, or
-- clients cannot read it. supabase/tests/620 checks that every column except the venue is
-- granted.
--
-- Rollback: docs/rollbacks/20261106210000_youth_post_venue_privacy.down.sql.

-- 1. Is this a youth team, meaning not known to be adult-only?
CREATE OR REPLACE FUNCTION private_sec.team_is_youth(_team text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT NOT (
    -- every member is a confirmed adult
    NOT EXISTS (
      SELECT 1 FROM public.team_members tm
      WHERE tm.team_id = _team
        AND COALESCE(public.age_cohort_of(tm.user_id), 'unknown') <> 'adult'
    )
    -- not listed for youth or teens
    AND NOT EXISTS (
      SELECT 1 FROM public.teams t
      WHERE t.id = _team AND t.age_groups && ARRAY['youth', 'teen']::text[]
    )
    -- and known to be for adults: listed for adults, or an adult player or captain
    AND (
      EXISTS (
        SELECT 1 FROM public.teams t
        WHERE t.id = _team AND t.age_groups @> ARRAY['adult']::text[]
      )
      OR EXISTS (
        SELECT 1 FROM public.team_members tm
        WHERE tm.team_id = _team AND tm.role IN ('player', 'captain')
      )
    )
  )
$$;

-- 2. May the caller see this post's venue? (Visibility of the post itself is checked
--    separately, by the caller's own row level security, in team_post_venues.)
CREATE OR REPLACE FUNCTION private_sec.can_see_post_venue(_post uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.team_posts p
    WHERE p.id = _post
      AND (
        NOT private_sec.team_is_youth(p.team_id)
        OR (
          auth.uid() IS NOT NULL
          AND (
            EXISTS (
              SELECT 1 FROM public.team_members tm
              WHERE tm.team_id = p.team_id
                AND (tm.user_id = auth.uid() OR public.is_guardian_of(auth.uid(), tm.user_id))
            )
            OR EXISTS (
              SELECT 1 FROM public.tryout_rsvps r
              WHERE r.post_id = p.id
                AND r.status = 'registered'
                AND (
                  r.user_id = auth.uid()
                  OR r.registered_by = auth.uid()
                  OR public.is_guardian_of(auth.uid(), r.user_id)
                )
            )
            OR public.has_role(auth.uid(), 'admin'::public.app_role)
            OR public.has_role(auth.uid(), 'superadmin'::public.app_role)
          )
        )
      )
  )
$$;

CREATE OR REPLACE FUNCTION private_sec.post_venue(_post uuid)
RETURNS TABLE (location text, formatted_address text, place_id text, lat numeric, lng numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p.location, p.formatted_address, p.place_id, p.lat, p.lng
  FROM public.team_posts p
  WHERE p.id = _post AND private_sec.can_see_post_venue(_post)
$$;

REVOKE ALL ON FUNCTION private_sec.team_is_youth(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private_sec.can_see_post_venue(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private_sec.post_venue(uuid) FROM PUBLIC;
-- Called from team_post_venues, which runs as the caller; private_sec is not exposed by the API.
GRANT EXECUTE ON FUNCTION private_sec.post_venue(uuid) TO anon, authenticated;

-- 3. The public entry point. SECURITY INVOKER: the caller's own row level security
--    decides which of the ids are visible posts at all (hidden, held or deleted posts
--    return nothing); the venue rule then decides which of those it may locate.
CREATE OR REPLACE FUNCTION public.team_post_venues(_ids uuid[])
RETURNS TABLE (
  id uuid,
  location text,
  formatted_address text,
  place_id text,
  lat numeric,
  lng numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT p.id, v.location, v.formatted_address, v.place_id, v.lat, v.lng
  FROM public.team_posts p
  CROSS JOIN LATERAL private_sec.post_venue(p.id) v
  WHERE p.id = ANY (_ids[1:200])
$$;

REVOKE ALL ON FUNCTION public.team_post_venues(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.team_post_venues(uuid[]) TO anon, authenticated, service_role;

-- 4. Clients may read every column of team_posts except the venue.
DO $grant$
DECLARE
  _cols text;
BEGIN
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position)
  INTO _cols
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'team_posts'
    AND column_name NOT IN ('location', 'formatted_address', 'place_id', 'lat', 'lng');

  REVOKE SELECT ON public.team_posts FROM anon, authenticated;
  EXECUTE format('GRANT SELECT (%s) ON public.team_posts TO anon, authenticated', _cols);
END
$grant$;
