-- 1) Trigger-only SECURITY DEFINER helpers must not be callable from the API
REVOKE EXECUTE ON FUNCTION public.validate_hosted_game_age_range() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_game_age_requirement() FROM PUBLIC, anon, authenticated;

-- 2) Keep non-public avatar URLs out of directly readable columns
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_url_private text;
REVOKE SELECT (avatar_url_private) ON public.profiles FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_private_avatar_url()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF coalesce(NEW.avatar_visibility, 'public') = 'public' THEN
    NEW.avatar_url := coalesce(NEW.avatar_url, NEW.avatar_url_private);
    NEW.avatar_url_private := NULL;
  ELSE
    -- Non-public avatars live only in the private column, so a plain
    -- select on profiles can never leak them.
    IF NEW.avatar_url IS NOT NULL AND NEW.avatar_url <> '' THEN
      NEW.avatar_url_private := NEW.avatar_url;
    ELSIF NEW.avatar_url = '' THEN
      -- explicit removal
      NEW.avatar_url_private := NULL;
    END IF;
    NEW.avatar_url := NULL;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.sync_private_avatar_url() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS profiles_sync_private_avatar_url ON public.profiles;
CREATE TRIGGER profiles_sync_private_avatar_url
BEFORE INSERT OR UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.sync_private_avatar_url();

-- Backfill existing rows through the same rule
UPDATE public.profiles SET avatar_url = avatar_url WHERE avatar_url IS NOT NULL OR avatar_url_private IS NOT NULL;

-- Visibility-aware reader now considers both columns
CREATE OR REPLACE FUNCTION public.visible_avatars(_ids uuid[])
RETURNS TABLE(id uuid, display_name text, avatar_initials text, avatar_url text, avatar_visibility text, avatar_hidden boolean)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id,
    p.display_name,
    p.avatar_initials,
    CASE
      WHEN coalesce(p.avatar_url, p.avatar_url_private) IS NULL THEN NULL
      WHEN p.id = auth.uid() THEN coalesce(p.avatar_url, p.avatar_url_private)
      WHEN p.avatar_visibility = 'public' THEN coalesce(p.avatar_url, p.avatar_url_private)
      WHEN p.avatar_visibility = 'members' AND auth.uid() IS NOT NULL
        THEN coalesce(p.avatar_url, p.avatar_url_private)
      WHEN p.avatar_visibility = 'game_members'
        AND auth.uid() IS NOT NULL
        AND public.shares_game_or_chat(auth.uid(), p.id)
        THEN coalesce(p.avatar_url, p.avatar_url_private)
      ELSE NULL
    END AS avatar_url,
    p.avatar_visibility,
    (
      coalesce(p.avatar_url, p.avatar_url_private) IS NOT NULL
      AND NOT (
        p.id = auth.uid()
        OR p.avatar_visibility = 'public'
        OR (p.avatar_visibility = 'members' AND auth.uid() IS NOT NULL)
        OR (
          p.avatar_visibility = 'game_members'
          AND auth.uid() IS NOT NULL
          AND public.shares_game_or_chat(auth.uid(), p.id)
        )
      )
    ) AS avatar_hidden
  FROM public.profiles p
  WHERE p.id = ANY(_ids)
    AND p.suspended_at IS NULL;
$$;

-- 3) Game cover reads must respect game privacy
DROP POLICY IF EXISTS "Authenticated read game covers" ON storage.objects;
CREATE POLICY "Authenticated read game covers"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'game-covers'
  AND (
    (auth.uid())::text = (storage.foldername(name))[1]
    OR EXISTS (
      SELECT 1 FROM public.hosted_games g
      WHERE g.image LIKE '%' || storage.objects.name || '%'
        AND (
          g.is_private IS NOT TRUE
          OR g.host_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.game_participants gp
            WHERE gp.game_id = g.id AND gp.user_id = auth.uid()
          )
          OR EXISTS (
            SELECT 1 FROM public.join_requests jr
            WHERE jr.game_id = g.id AND jr.player_id = auth.uid() AND jr.status = 'approved'
          )
        )
    )
  )
);