-- G3b: the staging bucket is private, write-only for the owner's own folder, and unreadable through the API.
BEGIN;
-- The platform stub gives API roles no grants on storage.objects; Supabase gives them all and leaves the rest to RLS. Mirror that (rolled back).
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO anon;
SELECT t.person('alice', 30), t.person('bob', 31);
SELECT t.ok((SELECT NOT public FROM storage.buckets WHERE id = 'image-staging'), 'the staging bucket exists and is private');
SELECT t.eq((SELECT file_size_limit FROM storage.buckets WHERE id = 'image-staging'), 8388608::bigint, 'with the same 8 MB limit as the destinations');
SELECT t.eq((SELECT allowed_mime_types FROM storage.buckets WHERE id = 'image-staging'), ARRAY['image/jpeg', 'image/png', 'image/webp'], 'and only image types');

SELECT t.as_user(t.id('alice'));
SELECT t.lives(format($q$INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('image-staging', %L, auth.uid())$q$, t.id('alice') || '/a.jpg'), 'a user can stage a file in their own folder');
SELECT t.throws(format($q$INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('image-staging', %L, auth.uid())$q$, t.id('bob') || '/b.jpg'), 'row-level security', 'but not in someone else''s folder');
SELECT t.throws($q$INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('image-staging', 'loose.jpg', auth.uid())$q$, 'row-level security', 'nor at the root');
SELECT t.eq(t.count($$SELECT 1 FROM storage.objects WHERE bucket_id = 'image-staging'$$), 0, 'the owner cannot read back what they staged (only the server can)');
SELECT t.eq(t.changed(format($q$UPDATE storage.objects SET name = %L WHERE bucket_id = 'image-staging'$q$, t.id('alice') || '/c.jpg')), 0, 'and cannot replace it');
SELECT t.reset();
SELECT t.eq((SELECT count(*)::int FROM storage.objects WHERE bucket_id = 'image-staging'), 1, 'the staged file exists for the service role');

SELECT t.as_user(t.id('bob'));
SELECT t.eq(t.count($$SELECT 1 FROM storage.objects WHERE bucket_id = 'image-staging'$$), 0, 'another user sees nothing');
SELECT t.eq(t.changed($$DELETE FROM storage.objects WHERE bucket_id = 'image-staging'$$), 0, 'and cannot delete it');
SELECT t.as_user(t.id('alice'));
SELECT t.eq(t.changed($$DELETE FROM storage.objects WHERE bucket_id = 'image-staging'$$), 0, 'the owner cannot delete it either (the server promotes or removes staged files)');
SELECT t.as_anon();
SELECT t.eq(t.count($$SELECT 1 FROM storage.objects WHERE bucket_id = 'image-staging'$$), 0, 'anonymous sees nothing');
SELECT t.throws($q$INSERT INTO storage.objects (bucket_id, name) VALUES ('image-staging', 'x/y.jpg')$q$, 'row-level security', 'anonymous cannot stage a file');
SELECT t.reset();

-- the public destinations are unchanged (the direct path stays during the adoption window)
SELECT t.ok((SELECT bool_and(public) FROM storage.buckets WHERE id IN ('avatars', 'covers', 'team-avatars', 'org-avatars')), 'public destination buckets are unchanged');
SELECT t.ok((SELECT count(*) FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname LIKE 'image_staging_%' AND cmd = 'SELECT') = 0, 'there is no SELECT policy for the staging bucket');
ROLLBACK;
