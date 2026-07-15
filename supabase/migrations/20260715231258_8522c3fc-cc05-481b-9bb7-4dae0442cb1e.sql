REVOKE EXECUTE ON FUNCTION public.is_game_participant(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_game_participant(text, uuid) TO authenticated, service_role;