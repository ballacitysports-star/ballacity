-- G3b: a private staging bucket for image uploads, so an unprocessed original is never in a public bucket.
--
-- WHY. Until now the browser uploaded the original file straight into a public bucket (avatars, covers, team/org/trainer images) and then
-- asked the server to validate, clean and scan it. For that interval, and forever if the second step never happens (a dropped connection,
-- a closed tab, a client that skips it), the original, with its GPS and camera data, sits at a public URL.
--
-- WHAT THIS DOES. Adds a PRIVATE bucket `image-staging`. A signed-in user may write only inside their own folder; nobody can
-- read it through the API (no SELECT policy), so only the server, with the service role, can fetch a staged file. The server validates,
-- strips metadata, scans, and only then writes the clean bytes to the public bucket and removes the staged copy (promoteStagedImage).
--
-- COMPATIBILITY. Additive. Old clients keep uploading directly to the public buckets, which still works; a later, separately approved
-- migration closes that direct path once the new build has been live for a full adoption window (documented in docs/privacy/g3b-image-staging.md,
-- not done here). A new client on a database without this migration falls back to the old flow when the bucket does not exist.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('image-staging', 'image-staging', false, 8388608, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 8388608, allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];

DROP POLICY IF EXISTS "image_staging_insert_own_folder" ON storage.objects;
CREATE POLICY "image_staging_insert_own_folder" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'image-staging' AND (auth.uid())::text = (storage.foldername(name))[1]);

-- Own-folder SELECT and DELETE are required, not optional: Storage inserts with INSERT ... RETURNING, and Postgres checks a new row against the
-- SELECT policy on its way back out (see 20261020130000), so a bucket with no SELECT policy rejects every upload. They expose nothing new: the
-- bucket is private, the folder is the caller's own, and the files are the caller's own unprocessed uploads. Nobody else can read, replace or
-- delete a staged file through the API; there is no UPDATE policy; promotion and cleanup use the service role.
DROP POLICY IF EXISTS "image_staging_select_own_folder" ON storage.objects;
CREATE POLICY "image_staging_select_own_folder" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'image-staging' AND (auth.uid())::text = (storage.foldername(name))[1]);
DROP POLICY IF EXISTS "image_staging_delete_own_folder" ON storage.objects;
CREATE POLICY "image_staging_delete_own_folder" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'image-staging' AND (auth.uid())::text = (storage.foldername(name))[1]);
