INSERT INTO public.user_roles (user_id, role)
SELECT id, 'superadmin'::public.app_role FROM auth.users WHERE email = 'ballacitysports@gmail.com'
ON CONFLICT (user_id, role) DO NOTHING;