-- SEC-6: flagged originals live in a private, service-only quarantine; reviewers reach them only through an audited, single-use
-- grant; evidence cannot be changed or removed while it is held; and no user token can write over a published image.
BEGIN;
-- Supabase gives the API roles every privilege on storage.objects and leaves the rest to RLS; the stub does not. Mirror it (rolled back).
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO anon, authenticated, service_role;
SELECT t.person('alice', 30), t.person('bob', 31), t.person('rev', 40), t.person('mod', 41);
INSERT INTO public.user_roles (user_id, role) VALUES (t.id('rev'), 'superadmin'), (t.id('mod'), 'moderator');

-- Storage's privileged write (service role, the signer stamped as owner), as in tests 212 and 440.
CREATE FUNCTION pg_temp.storage_put(_bucket text, _path text, _owner uuid, _version text) RETURNS void LANGUAGE sql AS $f$
  INSERT INTO storage.objects (bucket_id, name, owner, owner_id, version, metadata)
  VALUES (_bucket, _path, _owner, _owner::text, _version, '{"size": 2}')
  ON CONFLICT (bucket_id, name) DO UPDATE
    SET version = EXCLUDED.version, owner = EXCLUDED.owner, owner_id = EXCLUDED.owner_id, metadata = EXCLUDED.metadata
$f$;
GRANT EXECUTE ON FUNCTION pg_temp.storage_put(text, text, uuid, text) TO PUBLIC;

-- ---- the bucket
SELECT t.ok((SELECT NOT public FROM storage.buckets WHERE id = 'image-quarantine'),
            'the quarantine bucket exists and is PRIVATE (Storage serves no public URL for it)');
SELECT t.eq((SELECT allowed_mime_types FROM storage.buckets WHERE id = 'image-quarantine'), ARRAY['image/jpeg', 'image/png', 'image/webp'],
            'and holds pictures only');
SELECT t.eq((SELECT count(*)::int FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND permissive = 'PERMISSIVE'
              AND coalesce(qual, '') || coalesce(with_check, '') LIKE '%image-quarantine%'), 0,
            'no permissive policy names the quarantine bucket');

-- the server quarantines an original (service key: no end-user owner)
SELECT t.as_service();
SELECT t.lives($q$SELECT pg_temp.storage_put('image-quarantine', 'image_upload/q1.jpg', NULL, 'v1')$q$,
               'the service key can write a quarantined original');
SELECT t.lives(format($q$INSERT INTO public.image_quarantine_items (object_path, source, source_bucket, source_path, uploader_id, mime, bytes, sha256, categories, suspected_csam, reason)
  VALUES ('image_upload/q1.jpg', 'image_upload', 'image-staging', %L, %L, 'image/jpeg', 1234, repeat('a', 64), ARRAY['csam'], true, 'flagged')$q$,
  t.id('alice') || '/s1.jpg', t.id('alice')), 'and record it');
SELECT t.lives($q$SELECT pg_temp.storage_put('image-quarantine', 'message_attachment/q2.png', NULL, 'v1')$q$, 'a second, non-CSAM item');
SELECT t.lives(format($q$INSERT INTO public.image_quarantine_items (object_path, source, source_bucket, source_path, uploader_id, mime, bytes, sha256, categories, suspected_csam, reason, retain_until, status, legal_hold)
  VALUES ('message_attachment/q2.png', 'message_attachment', 'message-attachments', 'c/u/x.png', %L, 'image/png', 99, repeat('b', 64), ARRAY['violence'], false, 'flagged', now() - interval '1 day', 'reported', false)$q$,
  t.id('bob')), 'recorded with a past retention date and a forged status');
SELECT t.reset();
SELECT t.eq((SELECT row(status, legal_hold, retain_until IS NULL)::text FROM public.image_quarantine_items WHERE object_path = 'image_upload/q1.jpg'),
            row('held', true, true)::text, 'suspected CSAM is always held, under legal hold, with no end date');
SELECT t.eq((SELECT row(status, legal_hold, retain_until > now() + interval '89 days')::text FROM public.image_quarantine_items WHERE object_path = 'message_attachment/q2.png'),
            row('held', false, true)::text, 'anything else is held for at least 90 days whatever the writer asked for');

