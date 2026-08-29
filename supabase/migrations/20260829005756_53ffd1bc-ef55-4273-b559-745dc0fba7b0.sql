ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS avatar_visibility text NOT NULL DEFAULT 'public';

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_avatar_visibility_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_avatar_visibility_check
  CHECK (avatar_visibility IN ('public', 'members', 'game_members'));

CREATE OR REPLACE FUNCTION public.shares_game_or_chat(_a uuid, _b uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _a IS NOT NULL AND _b IS NOT NULL AND (
    _a = _b
    OR EXISTS (
      SELECT 1
      FROM public.game_participants pa
      JOIN public.game_participants pb ON pb.game_id = pa.game_id
      WHERE pa.user_id = _a AND pb.user_id = _b
    )
    OR EXISTS (
      SELECT 1
      FROM public.hosted_games g
      JOIN public.game_participants p ON p.game_id = g.id
      WHERE (g.host_id = _a AND p.user_id = _b)
         OR (g.host_id = _b AND p.user_id = _a)
    )
    OR EXISTS (
      SELECT 1
      FROM public.conversation_participants ca
      JOIN public.conversation_participants cb ON cb.conversation_id = ca.conversation_id
      WHERE ca.user_id = _a AND cb.user_id = _b
    )
  );
$$;

REVOKE ALL ON FUNCTION public.shares_game_or_chat(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.shares_game_or_chat(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.shares_game_or_chat(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.shares_game_or_chat(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.visible_avatars(_ids uuid[])
RETURNS TABLE (
  id uuid,
  display_name text,
  avatar_initials text,
  avatar_url text,
  avatar_visibility text,
  avatar_hidden boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id,
    p.display_name,
    p.avatar_initials,
    CASE
      WHEN p.avatar_url IS NULL THEN NULL
      WHEN p.id = auth.uid() THEN p.avatar_url
      WHEN p.avatar_visibility = 'public' THEN p.avatar_url
      WHEN p.avatar_visibility = 'members' AND auth.uid() IS NOT NULL THEN p.avatar_url
      WHEN p.avatar_visibility = 'game_members'
        AND auth.uid() IS NOT NULL
        AND public.shares_game_or_chat(auth.uid(), p.id) THEN p.avatar_url
      ELSE NULL
    END AS avatar_url,
    p.avatar_visibility,
    (
      p.avatar_url IS NOT NULL
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

REVOKE ALL ON FUNCTION public.visible_avatars(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.visible_avatars(uuid[]) TO anon;
GRANT EXECUTE ON FUNCTION public.visible_avatars(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.visible_avatars(uuid[]) TO service_role;