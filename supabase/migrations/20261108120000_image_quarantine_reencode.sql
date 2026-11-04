-- SEC-6: a restricted quarantine for flagged image originals, audited reviewer access, and no user write over a published image.
--
-- WHY.
--   * M4: a chat attachment the safety scan flagged as child-safety content was deleted (remove()) before it was escalated, so the
--     evidence was gone. Flagged promotion originals stayed in `image-staging`, a bucket users write to.
--   * Requirement 6: #268's storage.objects triggers stop a user's signed upload URL from overwriting a STAGED file or a CHECKED chat
--     attachment, but nothing stopped the same trick on a PUBLISHED image: a user who mints a signed upload URL with upsert for
--     their own avatar path (the legacy own-folder INSERT policy lets them, until phase 2), or uses the legacy own-folder UPDATE
--     policy, could replace the scanned, re-encoded bytes the server published with anything.
--
-- WHAT THIS DOES.
--   1. A PRIVATE bucket `image-quarantine`. No API role can read, list, write, move or delete in it: there is no permissive policy,
--      and a RESTRICTIVE policy for anon/authenticated keeps it so even if a broad permissive policy appears later. A trigger
--      refuses every write that is not the service key's own (Storage's signed-URL writes carry the signer as owner and are
--      refused, as in 20261106120000), refuses any change of an object's bytes or name (evidence is immutable, for every role),
--      and refuses a delete while the item is under legal hold or inside its retention period, for every role including the
--      service role and a superuser.
--   2. public.image_quarantine_items: one row per quarantined original (source, uploader, hash, categories, status, legal hold,
--      retention). Superadmins can read the metadata; only the service role writes. Rows survive account deletion (no foreign key
--      to auth.users) because evidence under legal hold must outlive the account; see docs/privacy/sec6-image-reencode-quarantine.md.
--   3. public.image_quarantine_access_log: append-only audit of every reviewer action.
--   4. Reviewer access in two steps, because SQL cannot sign a Storage URL (the signing key is not in the database):
--        request_quarantine_review(item, reason)   SECURITY DEFINER, superadmins only, writes the audit row, returns a single-use
--                                                  grant valid for two minutes;
--        consume_quarantine_review(grant)          SECURITY DEFINER, service role only: marks the grant used and returns the
--                                                  object path; the server then mints a 60-second signed URL with the service key.
--      The browser never holds a credential that can list or read the bucket.
--   5. update_quarantine_item(item, action, reason, reference): superadmin, audited: mark_reported (NCMEC CyberTipline reference),
--      place_hold, release_hold (refused for suspected CSAM until it was reported), clear (a false positive).
--   6. A trigger on the published image buckets: once the server has processed a path (it has an image_moderation row: published,
--      quarantined or removed), only a trusted writer may write at that path again. A user's own API write, and Storage's write for
--      a user's signed upload URL, are refused. Unprocessed legacy uploads (no moderation row) keep working until phase 2.
--
-- DEPENDS ON 20261106120000 (private_sec.storage_write_is_trusted) and image_moderation. Additive; the app deploys after it (the
-- server writes quarantine rows; without this migration a flagged upload keeps its original where it is and fails closed).
-- ROLLBACK: DROP TRIGGER image_quarantine_guard, published_image_refuse_user_write ON storage.objects; drop the functions, the two
-- tables, the policy "image_quarantine_no_api_access", and (only once it is empty and no hold applies) the bucket.
DO $guard$
BEGIN
  IF to_regclass('storage.objects') IS NULL OR to_regclass('storage.buckets') IS NULL THEN
    RAISE EXCEPTION 'image quarantine: storage schema is missing';
  END IF;
  IF to_regprocedure('private_sec.storage_write_is_trusted(uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'image quarantine: apply 20261106120000_private_image_staging first';
  END IF;
  IF to_regclass('public.image_moderation') IS NULL THEN
    RAISE EXCEPTION 'image quarantine: public.image_moderation is missing';
  END IF;
  IF to_regprocedure('private_sec.is_superadmin(uuid)') IS NULL THEN
    RAISE EXCEPTION 'image quarantine: private_sec.is_superadmin is missing (apply 20261103150000_helper_oracle_containment first)';
  END IF;
END
$guard$;

-- 1. The bucket. 20 MB covers the largest scanned original (a chat picture, 20 MB); published images are 8 MB at most.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('image-quarantine', 'image-quarantine', false, 20971520, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 20971520,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];

DROP POLICY IF EXISTS "image_quarantine_no_api_access" ON storage.objects;
CREATE POLICY "image_quarantine_no_api_access" ON storage.objects AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (bucket_id IS DISTINCT FROM 'image-quarantine')
  WITH CHECK (bucket_id IS DISTINCT FROM 'image-quarantine');

-- 2. Items.
CREATE TABLE IF NOT EXISTS public.image_quarantine_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  object_path text NOT NULL UNIQUE,
  source text NOT NULL CHECK (source IN ('image_upload', 'message_attachment', 'legacy_direct_upload')),
  source_bucket text NOT NULL,
  source_path text NOT NULL,
  uploader_id uuid,
  conversation_id uuid,
  mime text NOT NULL,
  bytes integer NOT NULL CHECK (bytes > 0),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  categories text[] NOT NULL DEFAULT '{}',
  suspected_csam boolean NOT NULL DEFAULT false,
  reason text,
  status text NOT NULL DEFAULT 'held' CHECK (status IN ('held', 'reported', 'cleared', 'destroyed')),
  legal_hold boolean NOT NULL DEFAULT false,
  retain_until timestamptz,
  report_reference text,
  reported_at timestamptz,
  destroyed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT image_quarantine_csam_held CHECK (NOT suspected_csam OR legal_hold OR status IN ('reported', 'destroyed'))
);
COMMENT ON TABLE public.image_quarantine_items IS
  'Flagged image originals held in the private image-quarantine bucket for authorized safety review. Service role writes; superadmins read metadata; bytes only via request_quarantine_review. uploader_id has no foreign key on purpose: evidence under legal hold outlives the account.';
