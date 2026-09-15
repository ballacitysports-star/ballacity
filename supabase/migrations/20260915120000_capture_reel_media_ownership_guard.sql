-- Captures a security control that exists in production but in no migration.
--
-- `enforce_reel_media_ownership_trg` has been live on `highlight_reels` for some
-- time, added out of band rather than through this directory. Nothing here
-- changes production: the function below is byte-for-byte what is already
-- running, and CREATE OR REPLACE plus DROP/CREATE TRIGGER re-assert it
-- identically. The point is that a database rebuilt from these migrations comes
-- up with the control, because without it the rebuilt instance is vulnerable.
--
-- What it defends. `highlight_reels` is writable by its owner through one RLS
-- policy, "Users manage own reels" (FOR ALL, auth.uid() = user_id). That policy
-- constrains `user_id` and nothing else, so the five media path columns are
-- free text as far as RLS is concerned — a signed-in user can put any string in
-- them straight from the browser client. Several readers then hand those
-- strings to the service-role client:
--
--   supabaseAdmin.storage.from("highlight-videos")
--     .createSignedUrl(r.playback_path ?? r.video_path, 3600)
--
-- in src/lib/highlight-feed.functions.ts and src/lib/reels.functions.ts. The
-- service role bypasses Storage RLS, so without this trigger, pointing your own
-- reel at someone else's object and reading your own recaps returns a working
-- signed URL to their footage. The bucket holds raw uploads, extracted frames
-- and audio tracks, including minors'. Public visibility is not required: the
-- recap reader filters on status and hidden_at for a given user id, all of
-- which the attacker controls on their own row.
--
-- So this is the only thing standing between that RLS policy and an
-- authenticated arbitrary read of the whole bucket. It belongs in version
-- control.
--
-- Verified against production before writing: six attack shapes are refused
-- (video_path, playback_path and frame_paths pointed at another user, on both
-- INSERT and UPDATE, plus ".." traversal) while a normal owner-scoped reel
-- inserts fine.

CREATE OR REPLACE FUNCTION public.enforce_reel_media_ownership()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  _p text;
  _paths text[];
BEGIN
  _paths := ARRAY[NEW.video_path, NEW.playback_path, NEW.thumbnail_path, NEW.audio_path]
            || COALESCE(NEW.frame_paths, ARRAY[]::text[]);

  FOREACH _p IN ARRAY _paths LOOP
    IF _p IS NULL OR _p = '' THEN
      CONTINUE;
    END IF;
    IF _p LIKE '%..%' THEN
      RAISE EXCEPTION 'REEL_MEDIA_PATH_INVALID: media paths cannot contain "..".';
    END IF;
    IF split_part(_p, '/', 1) <> NEW.user_id::text THEN
      RAISE EXCEPTION 'REEL_MEDIA_PATH_FORBIDDEN: reel media must live in the owner''s own folder.';
    END IF;
  END LOOP;

  RETURN NEW;
END $function$;

REVOKE EXECUTE ON FUNCTION public.enforce_reel_media_ownership() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS enforce_reel_media_ownership_trg ON public.highlight_reels;
CREATE TRIGGER enforce_reel_media_ownership_trg
  BEFORE INSERT OR UPDATE ON public.highlight_reels
  FOR EACH ROW EXECUTE FUNCTION public.enforce_reel_media_ownership();
