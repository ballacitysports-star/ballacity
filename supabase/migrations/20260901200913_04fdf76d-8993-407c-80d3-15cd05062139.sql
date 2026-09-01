REVOKE ALL ON FUNCTION public.privacy_text(uuid, text) FROM anon, authenticated, PUBLIC;
REVOKE ALL ON FUNCTION public.shares_game_or_chat(uuid, uuid) FROM anon, authenticated, PUBLIC;
REVOKE ALL ON FUNCTION public.has_verified_gym_visit(uuid, uuid) FROM anon, authenticated, PUBLIC;
REVOKE ALL ON FUNCTION public.get_account_type(uuid) FROM anon, authenticated, PUBLIC;
REVOKE ALL ON FUNCTION public.free_reels_used(uuid, text) FROM anon, authenticated, PUBLIC;
REVOKE ALL ON FUNCTION public.has_active_subscription(uuid, text) FROM anon, authenticated, PUBLIC;