ALTER TABLE public.image_quarantine_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.image_quarantine_items FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.image_quarantine_items TO authenticated;
GRANT ALL ON public.image_quarantine_items TO service_role;
DROP POLICY IF EXISTS "Superadmins read quarantine items" ON public.image_quarantine_items;
CREATE POLICY "Superadmins read quarantine items" ON public.image_quarantine_items FOR SELECT TO authenticated
  USING (private_sec.is_superadmin(auth.uid()));
CREATE INDEX IF NOT EXISTS image_quarantine_items_uploader_idx ON public.image_quarantine_items (uploader_id);
CREATE INDEX IF NOT EXISTS image_quarantine_items_retention_idx ON public.image_quarantine_items (retain_until)
  WHERE NOT legal_hold AND status <> 'destroyed';

-- Defaults no caller can weaken: suspected CSAM is always under legal hold with no end date; anything else is kept 90 days.
-- An item row can never be deleted (status 'destroyed' records the destruction), and its identity never changes.
CREATE OR REPLACE FUNCTION private_sec.image_quarantine_item_rules()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'QUARANTINE_RECORD_FINAL: a quarantine record is never deleted; destruction is recorded as status destroyed.'
      USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.status := 'held';
    NEW.reported_at := NULL;
    NEW.report_reference := NULL;
    NEW.destroyed_at := NULL;
    NEW.created_at := now();
    IF NEW.suspected_csam THEN
      NEW.legal_hold := true;
      NEW.retain_until := NULL;
    ELSE
      NEW.retain_until := greatest(coalesce(NEW.retain_until, now()), now() + interval '90 days');
    END IF;
  ELSE
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.object_path IS DISTINCT FROM OLD.object_path
       OR NEW.sha256 IS DISTINCT FROM OLD.sha256 OR NEW.source_bucket IS DISTINCT FROM OLD.source_bucket
       OR NEW.source_path IS DISTINCT FROM OLD.source_path OR NEW.uploader_id IS DISTINCT FROM OLD.uploader_id
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR (OLD.suspected_csam AND NOT NEW.suspected_csam) THEN
      RAISE EXCEPTION 'QUARANTINE_RECORD_FINAL: the identity of a quarantined original cannot change.' USING ERRCODE = '42501';
    END IF;
    IF OLD.status = 'destroyed' THEN
      RAISE EXCEPTION 'QUARANTINE_RECORD_FINAL: a destroyed item cannot change.' USING ERRCODE = '42501';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION private_sec.image_quarantine_item_rules() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS image_quarantine_item_rules ON public.image_quarantine_items;
