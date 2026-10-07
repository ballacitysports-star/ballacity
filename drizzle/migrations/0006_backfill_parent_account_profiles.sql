INSERT INTO public.account_profiles (user_id, kind, ref_id)
SELECT DISTINCT managed_by, 'parent', NULL
FROM public.managed_accounts
ON CONFLICT DO NOTHING;