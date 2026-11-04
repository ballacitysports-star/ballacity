-- G3b PHASE 2 — NOT A MIGRATION. NOT APPLIED. Kept outside supabase/migrations so no replay, CLI or sync picks it up.
-- Closes the legacy direct-upload path: after it, only the service role (the staging -> scan -> strip -> promote server path)
-- writes into public image buckets and the game-covers bucket. Owners keep read-back and delete of their own files.
-- Gate (runbook / docs/privacy/g3b-image-staging.md): the staging migration and the new app build have been live for the
-- adoption window; the weekly read-only sweep is clean; owner approval; sandbox rehearsal first. To ship it, copy it into a
-- new timestamped file in supabase/migrations at that time (AGENTS.md: every live change is a migration file), re-reading
-- the policy names from the target first. Tested by supabase/tests/445_image_phase2_direct_upload_closure.test.sql, which
-- applies this file inside a rolled-back transaction.
-- No BEGIN/COMMIT here: the operator (or the test) owns the transaction. Set a lock_timeout before running it.

DO $guard$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'image-staging' AND NOT public) THEN
    RAISE EXCEPTION 'G3b phase 2: the private image-staging bucket is missing; apply 20261106120000_private_image_staging first';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'image_staging_insert_own_folder') THEN
    RAISE EXCEPTION 'G3b phase 2: staging upload policy missing; new clients would have no upload path';
  END IF;
END
$guard$;

-- 1. Remove every browser write path into public image buckets and game covers.
DROP POLICY IF EXISTS "Users write own avatar" ON storage.objects;                              -- ALL: avatars, covers
DROP POLICY IF EXISTS "Users write entity images in own folder (insert)" ON storage.objects;
DROP POLICY IF EXISTS "Users write entity images in own folder (update)" ON storage.objects;
DROP POLICY IF EXISTS "Team owners write team images" ON storage.objects;                       -- ALL: trainer/team avatars, team covers
DROP POLICY IF EXISTS "Org admins write org images" ON storage.objects;                         -- ALL: org avatars, org covers
DROP POLICY IF EXISTS "Users can upload their own game covers" ON storage.objects;
DROP POLICY IF EXISTS "Users can update their own game covers" ON storage.objects;

-- 2. Keep what the dropped ALL policies gave besides writing: read-back and delete (Storage deletes with RETURNING, so it needs SELECT).
DROP POLICY IF EXISTS "phase2 owners read own public images" ON storage.objects;
CREATE POLICY "phase2 owners read own public images" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id IN ('avatars', 'covers') AND (storage.foldername(name))[1] = (auth.uid())::text);
DROP POLICY IF EXISTS "phase2 owners delete own public images" ON storage.objects;
CREATE POLICY "phase2 owners delete own public images" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id IN ('avatars', 'covers') AND (storage.foldername(name))[1] = (auth.uid())::text);

DROP POLICY IF EXISTS "phase2 team owners read team images" ON storage.objects;
CREATE POLICY "phase2 team owners read team images" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id IN ('trainer-avatars', 'team-avatars', 'team-covers')
         AND EXISTS (SELECT 1 FROM public.teams t WHERE t.id = (storage.foldername(objects.name))[1] AND t.owner_id = auth.uid()));
DROP POLICY IF EXISTS "phase2 team owners delete team images" ON storage.objects;
CREATE POLICY "phase2 team owners delete team images" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id IN ('trainer-avatars', 'team-avatars', 'team-covers')
         AND EXISTS (SELECT 1 FROM public.teams t WHERE t.id = (storage.foldername(objects.name))[1] AND t.owner_id = auth.uid()));

DROP POLICY IF EXISTS "phase2 org admins read org images" ON storage.objects;
CREATE POLICY "phase2 org admins read org images" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id IN ('org-avatars', 'org-covers') AND public.is_trainer_org_admin(((storage.foldername(name))[1])::uuid, auth.uid()));
DROP POLICY IF EXISTS "phase2 org admins delete org images" ON storage.objects;
CREATE POLICY "phase2 org admins delete org images" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id IN ('org-avatars', 'org-covers') AND public.is_trainer_org_admin(((storage.foldername(name))[1])::uuid, auth.uid()));
-- Kept unchanged: "Users write entity images in own folder (delete)", "Users can delete their own game covers",
-- "Authenticated read game covers", every staging, payment-proof, message-attachment and highlight-video policy.

-- 3. Postcondition: no INSERT/UPDATE/ALL policy for an API role still names a public image bucket or game covers.
DO $post$
DECLARE _bad text;
BEGIN
  SELECT string_agg(policyname, ', ') INTO _bad
    FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects' AND cmd IN ('INSERT', 'UPDATE', 'ALL')
     AND roles && ARRAY['authenticated', 'anon', 'public']::name[]
     AND coalesce(qual, '') || coalesce(with_check, '') ~ '(''(avatars|covers|org-avatars|org-covers|trainer-avatars|team-avatars|team-covers|game-covers)'')';
  IF _bad IS NOT NULL THEN
    RAISE EXCEPTION 'G3b phase 2: write policies still open on image buckets: % (names differ from this script; re-read the target)', _bad;
  END IF;
END
$post$;
