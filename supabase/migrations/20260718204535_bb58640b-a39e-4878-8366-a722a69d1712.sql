
-- Public read access to team-covers bucket (so <img src> works without signed URLs)
CREATE POLICY "team_covers_public_read"
ON storage.objects FOR SELECT
TO anon, authenticated
USING (bucket_id = 'team-covers');

-- Authenticated users can upload to their own folder: {auth.uid}/...
CREATE POLICY "team_covers_owner_insert"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'team-covers'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "team_covers_owner_update"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'team-covers'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "team_covers_owner_delete"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'team-covers'
  AND (storage.foldername(name))[1] = auth.uid()::text
);