-- ---- nobody but the server can see, list, write, move or delete
SELECT t.as_user(t.id('alice'));
SELECT t.eq(t.count($$SELECT 1 FROM storage.objects WHERE bucket_id = 'image-quarantine'$$), 0, 'the uploader cannot see their quarantined original');
SELECT t.throws(format($q$INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('image-quarantine', %L, auth.uid())$q$, t.id('alice') || '/x.jpg'),
                'QUARANTINE_FINAL', 'nor write to the quarantine');
SELECT t.eq(t.changed($$DELETE FROM storage.objects WHERE bucket_id = 'image-quarantine'$$), 0, 'nor delete from it');
SELECT t.eq(t.changed($$UPDATE storage.objects SET name = 'x' WHERE bucket_id = 'image-quarantine'$$), 0, 'nor rename in it');
SELECT t.eq(t.count($$SELECT 1 FROM public.image_quarantine_items$$), 0, 'nor read the quarantine records');
SELECT t.as_user(t.id('mod'));
SELECT t.eq(t.count($$SELECT 1 FROM storage.objects WHERE bucket_id = 'image-quarantine'$$), 0, 'a moderator (not a safety reviewer) sees no object');
SELECT t.eq(t.count($$SELECT 1 FROM public.image_quarantine_items$$), 0, 'nor any record');
SELECT t.as_user(t.id('rev'));
SELECT t.eq(t.count($$SELECT 1 FROM storage.objects WHERE bucket_id = 'image-quarantine'$$), 0,
            'even a superadmin cannot read or list the objects through the API (only through a minted, audited URL)');
SELECT t.eq(t.count($$SELECT 1 FROM public.image_quarantine_items$$), 2, 'a superadmin reads the records (metadata only)');
SELECT t.eq(t.changed($$UPDATE public.image_quarantine_items SET legal_hold = false$$), 0, 'but cannot change them directly');
SELECT t.as_anon();
SELECT t.eq(t.count($$SELECT 1 FROM storage.objects WHERE bucket_id = 'image-quarantine'$$), 0, 'anonymous sees nothing');
SELECT t.eq(t.count($$SELECT 1 FROM public.image_quarantine_items$$), 0, 'nor any record');
SELECT t.throws($q$INSERT INTO storage.objects (bucket_id, name) VALUES ('image-quarantine', 'a/b.jpg')$q$, 'QUARANTINE_FINAL', 'nor writes');
SELECT t.reset();
-- two independent layers: with the trigger off, row-level security alone still refuses API writes
ALTER TABLE storage.objects DISABLE TRIGGER image_quarantine_guard;
SELECT t.as_user(t.id('alice'));
SELECT t.throws(format($q$INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('image-quarantine', %L, auth.uid())$q$, t.id('alice') || '/x.jpg'),
                'row-level security', 'layer 2: without the trigger, row-level security alone refuses a user write');
SELECT t.as_anon();
SELECT t.throws($q$INSERT INTO storage.objects (bucket_id, name) VALUES ('image-quarantine', 'a/b.jpg')$q$, 'row-level security',
                'and an anonymous write');
SELECT t.reset();
ALTER TABLE storage.objects ENABLE TRIGGER image_quarantine_guard;

-- defence in depth: a later broad permissive policy does not open the quarantine
CREATE POLICY "t520 broad read" ON storage.objects FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "t520 broad write" ON storage.objects FOR ALL TO authenticated USING (true) WITH CHECK (true);
SELECT t.as_anon();
SELECT t.eq(t.count($$SELECT 1 FROM storage.objects WHERE bucket_id = 'image-quarantine'$$), 0,
            'a broad public-read policy still exposes nothing in the quarantine (the RESTRICTIVE policy holds)');
SELECT t.as_user(t.id('alice'));
SELECT t.eq(t.count($$SELECT 1 FROM storage.objects WHERE bucket_id = 'image-quarantine'$$), 0, 'nor to a signed-in user');
SELECT t.eq(t.changed($$DELETE FROM storage.objects WHERE bucket_id = 'image-quarantine'$$), 0, 'and a broad DELETE removes nothing');
SELECT t.reset();
DROP POLICY "t520 broad read" ON storage.objects;
DROP POLICY "t520 broad write" ON storage.objects;

