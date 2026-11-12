-- ROLLBACK for supabase/migrations/20261111180000_lock_published_team_waivers.sql.
-- NOT a migration. It reopens what the migration closed: a team manager can again clear a published waiver's
-- published_at and then edit the text people signed, unpublish and delete it (taking its signatures with it), mark a
-- draft published directly (live for signing, still editable), edit and delete a retired or signed version that has
-- no published_at, and insert a draft that already carries published_at or archived_at. It puts back, as they were
-- before the migration (drizzle/migrations/0008_team_waivers.sql):
--   * the table-wide INSERT and UPDATE privileges of anon and authenticated, and drops the column grants;
--   * team_waivers_guard, byte for byte (md5(pg_get_functiondef) = b88e201fe1bf0c36c187da1b17436e86);
--   * team_waivers_manager_delete_draft (md5 of its USING|WITH CHECK = a4455a6b050108334b795fdcc281a65d).
-- No row is written.
-- It refuses to run unless the session sets the confirmation first:
--     SET app.confirm_lock_published_team_waivers_rollback = 'yes';
--     (or PGOPTIONS="-c app.confirm_lock_published_team_waivers_rollback=yes")
BEGIN;
DO $guard$
BEGIN
  IF current_setting('app.confirm_lock_published_team_waivers_rollback', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'Refusing to run: this lets team managers edit, unpublish and delete signed waivers again. Set app.confirm_lock_published_team_waivers_rollback=yes for the session to proceed deliberately.';
  END IF;
END
$guard$;

SET LOCAL lock_timeout = '5s';

-- Privileges, as they were. Revoking the table-wide privilege also clears the column grants of it.
REVOKE INSERT, UPDATE ON public.team_waivers FROM anon, authenticated;
GRANT INSERT, UPDATE ON public.team_waivers TO anon, authenticated;

-- Policy, as it was.
ALTER POLICY "team_waivers_manager_delete_draft" ON public.team_waivers
  USING (public.is_team_manager(team_id, auth.uid()) AND published_at IS NULL);

-- The definition in force before the migration, unchanged.
CREATE OR REPLACE FUNCTION public.team_waivers_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.published_at IS NOT NULL THEN
    IF NEW.content <> OLD.content OR NEW.version <> OLD.version OR NEW.title <> OLD.title
       OR NEW.team_id <> OLD.team_id THEN
      RAISE EXCEPTION 'Published waiver versions are immutable; create a new version instead';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$
;

COMMIT;
