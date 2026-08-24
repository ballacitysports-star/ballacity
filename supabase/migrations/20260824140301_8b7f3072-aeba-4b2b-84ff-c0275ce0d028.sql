DROP VIEW IF EXISTS public.blocked_images;

CREATE OR REPLACE FUNCTION public.blocked_image_paths()
RETURNS TABLE(bucket text, path text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.bucket, m.path
    FROM public.image_moderation m
   WHERE m.status IN ('quarantined','removed');
$$;

REVOKE ALL ON FUNCTION public.blocked_image_paths() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.blocked_image_paths() TO anon, authenticated, service_role;