-- ---- Storage's own writes for a user's signed upload URL are refused (H1 pattern)
SELECT t.as_service();
SELECT t.throws(format($q$SELECT pg_temp.storage_put('image-quarantine', 'image_upload/q1.jpg', %L, 'v2')$q$, t.id('alice')),
                'QUARANTINE_FINAL', 'a signed-URL upsert cannot overwrite a quarantined original');
SELECT t.throws(format($q$SELECT pg_temp.storage_put('image-quarantine', 'planted.jpg', %L, 'v1')$q$, t.id('alice')),
                'QUARANTINE_FINAL', 'nor plant a file in the quarantine');
SELECT t.throws($q$SELECT pg_temp.storage_put('image-quarantine', 'image_upload/q1.jpg', NULL, 'v2')$q$,
                'QUARANTINE_FINAL', 'even the service key cannot replace the bytes of a quarantined original');
SELECT t.throws($q$UPDATE storage.objects SET name = 'moved.jpg' WHERE bucket_id = 'image-quarantine' AND name = 'image_upload/q1.jpg'$q$,
                'QUARANTINE_FINAL', 'nor move it');
SELECT t.throws($q$UPDATE storage.objects SET bucket_id = 'avatars' WHERE bucket_id = 'image-quarantine' AND name = 'image_upload/q1.jpg'$q$,
                'QUARANTINE_FINAL', 'nor move it into a public bucket');
SELECT t.lives($q$UPDATE storage.objects SET metadata = '{"size": 3}' WHERE bucket_id = 'image-quarantine' AND name = 'image_upload/q1.jpg'$q$,
               'bookkeeping on the same object stays possible for the service key');
SELECT t.throws($q$DELETE FROM storage.objects WHERE bucket_id = 'image-quarantine' AND name = 'image_upload/q1.jpg'$q$,
                'QUARANTINE_HOLD', 'the service role cannot delete an original under legal hold');
SELECT t.throws($q$DELETE FROM storage.objects WHERE bucket_id = 'image-quarantine' AND name = 'message_attachment/q2.png'$q$,
                'QUARANTINE_HOLD', 'nor one inside its retention period');
SELECT t.throws($q$DELETE FROM public.image_quarantine_items$q$, 'QUARANTINE_RECORD_FINAL', 'nor delete a record');
SELECT t.throws($q$UPDATE public.image_quarantine_items SET sha256 = repeat('c', 64)$q$, 'QUARANTINE_RECORD_FINAL', 'nor change what a record points at');
SELECT t.throws($q$UPDATE public.image_quarantine_items SET suspected_csam = false WHERE object_path = 'image_upload/q1.jpg'$q$,
                'QUARANTINE_RECORD_FINAL', 'nor downgrade suspected CSAM');
SELECT t.throws($q$UPDATE public.image_quarantine_items SET legal_hold = false WHERE object_path = 'image_upload/q1.jpg'$q$,
                'image_quarantine_csam_held', 'nor lift the hold on suspected CSAM that was never reported');
SELECT t.reset();
SELECT t.throws($q$DELETE FROM storage.objects WHERE bucket_id = 'image-quarantine' AND name = 'image_upload/q1.jpg'$q$,
                'QUARANTINE_HOLD', 'a superuser (SQL console) is refused too while the hold stands');
SELECT t.as_service();
SELECT t.lives($q$SELECT pg_temp.storage_put('image-quarantine', 'orphan.jpg', NULL, 'v1')$q$, 'an object whose record was never written');
SELECT t.throws($q$DELETE FROM storage.objects WHERE bucket_id = 'image-quarantine' AND name = 'orphan.jpg'$q$,
                'QUARANTINE_HOLD', 'is kept for manual reconciliation, not deleted');
SELECT t.reset();

