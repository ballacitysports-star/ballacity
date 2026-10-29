-- Anonymous visitors only see games that are provably adult-only.
--
-- Until now the only gate on an anonymous read of hosted_games was
--   is_private = false AND hidden_at IS NULL
-- (policy "Public games are viewable by everyone"). Nothing there looks at who a game is
-- for, so a public game for under-18s was readable by anyone, through the API as well as
-- the app. The same policy also let anonymous visitors read cancelled games and games an
-- organisation had hidden (org_hidden_at is separate from hidden_at).
--
-- What this adds, for the anon role only, is a RESTRICTIVE policy. An anonymous visitor
-- reads a game only if ALL of these hold (on top of the existing permissive policy, which
-- still requires is_private = false AND hidden_at IS NULL):
--   * its age range is adult-only: min_age >= 18, and max_age is either NULL (the
--     open-ended "18+" / "21+" presets in src/lib/game-age.ts) or >= min_age.
--     A game with no minimum (min_age NULL, including "no limit"), a minimum below 18, a
--     maximum alone, a mixed range such as 16-30 (it admits 16 and 17 year olds) or an
--     inverted range (min_age > max_age, which cannot be trusted) is NOT readable.
--   * cancelled_at IS NULL
--   * org_hidden_at IS NULL
--
-- The TypeScript rule used by the city pages and sitemap (gameTouchesMinors in
-- src/lib/city-seo.ts) is looser than this (it keeps games with no age limit) and is
-- aligned separately.
--
-- Signed-in users are unaffected: the policy is TO anon, so hosts, participants, guardians,
-- moderators and every other signed-in member read exactly what they read before.
-- Service-role code bypasses row level security and must apply the same rule itself.
-- Time is deliberately not part of the rule: the existing policies have no time predicate
-- (upcoming/finished filtering happens in the app queries) and a past game keeps its audience.
--
-- Rolling back: dropping the policy widens anonymous access to what it was before. Treat
-- that as a decision, not a routine undo; fix forward instead.

CREATE OR REPLACE FUNCTION public.game_age_range_is_adult_only(_min_age integer, _max_age integer)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT COALESCE(_min_age >= 18 AND (_max_age IS NULL OR _max_age >= _min_age), false);
$$;

COMMENT ON FUNCTION public.game_age_range_is_adult_only(integer, integer) IS
  'True only for an adult range: min_age >= 18 and max_age either NULL (open-ended 18+/21+) or '
  '>= min_age. A NULL minimum, a minimum below 18 or an inverted range is false.';

-- Pure and leaks nothing, but a policy runs it as the querying role, so that role needs
-- EXECUTE. Only anon uses it; Supabase default privileges grant new functions to the other
-- API roles, so revoke those explicitly (postgres/superuser keep access as owner).
REVOKE ALL ON FUNCTION public.game_age_range_is_adult_only(integer, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.game_age_range_is_adult_only(integer, integer) TO anon;

DROP POLICY IF EXISTS "Anonymous visitors see only listable games" ON public.hosted_games;
CREATE POLICY "Anonymous visitors see only listable games"
  ON public.hosted_games
  AS RESTRICTIVE
  FOR SELECT
  TO anon
  USING (
    public.game_age_range_is_adult_only(min_age, max_age)
    AND org_hidden_at IS NULL
    AND cancelled_at IS NULL
  );
