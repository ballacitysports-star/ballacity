-- ROLLBACK for supabase/migrations/20261122100000_game_series.sql (WP 3.1).
-- NOT a migration. It unschedules 'extend-game-series', clears the "repeats" label (rrule) on the games of every series, and drops
-- game_series_start, game_series_stop, the generator functions and the game_series table. Games already created stay as they
-- are, with their series_id (the app then shows them like dates picked up front); no new dates are created afterwards.
-- It stops, changing nothing, if the generator or game_series_start no longer has the definition 20261122100000 gave it (a later
-- change needs a person to look first), and refuses to run unless the session sets the confirmation first:
--     SET app.confirm_game_series_rollback = 'yes';
BEGIN;
DO $guard$
DECLARE
  _gen text;
  _start text;
BEGIN
  IF current_setting('app.confirm_game_series_rollback', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'Refusing to run: this ends every repeating game series. Set app.confirm_game_series_rollback=yes for the session to proceed deliberately.';
  END IF;
  SELECT md5(pg_get_functiondef(p.oid)) INTO _gen
    FROM pg_proc p WHERE p.oid = to_regprocedure('private_sec.extend_game_series(uuid,timestamptz)');
  SELECT md5(pg_get_functiondef(p.oid)) INTO _start
    FROM pg_proc p WHERE p.oid = to_regprocedure('public.game_series_start(text,text,date)');
  IF _gen IS DISTINCT FROM '0dddb7ff51c7d0ea8da9f1a27c6db634' OR _start IS DISTINCT FROM 'f15bc8ef89af9494d1cf4f60fd9fa526' THEN
    RAISE EXCEPTION 'Refusing to run: the series functions are not the definitions 20261122100000 created (md5 % / %). A later change needs a person to look first.', _gen, _start;
  END IF;
END
$guard$;

SET LOCAL lock_timeout = '5s';

DO $cron$
DECLARE
  _scheduled boolean := false;
BEGIN
  IF to_regclass('cron.job') IS NOT NULL THEN
    EXECUTE $q$SELECT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'extend-game-series')$q$ INTO _scheduled;
  END IF;
  IF _scheduled THEN
    EXECUTE $q$SELECT cron.unschedule('extend-game-series')$q$;
  END IF;
END
$cron$;

UPDATE public.hosted_games SET rrule = NULL
 WHERE rrule IS NOT NULL AND series_id IN (SELECT id FROM public.game_series);

DROP FUNCTION public.game_series_start(text, text, date);
DROP FUNCTION public.game_series_stop(uuid);
DROP FUNCTION private_sec.extend_all_game_series(timestamptz);
DROP FUNCTION private_sec.extend_game_series(uuid, timestamptz);
DROP FUNCTION private_sec.series_host_still_eligible(uuid, text);
DROP TABLE public.game_series;

COMMIT;