-- ---- audited, single-use reviewer access
CREATE TEMP TABLE g520(k text PRIMARY KEY, v uuid); GRANT ALL ON g520 TO PUBLIC;
CREATE TEMP TABLE r520(path text, ttl int); GRANT ALL ON r520 TO PUBLIC;
SELECT t.ok(NOT has_function_privilege('anon', 'public.request_quarantine_review(uuid, text)', 'EXECUTE'), 'anonymous cannot request a review');
SELECT t.ok(NOT has_function_privilege('authenticated', 'public.consume_quarantine_review(uuid)', 'EXECUTE'),
            'no API user can mint the URL step (service role only)');
SELECT t.ok(NOT has_function_privilege('anon', 'public.consume_quarantine_review(uuid)', 'EXECUTE'), 'nor anonymous');
SELECT t.as_user(t.id('alice'));
SELECT t.throws(format($q$SELECT public.request_quarantine_review(%L, 'I want to see my upload again')$q$,
                (SELECT id FROM public.image_quarantine_items WHERE object_path = 'image_upload/q1.jpg')),
                'QUARANTINE_FORBIDDEN', 'the uploader cannot request their quarantined original');
SELECT t.as_user(t.id('mod'));
SELECT t.throws(format($q$SELECT public.request_quarantine_review(%L, 'moderation queue review')$q$,
                (SELECT id FROM public.image_quarantine_items WHERE object_path = 'image_upload/q1.jpg')),
                'QUARANTINE_FORBIDDEN', 'nor can a moderator who is not a safety reviewer');
SELECT t.reset();
INSERT INTO g520 VALUES ('q1', (SELECT id FROM public.image_quarantine_items WHERE object_path = 'image_upload/q1.jpg')),
                        ('q2', (SELECT id FROM public.image_quarantine_items WHERE object_path = 'message_attachment/q2.png'));
SELECT t.as_user(t.id('rev'));
SELECT t.throws(format($q$SELECT public.request_quarantine_review(%L, 'look')$q$, (SELECT v FROM g520 WHERE k = 'q1')),
                'QUARANTINE_REASON_REQUIRED', 'a reviewer must give a reason');
SELECT t.throws(format($q$SELECT public.request_quarantine_review(%L, 'confirming the classifier verdict')$q$, gen_random_uuid()),
                'QUARANTINE_NOT_FOUND', 'an unknown item is refused');
INSERT INTO g520 SELECT 'grant', public.request_quarantine_review((SELECT v FROM g520 WHERE k = 'q1'), 'confirming the classifier verdict before reporting');
SELECT t.reset();
SELECT t.eq((SELECT row(actor_id, action, consumed_at IS NULL, grant_expires_at <= now() + interval '2 minutes')::text
               FROM public.image_quarantine_access_log WHERE id = (SELECT v FROM g520 WHERE k = 'grant')),
            row(t.id('rev'), 'view_requested', true, true)::text, 'the request is audited with the reviewer, the reason and a two-minute expiry');
SELECT t.as_service();
INSERT INTO r520 SELECT * FROM public.consume_quarantine_review((SELECT v FROM g520 WHERE k = 'grant'));
SELECT t.eq((SELECT row(path, ttl)::text FROM r520), row('image_upload/q1.jpg', 60)::text,
            'the server exchanges the grant for the object path and a 60-second URL lifetime');
SELECT t.throws(format($q$SELECT * FROM public.consume_quarantine_review(%L)$q$, (SELECT v FROM g520 WHERE k = 'grant')),
                'QUARANTINE_GRANT_INVALID', 'a grant works once');
SELECT t.reset();
SELECT t.ok((SELECT consumed_at IS NOT NULL FROM public.image_quarantine_access_log WHERE id = (SELECT v FROM g520 WHERE k = 'grant')),
            'and its use is stamped in the audit');
