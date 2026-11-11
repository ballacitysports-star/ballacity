-- ROLLBACK for supabase/migrations/20261106230000_games_near.sql (P1-4, first slice).
-- NOT a migration. It removes games_near and its two indexes. No data is changed; nothing in the app uses
-- games_near until a later change switches the feed over. It refuses to run unless the session confirms:
--     PGOPTIONS="-c app.confirm_drop_games_near=yes" psql ... -f <this file>
BEGIN;
DO $guard$
BEGIN
  IF current_setting('app.confirm_drop_games_near', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'Refusing to run: set app.confirm_drop_games_near=yes for the session to proceed deliberately.';
  END IF;
END
$guard$;

DROP FUNCTION IF EXISTS public.games_near(double precision, double precision, double precision, text[], timestamptz, text, integer, integer);
DROP INDEX IF EXISTS public.hosted_games_lat_lng_idx;
DROP INDEX IF EXISTS public.hosted_games_sport_date_live_idx;

COMMIT;
