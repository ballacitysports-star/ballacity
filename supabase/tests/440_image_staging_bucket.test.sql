-- G3b: the staging bucket is private; an owner may write a plain file in their own folder and read it back for a few minutes (never
-- once flagged), nothing else through the API. In particular nobody, the uploader included, can delete or replace a staged file (a
-- quarantined original is evidence), not even through Storage's privileged write for a signed upload URL.
BEGIN;
-- The platform stub gives API roles no grants on storage.objects; Supabase gives them all and leaves the rest to RLS. Mirror that (rolled back).
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO service_role;
SELECT t.person('alice', 30), t.person('bob', 31);
SELECT t.ok((SELECT NOT public FROM storage.buckets WHERE id = 'image-staging'), 'the staging bucket exists and is private');
SELECT t.eq((SELECT file_size_limit FROM storage.buckets WHERE id = 'image-staging'), 8388608::bigint, 'with the same 8 MB limit as the destinations');
SELECT t.eq((SELECT allowed_mime_types FROM storage.buckets WHERE id = 'image-staging'), ARRAY['image/jpeg', 'image/png', 'image/webp'], 'and only image types');

SELECT t.as_user(t.id('alice'));
SELECT t.lives(format($q$INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('image-staging', %L, auth.uid())$q$, t.id('alice') || '/a.jpg'), 'a user can stage a file in their own folder');
SELECT t.throws(format($q$INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('image-staging', %L, auth.uid())$q$, t.id('bob') || '/b.jpg'), 'row-level security', 'but not in someone else''s folder');
SELECT t.throws($q$INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('image-staging', 'loose.jpg', auth.uid())$q$, 'row-level security', 'nor at the root');
SELECT t.throws(format($q$INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('image-staging', %L, auth.uid())$q$, t.id('alice') || '/sub/nested.jpg'), 'row-level security', 'nor in a sub-folder of their own folder (the sweeper only walks {uid}/{file})');
SELECT t.throws(format($q$INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('image-staging', %L, auth.uid())$q$, t.id('alice') || '/a/b/c.jpg'), 'row-level security', 'nor deeper');
CREATE TEMP TABLE r440(n int); GRANT ALL ON r440 TO PUBLIC;
WITH i AS (INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('image-staging', t.id('alice') || '/returning.jpg', auth.uid()) RETURNING id) INSERT INTO r440 SELECT count(*) FROM i;
SELECT t.eq((SELECT n FROM r440), 1, 'an insert that returns the new row works (this is how Storage inserts)');
SELECT t.eq(t.count($$SELECT 1 FROM storage.objects WHERE bucket_id = 'image-staging'$$), 2, 'the owner can read back their own staged files');
SELECT t.eq(t.changed(format($q$UPDATE storage.objects SET name = %L WHERE bucket_id = 'image-staging'$q$, t.id('alice') || '/c.jpg')), 0, 'and cannot replace it');
SELECT t.reset();
SELECT t.eq((SELECT count(*)::int FROM storage.objects WHERE bucket_id = 'image-staging'), 2, 'the staged files exist for the service role');

SELECT t.as_user(t.id('bob'));
SELECT t.eq(t.count($$SELECT 1 FROM storage.objects WHERE bucket_id = 'image-staging'$$), 0, 'another user sees nothing');
SELECT t.eq(t.changed($$DELETE FROM storage.objects WHERE bucket_id = 'image-staging'$$), 0, 'and cannot delete them');
SELECT t.as_user(t.id('alice'));
SELECT t.eq(t.changed($$DELETE FROM storage.objects WHERE bucket_id = 'image-staging'$$), 0, 'the owner cannot delete their own staged files either (no DELETE for API roles)');
SELECT t.reset();
-- the scan quarantined one of alice's staged originals (possible child-safety evidence)
INSERT INTO public.image_moderation (bucket, path, owner_id, status, reason)
VALUES ('image-staging', t.id('alice') || '/a.jpg', t.id('alice'), 'quarantined', 'flagged');
SELECT t.as_user(t.id('alice'));
SELECT t.eq(t.changed(format($q$DELETE FROM storage.objects WHERE bucket_id = 'image-staging' AND name = %L$q$, t.id('alice') || '/a.jpg')), 0,
            'the uploader cannot delete a QUARANTINED staged original');
SELECT t.eq(t.changed(format($q$UPDATE storage.objects SET name = %L WHERE bucket_id = 'image-staging' AND name = %L$q$, t.id('alice') || '/renamed.jpg', t.id('alice') || '/a.jpg')), 0,
            'nor rename or overwrite it');
