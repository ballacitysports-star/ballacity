-- Lock the three audience-gated reel readers to service_role only.
-- Legitimate callers run through supabaseAdmin (service_role) with the
-- viewer identity resolved server-side by optionalSupabaseUserId(), so
-- anon/authenticated EXECUTE only enables the _include_members bypass.
REVOKE EXECUTE ON FUNCTION public.public_reel_feed_ids(timestamp with time zone, text, integer, boolean) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.public_reel_feed_sports(boolean) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.public_user_reel_ids(uuid, integer, boolean) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.public_reel_feed_ids(timestamp with time zone, text, integer, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.public_reel_feed_sports(boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.public_user_reel_ids(uuid, integer, boolean) TO service_role;