-- an expired grant
INSERT INTO public.image_quarantine_access_log (item_id, actor_id, action, reason, grant_expires_at)
VALUES ((SELECT v FROM g520 WHERE k = 'q1'), t.id('rev'), 'view_requested', 'expired grant', now() - interval '1 second')
RETURNING id \gset expired_
SELECT t.as_service();
SELECT t.throws(format($q$SELECT * FROM public.consume_quarantine_review(%L)$q$, :'expired_id'), 'QUARANTINE_GRANT_INVALID', 'an expired grant is refused');
SELECT t.reset();
-- a reviewer who lost the role between request and mint
INSERT INTO public.image_quarantine_access_log (item_id, actor_id, action, reason, grant_expires_at)
VALUES ((SELECT v FROM g520 WHERE k = 'q1'), t.id('mod'), 'view_requested', 'not a reviewer', now() + interval '1 minute')
RETURNING id \gset demoted_
SELECT t.as_service();
SELECT t.throws(format($q$SELECT * FROM public.consume_quarantine_review(%L)$q$, :'demoted_id'), 'QUARANTINE_FORBIDDEN',
                'a grant held by someone who is no longer a safety reviewer is refused');
SELECT t.throws($q$DELETE FROM public.image_quarantine_access_log$q$, 'QUARANTINE_AUDIT_FINAL', 'the audit cannot be deleted, even by the service role');
SELECT t.throws($q$UPDATE public.image_quarantine_access_log SET reason = 'edited'$q$, 'QUARANTINE_AUDIT_FINAL', 'nor edited');
SELECT t.reset();
SELECT t.as_user(t.id('rev'));
SELECT t.eq(t.changed($$DELETE FROM public.image_quarantine_access_log$$), 0, 'a superadmin cannot delete the audit through the API');
SELECT t.reset();

-- ---- reviewer decisions and retention
SELECT t.as_user(t.id('rev'));
SELECT t.throws(format($q$SELECT public.update_quarantine_item(%L, 'release_hold', 'classifier looks wrong to me')$q$, (SELECT v FROM g520 WHERE k = 'q1')),
                'QUARANTINE_HOLD_REQUIRED', 'suspected CSAM cannot leave legal hold before it is reported');
SELECT t.throws(format($q$SELECT public.update_quarantine_item(%L, 'clear', 'classifier looks wrong to me')$q$, (SELECT v FROM g520 WHERE k = 'q1')),
                'QUARANTINE_HOLD_REQUIRED', 'nor can one reviewer clear it');
SELECT t.throws(format($q$SELECT public.update_quarantine_item(%L, 'mark_reported', 'reported to the CyberTipline')$q$, (SELECT v FROM g520 WHERE k = 'q1')),
                'QUARANTINE_REFERENCE_REQUIRED', 'a report needs its reference');
SELECT t.lives(format($q$SELECT public.update_quarantine_item(%L, 'mark_reported', 'reported to the CyberTipline', 'CT-123456')$q$, (SELECT v FROM g520 WHERE k = 'q1')),
               'a reviewer records the report');
SELECT t.reset();
SELECT t.eq((SELECT row(status, legal_hold, report_reference, retain_until >= now() + interval '1 year' - interval '1 minute')::text
               FROM public.image_quarantine_items WHERE id = (SELECT v FROM g520 WHERE k = 'q1')),
            row('reported', true, 'CT-123456', true)::text, 'reported: still under hold, preserved at least one year');
SELECT t.eq((SELECT count(*)::int FROM public.image_quarantine_access_log WHERE item_id = (SELECT v FROM g520 WHERE k = 'q1') AND action = 'mark_reported'), 1,
            'and the decision is audited');
SELECT t.as_user(t.id('mod'));
SELECT t.throws(format($q$SELECT public.update_quarantine_item(%L, 'place_hold', 'moderator wants a hold')$q$, (SELECT v FROM g520 WHERE k = 'q2')),
                'QUARANTINE_FORBIDDEN', 'a moderator cannot decide');
SELECT t.as_user(t.id('rev'));
SELECT t.lives(format($q$SELECT public.update_quarantine_item(%L, 'clear', 'false positive: a sports injury photo')$q$, (SELECT v FROM g520 WHERE k = 'q2')),
               'a non-CSAM false positive can be cleared');
SELECT t.reset();
SELECT t.ok((SELECT retain_until <= now() + interval '30 days' FROM public.image_quarantine_items WHERE id = (SELECT v FROM g520 WHERE k = 'q2')),
            'a cleared item is kept at most 30 more days');
