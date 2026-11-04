-- G3b: a private staging bucket for image uploads, so an unprocessed original is never in a public bucket.
--
-- WHY. Until now the browser uploaded the original file straight into a public bucket (avatars, covers, team/org/trainer images) and then
-- asked the server to validate, clean and scan it. For that interval, and forever if the second step never happens (a dropped connection,
-- a closed tab, a client that skips it), the original, with its GPS and camera data, sits at a public URL.
--
-- WHAT THIS DOES. Adds a PRIVATE bucket `image-staging`. A signed-in user may write only a plain file directly inside their own folder
-- (`{uid}/{file}`, no sub-folders) and read back only their own staged files for a few minutes after the upload (needed for Storage's
-- INSERT ... RETURNING, see below) and never one the server has flagged, held or removed. Nobody can replace or delete a staged file
-- through the API: RLS refuses it for API roles, and a trigger refuses an overwrite that Storage itself performs on a user's behalf
-- (a signed upload URL with upsert, see "SIGNED UPLOAD URLS" below). The server, with the service role, validates, strips metadata, scans,
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
-- SELECT policy on its way back out (see 20261020130000), so a bucket with no SELECT policy rejects every upload. It is kept as narrow
-- as that need: only rows created in the last five minutes (the RETURNING happens in the inserting transaction, where created_at =
-- now()), and never a path the server has recorded in image_moderation for this bucket. A staging row there means the original was
-- quarantined, removed, or held because the scan could not run (status 'pending' in staging); successful promotions are recorded
-- under the destination bucket instead. Without these limits the uploader could keep reading, and minting signed URLs for, an
-- original the scan quarantined.
CREATE OR REPLACE FUNCTION private_sec.image_staging_flagged(_path text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.image_moderation m
                  WHERE m.bucket = 'image-staging' AND m.path = _path
                    AND m.status IN ('pending', 'quarantined', 'removed'))
$function$;
REVOKE ALL ON FUNCTION private_sec.image_staging_flagged(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private_sec.image_staging_flagged(text) TO authenticated, service_role;

DROP POLICY IF EXISTS "image_staging_select_own_folder" ON storage.objects;
CREATE POLICY "image_staging_select_own_folder" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'image-staging' AND (auth.uid())::text = (storage.foldername(name))[1]
         AND created_at > now() - interval '5 minutes'
         AND NOT private_sec.image_staging_flagged(name));

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

-- SIGNED UPLOAD URLS. RLS is not enough on its own. Storage checks RLS when it SIGNS an upload URL (createSignedUploadUrl), but the
-- PUT to that URL (valid for two hours) is written by Storage itself as the service role, so RLS never sees it. With upsert in the
-- token, that write is `INSERT ... ON CONFLICT (bucket_id, name) DO UPDATE`: same object id, new version, new bytes. An uploader
-- could therefore overwrite their own staged original, including one the scan quarantined, after the server looked at it.
-- Triggers fire for every writer, so this one refuses any UPDATE of a staging row unless the writer is trusted:
--   * a superuser (maintenance in the SQL console or a migration; Storage never connects as one), or
--   * service code that set the transaction-local flag `ballacity.storage_service_write = on` (never an API role), or
--   * the service role or Storage's own role writing a row that carries no end user as owner: a request made with the service key
--     itself. Storage stamps the signer of a signed upload URL as the row's owner/owner_id, so a write it performs for a user's
--     token is not trusted even though it runs as the service role.
-- The server never updates a staging row (promotion reads, writes clean bytes elsewhere, and deletes; the sweeper deletes), so
-- nothing legitimate is lost. DELETE is untouched (promotion and the sweeper delete as the service role; API roles cannot).
CREATE OR REPLACE FUNCTION private_sec.storage_write_is_trusted(_owner uuid, _owner_id text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT CASE
    WHEN current_user IN ('anon', 'authenticated') THEN false
    WHEN coalesce((SELECT r.rolsuper FROM pg_catalog.pg_roles r WHERE r.rolname = current_user), false) THEN true
    WHEN coalesce(current_setting('ballacity.storage_service_write', true), '') = 'on' THEN true
    WHEN current_user IN ('service_role', 'supabase_storage_admin') THEN _owner IS NULL AND nullif(_owner_id, '') IS NULL
    ELSE false
  END
$function$;
COMMENT ON FUNCTION private_sec.storage_write_is_trusted(uuid, text) IS
  'SECURITY INVOKER on purpose (it reads current_user). True for a superuser, for non-API service code that set ballacity.storage_service_write = on, and for the service role writing a row with no end-user owner; false for a write Storage performs for a user''s signed upload URL.';
REVOKE ALL ON FUNCTION private_sec.storage_write_is_trusted(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private_sec.storage_write_is_trusted(uuid, text) TO anon, authenticated, service_role;
DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_storage_admin') THEN
    GRANT USAGE ON SCHEMA private_sec TO supabase_storage_admin;
    GRANT EXECUTE ON FUNCTION private_sec.storage_write_is_trusted(uuid, text) TO supabase_storage_admin;
  END IF;
END
$grant$;

CREATE OR REPLACE FUNCTION private_sec.image_staging_refuse_overwrite()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF (OLD.bucket_id = 'image-staging' OR NEW.bucket_id = 'image-staging')
     AND NOT private_sec.storage_write_is_trusted(NEW.owner, NEW.owner_id) THEN
    RAISE EXCEPTION 'STAGED_IMAGE_FINAL: a staged image cannot be replaced, moved or changed.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION private_sec.image_staging_refuse_overwrite() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS image_staging_refuse_overwrite ON storage.objects;
CREATE TRIGGER image_staging_refuse_overwrite BEFORE UPDATE ON storage.objects
  FOR EACH ROW EXECUTE FUNCTION private_sec.image_staging_refuse_overwrite();
