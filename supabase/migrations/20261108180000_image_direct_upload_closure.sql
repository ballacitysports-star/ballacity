-- Audit F06: fresh direct uploads bypass image processing.
--
-- published_image_refuse_user_write (20261108120000) only protects paths that already have an image_moderation row. A
-- brand-new path in a user's own folder has none, and the legacy browser write policies (20260719202354 and others)
-- still allow it, so an authenticated client could upload straight into a public image bucket and never call
-- finalization: no re-encoding, metadata removal or scan. The full closure (supabase/phase2/
-- g3b_phase2_close_direct_image_uploads.sql, which drops those policies) sits outside migration replay because the app
-- that production runs today still uploads directly; closing it before the new client (private staging, server
-- promotion) is adopted would break every upload from the old app.
--
-- This migration ships the closure as a switch, enforced in the database, so it is part of the release and cannot be
-- forgotten or applied partially:
--   * app_settings 'image_direct_uploads' {"closed": false} is seeded (open, today's behaviour);
--   * while closed, ANY user-attributed write into a public image bucket or game covers is refused: a browser insert
--     or update (fresh or processed path), and the write Storage performs for a signed upload URL minted for a user
--     (service role with the user stamped as owner), including URLs minted before the switch closed. Only server
--     writes with no end-user owner (the staging -> scan -> strip -> promote path) remain.
-- Closing the switch is a release cutover (docs/privacy/g3b-image-staging.md): after the new client is adopted, the
-- service role sets {"closed": true}; the phase-2 script then removes the policies. Re-opening needs the service role.

DO $$ BEGIN
  IF to_regprocedure('private_sec.storage_write_is_trusted(uuid,text)') IS NULL
     OR to_regprocedure('private_sec.published_image_refuse_user_write()') IS NULL THEN
    RAISE EXCEPTION 'image direct-upload closure: needs 20261106120000 (staging) and 20261108120000 (SEC-6)';
  END IF;
END $$;

INSERT INTO public.app_settings (key, value, is_public)
VALUES ('image_direct_uploads', '{"closed": false}'::jsonb, false)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION private_sec.direct_image_uploads_closed()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT COALESCE((SELECT (value ->> 'closed')::boolean FROM public.app_settings WHERE key = 'image_direct_uploads'), false)
$function$;
REVOKE ALL ON FUNCTION private_sec.direct_image_uploads_closed() FROM PUBLIC;
-- Not anon: the trigger below never reads the switch for an anonymous write (row-level security refuses those).
GRANT EXECUTE ON FUNCTION private_sec.direct_image_uploads_closed() TO authenticated, service_role;
DO $grant$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_storage_admin') THEN
    GRANT EXECUTE ON FUNCTION private_sec.direct_image_uploads_closed() TO supabase_storage_admin;
  END IF;
END $grant$;

-- SECURITY INVOKER on purpose: storage_write_is_trusted reads current_user (the API role, or the Storage service role).
CREATE OR REPLACE FUNCTION private_sec.refuse_direct_public_image_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  dest constant text[] := ARRAY['avatars', 'covers', 'org-avatars', 'org-covers', 'team-avatars', 'team-covers',
                                'trainer-avatars', 'game-covers'];
BEGIN
  IF NOT (NEW.bucket_id = ANY (dest) OR (TG_OP = 'UPDATE' AND OLD.bucket_id = ANY (dest))) THEN
    RETURN NEW;
  END IF;
  IF private_sec.storage_write_is_trusted(NEW.owner, NEW.owner_id) THEN
    RETURN NEW;                                   -- the server's promotion (no end-user owner)
  END IF;
  IF current_user = 'anon' THEN
    -- Row-level security refuses every anonymous write into storage (no anon write policy exists: schema invariant 4 in
    -- supabase/tests/00_schema_invariants.test.sql), so the switch is not consulted for it.
    RETURN NEW;
  END IF;
  IF private_sec.direct_image_uploads_closed() THEN
    RAISE EXCEPTION 'DIRECT_IMAGE_UPLOAD_CLOSED: pictures are uploaded through processing. Update the app and try again.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION private_sec.refuse_direct_public_image_write() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private_sec.refuse_direct_public_image_write() TO anon, authenticated, service_role;
DO $grant$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_storage_admin') THEN
    GRANT EXECUTE ON FUNCTION private_sec.refuse_direct_public_image_write() TO supabase_storage_admin;
  END IF;
END $grant$;

DROP TRIGGER IF EXISTS a_refuse_direct_public_image_write ON storage.objects;
CREATE TRIGGER a_refuse_direct_public_image_write BEFORE INSERT OR UPDATE ON storage.objects
  FOR EACH ROW EXECUTE FUNCTION private_sec.refuse_direct_public_image_write();
