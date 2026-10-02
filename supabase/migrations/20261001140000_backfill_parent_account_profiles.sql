-- Backfill: every existing guardian gets their account_profiles 'parent' row.
--
-- 20261001130000_parent_account_type.sql only creates this row going forward,
-- the moment provision_managed_child() runs. Anyone who already manages a
-- child (a row in managed_accounts, from before this change existed) would
-- otherwise never get one, since nothing re-runs provision_managed_child()
-- for an already-provisioned child.
--
-- Deliberately does not touch active_profile_id, default_profile_id, or
-- account_type: the parent profile becomes available to switch into, but
-- nobody's current view changes. ON CONFLICT DO NOTHING makes this safe to
-- run again.

INSERT INTO public.account_profiles (user_id, kind, ref_id)
SELECT DISTINCT managed_by, 'parent', NULL
FROM public.managed_accounts
ON CONFLICT DO NOTHING;
