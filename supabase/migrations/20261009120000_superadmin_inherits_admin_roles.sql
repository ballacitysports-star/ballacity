-- Role hierarchy: superadmin > admin > moderator.
-- A superadmin passes every has_role(_, 'admin') and has_role(_, 'moderator')
-- check (including RLS policies) without needing separate rows. Inheritance is
-- one-directional: has_role(_, 'superadmin') still requires the literal role.
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id
      AND (
        role = _role
        OR (role = 'superadmin'::public.app_role
            AND _role IN ('admin'::public.app_role, 'moderator'::public.app_role))
      )
  )
$$;

REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;
