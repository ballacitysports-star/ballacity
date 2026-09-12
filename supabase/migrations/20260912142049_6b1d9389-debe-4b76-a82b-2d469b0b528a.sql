REVOKE SELECT (moderation_state, suspended_at, suspended_reason) ON public.profiles FROM anon;
REVOKE SELECT (moderation_state, suspended_at, suspended_reason) ON public.profiles FROM authenticated;
GRANT ALL ON public.profiles TO service_role;