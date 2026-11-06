-- ROLLBACK for supabase/migrations/20261106220000_following_feed.sql (P1-3).
-- NOT a migration. It removes the Following feed function; the app's Following tab then shows an error.
-- No data is changed. It refuses to run unless the session confirms:
--     PGOPTIONS="-c app.confirm_drop_following_feed=yes" psql ... -f <this file>
BEGIN;
DO $guard$
BEGIN
  IF current_setting('app.confirm_drop_following_feed', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'Refusing to run: the Following tab would stop working. Set app.confirm_drop_following_feed=yes for the session to proceed deliberately.';
  END IF;
END
$guard$;

DROP FUNCTION IF EXISTS public.following_feed(timestamptz, integer);

COMMIT;
