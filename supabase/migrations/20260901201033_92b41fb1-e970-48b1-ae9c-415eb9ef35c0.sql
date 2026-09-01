CREATE OR REPLACE FUNCTION public.profile_visibility_of(_user uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((SELECT pp.profile_visibility FROM public.privacy_preferences pp WHERE pp.user_id = _user), 'public');
$$;

REVOKE ALL ON FUNCTION public.profile_visibility_of(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.profile_visibility_of(uuid) TO anon, authenticated, service_role;

DROP POLICY IF EXISTS "Public profiles viewable by anon" ON public.profiles;
CREATE POLICY "Public profiles viewable by anon"
ON public.profiles FOR SELECT TO anon
USING (public.profile_visibility_of(id) = 'public');

DROP POLICY IF EXISTS "Profiles viewable by members" ON public.profiles;
CREATE POLICY "Profiles viewable by members"
ON public.profiles FOR SELECT TO authenticated
USING (id = auth.uid() OR public.profile_visibility_of(id) IN ('public','members'));