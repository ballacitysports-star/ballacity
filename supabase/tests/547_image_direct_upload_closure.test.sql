-- F06: a brand-new path in a public image bucket bypassed processing (no image_moderation row, legacy browser policy).
-- With the release switch closed every user-attributed write into public image buckets is refused, including the write
-- Storage performs for a signed upload URL minted earlier; only the server's promotion (no end-user owner) remains.
BEGIN;
-- Supabase gives the API roles and its Storage role every privilege on storage.objects and leaves the rest to RLS and
-- triggers; the stub does not. Mirror it (rolled back with the test).
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO anon, authenticated, service_role, supabase_storage_admin;
GRANT USAGE ON SCHEMA storage TO supabase_storage_admin;
GRANT USAGE ON SCHEMA private_sec TO supabase_storage_admin;
SELECT t.person('alice', 30);
CREATE FUNCTION t.like(got text, pattern text, name text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF got LIKE pattern THEN RAISE NOTICE 'ok - %', name; ELSE RAISE NOTICE 'not ok - % (got %, wanted %)', name, got, pattern; END IF;
END $f$;
CREATE FUNCTION t.signed_upload(bucket text, path text, who uuid, as_role text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  -- Storage inserts as its own role and stamps the user the URL was minted for as the owner
  EXECUTE format('SET LOCAL ROLE %I', as_role);
  INSERT INTO storage.objects (bucket_id, name, owner, owner_id) VALUES (bucket, path, who, who::text);
  RESET ROLE;
  RETURN 'written';
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  RETURN 'ERROR: ' || SQLERRM;
END $f$;

-- ================= switch open (today's app): behaviour unchanged
SELECT t.eq((SELECT value ->> 'closed' FROM public.app_settings WHERE key = 'image_direct_uploads'), 'false', 'the switch ships open');
SELECT t.as_user(t.id('alice'));
SELECT t.lives(format($q$INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('avatars', %L, auth.uid())$q$, t.id('alice') || '/open-fresh.jpg'),
  'open: the current app can still upload directly (no breakage before the cutover)');
SELECT t.reset();

-- ================= switch closed
UPDATE public.app_settings SET value = '{"closed": true}'::jsonb WHERE key = 'image_direct_uploads';
SELECT t.as_user(t.id('alice'));
SELECT t.throws(format($q$INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('avatars', %L, auth.uid())$q$, t.id('alice') || '/fresh.jpg'),
  'DIRECT_IMAGE_UPLOAD_CLOSED', 'F06: a brand-new path in a public bucket is refused');
SELECT t.throws(format($q$INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('covers', %L, auth.uid())$q$, t.id('alice') || '/fresh-cover.jpg'),
  'DIRECT_IMAGE_UPLOAD_CLOSED', 'F06: in every public image bucket');
SELECT t.throws(format($q$UPDATE storage.objects SET metadata = '{"x":1}'::jsonb WHERE bucket_id = 'avatars' AND name = %L$q$, t.id('alice') || '/open-fresh.jpg'),
  'DIRECT_IMAGE_UPLOAD_CLOSED', 'F06: an existing unprocessed object cannot be rewritten either');
SELECT t.reset();
SELECT t.like(t.signed_upload('avatars', t.id('alice') || '/token-fresh.jpg', t.id('alice'), 'service_role'), 'ERROR:%DIRECT_IMAGE_UPLOAD_CLOSED%',
  'F06: a signed upload URL minted for the user (even before the switch closed) cannot place a fresh object');
SELECT t.like(t.signed_upload('game-covers', t.id('alice') || '/token-cover.jpg', t.id('alice'), 'service_role'), 'ERROR:%DIRECT_IMAGE_UPLOAD_CLOSED%',
  'F06: nor a game cover');
SELECT t.like(t.signed_upload('avatars', t.id('alice') || '/token-admin.jpg', t.id('alice'), 'supabase_storage_admin'), 'ERROR:%DIRECT_IMAGE_UPLOAD_CLOSED%',
  'F06: nor when Storage writes as supabase_storage_admin');
-- a processed (published) path stays protected as before
SET LOCAL session_replication_role = replica;
INSERT INTO storage.objects (bucket_id, name) VALUES ('avatars', t.id('alice') || '/published.jpg');
INSERT INTO public.image_moderation (bucket, path, owner_id, status) VALUES ('avatars', t.id('alice') || '/published.jpg', t.id('alice'), 'pending');
SET LOCAL session_replication_role = origin;
SELECT t.like(t.signed_upload('avatars', t.id('alice') || '/published.jpg', t.id('alice'), 'service_role'), 'ERROR:%',
  'F06: a processed path cannot be overwritten through a signed upload');
SELECT t.reset();
SELECT t.as_anon();
SELECT t.throws($q$INSERT INTO storage.objects (bucket_id, name) VALUES ('avatars', 'nobody/anon.jpg')$q$,
  'row-level security', 'an anonymous visitor is still refused by row-level security (the switch is not exposed to anon)');
SELECT t.reset();
-- the server's own promotion still works
SELECT t.as_service();
SELECT t.lives(format($q$INSERT INTO storage.objects (bucket_id, name) VALUES ('avatars', %L)$q$, t.id('alice') || '/promoted.jpg'),
  'F06: the server''s promotion (no end-user owner) still publishes');
SELECT t.reset();
-- private staging uploads (the new client's path) are unaffected
SELECT t.as_user(t.id('alice'));
SELECT t.lives(format($q$INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('image-staging', %L, auth.uid())$q$, t.id('alice') || '/stage-1.jpg'),
  'F06: uploading into private staging still works');
SELECT t.reset();
-- clients cannot reopen it
SELECT t.as_user(t.id('alice'));
SELECT t.eq(t.changed($q$UPDATE public.app_settings SET value = '{"closed": false}'::jsonb WHERE key = 'image_direct_uploads'$q$), 0,
  'F06: a client cannot reopen the switch');
SELECT t.reset();
-- ================= independent pre-review (2026-11-05): the switch row is guarded
SELECT t.reset();
SELECT t.eq((SELECT value ->> 'closed' FROM public.app_settings WHERE key = 'image_direct_uploads'), 'true', 'pre-review setup: the switch is closed');
SELECT t.as_service();
SELECT t.throws($q$UPDATE public.app_settings SET value = '{"closed": false}'::jsonb WHERE key = 'image_direct_uploads'$q$,
  'DIRECT_UPLOAD_SWITCH_GUARDED', 'pre-review F06: the service key (superadminSetSetting) cannot reopen it');
SELECT t.throws($q$UPDATE public.app_settings SET is_public = true WHERE key = 'image_direct_uploads'$q$,
  'DIRECT_UPLOAD_SWITCH_GUARDED', 'pre-review F06: nor make it public');
SELECT t.throws($q$UPDATE public.app_settings SET value = '{"closed": true, "note": "x"}'::jsonb WHERE key = 'image_direct_uploads'$q$,
  'DIRECT_UPLOAD_SWITCH_GUARDED', 'pre-review F06: nor store anything but {"closed": <boolean>}');
SELECT t.throws($q$DELETE FROM public.app_settings WHERE key = 'image_direct_uploads'$q$,
  'DIRECT_UPLOAD_SWITCH_GUARDED', 'pre-review F06: nor delete it');
SELECT t.throws($q$UPDATE public.app_settings SET key = 'image_direct_uploads_old' WHERE key = 'image_direct_uploads'$q$,
  'DIRECT_UPLOAD_SWITCH_GUARDED', 'pre-review F06: nor rename it');
SELECT t.reset();
SELECT t.eq((SELECT value ->> 'closed' FROM public.app_settings WHERE key = 'image_direct_uploads'), 'true', 'pre-review F06: it is still closed');
-- a missing row reads as closed
SET LOCAL session_replication_role = replica;
DELETE FROM public.app_settings WHERE key = 'image_direct_uploads';
SET LOCAL session_replication_role = origin;
SELECT t.ok(private_sec.direct_image_uploads_closed(), 'pre-review F06: a missing row reads as closed (fail closed)');
INSERT INTO public.app_settings (key, value, is_public) VALUES ('image_direct_uploads', '{"closed": true}'::jsonb, false);
-- re-opening is possible only on purpose, in a reviewed migration
SELECT set_config('app.confirm_reopen_direct_image_uploads', 'yes', true);
SELECT t.lives($q$UPDATE public.app_settings SET value = '{"closed": false}'::jsonb WHERE key = 'image_direct_uploads'$q$,
  'pre-review F06: a migration that confirms on purpose can reopen it');
SELECT set_config('app.confirm_reopen_direct_image_uploads', '', true);
SELECT t.lives($q$UPDATE public.app_settings SET value = '{"closed": true}'::jsonb WHERE key = 'image_direct_uploads'$q$,
  'pre-review F06: closing never needs a confirmation');
SELECT t.lives($q$UPDATE public.app_settings SET value = value WHERE key = 'age_policy'$q$, 'pre-review F06: other settings are untouched');
ROLLBACK;
