-- G3b: a private staging bucket for image uploads, so an unprocessed original is never in a public bucket.
--
-- WHY. Until now the browser uploaded the original file straight into a public bucket (avatars, covers, team/org/trainer images) and then
-- asked the server to validate, clean and scan it. For that interval, and forever if the second step never happens (a dropped connection,
-- a closed tab, a client that skips it), the original, with its GPS and camera data, sits at a public URL.
--
-- WHAT THIS DOES. Adds a PRIVATE bucket `image-staging`. A signed-in user may write only a plain file directly inside their own folder
-- (`{uid}/{file}`, no sub-folders) and read back only their own staged files (needed for Storage's INSERT ... RETURNING, see below);
-- nobody can replace or delete a staged file through the API. The server, with the service role, validates, strips metadata, scans,
-- and only then writes the clean bytes to the public bucket and removes the staged copy (promoteStagedImage). A file the scan flags
-- stays in staging as evidence, so the uploader must not be able to delete it.
--
-- COMPATIBILITY. Additive. Old clients keep uploading directly to the public buckets, which still works; a later, separately approved
-- change closes that direct path once the new build has been live for a full adoption window (prepared in
-- supabase/phase2/g3b_phase2_close_direct_image_uploads.sql, documented in docs/privacy/g3b-image-staging.md, not done here).
-- The new client has NO fallback to a direct upload: on a database without this migration its uploads fail with a clear message,
-- so the deploy order is this migration first, then the app.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('image-staging', 'image-staging', false, 8388608, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 8388608, allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];

-- Exactly one folder level: `{uid}/{file}`. The sweeper walks `{folder}/{file}` only, so a nested path would never be cleaned up.
DROP POLICY IF EXISTS "image_staging_insert_own_folder" ON storage.objects;
CREATE POLICY "image_staging_insert_own_folder" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'image-staging' AND (auth.uid())::text = (storage.foldername(name))[1]
              AND array_length(storage.foldername(name), 1) = 1);

-- Own-folder SELECT is required, not optional: Storage inserts with INSERT ... RETURNING, and Postgres checks a new row against the
-- SELECT policy on its way back out (see 20261020130000), so a bucket with no SELECT policy rejects every upload. It exposes nothing
-- new: the bucket is private, the folder is the caller's own, and the files are the caller's own unprocessed uploads.
DROP POLICY IF EXISTS "image_staging_select_own_folder" ON storage.objects;
CREATE POLICY "image_staging_select_own_folder" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'image-staging' AND (auth.uid())::text = (storage.foldername(name))[1]);

-- No DELETE and no UPDATE for API roles. The client never deletes or overwrites a staged file (it uploads with upsert: false); the
-- promotion, cleanup and sweeper run as the service role. A permissive own-folder DELETE would let an uploader erase a staged original
-- the scan quarantined (possible child-safety evidence) before a reviewer sees it. The RESTRICTIVE policies below keep that true even
-- if a later, broader permissive policy on storage.objects happens to match staging rows.
DROP POLICY IF EXISTS "image_staging_delete_own_folder" ON storage.objects;
DROP POLICY IF EXISTS "image_staging_no_api_delete" ON storage.objects;
CREATE POLICY "image_staging_no_api_delete" ON storage.objects AS RESTRICTIVE FOR DELETE TO anon, authenticated
  USING (bucket_id IS DISTINCT FROM 'image-staging');
DROP POLICY IF EXISTS "image_staging_no_api_update" ON storage.objects;
CREATE POLICY "image_staging_no_api_update" ON storage.objects AS RESTRICTIVE FOR UPDATE TO anon, authenticated
  USING (bucket_id IS DISTINCT FROM 'image-staging') WITH CHECK (bucket_id IS DISTINCT FROM 'image-staging');
