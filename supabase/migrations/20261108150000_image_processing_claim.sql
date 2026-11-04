-- SEC-6, R5 independent review (39ae9545) finding 1: an atomic processing claim for image promotion and legacy finalize.
--
-- WHY. promoteStagedImage and finalizeDirectImageUpload read the moderation row once, at the start, and wrote their outcome with an
-- unconditional upsert at the end. Two calls on the same path could both pass the start check; if call A's scan flagged the image
-- (quarantined, escalated, staged file removed) while call B was still re-encoding or scanning, B's "safe" verdict then published
-- the picture and overwrote the `quarantined` row with `pending`. A read-then-act check in the application cannot close that; the
-- database has to decide.
--
-- WHAT THIS DOES.
--   1. image_moderation gains status 'processing' and two columns, claim_token and claimed_at.
--   2. claim_image_processing(bucket, path, owner): service role only. Atomically inserts the row as 'processing' with a fresh
--      token, or moves an existing row to 'processing' ONLY when it is not already 'processing' (a live claim), 'quarantined' or
--      'removed'. A second, concurrent claim gets no token (the INSERT ... ON CONFLICT DO UPDATE ... WHERE serialises on the row),
--      and a flagged path can never be claimed again. Returns the token (NULL when refused) and the row's current status.
--   3. finish_image_processing(bucket, path, token, status, fields): service role only. Writes the outcome ('pending',
--      'removed', or 'released' = delete the row) ONLY while the row is still 'processing' under that same token. A flag written
--      in between (the flagging call upserts 'quarantined' unconditionally, and a moderator's decision likewise) makes it return
--      false, and the caller then refuses and removes whatever it wrote instead of publishing.
--   4. STALE CLAIMS. A worker that crashed leaves its row 'processing'. A claim older than 10 minutes (longer than any re-encode
--      plus scan, which run inside one server request) may be taken over by a new claim, which issues a NEW token: if the slow
--      worker comes back, its finish_image_processing call matches no row and it publishes nothing.
--   5. private_sec.image_staging_flagged also counts 'processing': while the server works on a staged file the uploader cannot
--      read it back, and the path cannot be refilled if it is emptied.
--
-- The application side (src/lib/image-promotion.server.ts, src/lib/image-finalize-direct.server.ts) claims before it downloads,
-- claims the destination path before it writes there, writes 'quarantined' on the destination path too when the scan flags (so
-- the destination claim refuses), and makes every non-flag outcome conditional through finish_image_processing.
--
-- DEPENDS ON 20261108120000_image_quarantine_reencode (and image_moderation). Additive.
-- ROLLBACK: drop the two functions; restore image_staging_flagged from 20261106120000; UPDATE image_moderation SET
-- status = 'pending' WHERE status = 'processing'; restore the status check without 'processing'; drop the two columns.
DO $guard$
BEGIN
  IF to_regclass('public.image_moderation') IS NULL THEN
    RAISE EXCEPTION 'image processing claim: public.image_moderation is missing';
  END IF;
  IF to_regprocedure('private_sec.image_path_processed(text,text)') IS NULL THEN
    RAISE EXCEPTION 'image processing claim: apply 20261108120000_image_quarantine_reencode first';
  END IF;
END
$guard$;

ALTER TABLE public.image_moderation
  ADD COLUMN IF NOT EXISTS claim_token uuid,
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz;
COMMENT ON COLUMN public.image_moderation.claim_token IS
  'Set while the server processes this path (status processing); see claim_image_processing. Never shown to users.';

ALTER TABLE public.image_moderation DROP CONSTRAINT IF EXISTS image_moderation_status_check;
ALTER TABLE public.image_moderation
  ADD CONSTRAINT image_moderation_status_check
  CHECK (status IN ('pending', 'processing', 'kept', 'quarantined', 'removed'));

CREATE OR REPLACE FUNCTION public.claim_image_processing(_bucket text, _path text, _owner_id uuid)
 RETURNS TABLE(claim_token uuid, status text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  token uuid := gen_random_uuid();
  got uuid;
BEGIN
  IF _bucket IS NULL OR _path IS NULL OR length(_path) = 0 THEN
    RAISE EXCEPTION 'IMAGE_CLAIM_ARGS: bucket and path are required' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.image_moderation AS m (bucket, path, owner_id, status, reason, scan, claim_token, claimed_at)
  VALUES (_bucket, _path, _owner_id, 'processing', 'Processing', jsonb_build_object('stage', 'processing'), token, now())
  ON CONFLICT (bucket, path) DO UPDATE
     SET status = 'processing', claim_token = EXCLUDED.claim_token, claimed_at = EXCLUDED.claimed_at
   WHERE m.status NOT IN ('processing', 'quarantined', 'removed')
      -- A claim older than 10 minutes belongs to a worker that crashed or stalled; a new claim takes over with a new token.
      OR (m.status = 'processing' AND (m.claimed_at IS NULL OR m.claimed_at < now() - interval '10 minutes'))
  RETURNING m.claim_token INTO got;
  IF got IS NOT NULL THEN
    RETURN QUERY SELECT got, 'processing'::text;
    RETURN;
  END IF;
  RETURN QUERY SELECT NULL::uuid, m.status FROM public.image_moderation m WHERE m.bucket = _bucket AND m.path = _path;
END
$function$;
REVOKE ALL ON FUNCTION public.claim_image_processing(text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_image_processing(text, text, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.finish_image_processing(
  _bucket text, _path text, _claim_token uuid, _status text, _fields jsonb DEFAULT '{}'::jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  f jsonb := coalesce(_fields, '{}'::jsonb);
BEGIN
  IF _claim_token IS NULL THEN
    RETURN false;
  END IF;
  IF _status = 'released' THEN
    DELETE FROM public.image_moderation m
     WHERE m.bucket = _bucket AND m.path = _path AND m.status = 'processing' AND m.claim_token = _claim_token;
    RETURN FOUND;
  END IF;
  -- 'quarantined' is never written through a claim: a flag is recorded unconditionally, so it always wins.
  IF _status NOT IN ('pending', 'removed') THEN
    RAISE EXCEPTION 'IMAGE_CLAIM_STATUS: unknown outcome %', _status USING ERRCODE = '22023';
  END IF;
  UPDATE public.image_moderation m
     SET status = _status,
         claim_token = NULL,
         claimed_at = NULL,
         reason = CASE WHEN f ? 'reason' THEN f->>'reason' ELSE m.reason END,
         mime = CASE WHEN f ? 'mime' THEN f->>'mime' ELSE m.mime END,
         bytes = CASE WHEN f ? 'bytes' THEN (f->>'bytes')::bigint ELSE m.bytes END,
         width = CASE WHEN f ? 'width' THEN (f->>'width')::integer ELSE m.width END,
         height = CASE WHEN f ? 'height' THEN (f->>'height')::integer ELSE m.height END,
         scan = CASE WHEN f ? 'scan' THEN f->'scan' ELSE m.scan END
   WHERE m.bucket = _bucket AND m.path = _path AND m.status = 'processing' AND m.claim_token = _claim_token;
  RETURN FOUND;
END
$function$;
REVOKE ALL ON FUNCTION public.finish_image_processing(text, text, uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_image_processing(text, text, uuid, text, jsonb) TO service_role;

-- A staged file the server is working on is as closed to its uploader as one it held or flagged.
CREATE OR REPLACE FUNCTION private_sec.image_staging_flagged(_path text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.image_moderation m
                  WHERE m.bucket = 'image-staging' AND m.path = _path
                    AND m.status IN ('pending', 'processing', 'quarantined', 'removed'))
$function$;
