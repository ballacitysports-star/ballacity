REVOKE ALL ON FUNCTION public.enforce_child_game_participation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_minor_handle_safety() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_on_consent_change() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_on_child_game_join() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_on_age_review() FROM PUBLIC, anon, authenticated;