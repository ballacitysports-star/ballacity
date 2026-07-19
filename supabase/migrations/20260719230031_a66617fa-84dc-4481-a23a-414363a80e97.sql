CREATE POLICY "Users write own scoped images"
  ON storage.objects
  FOR ALL TO authenticated
  USING (
    bucket_id IN ('trainer-avatars','team-avatars','team-covers','org-avatars','org-covers')
    AND auth.uid()::text = (storage.foldername(name))[1]
  )
  WITH CHECK (
    bucket_id IN ('trainer-avatars','team-avatars','team-covers','org-avatars','org-covers')
    AND auth.uid()::text = (storage.foldername(name))[1]
  );