-- 1) profile_ages is SECURITY DEFINER and leaks birthdays-derived ages; require sign-in.
REVOKE EXECUTE ON FUNCTION public.profile_ages(uuid[]) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.profile_ages(uuid[]) TO authenticated, service_role;

-- 2) Remove the user-id-scoped storage policy that let any signed-in user write
-- into org/team/trainer branded buckets, bypassing ownership checks.
DROP POLICY IF EXISTS "Users write own scoped images" ON storage.objects;

-- Public read of these public buckets stays intact (bucket is public), and the
-- resource-scoped write policies remain:
--   "Org admins write org images"  (org-avatars, org-covers)
--   "Team owners write team images" (trainer-avatars, team-avatars, team-covers)