CREATE TRIGGER image_quarantine_item_rules BEFORE INSERT OR UPDATE OR DELETE ON public.image_quarantine_items
  FOR EACH ROW EXECUTE FUNCTION private_sec.image_quarantine_item_rules();

-- 3. Access log (append-only; a grant can be consumed once).
CREATE TABLE IF NOT EXISTS public.image_quarantine_access_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES public.image_quarantine_items(id) ON DELETE RESTRICT,
  actor_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('view_requested', 'mark_reported', 'place_hold', 'release_hold', 'clear')),
  reason text NOT NULL,
  reference text,
  grant_expires_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.image_quarantine_access_log IS
  'Append-only audit of every reviewer action on a quarantined original. actor_id has no foreign key so the audit outlives the account.';
ALTER TABLE public.image_quarantine_access_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.image_quarantine_access_log FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.image_quarantine_access_log TO authenticated;
GRANT SELECT ON public.image_quarantine_access_log TO service_role;
DROP POLICY IF EXISTS "Superadmins read quarantine access log" ON public.image_quarantine_access_log;
CREATE POLICY "Superadmins read quarantine access log" ON public.image_quarantine_access_log FOR SELECT TO authenticated
  USING (private_sec.is_superadmin(auth.uid()));
CREATE INDEX IF NOT EXISTS image_quarantine_access_log_item_idx ON public.image_quarantine_access_log (item_id, created_at);

CREATE OR REPLACE FUNCTION private_sec.image_quarantine_log_append_only()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'QUARANTINE_AUDIT_FINAL: the quarantine access log is append-only.' USING ERRCODE = '42501';
  END IF;
  -- The only change ever made: stamping a view grant as consumed, once.
  IF OLD.consumed_at IS NOT NULL OR NEW.consumed_at IS NULL
     OR (to_jsonb(NEW) - 'consumed_at') IS DISTINCT FROM (to_jsonb(OLD) - 'consumed_at') THEN
    RAISE EXCEPTION 'QUARANTINE_AUDIT_FINAL: the quarantine access log is append-only.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION private_sec.image_quarantine_log_append_only() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS image_quarantine_log_append_only ON public.image_quarantine_access_log;
CREATE TRIGGER image_quarantine_log_append_only BEFORE UPDATE OR DELETE ON public.image_quarantine_access_log
  FOR EACH ROW EXECUTE FUNCTION private_sec.image_quarantine_log_append_only();