SELECT t.reset();
-- defence in depth: even a future broad permissive policy cannot reopen deletion in staging (the RESTRICTIVE policies still apply)
CREATE POLICY "t440 broad delete" ON storage.objects FOR DELETE TO authenticated USING (owner = auth.uid());
CREATE POLICY "t440 broad update" ON storage.objects FOR UPDATE TO authenticated USING (owner = auth.uid()) WITH CHECK (true);
SELECT t.as_user(t.id('alice'));
SELECT t.eq(t.changed($$DELETE FROM storage.objects WHERE bucket_id = 'image-staging'$$), 0, 'a broad permissive DELETE policy still cannot delete a staged file');
SELECT t.eq(t.changed($$UPDATE storage.objects SET bucket_id = 'avatars' WHERE bucket_id = 'image-staging'$$), 0, 'nor a broad UPDATE move it out of staging');
SELECT t.reset();
DROP POLICY "t440 broad delete" ON storage.objects;
DROP POLICY "t440 broad update" ON storage.objects;
SELECT t.eq((SELECT count(*)::int FROM storage.objects WHERE bucket_id = 'image-staging'), 2, 'both staged files, the quarantined one included, are still there for review');

-- ---- M1: the uploader cannot keep reading (or minting signed URLs for) a staged original
SELECT t.as_user(t.id('alice'));
SELECT t.eq(t.count(format($q$SELECT 1 FROM storage.objects WHERE bucket_id = 'image-staging' AND name = %L$q$, t.id('alice') || '/a.jpg')), 0,
            'M1: the uploader cannot read their own QUARANTINED staged original');
SELECT t.eq(t.count(format($q$SELECT 1 FROM storage.objects WHERE bucket_id = 'image-staging' AND name = %L$q$, t.id('alice') || '/returning.jpg')), 1,
            'but still reads a fresh, unflagged one (Storage''s INSERT ... RETURNING needs this)');
SELECT t.reset();
INSERT INTO storage.objects (bucket_id, name, owner, created_at) VALUES ('image-staging', t.id('alice') || '/old.jpg', t.id('alice'), now() - interval '10 minutes');
INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('image-staging', t.id('alice') || '/held.jpg', t.id('alice'));
INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('image-staging', t.id('alice') || '/removed.jpg', t.id('alice'));
INSERT INTO public.image_moderation (bucket, path, owner_id, status, reason) VALUES
  ('image-staging', t.id('alice') || '/held.jpg', t.id('alice'), 'pending', 'Safety scan unavailable'),
  ('image-staging', t.id('alice') || '/removed.jpg', t.id('alice'), 'removed', 'not an image');
SELECT t.as_user(t.id('alice'));
SELECT t.eq(t.count(format($q$SELECT 1 FROM storage.objects WHERE bucket_id = 'image-staging' AND name = %L$q$, t.id('alice') || '/old.jpg')), 0,
            'M1: nor one staged more than five minutes ago');
SELECT t.eq(t.count(format($q$SELECT 1 FROM storage.objects WHERE bucket_id = 'image-staging' AND name = %L$q$, t.id('alice') || '/held.jpg')), 0,
            'M1: nor one held because the scan could not run');
SELECT t.eq(t.count(format($q$SELECT 1 FROM storage.objects WHERE bucket_id = 'image-staging' AND name = %L$q$, t.id('alice') || '/removed.jpg')), 0,
            'M1: nor one the server removed');
SELECT t.reset();
SELECT t.ok(NOT has_function_privilege('anon', 'private_sec.image_staging_flagged(text)', 'EXECUTE'), 'anonymous cannot call the flag helper');
SELECT t.ok((SELECT prosecdef FROM pg_proc WHERE oid = 'private_sec.image_staging_flagged(text)'::regprocedure), 'the flag helper is SECURITY DEFINER (users cannot read image_moderation)');

-- ---- H1: Storage writes a signed upload URL's PUT itself, as the service role, outside RLS (checked only when the URL was signed),
--      stamping the signer as owner; with upsert in the token it is INSERT ... ON CONFLICT (bucket_id, name) DO UPDATE (same id, new version).
CREATE FUNCTION pg_temp.storage_put(_bucket text, _path text, _owner uuid, _version text) RETURNS void LANGUAGE sql AS $f$
  INSERT INTO storage.objects (bucket_id, name, owner, owner_id, version, metadata)
  VALUES (_bucket, _path, _owner, _owner::text, _version, '{"size": 2}')
  ON CONFLICT (bucket_id, name) DO UPDATE
    SET version = EXCLUDED.version, owner = EXCLUDED.owner, owner_id = EXCLUDED.owner_id, metadata = EXCLUDED.metadata
$f$;
GRANT EXECUTE ON FUNCTION pg_temp.storage_put(text, text, uuid, text) TO PUBLIC;
UPDATE storage.objects SET version = 'v1' WHERE bucket_id = 'image-staging';
SELECT t.as_service();
SELECT t.throws(format($q$SELECT pg_temp.storage_put('image-staging', %L, %L, 'v2')$q$, t.id('alice') || '/a.jpg', t.id('alice')),
            'STAGED_IMAGE_FINAL', 'H1: Storage''s privileged upsert for the uploader''s signed URL cannot overwrite a QUARANTINED staged original');
SELECT t.throws(format($q$SELECT pg_temp.storage_put('image-staging', %L, %L, 'v2')$q$, t.id('alice') || '/returning.jpg', t.id('alice')),
            'STAGED_IMAGE_FINAL', 'H1: nor any other staged file');
SELECT t.throws(format($q$UPDATE storage.objects SET name = %L WHERE bucket_id = 'image-staging' AND name = %L$q$, t.id('alice') || '/moved.jpg', t.id('alice') || '/a.jpg'),
            'STAGED_IMAGE_FINAL', 'nor can a privileged write on a user-owned staged row move it');
