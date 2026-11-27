-- ROLLBACK for supabase/migrations/20261104100000_youth_game_private_location.sql (PRIV-2A).
-- NOT a migration. It removes the private exact-location table, its policy, trigger, guard and functions.
--
-- ONLY BEFORE COARSENING WAS EVER ACTIVATED. The coarsening switch is one-way (a trigger refuses to turn it off or
-- delete it once on), and no function puts exact values back into public columns. Once the switch has been on, the
-- private table is the only place the exact locations exist and this script refuses to run: recover by fixing forward,
-- never by re-publishing exact venues. While the switch is still off nothing was ever coarsened, the public columns
-- still hold the exact values, and removing the private table loses nothing.
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
    RAISE EXCEPTION 'Refusing to run: coarsening has been activated and cannot be rolled back. The exact locations exist only in hosted_game_private; fix forward.';
  END IF;
  SELECT count(*) INTO _n FROM public.hosted_game_private p JOIN public.hosted_games g ON g.id = p.game_id
   WHERE g.location IS DISTINCT FROM p.location OR g.lat IS DISTINCT FROM p.lat OR g.lng IS DISTINCT FROM p.lng;
  IF _n > 0 THEN
    RAISE EXCEPTION 'Refusing to run: % game(s) hold a public location that differs from their private copy; the private table may be the only exact record.', _n;
  END IF;
END
$guard$;

DROP TRIGGER IF EXISTS guard_youth_location_switch_trg ON public.app_settings;
DROP FUNCTION IF EXISTS public.guard_youth_location_switch();
DROP TRIGGER IF EXISTS a1_sync_hosted_game_private_trg ON public.hosted_games;
DROP FUNCTION IF EXISTS public.sync_hosted_game_private();
DROP FUNCTION IF EXISTS public.coarsen_existing_youth_games(integer);
DROP TABLE IF EXISTS public.hosted_game_private;
DROP FUNCTION IF EXISTS private_sec.can_see_exact_game_location(text);
DROP FUNCTION IF EXISTS private_sec.game_fee_satisfied(text, uuid);
DROP FUNCTION IF EXISTS private_sec.coarse_game_label(text);
DELETE FROM public.app_settings WHERE key = 'youth_location_privacy';
COMMIT;
