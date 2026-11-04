-- G3b phase 2 (prepared, NOT a migration, NOT applied): applies supabase/phase2/g3b_phase2_close_direct_image_uploads.sql inside
-- this rolled-back transaction and proves the legacy direct-upload path is closed while authorized paths keep working.
BEGIN;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO service_role;
SELECT t.person('alice', 30), t.person('bob', 31);
SELECT t.team('tm445', 'alice');
INSERT INTO public.trainer_orgs (id, owner_id, name, handle) VALUES (t.id('org445'), t.id('alice'), 'Org 445', 'org445');
-- files that existed before phase 2 (written by the old direct path or by the service role)
INSERT INTO storage.objects (bucket_id, name, owner) VALUES
  ('avatars', t.id('alice') || '/old.jpg', t.id('alice')),
  ('team-covers', 'tm445/old.jpg', t.id('alice')),
  ('org-covers', t.id('org445') || '/old.jpg', t.id('alice')),
  ('game-covers', t.id('alice') || '/old.jpg', t.id('alice'));

\ir ../phase2/g3b_phase2_close_direct_image_uploads.sql

SELECT t.as_user(t.id('alice'));
SELECT t.throws(format($q$INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('avatars', %L, auth.uid())$q$, t.id('alice') || '/new.jpg'), 'row-level security', 'an older client can no longer upload an avatar directly');
SELECT t.throws(format($q$INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('covers', %L, auth.uid())$q$, t.id('alice') || '/new.jpg'), 'row-level security', 'nor a cover');
SELECT t.throws(format($q$INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('team-avatars', %L, auth.uid())$q$, t.id('alice') || '/new.jpg'), 'row-level security', 'nor an entity image in their own folder');
SELECT t.throws($q$INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('team-covers', 'tm445/new.jpg', auth.uid())$q$, 'row-level security', 'nor a team image as the team owner');
SELECT t.throws(format($q$INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('org-covers', %L, auth.uid())$q$, t.id('org445') || '/new.jpg'), 'row-level security', 'nor an org image as the org admin');
SELECT t.throws(format($q$INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('game-covers', %L, auth.uid())$q$, t.id('alice') || '/new.jpg'), 'row-level security', 'nor a game cover');
SELECT t.eq(t.changed(format($q$UPDATE storage.objects SET metadata = '{"x":1}' WHERE bucket_id IN ('avatars','team-covers','org-covers','game-covers')$q$)), 0, 'and cannot overwrite a finalized image in place');
SELECT t.lives(format($q$INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('image-staging', %L, auth.uid())$q$, t.id('alice') || '/s.jpg'), 'the staging upload path still works');
SELECT t.eq(t.count($$SELECT 1 FROM storage.objects WHERE bucket_id IN ('avatars','team-covers','org-covers','game-covers')$$), 4, 'owners can still read back their own images');
SELECT t.as_user(t.id('bob'));
SELECT t.eq(t.changed($$DELETE FROM storage.objects WHERE bucket_id IN ('avatars','team-covers','org-covers','game-covers')$$), 0, 'another user cannot delete them');
SELECT t.as_user(t.id('alice'));
SELECT t.eq(t.changed($$DELETE FROM storage.objects WHERE bucket_id IN ('avatars','team-covers','org-covers','game-covers')$$), 4, 'the owner, team owner and org admin can still delete them');
SELECT t.as_anon();
SELECT t.throws($q$INSERT INTO storage.objects (bucket_id, name) VALUES ('avatars', 'x/y.jpg')$q$, 'row-level security', 'anonymous cannot upload');
SELECT t.reset();

SELECT t.as_service();
SELECT t.lives(format($q$INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('avatars', %L, %L)$q$, t.id('alice') || '/promoted.jpg', t.id('alice')), 'the server promotion path (service role) still writes public images');
SELECT t.reset();
SELECT t.eq((SELECT count(*)::int FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND cmd IN ('INSERT','UPDATE','ALL')
              AND coalesce(qual,'') || coalesce(with_check,'') ~ '''(avatars|covers|org-avatars|org-covers|trainer-avatars|team-avatars|team-covers|game-covers)'''), 0,
            'no browser write policy names an image bucket');
SELECT t.ok((SELECT count(*) FROM pg_policies WHERE schemaname='storage' AND policyname IN ('msg_attach_insert_sender','Players upload own payment proofs','Users upload own highlight videos','image_staging_insert_own_folder')) = 4,
            'unrelated upload paths (attachments, payment proofs, highlight videos, staging) are untouched');
ROLLBACK;
