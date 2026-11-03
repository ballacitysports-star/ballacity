-- ROLLBACK for supabase/migrations/20261104100000_youth_game_private_location.sql (PRIV-2A).
-- NOT a migration. It removes the private exact-location table, its policy, trigger and functions.
--
-- DATA SAFETY. Once the coarsening switch has been on, or coarsen_existing_youth_games() has run, the PRIVATE table is
-- the only place the exact locations exist. Dropping it then would destroy them. So this script refuses to run unless
--   (1) the switch is off, and
--   (2) every youth-inclusive game's public location already equals its private copy (nothing is coarse), i.e.
--       restore_exact_youth_games() has been run until it returns 0.
-- It also needs a typed confirmation:
--     PGOPTIONS="-c app.confirm_drop_private_locations=yes" psql ... -f <this file>
BEGIN;
DO $guard$
DECLARE _n integer;
BEGIN
  IF current_setting('app.confirm_drop_private_locations', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'Refusing to run: set app.confirm_drop_private_locations=yes for the session to proceed deliberately.';
  END IF;
  IF COALESCE((SELECT (value ->> 'coarsen')::boolean FROM public.app_settings WHERE key = 'youth_location_privacy'), false) THEN
    RAISE EXCEPTION 'Refusing to run: the coarsening switch is on. Turn it off and restore exact locations first.';
  END IF;
  SELECT count(*) INTO _n FROM public.hosted_game_private p JOIN public.hosted_games g ON g.id = p.game_id
   WHERE g.location IS DISTINCT FROM p.location OR g.lat IS DISTINCT FROM p.lat OR g.lng IS DISTINCT FROM p.lng;
  IF _n > 0 THEN
    RAISE EXCEPTION 'Refusing to run: % game(s) hold a coarse public location whose exact value is only in the private table. Run restore_exact_youth_games() until it returns 0 first.', _n;
  END IF;
END
$guard$;

DROP TRIGGER IF EXISTS a1_sync_hosted_game_private_trg ON public.hosted_games;
DROP FUNCTION IF EXISTS public.sync_hosted_game_private();
DROP FUNCTION IF EXISTS public.coarsen_existing_youth_games(integer);
DROP FUNCTION IF EXISTS public.restore_exact_youth_games(integer);
DROP TABLE IF EXISTS public.hosted_game_private;
DROP FUNCTION IF EXISTS private_sec.can_see_exact_game_location(text);
DROP FUNCTION IF EXISTS private_sec.coarse_game_label(text);
DELETE FROM public.app_settings WHERE key = 'youth_location_privacy';
COMMIT;
