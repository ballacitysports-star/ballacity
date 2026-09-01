GRANT SELECT ON public.profiles TO anon;
GRANT SELECT ON public.trainer_orgs TO anon;
GRANT SELECT ON public.game_participants TO anon;
GRANT EXECUTE ON FUNCTION public.profile_visibility_of(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.is_game_participant(text, uuid) TO anon;