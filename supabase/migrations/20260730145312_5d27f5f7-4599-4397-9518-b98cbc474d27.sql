-- 1) Restrict raw birthday from broad profile reads (column-level privileges)
REVOKE SELECT ON public.profiles FROM authenticated;
REVOKE SELECT ON public.profiles FROM anon;
GRANT SELECT (
  id, account_type, avatar_initials, avatar_url, bio, city, cover_url,
  created_at, display_name, graduating_class, links, sport, updated_at, username
) ON public.profiles TO authenticated;

-- Owner-only access to own raw birthday
CREATE OR REPLACE FUNCTION public.get_my_birthday()
RETURNS date
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.birthday FROM public.profiles p WHERE p.id = auth.uid();
$$;
REVOKE ALL ON FUNCTION public.get_my_birthday() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_birthday() TO authenticated;

-- Derived age only for other users
CREATE OR REPLACE FUNCTION public.profile_ages(_ids uuid[])
RETURNS TABLE (id uuid, age integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id,
         CASE WHEN p.birthday IS NULL THEN NULL
              ELSE date_part('year', age(p.birthday))::int END
  FROM public.profiles p
  WHERE p.id = ANY(_ids);
$$;
REVOKE ALL ON FUNCTION public.profile_ages(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.profile_ages(uuid[]) TO authenticated;

-- 2) Fix broken team-image storage ownership policy
DROP POLICY IF EXISTS "Team owners write team images" ON storage.objects;
CREATE POLICY "Team owners write team images"
ON storage.objects
FOR ALL
TO authenticated
USING (
  bucket_id = ANY (ARRAY['trainer-avatars','team-avatars','team-covers'])
  AND EXISTS (
    SELECT 1 FROM public.teams t
    WHERE t.id = (storage.foldername(storage.objects.name))[1]
      AND t.owner_id = auth.uid()
  )
)
WITH CHECK (
  bucket_id = ANY (ARRAY['trainer-avatars','team-avatars','team-covers'])
  AND EXISTS (
    SELECT 1 FROM public.teams t
    WHERE t.id = (storage.foldername(storage.objects.name))[1]
      AND t.owner_id = auth.uid()
  )
);