SELECT t.lives(format($q$SELECT pg_temp.storage_put('image-staging', %L, %L, 'v1')$q$, t.id('alice') || '/fresh.jpg', t.id('alice')),
            'a signed upload to a NEW staging path still works (an insert, no conflict)');
SELECT t.lives($q$SELECT pg_temp.storage_put('image-staging', '_scan/x.jpg', NULL, 'v1'), pg_temp.storage_put('image-staging', '_scan/x.jpg', NULL, 'v2')$q$,
            'the service key itself (no end-user owner, e.g. the promotion scratch copy) can still write and overwrite in staging');
SELECT t.lives(format($q$SELECT set_config('ballacity.storage_service_write', 'on', true), pg_temp.storage_put('image-staging', %L, %L, 'v3')$q$, t.id('alice') || '/returning.jpg', t.id('alice')),
            'service code that sets the transaction flag can (maintenance)');
SELECT set_config('ballacity.storage_service_write', '', true);
SELECT t.reset();
SELECT t.eq((SELECT version FROM storage.objects WHERE bucket_id = 'image-staging' AND name = t.id('alice') || '/a.jpg'), 'v1',
            'the quarantined original is unchanged');
SELECT t.lives(format($q$UPDATE storage.objects SET metadata = '{}' WHERE bucket_id = 'image-staging' AND name = %L$q$, t.id('alice') || '/a.jpg'),
            'a superuser (SQL console maintenance) still can');
SELECT t.as_service();
SELECT t.eq(t.changed($$DELETE FROM storage.objects WHERE bucket_id = 'image-staging' AND name LIKE '%/returning.jpg'$$), 1, 'the service role (promotion, sweeper) can still remove a staged file');
SELECT t.lives($q$UPDATE storage.objects SET metadata = '{}' WHERE bucket_id = 'image-staging' AND name = '_scan/x.jpg'$q$, 'and update a row it wrote itself');
SELECT t.reset();
SELECT t.as_anon();
SELECT t.eq(t.count($$SELECT 1 FROM storage.objects WHERE bucket_id = 'image-staging'$$), 0, 'anonymous sees nothing');
SELECT t.throws($q$INSERT INTO storage.objects (bucket_id, name) VALUES ('image-staging', 'x/y.jpg')$q$, 'row-level security', 'anonymous cannot stage a file');
SELECT t.reset();

-- ---- legacy direct uploads (older clients) keep working during the adoption window, and the sweep finds them
SELECT t.as_user(t.id('alice'));
SELECT t.lives(format($q$INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('avatars', %L, auth.uid())$q$, t.id('alice') || '/old-client.jpg'), 'LEGACY PATH (kept until the separately approved phase 2): an older client can still upload straight into a public bucket');
SELECT t.throws(format($q$INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('avatars', %L, auth.uid())$q$, t.id('bob') || '/forged.jpg'), 'row-level security', 'but never into someone else''s folder');
SELECT t.reset();
SELECT t.eq((SELECT count(*)::int FROM storage.objects o LEFT JOIN public.image_moderation m ON m.bucket = o.bucket_id AND m.path = o.name
              WHERE o.bucket_id IN ('avatars', 'covers', 'org-avatars', 'org-covers', 'team-avatars', 'team-covers', 'trainer-avatars') AND m.id IS NULL), 1,
            'the read-only sweep (public-bucket objects with no moderation record) finds the unfinalized legacy upload');
INSERT INTO public.image_moderation (bucket, path, owner_id, status) VALUES ('avatars', t.id('alice') || '/old-client.jpg', t.id('alice'), 'pending');
SELECT t.eq((SELECT count(*)::int FROM storage.objects o LEFT JOIN public.image_moderation m ON m.bucket = o.bucket_id AND m.path = o.name
              WHERE o.bucket_id IN ('avatars', 'covers', 'org-avatars', 'org-covers', 'team-avatars', 'team-covers', 'trainer-avatars') AND m.id IS NULL), 0,
            'and it disappears once the object has been finalized');

-- the public destinations are unchanged (the direct path stays during the adoption window)
SELECT t.ok((SELECT bool_and(public) FROM storage.buckets WHERE id IN ('avatars', 'covers', 'team-avatars', 'org-avatars')), 'public destination buckets are unchanged');
SELECT t.ok((SELECT count(*) FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname LIKE 'image_staging_%' AND cmd = 'SELECT') = 1, 'the only staging SELECT policy is the own-folder one');
SELECT t.ok((SELECT qual FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'image_staging_select_own_folder') ~ 'created_at > \(now\(\) - ''00:05:00''::interval\)',
            'and it is limited to rows created in the last five minutes');
SELECT t.eq((SELECT count(*)::int FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND permissive = 'PERMISSIVE'
              AND cmd IN ('DELETE', 'UPDATE', 'ALL') AND coalesce(qual, '') || coalesce(with_check, '') LIKE '%image-staging%'), 0,
            'no permissive DELETE/UPDATE policy names the staging bucket');
ROLLBACK;
