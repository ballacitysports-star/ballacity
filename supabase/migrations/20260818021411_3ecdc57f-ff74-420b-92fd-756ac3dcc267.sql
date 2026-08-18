DROP POLICY IF EXISTS "team_covers_owner_insert" ON storage.objects;
DROP POLICY IF EXISTS "team_covers_owner_update" ON storage.objects;
DROP POLICY IF EXISTS "team_covers_owner_delete" ON storage.objects;

CREATE POLICY "Users write entity images in own folder (insert)"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = ANY (ARRAY['org-avatars','org-covers','trainer-avatars','team-avatars','team-covers'])
  AND (storage.foldername(name))[1] = (auth.uid())::text
);

CREATE POLICY "Users write entity images in own folder (update)"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = ANY (ARRAY['org-avatars','org-covers','trainer-avatars','team-avatars','team-covers'])
  AND (storage.foldername(name))[1] = (auth.uid())::text
)
WITH CHECK (
  bucket_id = ANY (ARRAY['org-avatars','org-covers','trainer-avatars','team-avatars','team-covers'])
  AND (storage.foldername(name))[1] = (auth.uid())::text
);

CREATE POLICY "Users write entity images in own folder (delete)"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = ANY (ARRAY['org-avatars','org-covers','trainer-avatars','team-avatars','team-covers'])
  AND (storage.foldername(name))[1] = (auth.uid())::text
);