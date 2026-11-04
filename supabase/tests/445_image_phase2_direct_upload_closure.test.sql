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
  ('game-covers', t.id('alice') || '/old.jpg', t.id('alice')),
  ('team-avatars', t.id('alice') || '/promoted-entity.jpg', t.id('alice'));  -- an entity image promoted into the uploader's own folder

-- before phase 2 the owner cannot delete an own-folder entity image (a DELETE policy, but no SELECT policy for Storage's RETURNING)
SELECT t.as_user(t.id('alice'));
SELECT t.eq(t.count($$SELECT 1 FROM storage.objects WHERE bucket_id = 'team-avatars' AND name LIKE '%/promoted-entity.jpg'$$), 0,
            'BEFORE phase 2: the owner cannot see their own-folder entity image (the gap phase 2 closes)');
SELECT t.reset();

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
SELECT t.eq(t.count($$SELECT 1 FROM storage.objects WHERE bucket_id = 'team-avatars' AND name LIKE '%/promoted-entity.jpg'$$), 1,
            'and an entity image promoted into their own folder (org/team/trainer buckets)');
SELECT t.eq(t.changed($$UPDATE storage.objects SET metadata = '{"x":1}' WHERE bucket_id = 'team-avatars'$$), 0, 'which they still cannot overwrite in place');
SELECT t.as_user(t.id('bob'));
SELECT t.eq(t.count($$SELECT 1 FROM storage.objects WHERE bucket_id = 'team-avatars'$$), 0, 'another user cannot list it');
SELECT t.eq(t.changed($$DELETE FROM storage.objects WHERE bucket_id IN ('avatars','team-covers','org-covers','game-covers','team-avatars')$$), 0, 'another user cannot delete them');
SELECT t.as_user(t.id('alice'));
SELECT t.eq(t.changed($$DELETE FROM storage.objects WHERE bucket_id IN ('avatars','team-covers','org-covers','game-covers')$$), 4, 'the owner, team owner and org admin can still delete them');
SELECT t.eq(t.changed($$DELETE FROM storage.objects WHERE bucket_id = 'team-avatars' AND name LIKE '%/promoted-entity.jpg'$$), 1, 'and the owner can delete their own-folder entity image');
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

-- ---- the allow-list postcondition (step 3), and negative controls: each injected policy below must make it fail
SELECT t.eq(pg_temp.g3b_phase2_open_write_policies(), NULL::text, 'after phase 2 every browser write policy is pinned to an allowed non-image bucket');
SELECT t.lives('SELECT pg_temp.g3b_phase2_assert_closed()', 'and the postcondition passes');
-- a group role that authenticated (or anon, through another group) inherits from: a policy granted to it applies to API requests
CREATE ROLE g445_writers NOLOGIN;
CREATE ROLE g445_outer NOLOGIN;
CREATE ROLE g445_inner NOLOGIN;
GRANT g445_writers TO authenticated;
GRANT g445_outer TO g445_inner;
GRANT g445_inner TO anon;
CREATE ROLE g445_unrelated NOLOGIN;
CREATE TEMP TABLE nc445 (label text, ddl text);
INSERT INTO nc445 VALUES
  ('an INSERT policy with no bucket at all', $$CREATE POLICY "nc" ON storage.objects FOR INSERT TO authenticated WITH CHECK (owner = auth.uid())$$),
  ('an INSERT policy for anon naming an image bucket', $$CREATE POLICY "nc" ON storage.objects FOR INSERT TO anon WITH CHECK (bucket_id = 'game-covers')$$),
  ('an allowed bucket OR-ed with another', $$CREATE POLICY "nc" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'payment-proofs' OR bucket_id = 'avatars')$$),
  ('an allowed bucket in an IN list with an image bucket', $$CREATE POLICY "nc" ON storage.objects FOR ALL TO public USING (bucket_id IN ('payment-proofs', 'covers'))$$),
  ('an UPDATE whose WITH CHECK escapes the bucket', $$CREATE POLICY "nc" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'payment-proofs') WITH CHECK (true)$$),
  ('an UPDATE with no USING', $$CREATE POLICY "nc" ON storage.objects FOR UPDATE TO authenticated WITH CHECK (bucket_id = 'payment-proofs')$$),
  ('an AND whose first operand is not the bucket', $$CREATE POLICY "nc" ON storage.objects FOR INSERT TO authenticated WITH CHECK (owner = auth.uid() AND bucket_id = 'avatars')$$),
  ('an unknown non-image bucket', $$CREATE POLICY "nc" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'some-new-bucket')$$),
  ('a top-level OR hidden behind an AND', $$CREATE POLICY "nc" ON storage.objects FOR INSERT TO authenticated WITH CHECK ((bucket_id = 'payment-proofs' AND true) OR bucket_id = 'avatars')$$),
  ('L2: a policy granted to a group role authenticated is a member of', $$CREATE POLICY "nc" ON storage.objects FOR INSERT TO g445_writers WITH CHECK (bucket_id = 'avatars')$$),
  ('L2: a policy granted to a role anon inherits through another role', $$CREATE POLICY "nc" ON storage.objects FOR ALL TO g445_outer USING (true)$$);
DO $nc$
DECLARE r record; _caught boolean;
BEGIN
  FOR r IN SELECT * FROM nc445 LOOP
    BEGIN
      EXECUTE r.ddl;
      _caught := false;
      BEGIN
        PERFORM pg_temp.g3b_phase2_assert_closed();
      EXCEPTION WHEN OTHERS THEN
        _caught := SQLERRM LIKE '%write policies still open%"nc"%' OR SQLERRM LIKE '%write policies still open%nc (%';
      END;
      RAISE EXCEPTION 'rollback %', _caught;  -- undo the injected policy
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM = 'rollback t' THEN RAISE NOTICE 'ok - NEGATIVE CONTROL: the postcondition fails on %', r.label;
      ELSE RAISE NOTICE 'not ok - NEGATIVE CONTROL: the postcondition missed % (%)', r.label, SQLERRM; END IF;
    END;
  END LOOP;
END
$nc$;
-- and it does not trip on what is fine
CREATE POLICY "ok restrictive" ON storage.objects AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "ok service" ON storage.objects FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "ok pinned" ON storage.objects FOR UPDATE TO authenticated USING ((bucket_id = 'highlight-videos') AND (owner = auth.uid()) AND (name LIKE 'x%' OR name LIKE 'y%'));
CREATE POLICY "ok unrelated role" ON storage.objects FOR INSERT TO g445_unrelated WITH CHECK (true);
SELECT t.eq(pg_temp.g3b_phase2_open_write_policies(), NULL::text, 'restrictive, service-role-only, bucket-pinned policies and roles no API role inherits pass the postcondition');
CREATE POLICY "nc group" ON storage.objects FOR INSERT TO g445_writers WITH CHECK (bucket_id = 'covers');
SELECT t.eq(pg_temp.g3b_phase2_open_write_policies(), 'nc group (INSERT)', 'L2: a write policy for a group role authenticated inherits is reported by name');
ROLLBACK;
