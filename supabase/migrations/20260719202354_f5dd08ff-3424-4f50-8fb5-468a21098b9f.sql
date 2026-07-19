
-- Columns
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS cover_url text;
ALTER TABLE public.trainer_orgs ADD COLUMN IF NOT EXISTS avatar_url text;
ALTER TABLE public.trainer_orgs ADD COLUMN IF NOT EXISTS cover_url text;

-- Storage policies. Bucket paths use `{ownerId}/filename`.

-- Public read for all image buckets
DROP POLICY IF EXISTS "Public read image buckets" ON storage.objects;
CREATE POLICY "Public read image buckets" ON storage.objects
  FOR SELECT TO public
  USING (bucket_id IN ('avatars','covers','trainer-avatars','team-avatars','org-avatars','org-covers','team-covers'));

-- User-scoped buckets: avatars, covers
DROP POLICY IF EXISTS "Users write own avatar" ON storage.objects;
CREATE POLICY "Users write own avatar" ON storage.objects
  FOR ALL TO authenticated
  USING (
    bucket_id IN ('avatars','covers')
    AND auth.uid()::text = (storage.foldername(name))[1]
  )
  WITH CHECK (
    bucket_id IN ('avatars','covers')
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- Trainer / team buckets: path is {team_id}/... where teams.owner_id = auth.uid()
DROP POLICY IF EXISTS "Team owners write team images" ON storage.objects;
CREATE POLICY "Team owners write team images" ON storage.objects
  FOR ALL TO authenticated
  USING (
    bucket_id IN ('trainer-avatars','team-avatars','team-covers')
    AND EXISTS (
      SELECT 1 FROM public.teams t
      WHERE t.id = (storage.foldername(name))[1]
        AND t.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    bucket_id IN ('trainer-avatars','team-avatars','team-covers')
    AND EXISTS (
      SELECT 1 FROM public.teams t
      WHERE t.id = (storage.foldername(name))[1]
        AND t.owner_id = auth.uid()
    )
  );

-- Org buckets: path is {org_id}/... where user is owner or admin
DROP POLICY IF EXISTS "Org admins write org images" ON storage.objects;
CREATE POLICY "Org admins write org images" ON storage.objects
  FOR ALL TO authenticated
  USING (
    bucket_id IN ('org-avatars','org-covers')
    AND public.is_trainer_org_admin(((storage.foldername(name))[1])::uuid, auth.uid())
  )
  WITH CHECK (
    bucket_id IN ('org-avatars','org-covers')
    AND public.is_trainer_org_admin(((storage.foldername(name))[1])::uuid, auth.uid())
  );
