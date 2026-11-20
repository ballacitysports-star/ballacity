-- Privacy gap found in the WP 4.0 review (docs/release/records/2026-11-20-batch-18.md, "Open"): the rule that lets one
-- member read another's profile did not look at blocks or at suspension. docs/privacy/profile-blocks-and-suspension.md
-- has the scope, the app side and the checks.
--
-- BEFORE
--   "Profiles viewable by members" (authenticated): id = auth.uid() OR profile_visibility_of(id) IN ('public','members')
--   "Public profiles viewable by anon" (anon):      profile_visibility_of(id) = 'public'
--   So B, blocked by A (an adult with visibility 'members'), opened /players/A and read A's whole profile. And a
--   suspended account stayed readable on /players/:id while getPlayerCard already hid it, so comparing the two pages
--   told anyone the account was suspended.
--
-- AFTER (a profile row is returned when ANY of these holds)
--   * it is the viewer's own row (unchanged: a suspended person still sees themselves);
--   * the viewer is staff (private_sec.is_moderator: admin, moderator or superadmin, the existing check) and the
--     visibility allows it, exactly as before: staff are exempt from the two new conditions only, they gain nothing else;
--   * the visibility allows it, the account is not suspended (suspended_at IS NULL) and there is no block between the
--     viewer and the owner in either direction: the owner is not in private_sec.my_block_partners(), the viewer's
--     user_blocks rows both ways. It reads exactly the rows private_sec.blocks_exist_between (the message, request,
--     follow, availability and invite rules) reads, as one list per statement instead of one lookup per row; test 960
--     checks the two agree.
--   Anonymous visitors: visibility 'public' and not suspended (no blocks without a viewer).
--   Each hidden case comes back as "no row", the same as a missing or private account, so the app shows the existing
--   "This profile is private or unavailable" screen and never says which.
--
-- WHAT THIS DELIBERATELY DOES NOT DO
--   * private_sec.profile_visibility_of is NOT changed. It answers "what did the owner choose" and has many callers in
--     other contexts: the service role with no viewer (getPlayerCard, player passport), SECURITY DEFINER RPCs and
--     triggers acting for someone other than the reader, reel and avatar rules. Making it depend on auth.uid() would
--     change all of them at once; the read rule for profile rows is the policy, so the policy carries the new terms.
--     The player card (service role, no viewer in the database) checks blocks in the app instead (player-card.functions.ts).
--   * No other policy, view or SECURITY INVOKER function reads profiles (checked from the catalog when this was
--     written), so the change reaches direct API reads of profiles only. SECURITY DEFINER code is unaffected.
--   * It changes no data.
--
-- THE PERSON WHO BLOCKED: their own list of blocked accounts used to read the blocked people's profile rows, which this
-- now hides. public.my_blocked_profiles() returns the names for that list only, under the rule the list had before
-- (visibility 'public' or 'members', and not suspended, so a suspended account looks like any private one there).
--
-- PERFORMANCE: auth.uid(), the staff check and the viewer's block list are written as (SELECT ...) so each runs once
-- per statement (an InitPlan), not once per row. The new per-row work is a test of suspended_at (a column of the row)
-- and a check against the viewer's block list (an array, usually empty or short), both before the existing visibility
-- lookup. Measured on a scratch copy with 20,000 profiles (docs/privacy/profile-blocks-and-suspension.md): no measurable
-- cost against the old rule, where calling blocks_exist_between per row added about half again to every list read.
--
-- Rollback: docs/rollbacks/20261126100000_profiles_respect_blocks_and_suspension.down.sql (guarded).
-- Test: supabase/tests/960_profiles_respect_blocks_and_suspension.test.sql.

SET lock_timeout = '5s';

-- The signed-in caller's block partners, both directions: everyone they blocked and everyone who blocked them. It answers
-- only about the caller (no argument), and private_sec is not exposed by the API; the profiles policy below calls it.
CREATE OR REPLACE FUNCTION private_sec.my_block_partners()
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT coalesce(array_agg(DISTINCT q.partner), '{}'::uuid[])
    FROM (SELECT b.blocked_id AS partner FROM public.user_blocks b WHERE b.blocker_id = auth.uid()
          UNION ALL
          SELECT b.blocker_id FROM public.user_blocks b WHERE b.blocked_id = auth.uid()) q;
$$;
REVOKE ALL ON FUNCTION private_sec.my_block_partners() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private_sec.my_block_partners() TO authenticated, service_role;

DROP POLICY IF EXISTS "Profiles viewable by members" ON public.profiles;
CREATE POLICY "Profiles viewable by members"
ON public.profiles FOR SELECT TO authenticated
USING (
  id = (SELECT auth.uid())
  OR (
    (SELECT private_sec.is_moderator(auth.uid()))
    AND private_sec.profile_visibility_of(id) IN ('public', 'members')
  )
  OR (
    suspended_at IS NULL
    AND id <> ALL (COALESCE((SELECT private_sec.my_block_partners()), '{}'::uuid[]))
    AND private_sec.profile_visibility_of(id) IN ('public', 'members')
  )
);

DROP POLICY IF EXISTS "Public profiles viewable by anon" ON public.profiles;
CREATE POLICY "Public profiles viewable by anon"
ON public.profiles FOR SELECT TO anon
USING (
  suspended_at IS NULL
  AND private_sec.profile_visibility_of(id) = 'public'
);

-- The blocker's own list (Settings > Blocked accounts). Only rows the caller blocked; only what the list showed before.
CREATE OR REPLACE FUNCTION public.my_blocked_profiles()
RETURNS TABLE (
  id uuid,
  display_name text,
  username text,
  avatar_url text,
  avatar_initials text,
  blocked_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT b.blocked_id,
         p.display_name,
         p.username,
         p.avatar_url,
         p.avatar_initials,
         b.created_at
    FROM public.user_blocks b
    LEFT JOIN public.profiles p
      ON p.id = b.blocked_id
     AND p.suspended_at IS NULL
     AND private_sec.profile_visibility_of(p.id) IN ('public', 'members')
   WHERE b.blocker_id = auth.uid()
   ORDER BY b.created_at DESC;
$$;
REVOKE ALL ON FUNCTION public.my_blocked_profiles() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_blocked_profiles() TO authenticated, service_role;