-- retention elapsed, no hold: the server may destroy it, and only then
UPDATE public.image_quarantine_items SET retain_until = now() - interval '1 minute' WHERE id = (SELECT v FROM g520 WHERE k = 'q2');
SELECT t.as_user(t.id('alice'));
SELECT t.eq(t.changed($$DELETE FROM storage.objects WHERE bucket_id = 'image-quarantine'$$), 0, 'an API user still cannot delete an expired item');
SELECT t.as_service();
SELECT t.throws($q$SELECT pg_temp.storage_put('image-quarantine', 'message_attachment/q2.png', NULL, 'v9')$q$, 'QUARANTINE_FINAL',
                'nor can anyone replace it before destruction');
SELECT t.eq(t.changed($$DELETE FROM storage.objects WHERE bucket_id = 'image-quarantine' AND name = 'message_attachment/q2.png'$$), 1,
            'the service role destroys an item past retention with no hold');
SELECT t.lives(format($q$UPDATE public.image_quarantine_items SET status = 'destroyed', destroyed_at = now() WHERE id = %L$q$, (SELECT v FROM g520 WHERE k = 'q2')),
               'and records the destruction');
SELECT t.throws(format($q$UPDATE public.image_quarantine_items SET status = 'held' WHERE id = %L$q$, (SELECT v FROM g520 WHERE k = 'q2')),
                'QUARANTINE_RECORD_FINAL', 'a destroyed record is final');
SELECT t.reset();
SELECT t.as_user(t.id('rev'));
SELECT t.throws(format($q$SELECT public.request_quarantine_review(%L, 'confirming the classifier verdict')$q$, (SELECT v FROM g520 WHERE k = 'q2')),
                'QUARANTINE_NOT_FOUND', 'a destroyed item cannot be reviewed');
SELECT t.reset();

-- ---- requirement 6: no user token can write over a published (or reviewed) image
INSERT INTO storage.objects (bucket_id, name, owner, version) VALUES
  ('avatars', t.id('alice') || '/pub.jpg', NULL, 'v1'),        -- published by the server (service key)
  ('covers', t.id('alice') || '/held.jpg', NULL, 'v1'),
  ('avatars', t.id('alice') || '/legacy.jpg', t.id('alice'), 'v1'); -- an older client's direct upload, not yet finalized
INSERT INTO public.image_moderation (bucket, path, owner_id, status) VALUES
  ('avatars', t.id('alice') || '/pub.jpg', t.id('alice'), 'pending'),
  ('covers', t.id('alice') || '/held.jpg', t.id('alice'), 'quarantined'),
  ('game-covers', t.id('alice') || '/gone.jpg', t.id('alice'), 'removed');
SELECT t.as_service();
SELECT t.throws(format($q$SELECT pg_temp.storage_put('avatars', %L, %L, 'v2')$q$, t.id('alice') || '/pub.jpg', t.id('alice')),
                'PUBLISHED_IMAGE_FINAL', 'a signed-URL upsert cannot replace a PUBLISHED image');
SELECT t.throws(format($q$SELECT pg_temp.storage_put('covers', %L, %L, 'v2')$q$, t.id('alice') || '/held.jpg', t.id('alice')),
                'PUBLISHED_IMAGE_FINAL', 'nor a quarantined one');
SELECT t.throws(format($q$SELECT pg_temp.storage_put('game-covers', %L, %L, 'v1')$q$, t.id('alice') || '/gone.jpg', t.id('alice')),
                'PUBLISHED_IMAGE_FINAL', 'nor refill the path of one the server removed (private game-covers included)');
SELECT t.lives(format($q$SELECT pg_temp.storage_put('avatars', %L, NULL, 'v3')$q$, t.id('alice') || '/pub.jpg'),
               'the server (service key) still publishes and re-publishes');
SELECT t.reset();
SELECT t.as_user(t.id('alice'));
SELECT t.throws(format($q$UPDATE storage.objects SET metadata = '{"x":1}', version = 'v9' WHERE bucket_id = 'avatars' AND name = %L$q$, t.id('alice') || '/pub.jpg'),
                'PUBLISHED_IMAGE_FINAL', 'the owner cannot overwrite a published image through the legacy own-folder policy');
