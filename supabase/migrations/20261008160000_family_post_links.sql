-- Private share links for family posts.
--
-- A parent can create a link to ONE family post (their clip of their under-13
-- child) and send it to someone, such as a coach or a relative. The clip still is
-- not on the feed, on a profile, or visible to other members: the link is the only
-- way in, it opens that single clip with no child name, no profile and no
-- comments, it expires, and the parent can revoke it.
--
-- OFF until app_settings 'family_post_links' = {"enabled": true} AND
-- 'family_posts' = {"enabled": true}. Missing means off.
--
-- Only a SHA-256 hash of the secret is stored, so a database leak does not expose
-- a working link. Links are created and resolved only by server code using the
-- service role; members cannot insert, update or read other people's links.
--
-- Every time a link is opened the resolver re-checks, in the database:
--   * both switches are on;
--   * the link is not revoked and has not expired;
--   * the reel is still a completed family post and not hidden (a safety hold or
--     moderation action stops the link working immediately);
--   * the link's creator still owns the reel and is still an active, verified
--     guardian of the child (revoking the guardian link kills the share link).
-- Deleting the reel, the child or the parent deletes the links.

CREATE TABLE IF NOT EXISTS public.family_post_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reel_id uuid NOT NULL REFERENCES public.highlight_reels(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  view_count integer NOT NULL DEFAULT 0,
  last_viewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS family_post_links_reel_idx ON public.family_post_links (reel_id);

ALTER TABLE public.family_post_links ENABLE ROW LEVEL SECURITY;

-- A parent can see the links they created (never the secret, which is not stored).
DROP POLICY IF EXISTS "Creator reads own family post links" ON public.family_post_links;
CREATE POLICY "Creator reads own family post links"
  ON public.family_post_links FOR SELECT TO authenticated
  USING (created_by = auth.uid());

REVOKE ALL ON public.family_post_links FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.family_post_links TO authenticated;
GRANT ALL ON public.family_post_links TO service_role;

CREATE OR REPLACE FUNCTION public.family_share_enabled()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE((SELECT (value ->> 'enabled')::boolean FROM public.app_settings
                   WHERE key = 'family_posts'), false)
     AND COALESCE((SELECT (value ->> 'enabled')::boolean FROM public.app_settings
                   WHERE key = 'family_post_links'), false);
$$;

REVOKE EXECUTE ON FUNCTION public.family_share_enabled() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.family_share_enabled() TO service_role;

-- Defence in depth: even a direct insert must satisfy the rules.
CREATE OR REPLACE FUNCTION public.guard_family_post_link()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE r record;
BEGIN
  IF NOT public.family_share_enabled() THEN
    RAISE EXCEPTION 'FAMILY_SHARE_OFF';
  END IF;

  SELECT user_id, subject_child_id, status, hidden_at INTO r
  FROM public.highlight_reels WHERE id = NEW.reel_id;

  IF r.subject_child_id IS NULL OR r.user_id IS DISTINCT FROM NEW.created_by THEN
    RAISE EXCEPTION 'FAMILY_SHARE_NOT_OWNER';
  END IF;
  IF NOT public.is_guardian_of(NEW.created_by, r.subject_child_id) THEN
    RAISE EXCEPTION 'FAMILY_POST_NOT_GUARDIAN';
  END IF;
  IF r.status <> 'completed' OR r.hidden_at IS NOT NULL THEN
    RAISE EXCEPTION 'FAMILY_SHARE_NOT_READY';
  END IF;
  IF NEW.expires_at <= now() OR NEW.expires_at > now() + interval '31 days' THEN
    RAISE EXCEPTION 'FAMILY_SHARE_BAD_EXPIRY';
  END IF;
  IF (SELECT count(*) FROM public.family_post_links l
      WHERE l.reel_id = NEW.reel_id AND l.revoked_at IS NULL AND l.expires_at > now()) >= 5 THEN
    RAISE EXCEPTION 'FAMILY_SHARE_TOO_MANY';
  END IF;
  RETURN NEW;
END $$;

REVOKE EXECUTE ON FUNCTION public.guard_family_post_link() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_family_post_link ON public.family_post_links;
CREATE TRIGGER trg_guard_family_post_link
BEFORE INSERT ON public.family_post_links
FOR EACH ROW EXECUTE FUNCTION public.guard_family_post_link();

-- Resolves a link (by the hash of its secret) to the one clip it opens, or to
-- nothing. Counts the view. Returns no child name or owner details.
CREATE OR REPLACE FUNCTION public.resolve_family_post_link(_token_hash text)
RETURNS TABLE (
  reel_id uuid,
  owner_id uuid,
  title text,
  caption text,
  video_path text,
  playback_path text,
  thumbnail_path text
)
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE l record; r record;
BEGIN
  IF NOT public.family_share_enabled() THEN
    RETURN;
  END IF;

  SELECT * INTO l FROM public.family_post_links
  WHERE token_hash = _token_hash AND revoked_at IS NULL AND expires_at > now();
  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT h.id, h.user_id, h.subject_child_id, h.status, h.hidden_at, h.title AS t, h.ai_title,
         h.ai_caption, h.video_path AS vp, h.playback_path AS pp, h.thumbnail_path AS tp
  INTO r FROM public.highlight_reels h WHERE h.id = l.reel_id;

  IF NOT FOUND OR r.subject_child_id IS NULL OR r.status <> 'completed' OR r.hidden_at IS NOT NULL
     OR r.user_id IS DISTINCT FROM l.created_by
     OR NOT public.is_guardian_of(l.created_by, r.subject_child_id) THEN
    RETURN;
  END IF;

  UPDATE public.family_post_links
     SET view_count = view_count + 1, last_viewed_at = now()
   WHERE id = l.id;

  RETURN QUERY SELECT r.id, r.user_id, COALESCE(NULLIF(r.ai_title, ''), r.t), r.ai_caption,
                      r.vp, r.pp, r.tp;
END $$;

REVOKE EXECUTE ON FUNCTION public.resolve_family_post_link(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_family_post_link(text) TO service_role;
