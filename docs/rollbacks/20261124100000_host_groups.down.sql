-- ROLLBACK for supabase/migrations/20261124100000_host_groups.sql (WP 3.2b).
-- NOT a migration. It drops host_groups and host_group_members, their rules, triggers and helper functions. Every host's lists are
-- deleted (they are the hosts' private notes; nothing else refers to them). Invitations already sent stay as they are.
-- It refuses to run unless the session sets the confirmation first, and stops, changing nothing, if a later migration made
-- anything else depend on these tables:
--     SET app.confirm_host_groups_rollback = 'yes';
BEGIN;
DO $guard$
BEGIN
  IF current_setting('app.confirm_host_groups_rollback', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'Refusing to run: this deletes every host''s groups. Set app.confirm_host_groups_rollback=yes for the session to proceed deliberately.';
  END IF;
  IF to_regclass('public.host_groups') IS NULL THEN
    RAISE EXCEPTION 'Refusing to run: public.host_groups does not exist (already rolled back?).';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint c
              WHERE c.confrelid IN ('public.host_groups'::regclass, 'public.host_group_members'::regclass)
                AND c.conrelid NOT IN ('public.host_groups'::regclass, 'public.host_group_members'::regclass)) THEN
    RAISE EXCEPTION 'Refusing to run: another table now refers to host_groups. A person needs to look first.';
  END IF;
END
$guard$;

SET LOCAL lock_timeout = '5s';

DROP TABLE public.host_group_members;
DROP TABLE public.host_groups;
DROP FUNCTION private_sec.host_groups_limits();
DROP FUNCTION private_sec.owns_host_group(uuid);
DROP FUNCTION private_sec.is_my_regular(uuid);

COMMIT;
