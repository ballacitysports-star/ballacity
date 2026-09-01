CREATE OR REPLACE FUNCTION public.public_privacy_flags(_ids uuid[])
RETURNS TABLE(user_id uuid, show_sports boolean, show_games_played boolean)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.id,
         COALESCE(p.show_sports, true),
         COALESCE(p.show_games_played, true)
    FROM unnest(_ids) AS u(id)
    LEFT JOIN public.privacy_preferences p ON p.user_id = u.id;
$$;

REVOKE ALL ON FUNCTION public.public_privacy_flags(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_privacy_flags(uuid[]) TO anon, authenticated, service_role;