SELECT t.throws(format($q$UPDATE storage.objects SET name = %L WHERE bucket_id = 'avatars' AND name = %L$q$, t.id('alice') || '/renamed.jpg', t.id('alice') || '/pub.jpg'),
                'PUBLISHED_IMAGE_FINAL', 'nor move it');
SELECT t.throws(format($q$UPDATE storage.objects SET name = %L WHERE bucket_id = 'avatars' AND name = %L$q$, t.id('alice') || '/pub.jpg', t.id('alice') || '/legacy.jpg'),
                'PUBLISHED_IMAGE_FINAL', 'nor move another file onto a published path');
SELECT t.eq(t.changed(format($q$DELETE FROM storage.objects WHERE bucket_id = 'avatars' AND name = %L$q$, t.id('alice') || '/pub.jpg')), 1,
            'the owner can still delete their own published avatar');
SELECT t.throws(format($q$INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('avatars', %L, auth.uid())$q$, t.id('alice') || '/pub.jpg'),
                'PUBLISHED_IMAGE_FINAL', 'and cannot put other bytes back at that path');
SELECT t.lives(format($q$INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('avatars', %L, auth.uid())$q$, t.id('alice') || '/new-legacy.jpg'),
               'LEGACY (until phase 2): an older client can still upload a NEW file in its own folder');
SELECT t.lives(format($q$UPDATE storage.objects SET metadata = '{"x":1}' WHERE bucket_id = 'avatars' AND name = %L$q$, t.id('alice') || '/legacy.jpg'),
               'LEGACY (until phase 2): and change its own unprocessed file, which the server has never published');
SELECT t.reset();
SELECT t.as_service();
SELECT t.lives(format($q$SELECT pg_temp.storage_put('avatars', %L, %L, 'v1')$q$, t.id('bob') || '/fresh.jpg', t.id('bob')),
               'a signed-URL upload to a fresh path is unaffected (an insert, no conflict)');
SELECT t.reset();

-- ---- final review 780eaf8f, finding 3: the server's rewrite of an object the uploader created
-- An older client's direct upload (alice is the row's owner); the server's legacy finalize claims the path first.
INSERT INTO storage.objects (bucket_id, name, owner, owner_id, version) VALUES
  ('avatars', t.id('alice') || '/legacy-2.jpg', t.id('alice'), t.id('alice')::text, 'v1');
INSERT INTO public.image_moderation (bucket, path, owner_id, status, reason) VALUES
  ('avatars', t.id('alice') || '/legacy-2.jpg', t.id('alice'), 'pending', 'Processing');
SELECT t.as_service();
SELECT t.throws(format($q$INSERT INTO storage.objects (bucket_id, name, version, metadata) VALUES ('avatars', %L, 'v2', '{"size": 3}')
                          ON CONFLICT (bucket_id, name) DO UPDATE SET version = EXCLUDED.version, metadata = EXCLUDED.metadata$q$,
                       t.id('alice') || '/legacy-2.jpg'),
                'PUBLISHED_IMAGE_FINAL',
                'an UPSERT by the service role that does not set the owner columns is refused over a user-owned row (the row keeps the user as owner)');
SELECT t.eq(t.changed(format($q$DELETE FROM storage.objects WHERE bucket_id = 'avatars' AND name = %L$q$, t.id('alice') || '/legacy-2.jpg')), 1,
            'the server removes the user-owned object');
SELECT t.reset();
SELECT t.as_user(t.id('alice'));
SELECT t.throws(format($q$INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('avatars', %L, auth.uid())$q$, t.id('alice') || '/legacy-2.jpg'),
                'PUBLISHED_IMAGE_FINAL', 'the uploader cannot slip new bytes in between (the path is claimed)');
SELECT t.reset();
SELECT t.as_service();
SELECT t.throws(format($q$SELECT pg_temp.storage_put('avatars', %L, %L, 'v1')$q$, t.id('alice') || '/legacy-2.jpg', t.id('alice')),
                'PUBLISHED_IMAGE_FINAL', 'nor through a signed upload URL');