-- 4. Reviewer access.
CREATE OR REPLACE FUNCTION public.request_quarantine_review(_item_id uuid, _reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  actor uuid := auth.uid();
  item public.image_quarantine_items%ROWTYPE;
  grant_id uuid;
BEGIN
  IF actor IS NULL OR NOT private_sec.is_superadmin(actor) THEN
    RAISE EXCEPTION 'QUARANTINE_FORBIDDEN: only a safety reviewer can open a quarantined original.' USING ERRCODE = '42501';
  END IF;
  IF length(btrim(coalesce(_reason, ''))) < 10 THEN
    RAISE EXCEPTION 'QUARANTINE_REASON_REQUIRED: say why you need to view this original (at least 10 characters).'
      USING ERRCODE = '22023';
  END IF;
  SELECT * INTO item FROM public.image_quarantine_items WHERE id = _item_id;
  IF NOT FOUND OR item.status = 'destroyed' THEN
    RAISE EXCEPTION 'QUARANTINE_NOT_FOUND: no quarantined original with that id.' USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO public.image_quarantine_access_log (item_id, actor_id, action, reason, grant_expires_at)
  VALUES (_item_id, actor, 'view_requested', btrim(_reason), now() + interval '2 minutes')
  RETURNING id INTO grant_id;
  RETURN grant_id;
END
$function$;
REVOKE ALL ON FUNCTION public.request_quarantine_review(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_quarantine_review(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.consume_quarantine_review(_grant_id uuid)
 RETURNS TABLE(object_path text, url_ttl_seconds integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  g public.image_quarantine_access_log%ROWTYPE;
BEGIN
  SELECT * INTO g FROM public.image_quarantine_access_log WHERE id = _grant_id FOR UPDATE;
  IF NOT FOUND OR g.action <> 'view_requested' OR g.consumed_at IS NOT NULL OR g.grant_expires_at <= now() THEN
    RAISE EXCEPTION 'QUARANTINE_GRANT_INVALID: this review link was already used or has expired.' USING ERRCODE = '42501';
  END IF;
  -- The reviewer may have lost the role between the request and the mint.
  IF NOT private_sec.is_superadmin(g.actor_id) THEN
    RAISE EXCEPTION 'QUARANTINE_FORBIDDEN: only a safety reviewer can open a quarantined original.' USING ERRCODE = '42501';
  END IF;
  UPDATE public.image_quarantine_access_log SET consumed_at = now() WHERE id = _grant_id;
  RETURN QUERY SELECT i.object_path, 60 FROM public.image_quarantine_items i
                WHERE i.id = g.item_id AND i.status <> 'destroyed';
END
$function$;
REVOKE ALL ON FUNCTION public.consume_quarantine_review(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_quarantine_review(uuid) TO service_role;

-- 5. Reviewer decisions.
CREATE OR REPLACE FUNCTION public.update_quarantine_item(_item_id uuid, _action text, _reason text, _reference text DEFAULT NULL)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  actor uuid := auth.uid();
  item public.image_quarantine_items%ROWTYPE;
BEGIN
  IF actor IS NULL OR NOT private_sec.is_superadmin(actor) THEN
    RAISE EXCEPTION 'QUARANTINE_FORBIDDEN: only a safety reviewer can change a quarantined original.' USING ERRCODE = '42501';
  END IF;
  IF _action NOT IN ('mark_reported', 'place_hold', 'release_hold', 'clear') THEN
    RAISE EXCEPTION 'QUARANTINE_ACTION: unknown action %', _action USING ERRCODE = '22023';
  END IF;
  IF length(btrim(coalesce(_reason, ''))) < 10 THEN
    RAISE EXCEPTION 'QUARANTINE_REASON_REQUIRED: give a reason (at least 10 characters).' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO item FROM public.image_quarantine_items WHERE id = _item_id FOR UPDATE;
  IF NOT FOUND OR item.status = 'destroyed' THEN
    RAISE EXCEPTION 'QUARANTINE_NOT_FOUND: no quarantined original with that id.' USING ERRCODE = 'P0002';
  END IF;

  IF _action = 'mark_reported' THEN
    IF length(btrim(coalesce(_reference, ''))) = 0 THEN
      RAISE EXCEPTION 'QUARANTINE_REFERENCE_REQUIRED: record the report reference (e.g. the CyberTipline report id).'
        USING ERRCODE = '22023';
    END IF;
    -- Preserve at least one year after the report (18 U.S.C. 2258A(h) as amended; counsel to confirm), and keep the hold.
    UPDATE public.image_quarantine_items
       SET status = 'reported', reported_at = now(), report_reference = btrim(_reference), legal_hold = true,
           retain_until = greatest(coalesce(retain_until, now()), now() + interval '1 year')
     WHERE id = _item_id;
  ELSIF _action = 'place_hold' THEN
    UPDATE public.image_quarantine_items SET legal_hold = true WHERE id = _item_id;
  ELSIF _action = 'release_hold' THEN
    IF item.suspected_csam AND item.status <> 'reported' THEN
      RAISE EXCEPTION 'QUARANTINE_HOLD_REQUIRED: suspected child sexual abuse material stays under hold until it has been reported.'
        USING ERRCODE = '42501';
    END IF;
    UPDATE public.image_quarantine_items
       SET legal_hold = false,
           retain_until = greatest(coalesce(retain_until, now()), coalesce(reported_at + interval '1 year', now()))
     WHERE id = _item_id;
  ELSE -- clear: a false positive. Not for suspected CSAM (that is decided by the report, not by one reviewer).
    IF item.suspected_csam THEN
      RAISE EXCEPTION 'QUARANTINE_HOLD_REQUIRED: suspected child sexual abuse material cannot be cleared by a reviewer.'
        USING ERRCODE = '42501';
    END IF;
    UPDATE public.image_quarantine_items
       SET status = 'cleared', retain_until = least(coalesce(retain_until, now() + interval '30 days'), now() + interval '30 days')
     WHERE id = _item_id;
  END IF;

  INSERT INTO public.image_quarantine_access_log (item_id, actor_id, action, reason, reference)
  VALUES (_item_id, actor, _action, btrim(_reason), nullif(btrim(coalesce(_reference, '')), ''));
END
$function$;
REVOKE ALL ON FUNCTION public.update_quarantine_item(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_quarantine_item(uuid, text, text, text) TO authenticated;

-- 6. Storage triggers.
-- May this quarantine object be deleted? Only when its record allows it: not under legal hold and past its retention date.
-- An object with no record (an upload whose record insert failed) is kept for manual reconciliation.
CREATE OR REPLACE FUNCTION private_sec.image_quarantine_deletable(_name text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.image_quarantine_items i
                  WHERE i.object_path = _name AND NOT i.legal_hold
                    AND i.retain_until IS NOT NULL AND i.retain_until <= now())
$function$;
REVOKE ALL ON FUNCTION private_sec.image_quarantine_deletable(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private_sec.image_quarantine_deletable(text) TO service_role;

CREATE OR REPLACE FUNCTION private_sec.image_quarantine_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.bucket_id IS DISTINCT FROM 'image-quarantine' THEN
      RETURN OLD;
    END IF;
    IF current_user IN ('anon', 'authenticated') OR NOT private_sec.storage_write_is_trusted(OLD.owner, OLD.owner_id) THEN
      RAISE EXCEPTION 'QUARANTINE_FINAL: a quarantined original cannot be removed through the API.' USING ERRCODE = '42501';
    END IF;
    IF NOT private_sec.image_quarantine_deletable(OLD.name) THEN
      RAISE EXCEPTION 'QUARANTINE_HOLD: this original is under legal hold or inside its retention period.' USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.bucket_id IS DISTINCT FROM 'image-quarantine'
     AND (TG_OP = 'INSERT' OR OLD.bucket_id IS DISTINCT FROM 'image-quarantine') THEN
    RETURN NEW;
  END IF;
  IF current_user IN ('anon', 'authenticated') OR NOT private_sec.storage_write_is_trusted(NEW.owner, NEW.owner_id) THEN
    RAISE EXCEPTION 'QUARANTINE_FINAL: only the server can write to the quarantine.' USING ERRCODE = '42501';
  END IF;
  -- Evidence is immutable: no role may move it or change its bytes. Bookkeeping on the same object (metadata) stays possible.
  IF TG_OP = 'UPDATE' AND (NEW.bucket_id IS DISTINCT FROM OLD.bucket_id OR NEW.name IS DISTINCT FROM OLD.name
                           OR NEW.version IS DISTINCT FROM OLD.version OR NEW.id IS DISTINCT FROM OLD.id) THEN
    RAISE EXCEPTION 'QUARANTINE_FINAL: a quarantined original cannot be replaced or moved.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION private_sec.image_quarantine_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS image_quarantine_guard ON storage.objects;
CREATE TRIGGER image_quarantine_guard BEFORE INSERT OR UPDATE OR DELETE ON storage.objects
  FOR EACH ROW EXECUTE FUNCTION private_sec.image_quarantine_guard();

-- Has the server processed this path in a destination bucket (published, quarantined or removed)?
CREATE OR REPLACE FUNCTION private_sec.image_path_processed(_bucket text, _path text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.image_moderation m WHERE m.bucket = _bucket AND m.path = _path)
$function$;
REVOKE ALL ON FUNCTION private_sec.image_path_processed(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private_sec.image_path_processed(text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION private_sec.published_image_refuse_user_write()
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
  -- An anonymous request has no write policy on these buckets; row-level security refuses it.
  IF current_user = 'anon' THEN
    RETURN NEW;
  END IF;
  IF private_sec.storage_write_is_trusted(NEW.owner, NEW.owner_id) THEN
    RETURN NEW;
  END IF;
  IF private_sec.image_path_processed(NEW.bucket_id, NEW.name)
     OR (TG_OP = 'UPDATE' AND private_sec.image_path_processed(OLD.bucket_id, OLD.name)) THEN
    RAISE EXCEPTION 'PUBLISHED_IMAGE_FINAL: a published or reviewed image cannot be replaced. Upload a new picture instead.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION private_sec.published_image_refuse_user_write() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS published_image_refuse_user_write ON storage.objects;
CREATE TRIGGER published_image_refuse_user_write BEFORE INSERT OR UPDATE ON storage.objects
  FOR EACH ROW EXECUTE FUNCTION private_sec.published_image_refuse_user_write();

DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_storage_admin') THEN
    GRANT EXECUTE ON FUNCTION private_sec.image_quarantine_deletable(text) TO supabase_storage_admin;
    GRANT EXECUTE ON FUNCTION private_sec.image_path_processed(text, text) TO supabase_storage_admin;
  END IF;
END
$grant$;
