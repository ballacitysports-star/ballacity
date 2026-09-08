REVOKE EXECUTE ON FUNCTION public.age_verified(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.default_profile_visibility_for(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.my_platform_status() FROM anon;
REVOKE EXECUTE ON FUNCTION public.platform_status(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.public_privacy_flags(uuid[]) FROM anon;
REVOKE EXECUTE ON FUNCTION public.reel_audience(uuid) FROM anon;