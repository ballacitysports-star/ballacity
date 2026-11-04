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

-- Entity images promoted into the uploader's own folder (`{uid}/...` in the org, team and trainer buckets) had a DELETE policy but no
-- SELECT policy, so the owner could not delete them (Storage deletes with RETURNING). Read-back of the own folder fixes that. It is
-- added only here, never before phase 2: while "Users write entity images in own folder (update)" exists, a SELECT policy would also
-- enable in-place overwrites of promoted (already moderated) images, which the unmoderated-object sweep cannot see.
DROP POLICY IF EXISTS "phase2 owners read own entity images" ON storage.objects;
CREATE POLICY "phase2 owners read own entity images" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id IN ('org-avatars', 'org-covers', 'trainer-avatars', 'team-avatars', 'team-covers')
         AND (storage.foldername(name))[1] = (auth.uid())::text);
-- Kept unchanged: "Users write entity images in own folder (delete)", "Users can delete their own game covers",
-- "Authenticated read game covers", every staging, payment-proof, message-attachment and highlight-video policy.

-- 3. Postcondition, by allow-list rather than by deny-list: every PERMISSIVE INSERT/UPDATE/ALL policy for an API role (anon,
--    authenticated, public) must be pinned to one of the non-image buckets that keep a browser upload path. Conservatively, the
--    deparsed expression must be exactly `(bucket_id = '<allowed>'::text)` or an AND whose FIRST operand is that comparison
--    (`((bucket_id = '<allowed>'::text) AND ...)`); an OR at the top, an IN/ANY list, a missing USING or WITH CHECK, or a policy
--    that does not mention the bucket at all fails. For UPDATE/ALL both USING and WITH CHECK (when present) must pass.
--    RESTRICTIVE policies only narrow access and are not checked. A policy counts as an API-role policy when it names `public`
--    or any role that anon or authenticated is a member of (directly or through other roles: pg_has_role(..., 'MEMBER')), so a
--    policy granted to an intermediate group role is caught too. Policies only for roles neither API role inherits are out of scope.
--    The check lives in a session-temporary function so the test can run it again against injected policies.
CREATE OR REPLACE FUNCTION pg_temp.g3b_phase2_open_write_policies() RETURNS text LANGUAGE sql STABLE AS $fn$
  WITH allowed(re) AS (
    SELECT '^(\(bucket_id = ''(payment-proofs|highlight-videos|message-attachments|image-staging)''::text\)'
           '|\(\(bucket_id = ''(payment-proofs|highlight-videos|message-attachments|image-staging)''::text\) AND .*\))$'
  )
  SELECT string_agg(format('%s (%s)', p.policyname, p.cmd), ', ' ORDER BY p.policyname)
    FROM pg_policies p, allowed a
   WHERE p.schemaname = 'storage' AND p.tablename = 'objects' AND p.permissive = 'PERMISSIVE'
     AND p.cmd IN ('INSERT', 'UPDATE', 'ALL')
     AND EXISTS (SELECT 1 FROM unnest(p.roles) AS r(name)
                  WHERE r.name = 'public'
                     OR (EXISTS (SELECT 1 FROM pg_roles x WHERE x.rolname = r.name)
                         AND (pg_has_role('anon', r.name, 'MEMBER') OR pg_has_role('authenticated', r.name, 'MEMBER'))))
     AND NOT CASE p.cmd
           WHEN 'INSERT' THEN coalesce(p.with_check, '') ~ a.re
           ELSE coalesce(p.qual, '') ~ a.re AND (p.with_check IS NULL OR p.with_check ~ a.re)
         END
$fn$;
CREATE OR REPLACE FUNCTION pg_temp.g3b_phase2_assert_closed() RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE _bad text := pg_temp.g3b_phase2_open_write_policies();
BEGIN
  IF _bad IS NOT NULL THEN
    RAISE EXCEPTION 'G3b phase 2: write policies still open outside the allowed non-image buckets: % (names differ from this script, or a new policy appeared; re-read the target)', _bad;
  END IF;
END
$fn$;
SELECT pg_temp.g3b_phase2_assert_closed();
