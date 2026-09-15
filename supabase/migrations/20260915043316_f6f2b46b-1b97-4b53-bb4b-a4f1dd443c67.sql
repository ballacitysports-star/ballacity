-- 1. Media paths on a reel must live in the owner's own storage folder.
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

REVOKE ALL ON FUNCTION public.enforce_reel_media_ownership() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.enforce_reel_media_ownership() FROM anon, authenticated;

DROP TRIGGER IF EXISTS enforce_reel_media_ownership_trg ON public.highlight_reels;
CREATE TRIGGER enforce_reel_media_ownership_trg
  BEFORE INSERT OR UPDATE ON public.highlight_reels
  FOR EACH ROW EXECUTE FUNCTION public.enforce_reel_media_ownership();

-- 2. Audience-gated readers for the public feed / public player card.
--    reel_audience() returns 'none' for child_under_13, teen_13_15 and locked
--    child accounts, and 'members' for teen_16_17 (signed-in viewers only).
CREATE OR REPLACE FUNCTION public.public_reel_feed_ids(
  _cursor timestamptz DEFAULT NULL,
  _sport text DEFAULT NULL,
  _limit int DEFAULT 8,
  _include_members boolean DEFAULT false
)
RETURNS TABLE (id uuid, created_at timestamptz)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT r.id, r.created_at
  FROM public.highlight_reels r
  WHERE r.status = 'completed'
    AND r.hidden_at IS NULL
    AND (_sport IS NULL OR r.ai_sport = _sport)
    AND (_cursor IS NULL OR r.created_at < _cursor)
    AND (
      public.reel_audience(r.id) = 'public'
      OR (COALESCE(_include_members, false) AND public.reel_audience(r.id) = 'members')
    )
  ORDER BY r.created_at DESC
  LIMIT LEAST(GREATEST(COALESCE(_limit, 8), 1), 50);
$function$;

CREATE OR REPLACE FUNCTION public.public_reel_feed_sports(
  _include_members boolean DEFAULT false
)
RETURNS TABLE (sport text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT DISTINCT r.ai_sport
  FROM public.highlight_reels r
  WHERE r.status = 'completed'
    AND r.hidden_at IS NULL
    AND r.ai_sport IS NOT NULL
    AND (
      public.reel_audience(r.id) = 'public'
      OR (COALESCE(_include_members, false) AND public.reel_audience(r.id) = 'members')
    )
  ORDER BY 1;
$function$;

CREATE OR REPLACE FUNCTION public.public_user_reel_ids(
  _user_id uuid,
  _limit int DEFAULT 12,
  _include_members boolean DEFAULT false
)
RETURNS TABLE (id uuid, created_at timestamptz)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT r.id, r.created_at
  FROM public.highlight_reels r
  WHERE r.user_id = _user_id
    AND r.status = 'completed'
    AND r.hidden_at IS NULL
    AND (
      public.reel_audience(r.id) = 'public'
      OR (COALESCE(_include_members, false) AND public.reel_audience(r.id) = 'members')
    )
  ORDER BY r.created_at DESC
  LIMIT LEAST(GREATEST(COALESCE(_limit, 12), 1), 50);
$function$;

REVOKE ALL ON FUNCTION public.public_reel_feed_ids(timestamptz, text, int, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.public_reel_feed_sports(boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.public_user_reel_ids(uuid, int, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_reel_feed_ids(timestamptz, text, int, boolean) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.public_reel_feed_sports(boolean) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.public_user_reel_ids(uuid, int, boolean) TO anon, authenticated, service_role;