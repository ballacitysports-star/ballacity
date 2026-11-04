-- SEC-6, R5 independent review (39ae9545) finding 1: one server call at a time processes an image path, a flag recorded while
-- another call is working always wins, and only the service role can claim or settle a path.
BEGIN;
SELECT t.person('alice', 30);

CREATE TEMP TABLE claims (k text PRIMARY KEY, token uuid);
GRANT ALL ON claims TO PUBLIC;
CREATE FUNCTION pg_temp.claim(_k text, _bucket text, _path text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM public.claim_image_processing(_bucket, _path, md5('t:alice')::uuid);
  INSERT INTO claims VALUES (_k, r.claim_token) ON CONFLICT (k) DO UPDATE SET token = EXCLUDED.token;
  RETURN coalesce(r.status, 'none') || CASE WHEN r.claim_token IS NULL THEN ':refused' ELSE ':claimed' END;
END
$f$;
GRANT EXECUTE ON FUNCTION pg_temp.claim(text, text, text) TO PUBLIC;
CREATE FUNCTION pg_temp.tok(_k text) RETURNS uuid LANGUAGE sql AS $f$ SELECT token FROM claims WHERE k = _k $f$;
GRANT EXECUTE ON FUNCTION pg_temp.tok(text) TO PUBLIC;

-- ---- only the service role
SELECT t.ok(NOT has_function_privilege('anon', 'public.claim_image_processing(text, text, uuid)', 'EXECUTE'),
            'anon cannot execute claim_image_processing');
SELECT t.ok(NOT has_function_privilege('authenticated', 'public.claim_image_processing(text, text, uuid)', 'EXECUTE'),
            'authenticated cannot execute claim_image_processing');
SELECT t.ok(NOT has_function_privilege('anon', 'public.finish_image_processing(text, text, uuid, text, jsonb)', 'EXECUTE'),
            'anon cannot execute finish_image_processing');
SELECT t.ok(NOT has_function_privilege('authenticated', 'public.finish_image_processing(text, text, uuid, text, jsonb)', 'EXECUTE'),
            'authenticated cannot execute finish_image_processing');
SELECT t.as_user(t.id('alice'));
SELECT t.throws(format($q$SELECT * FROM public.claim_image_processing('image-staging', %L, auth.uid())$q$, t.id('alice') || '/s.jpg'),
                'permission denied', 'the uploader cannot claim their own staged path through the API');
SELECT t.throws($q$SELECT public.finish_image_processing('avatars', 'x', gen_random_uuid(), 'pending', '{}')$q$,
                'permission denied', 'nor settle one');
SELECT t.as_anon();
SELECT t.throws($q$SELECT * FROM public.claim_image_processing('avatars', 'x', NULL)$q$, 'permission denied', 'nor can anonymous');
SELECT t.reset();

-- ---- a concurrent second claim is refused; the first claim's outcome is written only under its own token
SELECT t.as_service();
SELECT t.eq(pg_temp.claim('a', 'image-staging', t.id('alice') || '/s1.jpg'), 'processing:claimed', 'the first call claims a fresh path');
SELECT t.eq(pg_temp.claim('b', 'image-staging', t.id('alice') || '/s1.jpg'), 'processing:refused',
            'a second call on the same path, while the first is processing, is refused');
SELECT t.eq(public.finish_image_processing('image-staging', t.id('alice') || '/s1.jpg', gen_random_uuid(), 'pending', '{}'), false,
            'a settle with a token that does not hold the claim changes nothing');
SELECT t.eq(public.finish_image_processing('image-staging', t.id('alice') || '/s1.jpg', pg_temp.tok('a'), 'pending',
              '{"reason": "Safety scan unavailable", "bytes": 12}'), true, 'the holder settles its own claim');
SELECT t.reset();
SELECT t.eq((SELECT row(status, reason, bytes, claim_token IS NULL)::text FROM public.image_moderation
              WHERE bucket = 'image-staging' AND path = t.id('alice') || '/s1.jpg'),
            row('pending', 'Safety scan unavailable', 12::bigint, true)::text, 'and the outcome is recorded, the claim cleared');
SELECT t.as_service();
SELECT t.eq(pg_temp.claim('c', 'image-staging', t.id('alice') || '/s1.jpg'), 'processing:claimed',
            'a held (pending) path can be claimed again for a retry');

-- ---- a flag written while another call holds the claim wins: the holder can no longer publish or reset it
SELECT t.eq(pg_temp.claim('d', 'avatars', t.id('alice') || '/a.jpg'), 'processing:claimed', 'call B claims a destination path');
-- call A's scan flags: it records the flag unconditionally (as the server does)
UPDATE public.image_moderation SET status = 'quarantined', claim_token = NULL, claimed_at = NULL
 WHERE bucket = 'avatars' AND path = t.id('alice') || '/a.jpg';
SELECT t.eq(public.finish_image_processing('avatars', t.id('alice') || '/a.jpg', pg_temp.tok('d'), 'pending', '{"reason": null}'), false,
            'call B''s "safe" outcome is refused once the path is quarantined');
SELECT t.eq(public.finish_image_processing('avatars', t.id('alice') || '/a.jpg', pg_temp.tok('d'), 'released', '{}'), false,
            'and B cannot release (delete) the quarantined row either');
SELECT t.eq(pg_temp.claim('e', 'avatars', t.id('alice') || '/a.jpg'), 'quarantined:refused', 'a quarantined path cannot be claimed again');
SELECT t.reset();
SELECT t.eq((SELECT status FROM public.image_moderation WHERE bucket = 'avatars' AND path = t.id('alice') || '/a.jpg'), 'quarantined',
            'the row stays quarantined');
INSERT INTO public.image_moderation (bucket, path, owner_id, status) VALUES ('avatars', t.id('alice') || '/r.jpg', t.id('alice'), 'removed');
SELECT t.as_service();
SELECT t.eq(pg_temp.claim('f', 'avatars', t.id('alice') || '/r.jpg'), 'removed:refused', 'nor can a removed path');

-- ---- a stale claim (a crashed worker) can be taken over after 10 minutes, and the old token is dead
SELECT t.eq(pg_temp.claim('g', 'avatars', t.id('alice') || '/s.jpg'), 'processing:claimed', 'a worker claims a path');
SELECT t.reset();
UPDATE public.image_moderation SET claimed_at = now() - interval '9 minutes' WHERE bucket = 'avatars' AND path = t.id('alice') || '/s.jpg';
SELECT t.as_service();
SELECT t.eq(pg_temp.claim('h', 'avatars', t.id('alice') || '/s.jpg'), 'processing:refused', 'a 9-minute-old claim is still live');
SELECT t.reset();
UPDATE public.image_moderation SET claimed_at = now() - interval '11 minutes' WHERE bucket = 'avatars' AND path = t.id('alice') || '/s.jpg';
SELECT t.as_service();
SELECT t.eq(pg_temp.claim('h', 'avatars', t.id('alice') || '/s.jpg'), 'processing:claimed', 'an 11-minute-old claim is taken over');
SELECT t.eq(public.finish_image_processing('avatars', t.id('alice') || '/s.jpg', pg_temp.tok('g'), 'pending', '{}'), false,
            'the stalled worker''s token no longer settles anything');
SELECT t.eq(public.finish_image_processing('avatars', t.id('alice') || '/s.jpg', pg_temp.tok('h'), 'released', '{}'), true,
            'the new holder can release the path');
SELECT t.reset();
SELECT t.eq((SELECT count(*)::int FROM public.image_moderation WHERE bucket = 'avatars' AND path = t.id('alice') || '/s.jpg'), 0,
            'release deletes the row');

-- ---- a staged file being processed is closed to its uploader like a held one
SELECT t.ok(private_sec.image_staging_flagged(t.id('alice') || '/s1.jpg'), 'a processing staged path counts as flagged for the uploader');
SELECT t.throws($q$SELECT public.finish_image_processing('avatars', 'x', gen_random_uuid(), 'quarantined', '{}')$q$,
                'IMAGE_CLAIM_STATUS', 'a flag is never written through a claim');
ROLLBACK;