SELECT t.lives(format($q$INSERT INTO storage.objects (bucket_id, name, version, metadata) VALUES ('avatars', %L, 'v2', '{"size": 3}')$q$,
                      t.id('alice') || '/legacy-2.jpg'),
               'and the service role inserts the re-encoded bytes fresh (delete, then insert)');
SELECT t.reset();
SELECT t.ok((SELECT owner IS NULL AND owner_id IS NULL FROM storage.objects WHERE bucket_id = 'avatars' AND name = t.id('alice') || '/legacy-2.jpg'),
            'the published row has no end-user owner');
SELECT t.as_anon();
SELECT t.throws(format($q$INSERT INTO storage.objects (bucket_id, name) VALUES ('avatars', %L)$q$, t.id('alice') || '/anon.jpg'),
                'row-level security', 'anonymous writes stay refused by row-level security');
SELECT t.reset();
SELECT t.ok((SELECT tgenabled <> 'D' FROM pg_trigger WHERE tgname = 'published_image_refuse_user_write' AND tgrelid = 'storage.objects'::regclass),
            'the published-image trigger is installed on storage.objects');
SELECT t.ok((SELECT tgenabled <> 'D' FROM pg_trigger WHERE tgname = 'image_quarantine_guard' AND tgrelid = 'storage.objects'::regclass),
            'and so is the quarantine guard');
SELECT t.ok(NOT has_function_privilege('anon', 'private_sec.image_path_processed(text, text)', 'EXECUTE'), 'anonymous cannot call the processed-path helper');

-- ---- final review 780eaf8f, finding 5a: a flagged staging path cannot be refilled
-- alice's staged upload was flagged; its original went to the quarantine and the staged copy was removed (only the row is left).
INSERT INTO public.image_moderation (bucket, path, owner_id, status, reason) VALUES
  ('image-staging', t.id('alice') || '/flagged.jpg', t.id('alice'), 'quarantined', 'flagged');
SELECT t.as_user(t.id('alice'));
SELECT t.throws(format($q$INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('image-staging', %L, auth.uid())$q$, t.id('alice') || '/flagged.jpg'),
                'STAGED_IMAGE_FLAGGED', 'the uploader cannot put new bytes at a flagged staging path');
SELECT t.lives(format($q$INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('image-staging', %L, auth.uid())$q$, t.id('alice') || '/next.jpg'),
               'a new staged upload in their own folder still works');
SELECT t.reset();
SELECT t.as_service();
SELECT t.throws(format($q$SELECT pg_temp.storage_put('image-staging', %L, %L, 'v1')$q$, t.id('alice') || '/flagged.jpg', t.id('alice')),
                'STAGED_IMAGE_FLAGGED', 'nor through a signed upload URL (Storage writes as the service role with alice as owner)');
SELECT t.lives($q$SELECT pg_temp.storage_put('image-staging', '_held/legacy_direct_upload/h1.jpg', NULL, 'v1')$q$,
               'the service key still writes its own private paths (the held fallback)');
SELECT t.reset();
-- two layers: with the trigger off, the RESTRICTIVE policy alone refuses the API write
ALTER TABLE storage.objects DISABLE TRIGGER image_staging_refuse_flagged_insert;
SELECT t.as_user(t.id('alice'));
SELECT t.throws(format($q$INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('image-staging', %L, auth.uid())$q$, t.id('alice') || '/flagged.jpg'),
                'row-level security', 'layer 2: without the trigger, row-level security alone refuses the refill');
SELECT t.reset();
ALTER TABLE storage.objects ENABLE TRIGGER image_staging_refuse_flagged_insert;
SELECT t.ok(EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
                     AND policyname = 'image_staging_no_insert_flagged' AND permissive = 'RESTRICTIVE' AND cmd = 'INSERT'),
            'the refill policy is RESTRICTIVE, for INSERT');
SELECT t.ok(NOT has_function_privilege('authenticated', 'private_sec.image_quarantine_deletable(text)', 'EXECUTE'),
            'API users cannot call the deletable helper');
ROLLBACK;
