-- ROLLBACK for supabase/migrations/20261110130000_entity_follow_counts.sql (P1-1).
-- NOT a migration. It removes public.entity_follow_counts. The app must be on a version that does not call it, or
-- directory cards lose their follower counts (they hide the number when the call fails). It refuses to run unless:
--     PGOPTIONS="-c app.confirm_drop_entity_follow_counts=yes" psql ... -f <this file>
BEGIN;
DO $guard$
BEGIN
  IF current_setting('app.confirm_drop_entity_follow_counts', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'Refusing to run: directory cards read follower counts through this function. Set app.confirm_drop_entity_follow_counts=yes for the session to proceed deliberately.';
  END IF;
END
$guard$;

DROP FUNCTION IF EXISTS public.entity_follow_counts(text, text[]);

COMMIT;
